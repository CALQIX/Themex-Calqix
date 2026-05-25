function header(req, name) {
  if (!req || !req.headers) return '';
  var lower = String(name || '').toLowerCase();
  return req.headers[name] || req.headers[lower] || '';
}

function splitIpList(raw) {
  return String(raw || '').split(',').map(function (s) {
    return s.trim().replace(/^"|"$/g, '');
  }).filter(Boolean);
}

function forwardedForIps(raw) {
  var out = [];
  String(raw || '').split(',').forEach(function (part) {
    var match = part.match(/for="?([^";,\s]+)"?/i);
    if (!match) return;
    out.push(match[1].replace(/^\[|\]$/g, ''));
  });
  return out;
}

function extractClientIP(req, fallbackPayloadIP) {
  var candidates = []
    .concat(splitIpList(header(req, 'cf-connecting-ip')))
    .concat(splitIpList(header(req, 'true-client-ip')))
    .concat(splitIpList(header(req, 'x-real-ip')))
    .concat(splitIpList(header(req, 'x-client-ip')))
    .concat(splitIpList(header(req, 'x-vercel-forwarded-for')))
    .concat(splitIpList(header(req, 'x-forwarded-for')))
    .concat(forwardedForIps(header(req, 'forwarded')))
    .concat(splitIpList(fallbackPayloadIP));

  var ipv6 = candidates.find(function (ip) {
    return ip.indexOf(':') !== -1 && ip.indexOf('::ffff:') !== 0;
  });
  if (ipv6) return ipv6;

  var ipv4 = candidates.find(function (ip) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip);
  });
  if (ipv4) return ipv4;

  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return fallbackPayloadIP || null;
}

module.exports = {
  extractClientIP: extractClientIP
};
