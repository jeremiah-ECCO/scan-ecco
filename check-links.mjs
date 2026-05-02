#!/usr/bin/env node
/**
 * ECCO Scanner — link integrity check (v3)
 * ---------------------------------------------------------------
 * v3 changes (May 2 build #2):
 *   - Timeout 15s → 30s (gov sites are slow under automation)
 *   - Concurrency 6 → 4 (less rate-limit pressure)
 *   - Retries 1 → 2 (third chance on transient timeouts)
 *   - Retry on 5xx (catches transient server errors)
 *
 * Doctrine: "Every claim verifiable. Every link live."
 * Live = reachable by a human in a browser. Not "reachable by every bot."
 * ---------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const SOURCE_FILE = process.argv[2] || 'index.html';
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 4;
const RETRIES = 2;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ACCEPT_HEADERS = {
  'User-Agent': BROWSER_UA,
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
    'image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const TOLERATED_STATUS = new Set([401, 403, 451, 999]);

const SKIP_PATTERNS = [
  /etherealconnectionsco\.com/,
  /fonts\.googleapis\.com/,
  /www\.w3\.org/,
  /script\.google\.com/,
  /linkedin\.com/,
];

function extractUrls(html) {
  const re = /https?:\/\/[^\s"'<>)]+/g;
  const found = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[0].replace(/[,;)]+$/, '');
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
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: ACCEPT_HEADERS,
    });
    const ok = res.status >= 200 && res.status < 400;
    const tolerated = TOLERATED_STATUS.has(res.status);
    const transient5xx = res.status >= 500 && res.status < 600;

    // Retry on transient 5xx
    if (transient5xx && attempt < RETRIES) {
      globalThis.clearTimeout(t);
      await sleep(1500);
      return checkOne(url, attempt + 1);
    }

    return { url, status: res.status, ok, tolerated, finalUrl: res.url };
  } catch (err) {
    if (attempt < RETRIES) {
      await sleep(1500);
      return checkOne(url, attempt + 1);
    }
    return { url, status: 0, ok: false, tolerated: false, error: err.message };
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
  console.log(`\n  ECCO link integrity check v3 — source: ${SOURCE_FILE}`);
  const html = readFileSync(SOURCE_FILE, 'utf8');
  const urls = extractUrls(html);
  console.log(`  found ${urls.length} external URLs (LinkedIn skipped)\n`);

  const results = await runWithConcurrency(urls, checkOne, CONCURRENCY);

  const passed = results.filter((r) => r.ok);
  const tolerated = results.filter((r) => !r.ok && r.tolerated);
  const broken = results.filter((r) => !r.ok && !r.tolerated);

  console.log(`\n  ✓ ${passed.length} OK`);
  if (tolerated.length) {
    console.log(`  ⚠ ${tolerated.length} TOLERATED (site rejects automation; live for humans)`);
    for (const t of tolerated) {
      console.log(`    [${t.status}] ${t.url}`);
    }
  }
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
