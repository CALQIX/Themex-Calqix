/**
 * Upload a single theme asset to the live (MAIN-role) Shopify theme.
 *
 * Used to deploy assets/calqix-meta-bridge.js without needing the Shopify CLI
 * auth flow. Uses the same self-healing token path as the rest of calqix-capi
 * (lib/shopify-admin.js).
 *
 * Usage:
 *   node scripts/deploy-theme-asset.js <localPath> <themeAssetKey>
 *
 * Example:
 *   node scripts/deploy-theme-asset.js ../assets/calqix-meta-bridge.js assets/calqix-meta-bridge.js
 */
/* eslint-disable no-console */
require('dotenv').config();
var fs = require('fs');
var path = require('path');
var shopify = require('../lib/shopify-admin');

var localPath = process.argv[2];
var assetKey = process.argv[3];
if (!localPath || !assetKey) {
  console.error('Usage: node scripts/deploy-theme-asset.js <localPath> <assetKey>');
  process.exit(2);
}

var absPath = path.resolve(localPath);
if (!fs.existsSync(absPath)) {
  console.error('File not found:', absPath);
  process.exit(2);
}

async function main() {
  var themes = await shopify.graphql('{ themes(first:20){ edges{ node{ id name role } } } }');
  var mainNode = null;
  themes.themes.edges.forEach(function (e) {
    if (e.node.role === 'MAIN') mainNode = e.node;
  });
  if (!mainNode) throw new Error('No MAIN theme found');

  var themeIdNumeric = mainNode.id.split('/').pop();
  console.log('[deploy-theme-asset] MAIN theme:', mainNode.name, '(id=' + themeIdNumeric + ')');
  console.log('[deploy-theme-asset] Uploading', assetKey, 'from', absPath);

  var content = fs.readFileSync(absPath, 'utf8');
  var result = await shopify.rest('themes/' + themeIdNumeric + '/assets.json', 'PUT', {
    asset: {
      key: assetKey,
      value: content
    }
  });

  if (result.errors) {
    console.error('[deploy-theme-asset] FAILED:', JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }

  console.log('[deploy-theme-asset] OK:', {
    key: result.asset && result.asset.key,
    size: result.asset && result.asset.size,
    checksum: result.asset && (result.asset.checksum || '').slice(0, 16),
    updated_at: result.asset && result.asset.updated_at
  });
}

main().catch(function (e) { console.error(e.message); process.exit(1); });
