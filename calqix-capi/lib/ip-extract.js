function header(req, name) {
  if (!req || !req.headers) return '';
  return req.headers[name] || req.headers[name.toLowerCase()] || '';
}

function extractClientIP(req, fallbackPayloadIP) {
  var raw = header(req, 'x-forwarded-for');
  var forwarded = String(raw || '').split(',').map(function (s) {
    return s.trim();
  }).filter(Boolean);

  var ipv6 = forwarded.find(function (ip) {
    return ip.indexOf(':') !== -1 && ip.indexOf('::ffff:') !== 0;
  });
  if (ipv6) return ipv6;

  var ipv4 = forwarded.find(function (ip) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip);
  });
  if (ipv4) return ipv4;

  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return fallbackPayloadIP || null;
}

module.exports = {
  extractClientIP: extractClientIP
};
