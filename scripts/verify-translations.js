'use strict';
const fs = require('fs');

const locales = ['ar', 'ja', 'ru', 'zh-CN', 'pt-PT', 'tr', 'th', 'hr-HR', 'pl', 'ko'];

function parse(path) {
  let t = fs.readFileSync(path, 'utf8');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  t = t.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
  return JSON.parse(t);
}

for (const l of locales) {
  const d = parse(`locales/${l}.json`);
  console.log(`\n=== ${l} ===`);
  const r = d.cart && d.cart.rebuild_kit_picker;
  if (!r) { console.log('  (no rebuild_kit_picker)'); continue; }
  console.log(`  banner_label: ${r.banner_label}`);
  console.log(`  banner_title: ${r.banner_title}`);
  console.log(`  banner_sub:   ${r.banner_sub}`);
  console.log(`  combi_label:  ${r.combi_label}`);
  console.log(`  modal_title:  ${r.modal_title}`);
  console.log(`  cta:          ${r.cta}`);
  console.log(`  rrp:          ${r.rrp}`);
  console.log(`  bundle:       ${r.bundle_price_suffix}`);
  console.log(`  footer:       ${r.footer}`);
  const c = d.calqix_cart;
  if (!c) { console.log('  (no calqix_cart)'); continue; }
  console.log(`  addons_head:  ${c.addons_heading}`);
  console.log(`  addon_1:      ${c.addon_1_title} / ${c.addon_1_text}`);
  console.log(`  addon_2:      ${c.addon_2_title} / ${c.addon_2_text}`);
  console.log(`  add/added:    ${c.addon_add} / ${c.addon_added}`);
  console.log(`  trust:        ${c.trust_text}`);
}
