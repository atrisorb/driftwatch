'use strict';

const store = require('./store');
const { fetchPlatform } = require('./fetchers');
const { classify } = require('./classify');

const DEFAULT_TTL_HOURS = 12;

function isDue(platform, ttlHours, force) {
  if (force) return true;
  if (!platform.lastChecked) return true;
  const ageHours = (Date.now() - new Date(platform.lastChecked).getTime()) / 3_600_000;
  return ageHours >= (platform.ttlHours || ttlHours);
}

// Fetches one platform (if due), turns raw fetcher items into stored entries,
// and returns whichever of them are actually new.
async function checkPlatform(platform, opts = {}) {
  const { force = false, ttlHours = DEFAULT_TTL_HOURS } = opts;
  if (!isDue(platform, ttlHours, force)) return { checked: false, newEntries: [] };

  let items, patch;
  try {
    ({ items, patch } = await fetchPlatform(platform));
  } catch (err) {
    store.upsertPlatform({ ...platform, lastChecked: new Date().toISOString(), lastError: err.message });
    return { checked: true, error: err.message, newEntries: [] };
  }

  const now = new Date().toISOString();
  const candidates = items.map((item) => {
    const entry = {
      id: store.makeEntryId(platform.id, item.uniquePart),
      platformId: platform.id,
      title: item.title,
      url: item.url,
      date: item.date || now,
      version: item.version || null,
      summary: item.summary || '',
      firstSeenAt: now,
    };
    entry.severity = classify(entry);
    return entry;
  });

  const fresh = store.addEntries(platform.id, candidates);
  store.upsertPlatform({ ...platform, ...patch, lastChecked: now, lastError: null });
  return { checked: true, newEntries: fresh };
}

async function checkAll(opts = {}) {
  const platforms = store.getPlatforms();
  const results = {};
  for (const platform of platforms) {
    results[platform.id] = await checkPlatform(platform, opts);
  }
  return results;
}

module.exports = { checkPlatform, checkAll, DEFAULT_TTL_HOURS };
