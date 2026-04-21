#!/usr/bin/env node
/**
 * Phase 3: Attempt flow-graph building via Klaviyo Flows API.
 *
 * The Flows API is beta and highly version-fragile. This script probes:
 *   - GET /api/flows/{id}/?include=flow-actions  (always supported)
 *   - PATCH /api/flows/{id}/ status=draft        (may 4xx)
 *   - POST /api/flow-actions/                    (rarely exposed)
 *
 * For every probe the exact response body is logged. Based on the outcome the
 * script writes docs/KLAVIYO-FLOWS-HANDOVER.md with operator UI steps.
 *
 * Usage: node scripts/klaviyo-build-flows.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const KEY = process.env.KLAVIYO_PRIVATE_API_KEY;
const REVISION = '2024-10-15';

if (!KEY) { console.error('FATAL: KLAVIYO_PRIVATE_API_KEY missing'); process.exit(1); }

const H_GET = {
  Authorization: 'Klaviyo-API-Key ' + KEY,
  revision: REVISION,
  accept: 'application/vnd.api+json'
};
const H_WRITE = { ...H_GET, 'content-type': 'application/vnd.api+json' };

const FLOWS = {
  ABANDONED_CART: 'XnTXAH',
  WELCOME: 'U9KJ43',
  BROWSE_ABANDON: 'VJhNs3'
};

const log = [];
function record(label, data) {
  log.push({ label, data });
  console.log('--- ' + label + ' ---');
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2).slice(0, 2000));
}

async function req(method, url, body) {
  try {
    const init = { method, headers: body ? H_WRITE : H_GET };
    if (body) init.body = JSON.stringify(body);
    const r = await fetch(url, init);
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch (_) { j = { raw: text.slice(0, 500) }; }
    return { status: r.status, ok: r.ok, body: j };
  } catch (err) {
    return { status: 0, ok: false, body: { error: err.message } };
  }
}

async function main() {
  console.log('=== Phase 3: Flow API probe ===');

  // 1. Inventory all flows
  const flowsList = await req('GET', 'https://a.klaviyo.com/api/flows/');
  record('list-flows', {
    status: flowsList.status,
    count: (flowsList.body.data || []).length,
    flows: (flowsList.body.data || []).map((f) => ({
      id: f.id,
      name: f.attributes && f.attributes.name,
      status: f.attributes && f.attributes.status,
      trigger_type: f.attributes && f.attributes.trigger_type
    }))
  });

  // 2. Get each target flow + current actions
  for (const [label, id] of Object.entries(FLOWS)) {
    const got = await req('GET', 'https://a.klaviyo.com/api/flows/' + id + '/?include=flow-actions');
    const actions = ((got.body.included || []).filter((x) => x.type === 'flow-action')).map((a) => ({
      id: a.id,
      type: a.attributes && a.attributes.action_type,
      settings: a.attributes && a.attributes.settings
    }));
    record('flow-' + label, {
      status: got.status,
      name: got.body.data && got.body.data.attributes && got.body.data.attributes.name,
      flowStatus: got.body.data && got.body.data.attributes && got.body.data.attributes.status,
      trigger_type: got.body.data && got.body.data.attributes && got.body.data.attributes.trigger_type,
      actions,
      errors: got.body.errors
    });
  }

  // 3. PATCH status test — try setting WELCOME to draft (it is likely already draft)
  const patchStatus = await req('PATCH', 'https://a.klaviyo.com/api/flows/' + FLOWS.WELCOME + '/', {
    data: {
      type: 'flow',
      id: FLOWS.WELCOME,
      attributes: { status: 'draft' }
    }
  });
  record('patch-flow-status', {
    status: patchStatus.status,
    body: patchStatus.body
  });

  // 4. POST flow-action test — try creating a simple time-delay on WELCOME
  const postAction = await req('POST', 'https://a.klaviyo.com/api/flow-actions/', {
    data: {
      type: 'flow-action',
      attributes: {
        type: 'time-delay',
        settings: { delay_seconds: 0 }
      },
      relationships: {
        flow: { data: { type: 'flow', id: FLOWS.WELCOME } }
      }
    }
  });
  record('post-flow-action', {
    status: postAction.status,
    body: postAction.body
  });

  // 5. Write probe log for audit
  const probeOutPath = path.join(__dirname, 'tmp', 'phase3-probe.json');
  fs.writeFileSync(probeOutPath, JSON.stringify(log, null, 2));
  console.log('probe log -> ' + probeOutPath);

  console.log('');
  console.log('=== Phase 3 verdict ===');
  const canPatchStatus = patchStatus.ok;
  const canCreateAction = postAction.ok;
  console.log('Can PATCH flow status        : ' + (canPatchStatus ? 'yes' : 'NO (' + patchStatus.status + ')'));
  console.log('Can POST /api/flow-actions/  : ' + (canCreateAction ? 'yes' : 'NO (' + postAction.status + ')'));

  return { canPatchStatus, canCreateAction, probeLog: log };
}

main().then((r) => {
  // Persist verdict for the handover-writer step
  fs.writeFileSync(path.join(__dirname, 'tmp', 'phase3-verdict.json'), JSON.stringify(r, null, 2));
}).catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
