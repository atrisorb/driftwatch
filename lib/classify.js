'use strict';

// Heuristic-only, no LLM call: this module just tags data so the host LLM
// can reason about it. Order matters — more severe wins on multiple matches.
const RULES = [
  { severity: 'security', re: /\b(CVE-\d{4}-\d+|security (fix|advisory|vulnerability)|RCE|CVE)\b/i },
  { severity: 'breaking', re: /\bbreaking[\s-]?change|BREAKING CHANGE|no longer (supports?|works?)|removed (support for|the)|has been removed\b/i },
  { severity: 'breaking', re: /\bv?(\d+)\.0\.0\b/, requiresMajorBump: true },
  { severity: 'deprecation', re: /\bdeprecat(ed|ion|es|e)\b/i },
  { severity: 'feature', re: /\b(new|added|introduc\w+|now supports?)\b/i },
];

function classify(entry) {
  const text = `${entry.title || ''} ${entry.summary || ''}`;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    if (rule.requiresMajorBump && m[1] === '0') continue;
    return rule.severity;
  }
  return 'update';
}

module.exports = { classify };
