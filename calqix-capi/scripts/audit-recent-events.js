/**
 * Audit recent Meta CAPI events in Redis.
 * Lists meta:event:* keys with their state (received/sent) and Meta result.
 */
require('dotenv').config();
const store = require('../lib/store');
const redis = store._getRedis();

async function main() {
  const patterns = [
    'meta:event:addtocart_*',
    'meta:event:viewcontent_*',
    'meta:event:lead_*'
  ];

  for (const pattern of patterns) {
    console.log(`\n=== ${pattern} ===`);
    let cursor = 0;
    const keys = [];
    do {
      const res = await redis.scan(cursor, { match: pattern, count: 200 });
      cursor = Number(res[0]);
      keys.push(...res[1]);
    } while (cursor !== 0);

    // Sort newest first by the trailing timestamp in the key
    keys.sort((a, b) => {
      const ta = Number(a.split('_').pop()) || 0;
      const tb = Number(b.split('_').pop()) || 0;
      return tb - ta;
    });

    for (const k of keys.slice(0, 5)) {
      const raw = await redis.get(k);
      if (!raw) continue;
      let v;
      try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (e) { v = { raw: String(raw).substring(0, 150) }; }
      const ts = v.received_at || v.sent_at || v.created_at || '';
      console.log(
        `  ${k}`,
        `state=${v.state || '?'}`,
        `source=${v.source || '?'}`,
        `meta_ok=${v.result && v.result.ok}`,
        `received=${ts}`
      );
    }
    console.log(`  (total: ${keys.length})`);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
