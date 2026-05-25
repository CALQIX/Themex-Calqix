var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var EXPECTED_ROOT = 'C:\\Users\\Gebruiker\\Desktop\\Business\\Calqix\\Repos\\CALQIX Repo';
var EXPECTED_PROJECT = 'calqix-capi';
var EXPECTED_ROOT_DIRECTORY = 'calqix-capi';

function fail(message, extra) {
  console.error('[preflight-root-guard] FAIL:', message);
  if (extra) console.error(JSON.stringify(extra, null, 2));
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function gitRoot() {
  try {
    return childProcess.execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (e) {
    return path.resolve(process.cwd(), '..');
  }
}

var cwd = path.resolve(process.cwd());
var root = path.resolve(gitRoot());
var packageJson = readJson(path.join(cwd, 'package.json')) || {};
var isVercel = Boolean(process.env.VERCEL);

if (packageJson.name !== EXPECTED_PROJECT) {
  fail('package root is not calqix-capi', { cwd: cwd, package_name: packageJson.name || null });
}

if (!isVercel && root !== path.resolve(EXPECTED_ROOT)) {
  fail('wrong local git root; refusing to deploy from duplicate workspace', {
    root: root,
    expected: EXPECTED_ROOT
  });
}

if (!isVercel) {
  var project = readJson(path.join(root, '.vercel', 'project.json'));
  if (!project) {
    fail('missing .vercel/project.json', { root: root });
  }
  var rootDirectory = project.settings && project.settings.rootDirectory;
  if (project.projectName !== EXPECTED_PROJECT || rootDirectory !== EXPECTED_ROOT_DIRECTORY) {
    fail('Vercel project/rootDirectory mismatch', {
      projectName: project.projectName,
      rootDirectory: rootDirectory
    });
  }
}

console.log('[preflight-root-guard] OK', {
  cwd: cwd,
  root: root,
  package_name: packageJson.name,
  vercel: isVercel
});
