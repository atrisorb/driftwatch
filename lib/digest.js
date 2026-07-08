'use strict';

const store = require('./store');
const relevance = require('./relevance');
const { assessImpact } = require('./impact');

const SEVERITY_RANK = { security: 0, breaking: 1, deprecation: 2, update: 3, feature: 4 };
const MAX_SHOWN_IDS_PER_PROJECT = 1000;

function impactHint(entry, platform, projectPath) {
  try {
    const { verdict, references } = assessImpact(entry, platform, projectPath);
    if (verdict === 'affected') {
      const first = references[0];
      return `touches your code (${references.length} ref${references.length > 1 ? 's' : ''}, e.g. ${first.file}:${first.line})`;
    }
    if (verdict === 'not-referenced') return 'no reference found in your codebase';
    return null; // inconclusive: say nothing rather than guess
  } catch {
    return null;
  }
}

// Builds a short, actionable digest of NEW entries relevant to this project,
// and remembers what's been shown so the same session/project isn't repeated.
function buildDigest(opts = {}) {
  const { projectPath = '.', maxItems = 8, withImpact = true } = opts;

  const identifiers = relevance.getProjectIdentifiers(projectPath);
  const platforms = store.getPlatforms().filter((p) => relevance.isPlatformRelevant(p, identifiers));
  const platformIds = new Set(platforms.map((p) => p.id));
  const platformById = new Map(platforms.map((p) => [p.id, p]));

  const key = store.projectKey(projectPath);
  const digestState = store.getDigestState();
  const shown = new Set(digestState[key] || []);

  const candidates = store
    .getEntries()
    .filter((e) => platformIds.has(e.platformId) && !shown.has(e.id))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.date.localeCompare(a.date))
    .slice(0, maxItems);

  if (candidates.length === 0) return { text: '', entries: [] };

  const lines = candidates.map((e) => {
    const platform = platformById.get(e.platformId);
    let line = `- [${e.severity}] ${platform.name}: ${e.title} (${e.url})`;
    if (withImpact && ['breaking', 'deprecation', 'security'].includes(e.severity)) {
      const hint = impactHint(e, platform, projectPath);
      if (hint) line += ` — ${hint}`;
    }
    return line;
  });

  const text = `driftwatch: ${candidates.length} update(s) on your tracked platforms since last time:\n${lines.join('\n')}`;

  const updatedShown = Array.from(shown).concat(candidates.map((e) => e.id)).slice(-MAX_SHOWN_IDS_PER_PROJECT);
  digestState[key] = updatedShown;
  store.saveDigestState(digestState);

  return { text, entries: candidates };
}

module.exports = { buildDigest };
