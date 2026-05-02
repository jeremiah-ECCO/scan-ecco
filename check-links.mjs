#!/usr/bin/env node
/**
 * ECCO Scanner — link integrity check
 * ---------------------------------------------------------------
 * Extracts every external URL from index.html and verifies it
 * resolves to a 2xx or 3xx status. Fails with non-zero exit code
 * if any URL returns 4xx/5xx, network error, or DNS failure.
 *
 * Designed to run in Netlify build:
 *   "build": "node check-links.mjs && (your normal build steps)"
 *
 * Or as a Netlify "build command" in netlify.toml:
 *   command = "node check-links.mjs"
 *
 * Doctrine: every external claim should resolve to live content.
 * If it doesn't, the deploy doesn't ship.
 * ---------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const SOURCE_FILE = process.argv[2] || 'index.html';
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;
const RETRIES = 1;

// Domains we don't need to verify (own subdomains, fonts, etc.)
const SKIP_PATTERNS = [
  /etherealconnectionsco\.com/,
  /fonts\.googleapis\.com/,
  /www\.w3\.org/,
  /script\.google\.com/,
];

function extractUrls(html) {
  // Match any https?://... in href, src, url:'...', or url:"..."
  const re = /https?:\/\/[^\s"'<>)]+/g;
  const found = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[0].replace(/[.,;)]+$/, ''); // strip trailing punctuation EXCEPT
    // Re-add a single trailing "." if the URL legitimately ends with one
    // (e.g., acquisition.gov DFARS URLs literally end in '.')
    if (m[0].endsWith('.') && !m[0].endsWith('..')) {
      // leave as-is; the regex already captured it
      url = m[0].replace(/[,;)]+$/, '');
    }
    if (!SKIP_PATTERNS.some((p) => p.test(url))) {
      found.add(url);
    }
  }
  return [...found].sort();
}

async function checkOne(url, attempt = 0) {
  const ctrl = new AbortController();
  const t = globalThis.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // HEAD first — many servers reject it; fall back to GET on 405/403
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ECCO-LinkChecker/1.0 (+https://etherealconnectionsco.com)' },
    });
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'ECCO-LinkChecker/1.0 (+https://etherealconnectionsco.com)' },
      });
    }
    return { url, status: res.status, ok: res.status >= 200 && res.status < 400, finalUrl: res.url };
  } catch (err) {
    if (attempt < RETRIES) {
      await sleep(500);
      return checkOne(url, attempt + 1);
    }
    return { url, status: 0, ok: false, error: err.message };
  } finally {
    globalThis.clearTimeout(t);
  }
}

async function runWithConcurrency(items, fn, n) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
      process.stdout.write(`\r  checked ${i}/${items.length}…`);
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
  return results;
}

(async () => {
  console.log(`\n  ECCO link integrity check — source: ${SOURCE_FILE}`);
  const html = readFileSync(SOURCE_FILE, 'utf8');
  const urls = extractUrls(html);
  console.log(`  found ${urls.length} external URLs\n`);

  const results = await runWithConcurrency(urls, checkOne, CONCURRENCY);

  const broken = results.filter((r) => !r.ok);
  const ok = results.filter((r) => r.ok);

  console.log(`\n  ✓ ${ok.length} OK`);
  console.log(`  ✗ ${broken.length} BROKEN\n`);

  if (broken.length) {
    console.log('  BROKEN URLS:');
    for (const b of broken) {
      const status = b.status || 'NETERR';
      const detail = b.error ? `  (${b.error})` : '';
      console.log(`    [${status}] ${b.url}${detail}`);
    }
    console.log('');
    process.exit(1);
  }
  console.log('  doctrine intact. deploy clear.\n');
})();
