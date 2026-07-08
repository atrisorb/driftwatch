'use strict';

const fs = require('fs');
const path = require('path');

function tryRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function tryReadJSON(file) {
  const raw = tryRead(file);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Returns a lowercase set of identifiers found in the project: dependency
// names from every manifest we recognize, plus coarse language tags. Used to
// decide which subscribed platforms are worth surfacing for this project.
function getProjectIdentifiers(projectPath) {
  const ids = new Set();
  const root = projectPath || '.';

  const pkg = tryReadJSON(path.join(root, 'package.json'));
  if (pkg) {
    ids.add('node');
    ids.add('npm');
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
      ids.add(dep.toLowerCase());
    }
  }

  const reqTxt = tryRead(path.join(root, 'requirements.txt'));
  if (reqTxt !== null) {
    ids.add('python');
    ids.add('pypi');
    for (const line of reqTxt.split('\n')) {
      const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line);
      if (m) ids.add(m[1].toLowerCase());
    }
  }

  const pyproject = tryRead(path.join(root, 'pyproject.toml'));
  if (pyproject !== null) {
    ids.add('python');
    ids.add('pypi');
    const depBlock = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(pyproject);
    if (depBlock) {
      const re = /["']([A-Za-z0-9_.-]+)/g;
      let m;
      while ((m = re.exec(depBlock[1]))) ids.add(m[1].toLowerCase());
    }
  }

  const goMod = tryRead(path.join(root, 'go.mod'));
  if (goMod !== null) {
    ids.add('go');
    const re = /^\s*([\w.\-/]+\.[\w.\-/]+)\s+v[\d.]+/gm;
    let m;
    while ((m = re.exec(goMod))) ids.add(m[1].toLowerCase());
  }

  const cargoToml = tryRead(path.join(root, 'Cargo.toml'));
  if (cargoToml !== null) {
    ids.add('rust');
    const depSection = /\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(cargoToml);
    if (depSection) {
      const re = /^\s*([\w-]+)\s*=/gm;
      let m;
      while ((m = re.exec(depSection[1]))) ids.add(m[1].toLowerCase());
    }
  }

  return ids;
}

// A platform with no `detect` list is treated as globally relevant (e.g. the
// runtime/language itself). Otherwise it's relevant if any detect identifier
// shows up in the project's dependency set.
function isPlatformRelevant(platform, identifiers) {
  if (!platform.detect || platform.detect.length === 0) return true;
  return platform.detect.some((d) => identifiers.has(d.toLowerCase()));
}

module.exports = { getProjectIdentifiers, isPlatformRelevant };
