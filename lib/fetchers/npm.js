'use strict';

const { fetchJSON } = require('./http');

// platform.url is the bare npm package name, e.g. "@anthropic-ai/sdk" or "next".
async function fetch_(platform) {
  const pkg = platform.url.trim();
  const data = await fetchJSON(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace('%40', '@')}`);
  const time = data.time || {};
  const versions = Object.keys(data.versions || {});

  return versions
    .filter((v) => time[v])
    .map((v) => ({
      uniquePart: v,
      title: `${data.name}@${v}`,
      url: `https://www.npmjs.com/package/${data.name}/v/${v}`,
      date: new Date(time[v]).toISOString(),
      version: v,
      summary: '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50);
}

module.exports = { fetch: fetch_ };
