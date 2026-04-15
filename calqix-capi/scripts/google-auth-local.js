#!/usr/bin/env node
/**
 * Google OAuth Local Token Acquisition
 *
 * Acquires a refresh token locally without needing the Vercel callback.
 * Starts a tiny local HTTP server, opens the browser, catches the redirect,
 * exchanges the code, and stores the refresh token in Redis.
 *
 * Usage:
 *   node scripts/google-auth-local.js
 *
 * Prerequisites:
 *   - Add http://localhost:3456/callback to Authorized redirect URIs
 *     in Google Cloud Console → Credentials → your OAuth client
 *   - GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env or env
 */
var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

var http = require('http');
var https = require('https');
var url = require('url');
var querystring = require('querystring');
var crypto = require('crypto');

var CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
var CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
var LOCAL_REDIRECT = 'http://localhost:3456/callback';
var SCOPES = 'https://www.googleapis.com/auth/adwords';
var REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
var REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: GOOGLE_OAUTH_CLIENT_ID en GOOGLE_OAUTH_CLIENT_SECRET moeten in env staan.');
  console.error('Tip: maak een .env bestand met deze waarden, of run:');
  console.error('  $env:GOOGLE_OAUTH_CLIENT_ID="..."');
  console.error('  $env:GOOGLE_OAUTH_CLIENT_SECRET="..."');
  process.exit(1);
}

function buildAuthUrl(state) {
  var params = {
    client_id: CLIENT_ID,
    redirect_uri: LOCAL_REDIRECT,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: state
  };
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify(params);
}

function exchangeCode(code) {
  return new Promise(function (resolve, reject) {
    var postData = querystring.stringify({
      code: code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: LOCAL_REDIRECT,
      grant_type: 'authorization_code'
    });

    var options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    var req = https.request(options, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          var data = JSON.parse(body);
          if (data.error) {
            reject(new Error(data.error + ': ' + (data.error_description || '')));
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(new Error('Token parse error: ' + body.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function storeInRedis(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log('[Redis] Geen Redis config — token alleen lokaal opgeslagen.');
    return Promise.resolve(false);
  }

  return new Promise(function (resolve, reject) {
    var redisUrl = REDIS_URL.replace(/\/$/, '') + '/set/' +
      encodeURIComponent(key) + '/' + encodeURIComponent(value);

    var parsed = url.parse(redisUrl);
    var options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + REDIS_TOKEN
      }
    };

    var req = https.request(options, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          var data = JSON.parse(body);
          resolve(data.result === 'OK');
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', function () { resolve(false); });
    req.end();
  });
}

// --- Main ---
var state = crypto.randomBytes(16).toString('hex');
var authUrl = buildAuthUrl(state);

console.log('\n=== Google OAuth Local Token Acquisition ===\n');
console.log('STAP 1: Zorg dat deze redirect URI is toegevoegd in Google Cloud Console:');
console.log('        Credentials → OAuth client → Authorized redirect URIs');
console.log('        URI: ' + LOCAL_REDIRECT);
console.log('');
console.log('STAP 2: Open deze URL in je browser:\n');
console.log(authUrl);
console.log('');
console.log('Wachten op callback op localhost:3456...\n');

// Try to open browser automatically
try {
  var { exec } = require('child_process');
  if (process.platform === 'win32') {
    exec('start "" "' + authUrl + '"');
  } else if (process.platform === 'darwin') {
    exec('open "' + authUrl + '"');
  } else {
    exec('xdg-open "' + authUrl + '"');
  }
} catch (e) {
  console.log('(Kon browser niet automatisch openen — kopieer de URL hierboven)');
}

var server = http.createServer(async function (req, res) {
  var parsed = url.parse(req.url, true);

  if (parsed.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  var code = parsed.query.code;
  var returnedState = parsed.query.state;
  var error = parsed.query.error;

  if (error) {
    console.error('\nERROR van Google:', error, parsed.query.error_description || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>❌ OAuth Error</h1><p>' + error + ': ' + (parsed.query.error_description || '') + '</p>');
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>❌ Geen auth code ontvangen</h1>');
    return;
  }

  if (returnedState !== state) {
    console.error('\nERROR: State mismatch (CSRF)');
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>❌ State mismatch</h1>');
    server.close();
    process.exit(1);
    return;
  }

  console.log('Auth code ontvangen, exchanging for tokens...');

  try {
    var tokens = await exchangeCode(code);
    console.log('\n=== TOKEN EXCHANGE SUCCES ===');
    console.log('Access token: ' + (tokens.access_token ? tokens.access_token.substring(0, 20) + '...' : 'GEEN'));
    console.log('Refresh token: ' + (tokens.refresh_token ? tokens.refresh_token.substring(0, 20) + '...' : 'GEEN'));
    console.log('Expires in: ' + tokens.expires_in + 's');
    console.log('Scope: ' + tokens.scope);

    if (tokens.refresh_token) {
      // Store in Redis
      var stored = await storeInRedis('google:refresh_token', tokens.refresh_token);
      if (stored) {
        console.log('\n✅ Refresh token opgeslagen in Redis (key: google:refresh_token)');
      } else {
        console.log('\n⚠️  Redis opslag mislukt. Sla dit refresh token HANDMATIG op:');
        console.log('    ' + tokens.refresh_token);
      }

      // Also store access token with TTL info
      var atStored = await storeInRedis('google:access_token', JSON.stringify({
        token: tokens.access_token,
        expires_at: Date.now() + (tokens.expires_in * 1000)
      }));
      if (atStored) {
        console.log('✅ Access token opgeslagen in Redis');
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;text-align:center">' +
        '<h1 style="color:#22c55e">&#10003; OAuth Succes!</h1>' +
        '<p>Refresh token is opgeslagen in Redis.</p>' +
        '<p>Je kunt dit venster sluiten.</p>' +
        '<p style="margin-top:30px;color:#666">Volgende stap: zet <code>GOOGLE_ADS_ENABLED=true</code> in Vercel en redeploy.</p>' +
        '</body></html>'
      );
    } else {
      console.log('\n⚠️  Geen refresh token ontvangen. Probeer opnieuw met prompt=consent.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>⚠️ Geen refresh token</h1><p>Probeer opnieuw.</p>');
    }
  } catch (err) {
    console.error('\nToken exchange FOUT:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>❌ Token Exchange Error</h1><p>' + err.message + '</p>');
  }

  setTimeout(function () { server.close(); process.exit(0); }, 1000);
});

server.listen(3456, function () {
  console.log('Local OAuth server draait op http://localhost:3456');
});

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('ERROR: Poort 3456 is al in gebruik. Stop het andere proces eerst.');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
