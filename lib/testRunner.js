'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120000;
const OUTPUT_TAIL_CHARS = 4000;

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

// Picks the project's own generic verification command — never installs
// tooling of its own, only runs scripts/commands that already exist.
function detectCommand(projectPath) {
  const root = projectPath || '.';

  const pkg = readJSON(path.join(root, 'package.json'));
  if (pkg && pkg.scripts) {
    if (pkg.scripts.test && !/no test specified/i.test(pkg.scripts.test)) {
      return { command: 'npm', args: ['test', '--silent'], label: 'npm test' };
    }
    if (pkg.scripts.typecheck) return { command: 'npm', args: ['run', 'typecheck', '--silent'], label: 'npm run typecheck' };
    if (pkg.scripts.build) return { command: 'npm', args: ['run', 'build', '--silent'], label: 'npm run build' };
  }

  if (exists(path.join(root, 'pyproject.toml')) || exists(path.join(root, 'requirements.txt')) || exists(path.join(root, 'setup.py'))) {
    if (exists(path.join(root, 'tests'))) return { command: 'python', args: ['-m', 'pytest', '-q'], label: 'pytest -q' };
  }

  if (exists(path.join(root, 'go.mod'))) {
    return { command: 'go', args: ['build', './...'], label: 'go build ./...' };
  }

  if (exists(path.join(root, 'Cargo.toml'))) {
    return { command: 'cargo', args: ['build'], label: 'cargo build' };
  }

  return null;
}

// Given source files an update seems to touch, look for their conventional
// test companions (foo.js -> foo.test.js, foo.py -> tests/test_foo.py, ...).
// Lets a run scope down to "the tests for the affected code" instead of the
// whole suite, when that mapping is guessable from common naming.
function findRelatedTestFiles(focusPaths, projectPath) {
  const root = projectPath || '.';
  const found = new Set();

  for (const rel of focusPaths) {
    const ext = path.extname(rel);
    const dir = path.dirname(rel);
    const name = path.basename(rel, ext);
    const candidates = [];

    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      candidates.push(
        path.join(dir, `${name}.test${ext}`),
        path.join(dir, `${name}.spec${ext}`),
        path.join(dir, '__tests__', `${name}${ext}`)
      );
    } else if (ext === '.py') {
      candidates.push(path.join(dir, `test_${name}.py`), path.join('tests', `test_${name}.py`), path.join(dir, `${name}_test.py`));
    } else if (ext === '.go') {
      candidates.push(path.join(dir, `${name}_test.go`));
    }

    for (const c of candidates) {
      if (exists(path.join(root, c))) found.add(c);
    }
  }
  return Array.from(found);
}

// Narrows the detected command to focusPaths' related tests when we can
// guess the mapping; otherwise falls back to the project's full command.
function scopeCommand(detected, focusPaths, projectPath) {
  if (!focusPaths || focusPaths.length === 0) return { ...detected, scoped: false };

  const testFiles = findRelatedTestFiles(focusPaths, projectPath);
  if (testFiles.length === 0) return { ...detected, scoped: false };

  if (detected.command === 'npm' && detected.args[0] === 'test') {
    return { command: 'npm', args: ['test', '--silent', '--', ...testFiles], label: `npm test -- ${testFiles.join(' ')}`, scoped: true };
  }
  if (detected.command === 'python') {
    return { command: 'python', args: ['-m', 'pytest', '-q', ...testFiles], label: `pytest -q ${testFiles.join(' ')}`, scoped: true };
  }
  if (detected.command === 'go') {
    const dirs = Array.from(new Set(testFiles.map((f) => `./${path.dirname(f)}/...`)));
    return { command: 'go', args: ['test', ...dirs], label: `go test ${dirs.join(' ')}`, scoped: true };
  }
  return { ...detected, scoped: false };
}

function runCommand(projectPath, opts = {}) {
  const { timeoutMs, focusPaths } = opts;
  const base = detectCommand(projectPath);
  if (!base) {
    return Promise.resolve({ ran: false, reason: 'no recognizable build/test command found in this project' });
  }
  const detected = scopeCommand(base, focusPaths, projectPath);

  return new Promise((resolve) => {
    const child = spawn(detected.command, detected.args, {
      cwd: projectPath || '.',
      shell: process.platform === 'win32',
    });

    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ran: true,
        label: detected.label,
        scoped: !!detected.scoped,
        passed: !timedOut && code === 0,
        timedOut,
        exitCode: code,
        outputTail: output.slice(-OUTPUT_TAIL_CHARS),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ran: true, label: detected.label, passed: false, error: err.message });
    });
  });
}

module.exports = { detectCommand, findRelatedTestFiles, runCommand };
