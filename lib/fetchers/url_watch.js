'use strict';

const crypto = require('crypto');
const { fetchText } = require('./http');

function textOnly(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// No feed available for this platform. We can't diff semantically, so we
// just hash the visible text and report "the page changed" when the hash
// moves. Honest and simple: whoever consumes the entry follows the link.
async function fetch_(platform) {
  const html = await fetchText(platform.url);
  const text = textOnly(html);
  const hash = crypto.createHash('sha1').update(text).digest('hex');

  if (platform.lastHash === hash) return { items: [], newHash: hash };

  return {
    items: [
      {
        uniquePart: hash,
        title: `Page changed: ${platform.name}`,
        url: platform.url,
        date: new Date().toISOString(),
        version: null,
        summary: 'Content of this changelog page changed since last check. No structured diff is available for this source type — open the link to review.',
      },
    ],
    newHash: hash,
  };
}

module.exports = { fetch: fetch_ };
