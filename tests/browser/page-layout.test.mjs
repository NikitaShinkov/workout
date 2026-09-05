// Render the page in real Chrome, assert the layout actually has height, and
// screenshot it. jsdom cannot do this - it has no layout engine, which is
// exactly how the zero-height `.main` bug slipped through.

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

import { OUT, BASE, harness, findChrome } from '../helpers/env.mjs';
const CHROME = findChrome();
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-gpu', '--no-sandbox'],
});

let failures = 0;
const lines = [];
function check(name, ok, detail) {
  if (ok) lines.push('  PASS  ' + name);
  else { failures += 1; lines.push('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

async function capture(name, url, width, height, waitFor, wipeDb) {
  const page = await browser.newPage();

  // Every capture shares one browser profile, so the seeded IndexedDB leaks
  // between them. Wipe it when a capture needs a clean slate.
  if (wipeDb) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('fitness_app');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }));
  }

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => pageErrors.push('request failed: ' + r.url()));

  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector(waitFor, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 400)); // let fonts settle

  const metrics = await page.evaluate(() => {
    const box = (sel) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
    };
    return {
      page: box('.page'),
      main: box('.main'),
      scheduleColumn: box('.column--schedule'),
      exerciseColumn: box('.column--exercise'),
      list: box('.exercise-list'),
      firstRow: box('.exercise-row'),
      rowCount: document.querySelectorAll('.exercise-row').length,
      thumb: box('.exercise-row__image'),
      indicators: document.querySelectorAll('.indicators').length,
      stars: document.querySelectorAll('.favorite-star').length,
      emptyState: Boolean(document.querySelector('.empty-state')),
      bodyScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  await page.screenshot({ path: OUT + '/' + name + '.png' });
  await page.close();
  return { metrics, pageErrors };
}


// --- the reported bug: list visible after adding ---
const wide = await capture('list', harness('seed=exercises'), 1600, 900, '.exercise-row', true);
const m = wide.metrics;
lines.push('\n1600x900 with 4 exercises: ' + JSON.stringify(m, null, 0) + '\n');

check('4 rows in the DOM', m.rowCount === 4, m.rowCount);
check('.main has real height', m.main && m.main.h > 400, m.main && m.main.h);
check('.main spans the full width', m.main && m.main.w === 1600, m.main && m.main.w);
check('two columns are 50/50',
  m.scheduleColumn && m.exerciseColumn && m.scheduleColumn.w === 800 && m.exerciseColumn.w === 800,
  m.scheduleColumn && m.scheduleColumn.w + '/' + (m.exerciseColumn && m.exerciseColumn.w));
check('exercise list has real height', m.list && m.list.h > 300, m.list && m.list.h);
check('first row is 66px tall', m.firstRow && m.firstRow.h === 66, m.firstRow && m.firstRow.h);
check('row thumbnail is 89x50', m.thumb && m.thumb.w === 89 && m.thumb.h === 50,
  m.thumb && m.thumb.w + 'x' + m.thumb.h);
check('no empty state while exercises exist', m.emptyState === false);
check('no horizontal page scroll', m.bodyScrollX === false);
check('no page errors', wide.pageErrors.length === 0, wide.pageErrors.join(' | '));

// --- indicators + favourites ---
const extras = await capture('extras', harness('seed=exercises&extras'), 1600, 900, '.indicators', true);
check('indicators render for every row', extras.metrics.indicators === 4, extras.metrics.indicators);
check('stars render for every row', extras.metrics.stars === 4, extras.metrics.stars);
check('rows stay 66px with extras on', extras.metrics.firstRow.h === 66, extras.metrics.firstRow.h);
check('no page errors (extras)', extras.pageErrors.length === 0, extras.pageErrors.join(' | '));

// --- 960px responsive ---
const narrow = await capture('narrow', harness('seed=exercises'), 960, 900, '.exercise-row', true);
check('960px keeps two columns side by side',
  narrow.metrics.scheduleColumn.w === 480 && narrow.metrics.exerciseColumn.w === 480,
  narrow.metrics.scheduleColumn.w + '/' + narrow.metrics.exerciseColumn.w);
check('960px has no horizontal scroll', narrow.metrics.bodyScrollX === false);
check('960px list still has height', narrow.metrics.list.h > 300, narrow.metrics.list.h);

// --- empty state (real index.html, fresh profile so no stored data) ---
const empty = await capture('empty', BASE + '/index.html', 1600, 900, '.empty-state .main-button', true);
check('empty category shows the add button', empty.metrics.emptyState === true);
check('empty state has no columns', empty.metrics.main === null);
check('no page errors (empty)', empty.pageErrors.length === 0, empty.pageErrors.join(' | '));

// --- favicon must not 404 ---
const page = await browser.newPage();
const favicon = await page.goto(BASE + '/assets/favicon.svg');
check('favicon.svg serves 200', favicon.status() === 200, favicon.status());
await page.close();

await browser.close();

console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL LAYOUT CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
