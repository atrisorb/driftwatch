#!/usr/bin/env node
'use strict';

const { ensureDeps } = require('../lib/ensureDeps');
const { buildDigest } = require('../lib/digest');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.on('data', (d) => (data += d));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

async function main() {
  await readStdin();

  try {
    ensureDeps();
  } catch (err) {
    process.stderr.write(`driftwatch: dependency install failed: ${err.message}\n`);
  }

  const projectPath = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let text = '';
  try {
    ({ text } = buildDigest({ projectPath }));
  } catch (err) {
    process.stderr.write(`driftwatch: digest failed: ${err.message}\n`);
  }

  if (!text) return; // nothing new — stay silent, don't add noise to every session

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: text,
      },
    })
  );
}

main();
