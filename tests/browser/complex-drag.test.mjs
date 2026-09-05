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

// A complex's outer edges - the outer 12px of its first and last rows. These
// mean "a new complex here"; complexes are stacked flush, so this band is the
// only way to aim at a boundary, the one above the first complex included.
const edgeAbove = (i) => page.evaluate((n) => {
  const b = document.querySelectorAll('.complex')[n].getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 3) };
}, i);
const edgeBelow = (i) => page.evaluate((n) => {
  const b = document.querySelectorAll('.complex')[n].getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.bottom - 3) };
}, i);

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

// ---------- 0. reordering inside Exercise_list ----------
//
// A library block does two different things: it is COPIED into the schedule and
// MOVED when reordered in its own list. dragstart has to declare both - with
// effectAllowed set to plain 'copy', Chrome refused the move outright, showing
// a no-drop cursor and firing no drop event, with nothing logged to say why.
// jsdom cannot catch that: its dataTransfer stub has no such semantics.

const libraryNames = () => page.$$eval('.column--exercise .exercise-row__title',
  (n) => n.map((t) => t.textContent.split(' ')[0]));

const startOrder = await libraryNames();
await dragDrop(await at('.column--exercise .exercise-row', 0),
  await at('.column--exercise .exercise-row', 2, 0.7));
const reordered = await libraryNames();
check('A LIBRARY BLOCK CAN STILL BE DRAGGED WITHIN ITS OWN LIST',
  reordered.join(',') !== startOrder.join(','), reordered.join(','));
check('it landed below the row it was dropped on',
  reordered[2] === startOrder[0], reordered.join(','));

// A group moves too.
await page.evaluate(() => {
  const rows = document.querySelectorAll('.column--exercise .exercise-row');
  rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
});
await new Promise((r) => setTimeout(r, 150));
await dragDrop(await at('.column--exercise .exercise-row', 0),
  await at('.column--exercise .exercise-row', 3, 0.7));
const grouped = await libraryNames();
check('so can a group of them',
  grouped.slice(2).join(',') === reordered.slice(0, 2).join(','), grouped.join(','));

// Put the library back, so the sections below can address rows by index.
await page.evaluate(() => {
  document.querySelector('.header').dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
// Sending each one to the end, in the original order, rebuilds that order.
for (const name of startOrder) {
  const from = (await libraryNames()).indexOf(name);
  await dragDrop(await at('.column--exercise .exercise-row', from),
    await at('.column--exercise .exercise-row', 3, 0.7));
}
check('the library order was restored',
  (await libraryNames()).join(',') === startOrder.join(','), (await libraryNames()).join(','));

// ---------- 1. Exercise_list -> empty Complex_list ----------

check('nothing is scheduled to begin with', (await shape()) === '', await shape());

const started = await dragDrop(await at('.column--exercise .exercise-row', 0), await emptySpace());
check('the drag started', started);
check('dropping in empty space created a complex',
  (await shape()) === 'Отведение', await shape());
check('the exercise stayed in the library', (await libraryCount()) === 4, await libraryCount());
await shot('cxdrag-1-first');

// ---------- 2. Exercise_list -> onto an existing complex ----------

// Onto the bottom half of the complex's only row, clear of its edge band.
await dragDrop(await at('.column--exercise .exercise-row', 1), await at('.complex .exercise-row', 0, 0.7));
check('dropping on a row joined that complex, below it',
  (await shape()) === 'Отведение+Круговое', await shape());

// Onto the top half of the first row, again clear of the band.
await dragDrop(await at('.column--exercise .exercise-row', 2), await at('.complex .exercise-row', 0, 0.3));
check('dropping on the upper half of a row inserts above it',
  (await shape()) === 'Скручивание+Отведение+Круговое', await shape());
check('still one complex', (await page.$$('.complex')).length === 1);
check('and the library is still four rows', (await libraryCount()) === 4, await libraryCount());

// The same exercise a second time - complexes hold copies, not the original.
await dragDrop(await at('.column--exercise .exercise-row', 0), await emptySpace());
check('the same exercise can be scheduled twice',
  (await shape()) === 'Скручивание+Отведение+Круговое | Отведение', await shape());
await shot('cxdrag-2-two-complexes');

// ---------- 3. a scheduled block onto a complex boundary ----------

await dragDrop(await at('.complex .exercise-row', 0), await edgeBelow(0));
check('dragged onto a complex\'s bottom edge it became a complex of its own',
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

// Selected by index rather than by selector: the Date_pointer is a sibling of
// the complexes, so :nth-of-type does not count what it looks like it counts.
await page.evaluate(() => {
  const rows = document.querySelectorAll('.complex .exercise-row');
  rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
});
await new Promise((r) => setTimeout(r, 150));
const selected = await page.$$eval('.complex .exercise-row--selected', (n) => n.length);
check('two blocks selected across two complexes', selected === 2, selected);

await dragDrop(await at('.complex .exercise-row', 0), await emptySpace());
check('the group left as one new complex at the end',
  (await shape()) === 'Отведение+Круговое | Скручивание+Отведение', await shape());
check('the complexes they emptied were pruned',
  (await page.$$('.complex')).length === 2, (await page.$$('.complex')).length);
await shot('cxdrag-4-grouped');

// ---------- 6. above the very first complex ----------

// With the complexes flush this band is the only aim point for the boundary at
// the head of the list; before it existed the drop fell into the first complex.
await dragDrop(await at('.column--exercise .exercise-row', 3), await edgeAbove(0));
check('dropping on the first complex\'s top edge makes a complex ABOVE it',
  (await shape()) === 'Наклоны | Отведение+Круговое | Скручивание+Отведение', await shape());

// Just inside that band, the same drop is an ordinary insert again.
await dragDrop(await at('.column--exercise .exercise-row', 3), await at('.complex .exercise-row', 1, 0.3));
check('just inside the band it inserts into the complex instead',
  (await shape()) === 'Наклоны | Наклоны+Отведение+Круговое | Скручивание+Отведение',
  await shape());
await shot('cxdrag-5-above-first');

// ---------- 7. the list stays where the user left it ----------

// Shrink the viewport so the list scrolls at all.
await page.setViewport({ width: 1500, height: 360, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 200));

const scrollRange = await page.$eval('.complex-list', (n) => n.scrollHeight - n.clientHeight);
check('the list overflows, so scroll behaviour is testable', scrollRange > 40, scrollRange);

const scrollTop = () => page.$eval('.complex-list', (n) => Math.round(n.scrollTop));
await page.$eval('.complex-list', (n) => { n.scrollTop = 60; });
await new Promise((r) => setTimeout(r, 100));

// Selecting re-renders the whole page; the scroll must survive it.
await page.evaluate(() => {
  document.querySelectorAll('.complex__side')[1]
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 150));
check('selecting a complex does not scroll the list back to the top',
  (await scrollTop()) === 60, await scrollTop());

await page.evaluate(() => {
  document.querySelectorAll('.complex .exercise-row')[1]
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 150));
check('selecting a block does not scroll the list either',
  (await scrollTop()) === 60, await scrollTop());

// Switching a complex out of the schedule re-renders the whole page too.
await page.evaluate(() => {
  const input = document.querySelectorAll('.complex__side .switch__input')[1];
  input.checked = false;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 150));
check('flipping a switch does not scroll the list back',
  (await scrollTop()) === 60, await scrollTop());

// Reordering is the same mechanism and is covered against a known layout in
// tests/jsdom/complexes.test.mjs - dragging a side block that the scroll has
// pushed off the top of the list is not something a user can do either.

// ---------- 8. dragging to an edge scrolls the list ----------

// A drag captures the pointer, so the wheel and the scrollbar are unreachable:
// holding the cursor near an edge has to move the list on its own.
await page.$eval('.complex-list', (n) => { n.scrollTop = 0; });
await new Promise((r) => setTimeout(r, 100));

const bottomEdge = await page.evaluate(() => {
  const b = document.querySelector('.complex-list').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.bottom - 8) };
});
const source = await at('.column--exercise .exercise-row', 0);

const data = await page.mouse.drag(source, bottomEdge);
await page.mouse.dragEnter(bottomEdge, data);
await page.mouse.dragOver(bottomEdge, data);
await new Promise((r) => setTimeout(r, 400));
const scrolledDown = await scrollTop();
check('hovering the bottom edge mid-drag scrolls the list down',
  scrolledDown > 20, scrolledDown);

// And back up from the top edge.
const topEdge = await page.evaluate(() => {
  const b = document.querySelector('.complex-list').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 8) };
});
await page.mouse.dragOver(topEdge, data);
await new Promise((r) => setTimeout(r, 400));
const scrolledBack = await scrollTop();
check('hovering the top edge scrolls it back up', scrolledBack < scrolledDown, scrolledBack);

await page.mouse.drop(topEdge, data);
await page.mouse.up();
await new Promise((r) => setTimeout(r, 300));

const settled = await scrollTop();
await new Promise((r) => setTimeout(r, 400));
check('the auto-scroll stops when the drag ends',
  (await scrollTop()) === settled, settled + ' -> ' + (await scrollTop()));

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
