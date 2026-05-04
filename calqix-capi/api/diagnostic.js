const dotenv = require('dotenv');
const { sendTelegram } = require('../lib/telegram');

dotenv.config();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanValue(value) {
  if (value === null || value === undefined) return undefined;
  var text = String(value).slice(0, 240);
  return text.replace(/[\r\n\t]+/g, ' ');
}

function cleanBody(body) {
  var input = body && typeof body === 'object' ? body : {};
  return {
    test: cleanValue(input.test),
    works: typeof input.works === 'boolean' ? input.works : undefined,
    source: cleanValue(input.source),
    error: cleanValue(input.error),
    timestamp: Number(input.timestamp) || Date.now()
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  var data = cleanBody(req.body);
  var text = escapeHtml('[DIAG ' + new Date().toISOString() + '] ' + JSON.stringify(data));
  var telegram = await sendTelegram(text);

  return res.status(200).json({ ok: true, telegram: telegram });
}

module.exports = handler;
