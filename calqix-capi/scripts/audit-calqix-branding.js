#!/usr/bin/env node
/**
 * CALQIX Branding Audit Script
 *
 * Scans the codebase for non-CALQIX naming (UrbixxVIP, Urbixx, old project names).
 * Reports any files that need cleanup.
 *
 * Usage: node scripts/audit-calqix-branding.js
 */
var fs = require('fs');
var path = require('path');

var SCAN_DIRS = [
  path.join(__dirname, '..', 'api'),
  path.join(__dirname, '..', 'lib'),
  path.join(__dirname, '..', 'scripts'),
  path.join(__dirname, '..', 'docs'),
  path.join(__dirname, '..', '..', 'assets'),
  path.join(__dirname, '..', '..', 'sections'),
  path.join(__dirname, '..', '..', 'snippets'),
  path.join(__dirname, '..', '..', 'layout'),
  path.join(__dirname, '..', '..', 'templates'),
  path.join(__dirname, '..', '..', 'config'),
  path.join(__dirname, '..', '..', 'locales')
];

var PATTERNS = [
  { regex: /urbixx/gi, label: 'UrbixxVIP / Urbixx' },
  { regex: /urbixxvip/gi, label: 'UrbixxVIP (exact)' },
  { regex: /old-project-name/gi, label: 'Old project name placeholder' }
];

var EXTENSIONS = ['.js', '.json', '.liquid', '.md', '.css', '.html', '.txt', '.yaml', '.yml'];

var SKIP_DIRS = ['node_modules', '.git', '.vercel', '.next', 'dist', 'build'];

function scanDir(dirPath) {
  var results = [];
  if (!fs.existsSync(dirPath)) return results;

  var entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(entry.name)) {
        results = results.concat(scanDir(fullPath));
      }
    } else if (entry.isFile()) {
      var ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function auditFile(filePath) {
  var content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return [];
  }

  var findings = [];
  var lines = content.split('\n');

  for (var p = 0; p < PATTERNS.length; p++) {
    var pattern = PATTERNS[p];
    for (var l = 0; l < lines.length; l++) {
      if (pattern.regex.test(lines[l])) {
        findings.push({
          file: filePath,
          line: l + 1,
          pattern: pattern.label,
          text: lines[l].trim().substring(0, 100)
        });
      }
      // Reset regex lastIndex for global flag
      pattern.regex.lastIndex = 0;
    }
  }

  return findings;
}

// Main
console.log('=== CALQIX Branding Audit ===\n');
console.log('Scanning directories:', SCAN_DIRS.length);
console.log('Patterns:', PATTERNS.map(function (p) { return p.label; }).join(', '));
console.log('');

var allFiles = [];
for (var d = 0; d < SCAN_DIRS.length; d++) {
  allFiles = allFiles.concat(scanDir(SCAN_DIRS[d]));
}

console.log('Files to scan:', allFiles.length);
console.log('');

var allFindings = [];
for (var f = 0; f < allFiles.length; f++) {
  var findings = auditFile(allFiles[f]);
  allFindings = allFindings.concat(findings);
}

if (allFindings.length === 0) {
  console.log('PASS: Geen non-CALQIX naming gevonden in de codebase.\n');
  console.log('De codebase is schoon. Alle referenties gebruiken CALQIX branding.');
} else {
  console.log('FINDINGS: ' + allFindings.length + ' non-CALQIX referenties gevonden:\n');
  allFindings.forEach(function (finding) {
    console.log('  [' + finding.pattern + '] ' + finding.file + ':' + finding.line);
    console.log('    ' + finding.text);
    console.log('');
  });
}

console.log('\n=== Audit Complete ===');
process.exit(allFindings.length > 0 ? 1 : 0);
