#!/usr/bin/env node
/* One-off Klaviyo audit — reads lists, flows, templates, segments, campaigns, metrics.
 * Safe to re-run. Read-only. */
require('dotenv').config();
const fetch = require('node-fetch');

const KEY = process.env.KLAVIYO_PRIVATE_API_KEY;
const BASE = 'https://a.klaviyo.com/api';
const H = {
  Authorization: 'Klaviyo-API-Key ' + KEY,
  revision: '2024-10-15',
  accept: 'application/vnd.api+json'
};

async function get(path) {
  const r = await fetch(BASE + path, { headers: H });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) console.error('  ERROR body:', JSON.stringify(j).slice(0, 300));
  return { status: r.status, data: j.data || [], meta: j.meta };
}

(async () => {
  if (!KEY) { console.error('missing KLAVIYO_PRIVATE_API_KEY'); process.exit(1); }

  // Klaviyo rejects URL-encoded brackets on some resources. Use literal brackets.
  const sections = [
    ['lists',    '/lists/'],
    ['segments', '/segments/'],
    ['flows',    '/flows/'],
    ['templates','/templates/'],
    ['campaigns-email', '/campaigns/?filter=' + encodeURIComponent('equals(messages.channel,"email")')],
    ['metrics',  '/metrics/']
  ];

  for (const [label, path] of sections) {
    const res = await get(path);
    console.log('\n=== ' + label.toUpperCase() + ' (' + res.status + ', count=' + (res.data || []).length + ') ===');
    (res.data || []).forEach((x) => {
      const a = x.attributes || {};
      const summary = [a.name, a.status, a.trigger_type, a.editor_type, a.opt_in_process, (a.integration && a.integration.name)]
        .filter(Boolean).join(' | ');
      console.log('  [' + x.id + '] ' + summary);
    });
  }

  // Profile count on UeRAty
  const UE = await fetch(BASE + '/lists/UeRAty/relationships/profiles/?page[size]=1', { headers: H });
  const ueJson = await UE.json().catch(() => ({}));
  const total = (ueJson.meta && ueJson.meta.total_count) || (ueJson.data || []).length || 'unknown';
  console.log('\n=== LIST UeRAty (Email List) profile count ===');
  console.log('  total profiles:', total);
})();
