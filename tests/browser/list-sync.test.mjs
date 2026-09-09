// The two lists read together, in real Chrome: selecting a block in a complex
// scrolls Exercise_list so the exercise it references sits in the middle, and
// draws that row in the hover fill without selecting it.
//
// Neither half can be judged in jsdom - one is a scroll position and the other
// is what :hover does when the pointer actually arrives. tests/jsdom/keyboard
// covers the selection arithmetic; this covers the geometry and the fills.
//
// Also the real-browser half of the new keys: Shift+ArrowDown and Enter, which
// is how the complex under test gets built.

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

// Short enough that sixteen rows overflow Exercise_list by a long way, so a
// centred row is a real scroll position rather than "the list happens to fit".
await page.setViewport({ width: 1400, height: 520, deviceScaleFactor: 2 });
await page.goto(harness('seed=exercises&rows=16'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.exercise-row');
await new Promise((r) => setTimeout(r, 500));

const HOVER_BG = 'rgb(29, 29, 29)'; // --hover-bg #1D1D1D

const shot = async (name, selector) => {
  const clip = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  }, selector);
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

const LIB = '.column--exercise .exercise-row';

// How far the row's middle is from the list's middle, in px. Zero is centred.
const centerOffset = (index) => page.evaluate((sel, i) => {
  const list = document.querySelector('.exercise-list');
  const row = document.querySelectorAll(sel)[i];
  if (!list || !row) return null;
  const lb = list.getBoundingClientRect();
  const rb = row.getBoundingClientRect();
  return +((rb.top + rb.height / 2) - (lb.top + lb.height / 2)).toFixed(1);
}, LIB, index);

// The one library row wearing the borrowed highlight, by position. Reports the
// count when it is not exactly one, so a failure says what went wrong.
const linkedIndex = () => page.evaluate((sel) => {
  const rows = [...document.querySelectorAll(sel)];
  const hits = rows
    .map((row, i) => (row.classList.contains('exercise-row--linked') ? i : -1))
    .filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : 'count=' + hits.length;
}, LIB);

// Every library row that is drawn on a fill at all, as "index:colour" - which
// is how "only one row is ever hovered" gets checked.
const filledRows = () => page.evaluate((sel) => [...document.querySelectorAll(sel)]
  .map((row, i) => [i, getComputedStyle(row).backgroundColor])
  .filter(([, color]) => color !== 'rgba(0, 0, 0, 0)')
  .map(([i, color]) => i + ':' + color)
  .join(','), LIB);

const itemSelection = () => page.evaluate(() => [...document.querySelectorAll('.complex-list .exercise-row')]
  .map((row, i) => (row.classList.contains('exercise-row--selected') ? i : -1))
  .filter((i) => i >= 0)
  .join(','));

const librarySelected = () =>
  page.evaluate((sel) => document.querySelectorAll(sel + '--selected').length, LIB);

// Click a row with the real mouse, scrolling it into the middle of its list
// first - a click needs coordinates, and a row past the fold has none.
async function clickLibraryRow(index) {
  await page.evaluate((sel, i) => {
    const list = document.querySelector('.exercise-list');
    const row = document.querySelectorAll(sel)[i];
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 100;
  }, LIB, index);
  await new Promise((r) => setTimeout(r, 60));

  const at = await page.evaluate((sel, i) => {
    const r = document.querySelectorAll(sel)[i].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, LIB, index);
  await page.mouse.click(at.x, at.y);
  await new Promise((r) => setTimeout(r, 80));
}

async function clickComplexRow(index) {
  const at = await page.evaluate((i) => {
    const r = document.querySelectorAll('.complex-list .exercise-row')[i].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, index);
  await page.mouse.click(at.x, at.y);
  await new Promise((r) => setTimeout(r, 120));
}

const press = async (key, modifiers = []) => {
  for (const m of modifiers) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of modifiers) await page.keyboard.up(m);
  await new Promise((r) => setTimeout(r, 120));
};

// ---------- 0. the list really does scroll ----------

const listMetrics = await page.evaluate(() => {
  const list = document.querySelector('.exercise-list');
  return { rows: document.querySelectorAll('.exercise-list .exercise-row').length,
    client: Math.round(list.clientHeight), scroll: Math.round(list.scrollHeight) };
});
check('0: sixteen rows are seeded', listMetrics.rows === 16, JSON.stringify(listMetrics));
check('0: Exercise_list overflows, so a centred row means something',
  listMetrics.scroll > listMetrics.client * 2, JSON.stringify(listMetrics));

// ---------- 1. Shift+Down and Enter, with a real keyboard ----------

await clickLibraryRow(10);
check('1: the row clicked is selected', await librarySelected() === 1, await librarySelected());

await press('ArrowDown', ['Shift']);
await press('ArrowDown', ['Shift']);
check('1: Shift+Down twice selects three rows', await librarySelected() === 3, await librarySelected());

await press('Enter');
const built = await page.evaluate(() => ({
  complexes: document.querySelectorAll('.complex').length,
  rows: document.querySelectorAll('.complex-list .exercise-row').length,
  titles: [...document.querySelectorAll('.complex-list .exercise-row__title')].map((n) => n.textContent),
}));
check('1: Enter made one complex', built.complexes === 1, JSON.stringify(built));
check('1: holding the three selected exercises', built.rows === 3, built.rows);
check('1: and they are the rows that were selected',
  built.titles.every((t, i) => t.endsWith(' ' + (11 + i))), built.titles.join(' | '));

// ---------- 2. selecting in the complex centres the library row ----------

await clickComplexRow(0);
const off10 = await centerOffset(10);
check('2: the exercise the block points at is centred in Exercise_list',
  Math.abs(off10) <= 2, off10);
check('2: that row wears the borrowed highlight', await linkedIndex() === 10, await linkedIndex());
check('2: in the hover fill, and it is the only row filled',
  await filledRows() === '10:' + HOVER_BG, await filledRows());
check('2: it is not selected', await librarySelected() === 0, await librarySelected());
check('2: the selection is still the block in the complex',
  await itemSelection() === '0', await itemSelection());
await shot('list-sync-centred', '.main');

// ---------- 3. Up/Down carry the highlight and the scroll with them ----------

await press('ArrowDown');
const off11 = await centerOffset(11);
check('3: Down re-centres on the next exercise', Math.abs(off11) <= 2, off11);
check('3: and the highlight moves with it', await linkedIndex() === 11, await linkedIndex());

await press('ArrowDown');
check('3: again', await linkedIndex() === 12, await linkedIndex());
const off12 = await centerOffset(12);
check('3: still centred', Math.abs(off12) <= 2, off12);

await press('ArrowDown');
check('3: Down at the end of the complex changes nothing',
  await itemSelection() === '2' && await linkedIndex() === 12,
  (await itemSelection()) + '/' + (await linkedIndex()));

// A range keeps the highlight on the block the run started from.
await press('ArrowUp', ['Shift', 'Control']);
check('3: Ctrl+Shift+Up selected the whole complex',
  await itemSelection() === '0,1,2', await itemSelection());
check('3: and left the highlight where the run started',
  await linkedIndex() === 12, await linkedIndex());

// ---------- 4. the pointer arriving in the list takes hover back ----------

// Two rows below the highlighted one, so "the row under the cursor" and "the
// row that was highlighted" are different rows.
const target = await page.evaluate((sel) => {
  const r = document.querySelectorAll(sel)[14].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, LIB);
await page.mouse.move(target.x, target.y);
await new Promise((r) => setTimeout(r, 150));

check('4: the borrowed highlight is gone', await linkedIndex() === 'count=0', await linkedIndex());
check('4: and the row under the cursor is the only one filled',
  await filledRows() === '14:' + HOVER_BG, await filledRows());
check('4: the complex still holds the selection',
  await itemSelection() === '0,1,2', await itemSelection());
await shot('list-sync-hover', '.main');

// It must not come back when the pointer leaves again.
await page.mouse.move(10, 10);
await new Promise((r) => setTimeout(r, 150));
check('4: nor does it return once the pointer leaves',
  await linkedIndex() === 'count=0' && await filledRows() === '', await filledRows());

// ---------- 5. a keyboard move parks hover until the mouse moves ----------
//
// The keys move the selection but not the pointer, so without this the block
// the pointer was left on goes on drawing its hover fill and the page looks as
// though two blocks are selected.

const parked = () => page.evaluate(() => document.body.classList.contains('hover-off'));

// Which library row the cursor is actually over, by position - the centring
// scroll moves the rows under a pointer that has not moved, so this cannot be
// assumed from the coordinates.
const rowUnderCursor = (x, y) => page.evaluate((sel, px, py) => {
  const node = document.elementFromPoint(px, py);
  const row = node && node.closest ? node.closest('.exercise-row') : null;
  if (!row) return 'none';
  return [...document.querySelectorAll(sel)].indexOf(row);
}, LIB, x, y);

const filledComplexRows = () => page.evaluate(() => [...document.querySelectorAll('.complex-list .exercise-row')]
  .map((row, i) => [i, getComputedStyle(row).backgroundColor])
  .filter(([, color]) => color !== 'rgba(0, 0, 0, 0)')
  .map(([i, color]) => i + ':' + color)
  .join(','));

// A library row the pointer can actually be put on: fully inside the list's
// scrollport, and not the row the complex is pointing at - the two have to be
// different rows for any of this to mean anything. Picked by measuring, not by
// index: the centring scroll has just moved every row under a pointer that has
// not moved, so which indices are on screen is not knowable from here.
const hoverableRow = () => page.evaluate((sel) => {
  const list = document.querySelector('.exercise-list');
  const lb = list.getBoundingClientRect();
  const rows = [...document.querySelectorAll(sel)];
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].classList.contains('exercise-row--linked')) continue;
    const r = rows[i].getBoundingClientRect();
    if (r.top >= lb.top && r.bottom <= lb.bottom) {
      return { index: i, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
  }
  return null;
}, LIB);

const BLOCK_BG = 'rgb(58, 58, 58)'; // --hover-bg-block #3A3A3A

// Select the complex's first block, then put the pointer on a library row.
await clickComplexRow(0);
const hoverAt = await hoverableRow();
check('5: there is a visible row to put the pointer on', hoverAt !== null, hoverAt);
await page.mouse.move(hoverAt.x, hoverAt.y);
await new Promise((r) => setTimeout(r, 150));
check('5: the row under the pointer is hovered, and it is the only fill',
  await filledRows() === hoverAt.index + ':' + HOVER_BG, await filledRows());

// Now move the selection with the keyboard. The pointer has not moved.
await press('ArrowDown');
check('5: the keyboard move parked hover', await parked() === true, await parked());
check('5: so the only fill left in the list is the row it points at',
  await filledRows() === '11:' + HOVER_BG, await filledRows());

// The first real movement brings hover back, wherever the pointer now is.
await page.mouse.move(hoverAt.x + 4, hoverAt.y);
await new Promise((r) => setTimeout(r, 150));
const under = await rowUnderCursor(hoverAt.x + 4, hoverAt.y);
check('5: a movement lifts the park', await parked() === false, await parked());
check('5: the row under the cursor is hovered again, and alone',
  await filledRows() === under + ':' + HOVER_BG,
  (await filledRows()) + ' (cursor over ' + under + ')');

// The same inside Complex_list: the pointer on one block, the keys on another.
await clickComplexRow(0);
const overRow2 = await page.evaluate(() => {
  const r = document.querySelectorAll('.complex-list .exercise-row')[2].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.move(overRow2.x, overRow2.y);
await new Promise((r) => setTimeout(r, 150));
check('5: two blocks are filled while the pointer is really there',
  await filledComplexRows() === '0:' + BLOCK_BG + ',2:' + BLOCK_BG, await filledComplexRows());

await press('ArrowDown');
check('5: after a keyboard move only the selected block is filled',
  await filledComplexRows() === '1:' + BLOCK_BG, await filledComplexRows());
await shot('list-sync-hover-parked', '.main');

await page.mouse.move(overRow2.x + 4, overRow2.y);
await new Promise((r) => setTimeout(r, 150));
check('5: and the pointer moving brings its block back',
  await filledComplexRows() === '1:' + BLOCK_BG + ',2:' + BLOCK_BG, await filledComplexRows());

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
