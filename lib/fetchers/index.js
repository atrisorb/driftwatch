'use strict';

const feed = require('./feed');
const npm = require('./npm');
const pypi = require('./pypi');
const urlWatch = require('./url_watch');

const TYPES = ['feed', 'npm', 'pypi', 'url_watch'];

// Normalizes every fetcher to { items: [...raw items...], patch: {...platform fields to persist} }
async function fetchPlatform(platform) {
  switch (platform.type) {
    case 'feed':
      return { items: await feed.fetch(platform), patch: {} };
    case 'npm':
      return { items: await npm.fetch(platform), patch: {} };
    case 'pypi':
      return { items: await pypi.fetch(platform), patch: {} };
    case 'url_watch': {
      const { items, newHash } = await urlWatch.fetch(platform);
      return { items, patch: { lastHash: newHash } };
    }
    default:
      throw new Error(`Unknown platform type: ${platform.type}`);
  }
}

module.exports = { fetchPlatform, TYPES };
