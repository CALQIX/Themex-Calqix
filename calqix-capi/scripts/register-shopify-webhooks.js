/**
 * Register Shopify webhook subscriptions for the CAPI pipeline.
 *
 * Creates subscriptions for the 4 topics that have dedicated handlers in
 * `api/webhook/`. Idempotent: lists existing subscriptions first and only
 * creates missing ones. Never deletes anything.
 *
 * Usage:
 *   node scripts/register-shopify-webhooks.js                 # dry run (lists only)
 *   node scripts/register-shopify-webhooks.js --apply         # actually create
 *   node scripts/register-shopify-webhooks.js --apply --base https://my-prev.vercel.app
 *
 * Requires env vars (already in .env / Vercel prod):
 *   SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN (or API_KEY+SECRET for refresh)
 *
 * Safety rails:
 *   - Will NOT delete or update existing subscriptions (even mismatched ones).
 *     If one exists with a wrong URL, the script reports it and asks the
 *     operator to handle manually (prevents accidental wipes).
 *   - Requires explicit --apply flag to call `webhookSubscriptionCreate`.
 */
/* eslint-disable no-console */
var dotenv = require('dotenv');
dotenv.config();

var shopify = require('../lib/shopify-admin');

var APPLY = process.argv.indexOf('--apply') !== -1;
var baseArgIdx = process.argv.indexOf('--base');
var BASE_URL = baseArgIdx !== -1
  ? process.argv[baseArgIdx + 1]
  : (process.env.CAPI_BASE_URL || 'https://calqix-capi.vercel.app');

// Only topics that have concrete handlers in api/webhook/
var TARGETS = [
  { topic: 'ORDERS_PAID',      path: '/api/webhook/orders-paid' },
  { topic: 'CHECKOUTS_CREATE', path: '/api/webhook/checkouts-create' },
  { topic: 'CUSTOMERS_CREATE', path: '/api/webhook/customers-create' },
  { topic: 'CARTS_CREATE',     path: '/api/webhook/carts-create' }
];

async function listExisting() {
  var q = `
    query {
      webhookSubscriptions(first: 100) {
        edges {
          node {
            id
            topic
            format
            endpoint {
              __typename
              ... on WebhookHttpEndpoint { callbackUrl }
            }
          }
        }
      }
    }
  `;
  var data = await shopify.graphql(q);
  return (data && data.webhookSubscriptions && data.webhookSubscriptions.edges || [])
    .map(function (e) { return e.node; });
}

async function createSubscription(topic, callbackUrl) {
  var mutation = `
    mutation createSub($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
        userErrors { field message }
      }
    }
  `;
  var vars = {
    topic: topic,
    sub: { callbackUrl: callbackUrl, format: 'JSON' }
  };
  var data = await shopify.graphql(mutation, vars);
  return data && data.webhookSubscriptionCreate;
}

(async function main() {
  console.log('\n=== CALQIX Shopify webhook registrar ===');
  console.log('Mode:', APPLY ? 'APPLY (will create)' : 'DRY RUN (lists only)');
  console.log('Base URL:', BASE_URL);
  console.log('');

  var existing = await listExisting();
  console.log('Existing subscriptions visible to this app: ' + existing.length);
  existing.forEach(function (s) {
    var url = s.endpoint && s.endpoint.callbackUrl || '?';
    console.log('  - ' + s.topic + '  →  ' + url);
  });

  console.log('\nPlanned subscriptions:');
  var toCreate = [];
  TARGETS.forEach(function (t) {
    var url = BASE_URL + t.path;
    var match = existing.find(function (s) {
      return s.topic === t.topic && s.endpoint && s.endpoint.callbackUrl === url;
    });
    var conflict = existing.find(function (s) {
      return s.topic === t.topic && !(s.endpoint && s.endpoint.callbackUrl === url);
    });
    if (match) {
      console.log('  ✅ ' + t.topic + '  (already present, skipping)');
    } else if (conflict) {
      console.log('  ⚠️  ' + t.topic + '  already exists with DIFFERENT url (' + conflict.endpoint.callbackUrl + ') — manual review, skipping');
    } else {
      console.log('  ➕ ' + t.topic + '  →  ' + url);
      toCreate.push({ topic: t.topic, url: url });
    }
  });

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to create the missing ' + toCreate.length + ' subscription(s).');
    return;
  }

  if (toCreate.length === 0) {
    console.log('\nNothing to create. Done.');
    return;
  }

  console.log('\nCreating...\n');
  for (var i = 0; i < toCreate.length; i++) {
    var t = toCreate[i];
    var result = await createSubscription(t.topic, t.url);
    if (result && result.webhookSubscription) {
      console.log('  ✅ created ' + t.topic + '  id=' + result.webhookSubscription.id);
    } else {
      console.log('  ❌ FAILED ' + t.topic + ': ' + JSON.stringify(result && result.userErrors));
    }
  }

  console.log('\nDone. Verify with a re-run without --apply.');
})();
