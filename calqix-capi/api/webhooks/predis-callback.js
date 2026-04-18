/**
 * Predis webhook (plural alias).
 *
 * The canonical handler lives at api/webhook/predis-callback.js. This file
 * exists so whichever URL is configured in the Predis.ai webhook settings
 * ( /api/webhook/predis-callback OR /api/webhooks/predis-callback ) continues
 * to work. Both URLs delegate to the same handler to avoid drift.
 */
module.exports = require('../webhook/predis-callback');
