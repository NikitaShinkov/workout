// Real HTML5 drags in Chrome, building the schedule the way the user does:
// out of Exercise_list into Complex_list, between complexes, and complexes
// themselves by their side block.
//
// The jsdom suite covers the same decisions against a fake layout; what only a
// browser can confirm is that the gestures start at all - a drag from the side
// block with its own setDragImage, and rows that stay draggable inside it.

import puppeteer from 'puppeteer-core';

import { OUT, harness, findChrome } from '../helpers/env.mjs';

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--disable-gpu', '--no-sandbox'],
});

let failures = 0;
const lines = [];
const check = (n, ok, d) => {
  if (ok) lines.push('  PASS  ' + n);
  else { failures += 1; lines.push('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); }
};

const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.setViewport({ width: 1500, height: 800, deviceScaleFactor: 2 });
await page.goto(harness('seed=exercises'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase('fitness_app');
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.goto(harness('seed=exercises'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.exercise-row');
await new Promise((r) => setTimeout(r, 700));
await page.setDragInterception(true);

// The schedule as "a+b | c", by the first word of each title - the same shape
// the jsdom suite reports, so a failure reads the same way in both.
const shape = () => page.evaluate(() =>
  [...document.querySelectorAll('.complex')]
    .map((c) => [...c.querySelectorAll('.exercise-row__title')]
      .map((t) => t.textContent.split(' ')[0]).join('+'))
    .join(' | '));

const libraryCount = () => page.$$eval('.column--exercise .exercise-row', (n) => n.length);

// A point inside an element: `where` is 0 for its top edge, 1 for its bottom.
const at = (selector, index, where = 0.5) => page.evaluate((s, i, w) => {
  const n = document.querySelectorAll(s)[i];
  const b = n.getBoundingClientRect();
  return {
    x: Math.round(b.left + b.width / 2),
    y: Math.round(b.top + Math.max(2, Math.min(b.height - 2, b.height * w))),
  };
}, selector, index, where);

// Straight into the empty area below every complex.
const emptySpace = () => page.evaluate(() => {
  const b = document.querySelector('.complex-list').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.bottom - 12) };
});

async function dragDrop(from, to) {
  const data = await page.mouse.drag(from, to);
  await page.mouse.dragEnter(to, data);
  await page.mouse.dragOver(to, data);
  await page.mouse.drop(to, data);
  // drop() leaves the button down; without this the next drag throws
  // "'left' is already pressed".
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  return Boolean(data);
}

const shot = async (name) => {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.main').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: 380 };
  });
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

// ---------- 1. Exercise_list -> empty Complex_list ----------

check('nothing is scheduled to begin with', (await shape()) === '', await shape());

const started = await dragDrop(await at('.column--exercise .exercise-row', 0), await emptySpace());
check('the drag started', started);
check('dropping in empty space created a complex',
  (await shape()) === 'Отведение', await shape());
check('the exercise stayed in the library', (await libraryCount()) === 4, await libraryCount());
await shot('cxdrag-1-first');

// ---------- 2. Exercise_list -> onto an existing complex ----------

// Onto the bottom half of the complex's only row -> below it.
await dragDrop(await at('.column--exercise .exercise-row', 1), await at('.complex .exercise-row', 0, 0.9));
check('dropping on a row joined that complex, below it',
  (await shape()) === 'Отведение+Круговое', await shape());

// Onto the top half of the first row -> above it.
await dragDrop(await at('.column--exercise .exercise-row', 2), await at('.complex .exercise-row', 0, 0.1));
check('dropping on the upper half of a row inserts above it',
  (await shape()) === 'Скручивание+Отведение+Круговое', await shape());
check('still one complex', (await page.$$('.complex')).length === 1);
check('and the library is still four rows', (await libraryCount()) === 4, await libraryCount());

// The same exercise a second time - complexes hold copies, not the original.
await dragDrop(await at('.column--exercise .exercise-row', 0), await emptySpace());
check('the same exercise can be scheduled twice',
  (await shape()) === 'Скручивание+Отведение+Круговое | Отведение', await shape());
await shot('cxdrag-2-two-complexes');

// ---------- 3. a scheduled block into the gap between complexes ----------

const gap = await page.evaluate(() => {
  const first = document.querySelectorAll('.complex')[0].getBoundingClientRect();
  return { x: Math.round(first.left + first.width / 2), y: Math.round(first.bottom + 4) };
});
await dragDrop(await at('.complex .exercise-row', 0), gap);
check('dragged into the gap it became a complex of its own',
  (await shape()) === 'Отведение+Круговое | Скручивание | Отведение', await shape());

// ---------- 4. complexes reorder by their side block ----------

check('a complex is not draggable as a whole',
  (await page.$eval('.complex', (n) => n.getAttribute('draggable'))) === null);
check('its side block is', (await page.$eval('.complex__side', (n) => n.getAttribute('draggable'))) === 'true');

const sideStarted = await dragDrop(await at('.complex__side', 0, 0.5), await emptySpace());
check('a drag from the side block started', sideStarted);
check('the complex moved to the end',
  (await shape()) === 'Скручивание | Отведение | Отведение+Круговое', await shape());

const datesNow = await page.$$eval('.complex__date', (n) => n.map((d) => d.textContent));
check('the dates renumbered in the new order',
  datesNow.join(',') === '3 сен,4 сен,5 сен', datesNow.join(','));
await shot('cxdrag-3-reordered');

// ---------- 5. a group of blocks moves together ----------

await page.click('.complex .exercise-row');
await page.keyboard.down('Control');
await page.click('.complex:nth-of-type(2) .exercise-row');
await page.keyboard.up('Control');
const selected = await page.$$eval('.complex .exercise-row--selected', (n) => n.length);
check('two blocks selected across two complexes', selected === 2, selected);

await dragDrop(await at('.complex .exercise-row', 0), await emptySpace());
check('the group left as one new complex at the end',
  (await shape()) === 'Отведение+Круговое | Скручивание+Отведение', await shape());
check('the complexes they emptied were pruned',
  (await page.$$('.complex')).length === 2, (await page.$$('.complex')).length);
await shot('cxdrag-4-grouped');

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
