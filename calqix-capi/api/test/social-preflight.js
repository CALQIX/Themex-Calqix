/**
 * Social Publishing Pre-flight Test
 *
 * GET /api/test/social-preflight?key=DIAGNOSTICS_KEY
 *
 * Checks:
 *   1. META_ACCESS_TOKEN permissions
 *   2. FACEBOOK_PAGE_ID configured + valid
 *   3. INSTAGRAM_ACCOUNT_ID configured + valid
 *   4. Auto-discovers Page ID and IG ID if not set
 */
var socialPublisher = require('../../lib/social-publisher');

module.exports = async function handler(req, res) {
  var diagKey = process.env.DIAGNOSTICS_KEY;
  var providedKey = req.query && req.query.key;
  if (!diagKey || diagKey !== providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var output = {
    timestamp: new Date().toISOString(),
    env: {
      FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID ? 'set (' + process.env.FACEBOOK_PAGE_ID + ')' : 'NOT SET',
      INSTAGRAM_ACCOUNT_ID: process.env.INSTAGRAM_ACCOUNT_ID ? 'set (' + process.env.INSTAGRAM_ACCOUNT_ID + ')' : 'NOT SET',
      META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN ? 'set (length: ' + process.env.META_ACCESS_TOKEN.length + ')' : 'NOT SET'
    },
    permissions: null,
    pages: null,
    instagram: null,
    platforms: socialPublisher.getEnabledPlatforms()
  };

  // Step 1: Check permissions
  try {
    output.permissions = await socialPublisher.checkPermissions();
  } catch (err) {
    output.permissions = { ok: false, error: err.message };
  }

  // Step 2: Fetch available pages
  try {
    output.pages = await socialPublisher.fetchPageId();
  } catch (err) {
    output.pages = { ok: false, error: err.message };
  }

  // Step 3: If we have a page ID, fetch Instagram account
  var pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId && output.pages && output.pages.ok && output.pages.pages && output.pages.pages.length > 0) {
    pageId = output.pages.pages[0].id;
    output.autoDetectedPageId = pageId;
  }

  if (pageId) {
    try {
      output.instagram = await socialPublisher.fetchInstagramId(pageId);
    } catch (err) {
      output.instagram = { ok: false, error: err.message };
    }
  }

  return res.status(200).json(output);
};
