'use strict';

const { fetchJSON } = require('./http');

// platform.url is the bare PyPI project name, e.g. "anthropic".
async function fetch_(platform) {
  const pkg = platform.url.trim();
  const data = await fetchJSON(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
  const releases = data.releases || {};

  return Object.keys(releases)
    .map((v) => {
      const files = releases[v] || [];
      const uploadTime = files.length ? files[0].upload_time_iso_8601 || files[0].upload_time : null;
      return uploadTime
        ? {
            uniquePart: v,
            title: `${data.info.name} ${v}`,
            url: `https://pypi.org/project/${data.info.name}/${v}/`,
            date: new Date(uploadTime).toISOString(),
            version: v,
            summary: '',
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50);
}

module.exports = { fetch: fetch_ };
