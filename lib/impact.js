'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'venv', '.venv', '__pycache__', 'target', '.next', 'vendor']);
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.php', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.swift']);
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES_SCANNED = 5000;
const MAX_MATCHES = 20;

// --- symbol extraction ---

function extractSymbols(entry) {
  const text = `${entry.title || ''} ${entry.summary || ''}`;
  const symbols = new Set();

  // backticked code spans: the most reliable signal
  const backticked = text.match(/`([^`]+)`/g) || [];
  for (const b of backticked) {
    const clean = b.slice(1, -1).trim();
    if (clean.length >= 2 && clean.length <= 60) symbols.add(clean);
  }

  // dotted access paths (e.g. client.messages.create)
  const dotted = text.match(/\b[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*){1,3}\b/g) || [];
  for (const d of dotted) symbols.add(d);

  // camelCase / PascalCase / snake_case identifiers of reasonable length
  const idents = text.match(/\b[a-zA-Z_][a-zA-Z0-9_]{3,40}\b/g) || [];
  for (const id of idents) {
    if (/[A-Z]/.test(id.slice(1)) || id.includes('_')) symbols.add(id);
  }

  return Array.from(symbols).slice(0, 8);
}

// --- codebase grep ---

function walk(dir, out, budget) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= budget.filesLeft) return;
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      walk(path.join(dir, ent.name), out, budget);
    } else if (ent.isFile() && CODE_EXT.has(path.extname(ent.name))) {
      out.push(path.join(dir, ent.name));
      budget.filesLeft--;
      if (budget.filesLeft <= 0) return;
    }
  }
}

// `patterns` carry an `origin` tag ('entry' | 'context') so callers can tell
// a hit that came from the changelog text apart from one that came from what
// the user said they're doing — the latter is the stronger relevance signal.
function grepPatterns(patterns, projectPath, explicitFiles) {
  if (patterns.length === 0) return [];
  const root = projectPath || '.';
  let files;
  if (explicitFiles && explicitFiles.length) files = explicitFiles;
  else {
    files = [];
    walk(root, files, { filesLeft: MAX_FILES_SCANNED });
  }

  const matches = [];
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { symbol, origin, re } of patterns) {
        if (re.test(lines[i])) {
          matches.push({ file: path.relative(root, file), line: i + 1, symbol, origin, text: lines[i].trim().slice(0, 200) });
          if (matches.length >= MAX_MATCHES) return matches;
          break;
        }
      }
    }
  }
  return matches;
}

function toPatterns(symbols, origin) {
  return symbols.map((s) => ({ symbol: s, origin, re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
}

function grepSymbols(symbols, projectPath, explicitFiles) {
  return grepPatterns(toPatterns(symbols, 'entry'), projectPath, explicitFiles);
}

// --- "what the user asked" extraction ---

const PATH_RE = /\b[\w./-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rs|rb|java|kt|php|c|cc|cpp|h|hpp|cs|swift)\b/g;

// Pulls file hints and identifier-looking keywords out of a free-text
// description of what the user is currently doing/asking, so a check can be
// scoped to that instead of a blind whole-repo grep.
function extractContextKeywords(context) {
  if (!context) return { keywords: [], paths: [] };

  const paths = Array.from(new Set(context.match(PATH_RE) || []));

  const quoted = (context.match(/`([^`]+)`/g) || []).map((s) => s.slice(1, -1));
  const idents = (context.match(/\b[a-zA-Z_][a-zA-Z0-9_]{3,40}\b/g) || []).filter(
    (w) => (/[A-Z]/.test(w.slice(1)) || w.includes('_')) && !paths.includes(w)
  );

  const keywords = Array.from(new Set([...quoted, ...idents])).slice(0, 8);
  return { keywords, paths };
}

function resolveFocusFiles(paths, projectPath) {
  const root = projectPath || '.';
  return paths.map((p) => path.join(root, p)).filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

// --- version gate (npm / pypi only — unambiguous package identity) ---

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function stripPrerelease(v) {
  return (v || '').replace(/^v/, '').split('-')[0];
}

function compareVersions(a, b) {
  const pa = stripPrerelease(a).split('.').map(Number);
  const pb = stripPrerelease(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function getInstalledNpmVersion(pkgName, projectPath) {
  const root = projectPath || '.';
  const installed = readJSON(path.join(root, 'node_modules', pkgName, 'package.json'));
  if (installed && installed.version) return { version: installed.version, precision: 'exact' };

  const lock = readJSON(path.join(root, 'package-lock.json'));
  if (lock) {
    const fromPackages = lock.packages && lock.packages[`node_modules/${pkgName}`];
    if (fromPackages && fromPackages.version) return { version: fromPackages.version, precision: 'exact' };
    const fromDeps = lock.dependencies && lock.dependencies[pkgName];
    if (fromDeps && fromDeps.version) return { version: fromDeps.version, precision: 'exact' };
  }

  const pkg = readJSON(path.join(root, 'package.json'));
  const range = pkg && ({ ...pkg.dependencies, ...pkg.devDependencies } || {})[pkgName];
  if (range) return { version: range.replace(/^[^\d]*/, ''), precision: 'approximate' };

  return null;
}

function getInstalledPypiVersion(pkgName, projectPath) {
  const root = projectPath || '.';
  const req = (() => {
    try {
      return fs.readFileSync(path.join(root, 'requirements.txt'), 'utf8');
    } catch {
      return null;
    }
  })();
  if (req) {
    const re = new RegExp(`^\\s*${pkgName}\\s*==\\s*([\\w.]+)`, 'im');
    const m = re.exec(req);
    if (m) return { version: m[1], precision: 'exact' };
  }
  return null;
}

function versionGate(entry, platform, projectPath) {
  if (!entry.version) return { status: 'unknown', reason: 'entry has no parseable version' };

  let installed = null;
  if (platform.type === 'npm') installed = getInstalledNpmVersion(platform.url.trim(), projectPath);
  else if (platform.type === 'pypi') installed = getInstalledPypiVersion(platform.url.trim(), projectPath);
  else return { status: 'unknown', reason: `no unambiguous package identity for type "${platform.type}"` };

  if (!installed) return { status: 'unknown', reason: 'could not determine installed version' };

  const cmp = compareVersions(installed.version, entry.version);
  return {
    status: cmp >= 0 ? 'already-applied' : 'not-yet',
    installedVersion: installed.version,
    entryVersion: entry.version,
    precision: installed.precision,
  };
}

// --- combined assessment ---

// `context` is optional free text: what the user asked / is currently doing
// ("sto aggiungendo il rate limiting in src/payments/stripeClient.js"). When
// given, its keywords/paths are grepped alongside the entry's own symbols, so
// the check answers "does this affect what I'm actually doing" and not just
// "does this appear anywhere in the repo".
function assessImpact(entry, platform, projectPath, context) {
  const entrySymbols = extractSymbols(entry);
  const { keywords: contextKeywords, paths: contextPaths } = extractContextKeywords(context);

  const patterns = toPatterns(entrySymbols, 'entry').concat(toPatterns(contextKeywords, 'context'));
  const focusFiles = resolveFocusFiles(contextPaths, projectPath);
  // When context names real files, we search only those — so any hit is
  // implicitly "in what the user is working on", even if it was the entry's
  // own symbol (e.g. `textStream`) that matched rather than a context keyword.
  const contextScoped = focusFiles.length > 0;
  const references = grepPatterns(patterns, projectPath, contextScoped ? focusFiles : null);

  const gate = versionGate(entry, platform, projectPath);

  let verdict;
  if (references.length > 0) verdict = 'affected';
  else if (gate.status === 'already-applied' || gate.status === 'not-yet') verdict = 'not-referenced';
  else verdict = 'inconclusive';

  return {
    verdict,
    symbols: entrySymbols,
    contextKeywords,
    contextPaths,
    contextScoped,
    references,
    matchesContext: contextScoped ? references.length > 0 : references.some((r) => r.origin === 'context'),
    versionGate: gate,
  };
}

module.exports = {
  extractSymbols,
  extractContextKeywords,
  grepSymbols,
  versionGate,
  compareVersions,
  assessImpact,
};
