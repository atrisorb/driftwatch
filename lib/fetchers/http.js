'use strict';

const FETCH_TIMEOUT_MS = 15000;

async function fetchText(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'driftwatch/0.1 (+https://github.com)', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url, headers) {
  const text = await fetchText(url, { Accept: 'application/json', ...headers });
  return JSON.parse(text);
}

module.exports = { fetchText, fetchJSON };
