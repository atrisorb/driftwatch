'use strict';

const { fetchText } = require('./http');

// Turn a bare "owner/repo" or a github.com/owner/repo URL into its stable
// Atom feed. GitHub gives every public repo a releases feed for free, no API
// key needed, so we treat "a github repo" as just another feed source.
function resolveFeedUrl(rawUrl) {
  const bare = /^([\w.-]+)\/([\w.-]+)$/.exec(rawUrl.trim());
  if (bare) return `https://github.com/${bare[1]}/${bare[2]}/releases.atom`;

  const gh = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/?$/.exec(rawUrl.trim());
  if (gh) return `https://github.com/${gh[1]}/${gh[2]}/releases.atom`;

  return rawUrl;
}

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagValue(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]) : null;
}

function linkValue(block) {
  // Atom: <link href="..."/> ; RSS: <link>...</link>
  const atom = /<link[^>]*\shref="([^"]+)"/i.exec(block);
  if (atom) return atom[1];
  const rss = tagValue(block, 'link');
  return rss;
}

function extractVersion(title) {
  const m = /v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/.exec(title || '');
  return m ? m[1] : null;
}

async function fetch_(platform) {
  const url = resolveFeedUrl(platform.url);
  const xml = await fetchText(url, { Accept: 'application/rss+xml, application/atom+xml, text/xml' });

  const blocks = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  const entryRe = /<entry[\s>][\s\S]*?<\/entry>/gi;
  let m;
  while ((m = itemRe.exec(xml))) blocks.push(m[0]);
  while ((m = entryRe.exec(xml))) blocks.push(m[0]);

  return blocks.map((block) => {
    const title = tagValue(block, 'title') || '(untitled)';
    const link = linkValue(block) || url;
    const date = tagValue(block, 'pubDate') || tagValue(block, 'updated') || tagValue(block, 'published') || null;
    const guid = tagValue(block, 'guid') || tagValue(block, 'id') || link;
    const summary = tagValue(block, 'description') || tagValue(block, 'summary') || tagValue(block, 'content') || '';
    return {
      uniquePart: guid,
      title,
      url: link,
      date: date ? new Date(date).toISOString() : null,
      version: extractVersion(title),
      summary: summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
    };
  });
}

module.exports = { fetch: fetch_, resolveFeedUrl };
