/**
 * Compliance Checker — validates content against platform policies and brand rules.
 *
 * Wraps brand-guardrails with additional platform-specific checks.
 */
var guardrails = require('./brand-guardrails');
var memory = require('./content-memory');

/**
 * Run full compliance check on a content brief.
 * @param {object} brief - content brief object
 * @returns {Promise<{approved: boolean, violations: string[], warnings: string[], blockedClaims: string[]}>}
 */
async function check(brief) {
  var brandResult = guardrails.checkBrief(brief);
  var blockedClaims = await memory.getBlockedClaims();
  var claimViolations = [];

  // Check against historically blocked claims
  var textToCheck = [brief.caption, brief.header, brief.hook, brief.valueClaims, brief.badge].filter(Boolean).join(' ').toLowerCase();
  blockedClaims.forEach(function (entry) {
    if (entry.claim && textToCheck.indexOf(entry.claim.toLowerCase()) !== -1) {
      claimViolations.push('Previously blocked claim: "' + entry.claim + '" (reason: ' + (entry.reason || 'unknown') + ')');
    }
  });

  // Platform-specific checks
  var platformWarnings = [];

  // Instagram: caption max ~2200 chars
  if (brief.platform === 'instagram' && brief.caption && brief.caption.length > 2200) {
    platformWarnings.push('Instagram caption exceeds 2200 chars (' + brief.caption.length + ')');
  }

  // Facebook: text in image should be < 20% (can't auto-check, just warn)
  if (brief.platform === 'facebook' && brief.format === 'image') {
    platformWarnings.push('Reminder: Facebook may reduce reach if image text > 20%');
  }

  var allViolations = brandResult.violations.concat(claimViolations);
  var allWarnings = brandResult.warnings.concat(platformWarnings);

  return {
    approved: allViolations.length === 0,
    violations: allViolations,
    warnings: allWarnings,
    blockedClaims: claimViolations
  };
}

module.exports = { check: check };
