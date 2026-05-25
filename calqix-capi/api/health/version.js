var fs = require('fs');
var path = require('path');
var dates = require('../../lib/dates');

var EXPECTED_LOCAL_ROOT = 'C:\\Users\\Gebruiker\\Desktop\\Business\\Calqix\\Repos\\CALQIX Repo';
var LAYOUT_VERSION = 'tracking-intelligence-2026-05-15';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function repoRoot() {
  return path.resolve(process.cwd(), '..');
}

function readGitSha(root) {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    var headPath = path.join(root, '.git', 'HEAD');
    var head = fs.readFileSync(headPath, 'utf8').trim();
    if (head.indexOf('ref:') === 0) {
      var ref = head.replace(/^ref:\s*/, '');
      return fs.readFileSync(path.join(root, '.git', ref), 'utf8').trim();
    }
    return head;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  var root = repoRoot();
  var project = readJson(path.join(root, '.vercel', 'project.json')) || {};
  var packageJson = readJson(path.join(process.cwd(), 'package.json')) || {};
  var rootDirectory = project.settings && project.settings.rootDirectory || null;
  var isVercel = Boolean(process.env.VERCEL);
  var vercelProjectName = project.projectName ||
    process.env.VERCEL_PROJECT_NAME ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    null;
  var localRootOk = isVercel ? true : path.resolve(root) === path.resolve(EXPECTED_LOCAL_ROOT);
  var projectOk = isVercel
    ? /calqix-capi/.test(String(vercelProjectName || ''))
    : project.projectName === 'calqix-capi' && rootDirectory === 'calqix-capi';

  return res.status(localRootOk && projectOk ? 200 : 500).json({
    ok: Boolean(localRootOk && projectOk),
    git_sha: readGitSha(root),
    layout_version: LAYOUT_VERSION,
    amsterdam_date: dates.toISODateAmsterdam(),
    amsterdam_time: dates.formatDateTimeAmsterdam(),
    project_root: root,
    expected_local_root: EXPECTED_LOCAL_ROOT,
    local_root_ok: localRootOk,
    cwd: process.cwd(),
    package_name: packageJson.name || null,
    vercel_project: vercelProjectName,
    vercel_root_directory: rootDirectory,
    vercel_project_ok: projectOk,
    vercel_env: process.env.VERCEL_ENV || null
  });
};
