#!/usr/bin/env node
/**
 * ECCO Scanner — link integrity check (v2)
 * ---------------------------------------------------------------
 * Doctrine: "Every claim verifiable. Every link live."
 * Live = reachable by a human in a browser. Not "reachable by every bot."
 *
 * What this script enforces:
 *   - 2xx / 3xx        → PASS (live)
 *   - 401 / 403 / 451  → TOLERATED (logged; site rejects automation, not a real 404)
 *   - 999              → TOLERATED (LinkedIn anti-bot code)
 *   - 4xx (other) / 5xx / network failure → FAIL build
 *
 * Domains skipped entirely (not verified):
 *   - own subdomains, Google Fonts, w3.org, GAS endpoints, LinkedIn
 *   (LinkedIn always returns 999; verifying is pointless)
 *
 * Run:  node check-links.mjs index.html
 * ---------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const SOURCE_FILE = process.argv[2] || 'index.html';
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const RETRIES = 1;

// Realistic Chrome on macOS UA — most agencies serve content to this UA.
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

// Status codes that prove the URL is reachable by humans even though
// the agency or publisher refuses automated tools. We log these but
// do not fail the build.
const TOLERATED_STATUS = new Set([401, 403, 451, 999]);

// Domains we don't verify at all.
const SKIP_PATTERNS = [
  /etherealconnectionsco\.com/,
  /fonts\.googleapis\.com/,
  /www\.w3\.org/,
  /script\.google\.com/,
  /linkedin\.com/, // always 999 to bots — verification is pointless
];

function extractUrls(html) {
  const re = /https?:\/\/[^\s"'<>)]+/g;
  const found = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[0];
    // Strip trailing punctuation that's likely sentence-final, not URL-final.
    // BUT: preserve a single trailing period if the URL legitimately ends in one
    // (e.g., acquisition.gov DFARS URLs end with "Reporting.").
    url = url.replace(/[,;)]+$/, '');
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
    // GET first now (HEAD is rejected by many gov sites even with a browser UA).
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: ACCEPT_HEADERS,
    });
    const ok = res.status >= 200 && res.status < 400;
    const tolerated = TOLERATED_STATUS.has(res.status);
    return { url, status: res.status, ok, tolerated, finalUrl: res.url };
  } catch (err) {
    if (attempt < RETRIES) {
      await sleep(800);
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
  console.log(`\n  ECCO link integrity check v2 — source: ${SOURCE_FILE}`);
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
