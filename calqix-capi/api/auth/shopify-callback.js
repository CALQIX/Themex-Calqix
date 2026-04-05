/**
 * Shopify OAuth Callback - Eenmalig endpoint voor Authorization Code Grant.
 *
 * Flow:
 * 1. Operator opent de authorize URL in de browser
 * 2. Shopify stuurt terug naar dit endpoint met ?code=...&shop=...&state=...&hmac=...
 * 3. Dit endpoint wisselt de code in voor een offline access token
 * 4. Token wordt getoond zodat de operator het kan opslaan
 *
 * VERWIJDER DIT ENDPOINT NA GEBRUIK. Het is eenmalig.
 */
var fetch = require('node-fetch');
var crypto = require('crypto');

module.exports = async function handler(req, res) {
  try {
    var code = req.query.code;
    var shop = req.query.shop;
    var state = req.query.state;
    var hmac = req.query.hmac;

    console.log('[ShopifyOAuth] Callback ontvangen. shop:', shop, 'state:', state);

    if (!code || !shop) {
      return res.status(400).json({
        error: 'Missende parameters',
        detail: 'code en shop zijn vereist'
      });
    }

    // Validate HMAC
    var apiSecret = process.env.SHOPIFY_API_SECRET;
    if (hmac && apiSecret) {
      var params = Object.assign({}, req.query);
      delete params.hmac;
      var sortedKeys = Object.keys(params).sort();
      var message = sortedKeys.map(function (k) { return k + '=' + params[k]; }).join('&');
      var computed = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
      if (computed !== hmac) {
        console.error('[ShopifyOAuth] HMAC validatie mislukt');
        return res.status(403).json({ error: 'HMAC validatie mislukt' });
      }
      console.log('[ShopifyOAuth] HMAC validatie OK');
    } else {
      console.warn('[ShopifyOAuth] HMAC validatie overgeslagen (geen hmac of secret)');
    }

    // Exchange authorization code for offline access token
    var clientId = process.env.SHOPIFY_API_KEY;
    var clientSecret = process.env.SHOPIFY_API_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: 'SHOPIFY_API_KEY of SHOPIFY_API_SECRET ontbreekt in env'
      });
    }

    console.log('[ShopifyOAuth] Token exchange starten voor shop:', shop);

    var tokenResponse = await fetch('https://' + shop + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code
      })
    });

    var tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.errors) {
      console.error('[ShopifyOAuth] Token exchange mislukt:', JSON.stringify(tokenData));
      return res.status(400).json({
        error: 'Token exchange mislukt',
        shopify_response: tokenData
      });
    }

    var accessToken = tokenData.access_token;
    var scope = tokenData.scope;
    var masked = accessToken ? accessToken.substring(0, 12) + '***' + accessToken.substring(accessToken.length - 4) : 'GEEN TOKEN';

    console.log('[ShopifyOAuth] Token ontvangen! Masked:', masked, 'Scopes:', scope);

    // Verify token works
    var verifyRes = await fetch('https://' + shop + '/admin/api/2024-10/shop.json', {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });
    var verifyOk = verifyRes.ok;
    var shopData = verifyOk ? await verifyRes.json() : null;

    // Return HTML page with token info
    var html = '<!DOCTYPE html><html><head><title>CALQIX Shopify OAuth</title>'
      + '<style>body{font-family:system-ui;max-width:700px;margin:40px auto;padding:20px;background:#0a0a0a;color:#e0e0e0}'
      + 'h1{color:#4ade80}code{background:#1a1a2e;padding:2px 8px;border-radius:4px;font-size:14px;word-break:break-all}'
      + '.box{background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;margin:12px 0}'
      + '.ok{color:#4ade80}.err{color:#f87171}.warn{color:#fbbf24}'
      + '</style></head><body>'
      + '<h1>CALQIX Shopify OAuth</h1>'
      + '<div class="box">'
      + '<p class="' + (verifyOk ? 'ok' : 'err') + '"><strong>Status: ' + (verifyOk ? 'TOKEN WERKT' : 'TOKEN VERIFICATIE MISLUKT') + '</strong></p>'
      + (shopData ? '<p>Shop: ' + shopData.shop.name + ' (' + shopData.shop.myshopify_domain + ')</p>' : '')
      + '<p>Scopes: <code>' + (scope || 'onbekend') + '</code></p>'
      + '</div>'
      + '<div class="box">'
      + '<p><strong>Access Token (kopieer dit):</strong></p>'
      + '<p><code id="token">' + accessToken + '</code></p>'
      + '<button onclick="navigator.clipboard.writeText(document.getElementById(\'token\').textContent);this.textContent=\'Gekopieerd!\'">Kopieer token</button>'
      + '</div>'
      + '<div class="box">'
      + '<p><strong>Volgende stappen:</strong></p>'
      + '<ol>'
      + '<li>Kopieer het token hierboven</li>'
      + '<li>Sla op als <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code> in:<br>'
      + '&nbsp;&nbsp;- <code>calqix-capi/.env</code><br>'
      + '&nbsp;&nbsp;- <code>.env.local</code> (repo root)<br>'
      + '&nbsp;&nbsp;- Vercel env vars (production)</li>'
      + '<li>Verwijder dit callback endpoint (<code>api/auth/shopify-callback.js</code>)</li>'
      + '</ol>'
      + '</div>'
      + '<p class="warn">Dit endpoint is eenmalig. Verwijder het na gebruik.</p>'
      + '</body></html>';

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[ShopifyOAuth] Fout:', err.message, err.stack);
    return res.status(500).json({
      error: 'Interne fout',
      message: err.message
    });
  }
};
