#!/usr/bin/env node
'use strict';

// Persistent background monitor (see monitors/monitors.json). Every stdout
// line becomes a notification delivered to Claude mid-session, so this is
// what makes driftwatch proactive instead of "ask and it'll check": nobody
// has to remember to poll.

const store = require('../lib/store');
const check = require('../lib/check');
const relevance = require('../lib/relevance');
const { assessImpact } = require('../lib/impact');

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const NOTIFY_SEVERITIES = new Set(['breaking', 'deprecation', 'security']);

function notify(entry, platform, hint) {
  const line = `[driftwatch] ${platform.name}: ${entry.title} (${entry.severity}) — ${entry.url}${hint ? ' — ' + hint : ''}`;
  process.stdout.write(line + '\n');
}

async function tick() {
  const projectPath = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const identifiers = relevance.getProjectIdentifiers(projectPath);

  let results;
  try {
    results = await check.checkAll({ force: false });
  } catch (err) {
    process.stderr.write(`driftwatch watch: check failed: ${err.message}\n`);
    return;
  }

  for (const [platformId, result] of Object.entries(results)) {
    if (!result.newEntries || result.newEntries.length === 0) continue;
    const platform = store.getPlatform(platformId);
    if (!platform || !relevance.isPlatformRelevant(platform, identifiers)) continue;

    for (const entry of result.newEntries) {
      if (!NOTIFY_SEVERITIES.has(entry.severity)) continue;
      let hint = null;
      try {
        const assessment = assessImpact(entry, platform, projectPath);
        if (assessment.verdict === 'affected') {
          hint = `references ${assessment.references.length} spot(s) in your code`;
        } else if (assessment.verdict === 'not-referenced') {
          hint = 'no reference found in your codebase (yet)';
        }
      } catch {
        // best-effort only
      }
      notify(entry, platform, hint);
    }
  }
}

async function loop() {
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

loop();
