'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ENTRIES_PER_PLATFORM = 200;

function dataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.driftwatch');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(name) {
  return path.join(dataDir(), name);
}

function readJSON(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJSON(name, data) {
  const tmp = filePath(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath(name));
}

function shortHash(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 12);
}

// --- platforms ---

function getPlatforms() {
  return readJSON('platforms.json', []);
}

function savePlatforms(platforms) {
  writeJSON('platforms.json', platforms);
}

function getPlatform(id) {
  return getPlatforms().find((p) => p.id === id) || null;
}

function upsertPlatform(platform) {
  const platforms = getPlatforms();
  const idx = platforms.findIndex((p) => p.id === platform.id);
  if (idx === -1) platforms.push(platform);
  else platforms[idx] = { ...platforms[idx], ...platform };
  savePlatforms(platforms);
  return platform;
}

function removePlatform(id) {
  const platforms = getPlatforms().filter((p) => p.id !== id);
  savePlatforms(platforms);
  const entries = getEntries().filter((e) => e.platformId !== id);
  saveEntries(entries);
}

function makePlatformId(name, url) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${shortHash(url).slice(0, 6)}`;
}

// --- entries ---

function getEntries() {
  return readJSON('entries.json', []);
}

function saveEntries(entries) {
  writeJSON('entries.json', entries);
}

function makeEntryId(platformId, uniquePart) {
  return `${platformId}:${shortHash(String(uniquePart))}`;
}

// Merge newly fetched entries into the store, dedup by id, cap per platform.
// Returns the subset of entries that were actually new.
function addEntries(platformId, incoming) {
  const all = getEntries();
  const existingIds = new Set(all.filter((e) => e.platformId === platformId).map((e) => e.id));
  const fresh = incoming.filter((e) => !existingIds.has(e.id));
  if (fresh.length === 0) return [];

  const merged = all.concat(fresh);
  const byPlatform = new Map();
  for (const e of merged) {
    if (!byPlatform.has(e.platformId)) byPlatform.set(e.platformId, []);
    byPlatform.get(e.platformId).push(e);
  }
  const capped = [];
  for (const [, list] of byPlatform) {
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    capped.push(...list.slice(0, MAX_ENTRIES_PER_PLATFORM));
  }
  saveEntries(capped);
  return fresh;
}

function getEntry(id) {
  return getEntries().find((e) => e.id === id) || null;
}

// --- digest / per-project "already shown" tracking ---

function getDigestState() {
  return readJSON('digest-state.json', {});
}

function saveDigestState(state) {
  writeJSON('digest-state.json', state);
}

function projectKey(projectPath) {
  return shortHash(path.resolve(projectPath || '.'));
}

module.exports = {
  dataDir,
  getPlatforms,
  savePlatforms,
  getPlatform,
  upsertPlatform,
  removePlatform,
  makePlatformId,
  getEntries,
  saveEntries,
  addEntries,
  getEntry,
  makeEntryId,
  getDigestState,
  saveDigestState,
  projectKey,
  shortHash,
};
