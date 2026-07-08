'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');

// Installs the plugin's one real dependency (@modelcontextprotocol/sdk) into
// the persistent plugin data dir, so it survives plugin updates instead of
// living in the (ephemeral, cache-copied) plugin install directory. Re-runs
// only when the bundled package.json actually changed. No-op outside a
// plugin context (e.g. running the CLI straight from a git checkout).
function ensureDeps() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) return { installed: false, reason: 'no CLAUDE_PLUGIN_DATA — assuming standalone checkout' };

  const bundledPkg = path.join(PLUGIN_ROOT, 'package.json');
  const stampPkg = path.join(dataDir, 'package.json');
  const nodeModules = path.join(dataDir, 'node_modules');

  const bundled = fs.readFileSync(bundledPkg, 'utf8');
  const stamped = fs.existsSync(stampPkg) ? fs.readFileSync(stampPkg, 'utf8') : null;
  if (bundled === stamped && fs.existsSync(nodeModules)) return { installed: false, reason: 'already up to date' };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(bundledPkg, stampPkg);
  try {
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dataDir, stdio: 'ignore' });
    return { installed: true };
  } catch (err) {
    fs.rmSync(stampPkg, { force: true }); // so the next run retries instead of thinking it's done
    return { installed: false, error: err.message };
  }
}

module.exports = { ensureDeps };
