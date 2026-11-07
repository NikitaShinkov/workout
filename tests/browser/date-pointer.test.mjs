// The Date_pointer as a handle, in real Chrome: pick it up by its triangle,
// drop it on a boundary, and the block after that boundary becomes today's -
// on the schedule page (one category, through the start date field) and on the
// calendar (every category at once).
//
// Expectations are worked out in the page from its own clock, so the suite
// means the same thing whatever day it runs on.

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 1500, height: 800, deviceScaleFactor: 2 });

// Where the list's children sit: 'P' for the pointer, the date for a block.
const listShape = () => page.$$eval('.complex-list > *', (nodes) => nodes.map((n) =>
  n.classList.contains('date-pointer')
    ? 'P'
    : (n.querySelector('.complex__date') || {}).textContent || '?').join(' '));

// Today and its neighbours, formatted the way the app writes them.
const days = () => page.evaluate(async () => {
  const s = await import('/js/schedule.js');
  const t = s.startOfDay();
  const f = (n) => s.formatDate(s.addDays(t, n));
  return { yesterday: f(-1), today: f(0), tomorrow: f(1), plus2: f(2), minus2: f(-2), minus3: f(-3) };
});

const handleCentre = () => page.$eval('.date-pointer__handle', (n) => {
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
});
const blockTop = (i) => page.$$eval('.complex-list .complex', (n, i) => {
  const r = n[i].getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
}, i);

// Press on the handle, travel in steps, and stop before releasing so the
// caller can look at the gesture mid-flight.
async function pickUpAndMove(toY) {
  const from = await handleCentre();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, toY, { steps: 12 });
  await wait(50);
}

// ============================================================
// 1. the schedule page
// ============================================================

// The default schedule is 3, 4, 5 сен - in the past, so the pointer is last.
await page.goto(harness('seed=exercises&complexes=2,1,1'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.date-pointer');
await wait(300);
const d = await days();

check('1: the pointer starts below every past complex',
  (await listShape()) === '3 сен 4 сен 5 сен P', await listShape());

const handle = await handleCentre();
// The grab area is a 20px band across the whole list, centred on the rule,
// and it wins over the complexes either side of it.
const band = await page.evaluate(() => {
  const rule = document.querySelector('.date-pointer').getBoundingClientRect();
  const h = document.querySelector('.date-pointer__handle').getBoundingClientRect();
  const list = document.querySelector('.complex-list').getBoundingClientRect();
  const handleAt = (x, y) => !!document.elementFromPoint(x, y)?.closest('.date-pointer__handle');
  const blockAt = (x, y) => !!document.elementFromPoint(x, y)?.closest('.complex');
  const mid = rule.top + rule.height / 2;
  const xs = [list.left + 5, list.left + 40, list.left + list.width / 2, list.right - 10];
  return {
    height: h.height,
    fullWidth: Math.abs(h.left - list.left) <= 1 && Math.abs(h.right - list.right) <= 1,
    centred: Math.abs((h.top + h.height / 2) - mid) <= 1,
    insideIsHandle: xs.every((x) => handleAt(x, mid - 9) && handleAt(x, mid) && handleAt(x, mid + 9)),
    // Just outside the band, above: the last complex is there.
    outsideIsBlock: xs.slice(1).every((x) => !handleAt(x, mid - 12) && blockAt(x, mid - 12)),
  };
});
check('1: the grab area is 20px tall', band.height === 20, band.height);
check('1: it spans the whole list', band.fullWidth, JSON.stringify(band));
check('1: centred on the rule', band.centred, JSON.stringify(band));
check('1: inside the band the pointer wins over the complexes', band.insideIsHandle,
  JSON.stringify(band));
check('1: outside it the complex is under the cursor again', band.outsideIsBlock,
  JSON.stringify(band));

// A row or complex drag must see through the band, or it would lose the row
// under it and turn a drop into a complex into a new complex.
const duringDnd = await page.evaluate(() => {
  const row = document.querySelector('.complex-list .exercise-row');
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
  const during = getComputedStyle(document.querySelector('.date-pointer__handle')).pointerEvents;
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  const after = getComputedStyle(document.querySelector('.date-pointer__handle')).pointerEvents;
  return { during, after };
});
check('1: during a block drag the band steps aside, and comes back after',
  duringDnd.during === 'none' && duringDnd.after === 'auto', JSON.stringify(duringDnd));
check('1: and shows a grab cursor', await page.$eval('.date-pointer__handle',
  (n) => getComputedStyle(n).cursor) === 'grab');

// Up to the boundary between the first and second complexes.
const second = await blockTop(1);
await pickUpAndMove(second.top + 4);

const mid = await page.evaluate(() => {
  const p = document.querySelector('.date-pointer');
  const blocks = Array.from(document.querySelectorAll('.complex-list .complex'));
  return {
    dragging: p.classList.contains('date-pointer--dragging'),
    y: p.getBoundingClientRect().top,
    marker: blocks.findIndex((b) => b.classList.contains('complex--drop-before')),
    cursor: getComputedStyle(document.body).cursor,
    hovered: blocks.filter((b) => b.matches(':hover')).length,
  };
});
check('1: mid-drag the pointer follows the cursor',
  mid.dragging && Math.abs(mid.y - (second.top + 4)) <= 2, JSON.stringify(mid));
check('1: and the boundary it will land on is marked', mid.marker === 1, mid.marker);
check('1: the cursor says grabbing', mid.cursor === 'grabbing', mid.cursor);
check('1: nothing under the cursor takes a hover fill', mid.hovered === 0, mid.hovered);
check('1: nothing has been written yet', (await page.$eval('.input--date', (n) => n.value)) === '3 сен');
await page.screenshot({ path: OUT + '/date-pointer-mid-drag.png', clip: { x: 0, y: 40, width: 760, height: 380 } });

await page.mouse.up();
await wait(250);

check('1: the start date field took the new date',
  (await page.$eval('.input--date', (n) => n.value)) === d.yesterday,
  await page.$eval('.input--date', (n) => n.value));
check('1: the complex after the boundary is today\'s, with the pointer above it',
  (await listShape()) === `${d.yesterday} P ${d.today} ${d.tomorrow}`, await listShape());
check('1: the store holds it as ISO',
  await page.evaluate(async () => /^\d{4}-\d{2}-\d{2}$/.test(
    (await import('/js/store.js')).activeCategory().scheduleStartDate)));
check('1: the end date in the toolbar followed',
  (await page.$eval('.schedule-toolbar', (n) => n.innerText)).includes('по ' + d.tomorrow),
  await page.$eval('.schedule-toolbar', (n) => n.innerText));
check('1: nothing is left marked',
  (await page.$$('.complex--drop-before, .complex--drop-after, .date-pointer--dragging')).length === 0);
await page.screenshot({ path: OUT + '/date-pointer-dropped.png', clip: { x: 0, y: 40, width: 760, height: 380 } });

// Above the first complex: the first is today.
await pickUpAndMove((await blockTop(0)).top + 2);
await page.mouse.up();
await wait(250);
check('1: dropped above the first, the first is today',
  (await listShape()) === `P ${d.today} ${d.tomorrow} ${d.plus2}`, await listShape());

// Below the last: every complex is past, the last one yesterday.
await pickUpAndMove((await blockTop(2)).bottom - 2);
await page.mouse.up();
await wait(250);
const lastShape = await listShape();
check('1: dropped below the last, every complex is past and the last was yesterday',
  lastShape === `${d.minus3} ${d.minus2} ${d.yesterday} P`, lastShape);

// Escape abandons the gesture: nothing moves, nothing is written.
const before = await page.$eval('.input--date', (n) => n.value);
await pickUpAndMove((await blockTop(0)).top + 2);
await page.keyboard.press('Escape');
await page.mouse.up();
await wait(250);
check('1: Escape puts it back and writes nothing',
  (await page.$eval('.input--date', (n) => n.value)) === before && (await listShape()) === lastShape,
  await listShape());

// A click on the handle is not a drag.
const c = await handleCentre();
await page.mouse.click(c.x, c.y);
await wait(200);
check('1: a click on the handle changes nothing',
  (await page.$eval('.input--date', (n) => n.value)) === before);

// ============================================================
// 2. the calendar page - every category at once
// ============================================================

await page.goto(harness('seed=exercises&complexes=2,1,1&multi&page=calendar'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.complex-list--calendar .date-pointer');
await wait(300);

const calendarDates = () => page.evaluate(async () => {
  const store = await import('/js/store.js');
  const s = await import('/js/schedule.js');
  const state = store.getState();
  const out = {};
  for (const id of state.categoryOrder) {
    const c = state.categories[id];
    const { dates } = s.buildSchedule(c);
    out[id] = c.complexes.map((x) => (dates.get(x.id) ? s.toIsoDate(dates.get(x.id)) : '-'));
  }
  return out;
});
const calBefore = await calendarDates();
const dayKeys = await page.$$eval('.complex-list--calendar .complex', (n) => n.map((d) => d.dataset.day));

check('2: the calendar pointer has a handle too',
  (await page.$$('.complex-list--calendar .date-pointer--movable .date-pointer__handle')).length === 1);
check('2: more than one category is on the calendar',
  Object.keys(calBefore).length >= 2, JSON.stringify(calBefore));

// Up to the boundary before the second day.
await pickUpAndMove((await blockTop(1)).top + 4);
const calMid = await page.$$eval('.complex-list--calendar .complex',
  (n) => n.findIndex((b) => b.classList.contains('complex--drop-before')));
check('2: the boundary is marked on the calendar', calMid === 1, calMid);
await page.mouse.up();
await wait(250);

check('2: the second day now reads today, with the pointer above it',
  (await listShape()).startsWith(`${d.yesterday} P ${d.today}`),
  await listShape());

// Every category moved by the same number of days.
const calAfter = await calendarDates();
const shiftOf = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const target = new Date(dayKeys[1]);
const todayIso = await page.evaluate(async () => (await import('/js/schedule.js')).toIsoDate(new Date()));
const expected = shiftOf(dayKeys[1], todayIso);
const shifts = [];
for (const id of Object.keys(calBefore)) {
  calBefore[id].forEach((iso, i) => {
    if (iso !== '-') shifts.push(shiftOf(iso, calAfter[id][i]));
  });
}
check('2: every category moved, and by the same number of days',
  shifts.length > 0 && shifts.every((s) => s === expected), JSON.stringify({ expected, shifts, target }));

// The schedule page agrees: its date field shows the moved start.
const firstCategory = await page.evaluate(async () => {
  const store = await import('/js/store.js');
  const s = await import('/js/schedule.js');
  const state = store.getState();
  return s.formatDate(s.parseStartDate(state.categories[state.categoryOrder[0]].scheduleStartDate));
});
await page.click('.header .categories .menu-button');
await page.waitForSelector('.input--date');
await wait(200);
check('2: the schedule page\'s date field shows the moved start',
  (await page.$eval('.input--date', (n) => n.value)) === firstCategory,
  (await page.$eval('.input--date', (n) => n.value)) + ' vs ' + firstCategory);

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
