// Carrying exercises and complexes into another category, with REAL native
// drags (mouse down / move / up, no drag interception): so it is Chrome's own
// drag session that has to survive the page switching category under it, and
// Chrome's own dragend that has to find the parked source node.
//
// The harness's first category (Голеностоп) is long, so "scrolled to the
// bottom" means something; the second (Колено, &multi) is short and is where
// every drag starts.

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

let page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1500, height: 800, deviceScaleFactor: 1 });

const SIZES = Array(12).fill('2,1,1').join(',');
async function open() {
  await page.goto(harness('seed=exercises&rows=30&complexes=' + SIZES + '&multi'), { waitUntil: 'networkidle2' });
  await page.waitForSelector('.exercise-row');
  await wait(300);
  // Start in Колено.
  await page.evaluate(() => document.querySelectorAll('.categories .category-list .menu-button')[1].click());
  await wait(200);
}

const centre = (selector, index = 0, dy = 0.5) => page.evaluate((s, i, f) => {
  const n = document.querySelectorAll(s)[i];
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * f) };
}, selector, index, dy);
const button = (i) => centre('.categories .category-list .menu-button', i);

async function glide(from, to, steps = 12) {
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    await wait(15);
  }
}

const state = () => page.evaluate(async () => {
  const s = (await import('/js/store.js')).getState();
  const cat = (i) => s.categories[s.categoryOrder[i]];
  const scroll = (sel) => {
    const l = document.querySelector(sel);
    return l ? { top: Math.round(l.scrollTop), max: l.scrollHeight - l.clientHeight } : null;
  };
  return {
    active: s.categoryOrder.indexOf(s.ui.activeCategory),
    activeButton: document.querySelector('.categories .menu-button--active .menu-button__sizer')?.textContent,
    ankle: { exercises: cat(0).exercises.map((e) => e.name), complexes: cat(0).complexes.length,
      complexIds: cat(0).complexes.map((c) => c.id),
      complexNames: cat(0).complexes.map((c) => c.items.map((i) => cat(0).exercises.find((e) => e.id === i.exerciseId)?.name).join('+')) },
    knee: { exercises: cat(1).exercises.map((e) => e.name), complexes: cat(1).complexes.length },
    lib: scroll('.exercise-list'), cx: scroll('.complex-list'),
    libMarker: [...document.querySelectorAll('.exercise-list .exercise-row')].findIndex((n) => n.classList.contains('exercise-row--drop-after')),
    libRows: document.querySelectorAll('.exercise-list .exercise-row').length,
    cxMarker: [...document.querySelectorAll('.complex-list .complex')].findIndex((n) => n.classList.contains('complex--drop-after')),
    cxCount: document.querySelectorAll('.complex-list .complex').length,
    anyMarker: document.querySelectorAll('.exercise-row--drop-after, .exercise-row--drop-before, .complex--drop-after, .complex--drop-before, .complex-list--drop').length,
    park: Boolean(document.querySelector('.drag-source-park')),
    undo: document.querySelector('.undo-button span')?.textContent || null,
  };
});

// ============================================================
// 1. an exercise, released outside the lists
// ============================================================

await open();
let s0 = await state();
check('0: starts in Колено, 2 exercises, Голеностоп has 30', s0.active === 1 && s0.knee.exercises.length === 2
  && s0.ankle.exercises.length === 30, JSON.stringify([s0.active, s0.knee.exercises.length, s0.ankle.exercises.length]));
const kneeFirst = s0.knee.exercises[0];

let from = await centre('.column--exercise .exercise-row', 0);
let ankle = await button(0);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await glide(from, ankle);
await page.mouse.move(ankle.x + 2, ankle.y + 1);
await wait(250);
let s = await state();
check('1: HOVERING Голеностоп OPENS IT mid-drag', s.active === 0, s.active);
check('1: its button is the selected one', s.activeButton === 'Голеностоп', s.activeButton);
check('1: Exercise_list is scrolled to the very bottom', s.lib && s.lib.max > 0 && Math.abs(s.lib.top - s.lib.max) <= 1,
  JSON.stringify(s.lib));
check('1: and so is Complex_list - an exercise can go into either', s.cx && s.cx.max > 0 && Math.abs(s.cx.top - s.cx.max) <= 1, JSON.stringify(s.cx));
check('1: the blue bar is under the last exercise', s.libMarker === s.libRows - 1, s.libMarker + '/' + s.libRows);
check('1: the drag source is parked, alive', s.park);
await page.screenshot({ path: OUT + '/cross-1-hover.png' });

// Down onto the view options, which belong to no list.
const options = await centre('.view-options .icon-button', 0);
await glide({ x: ankle.x + 2, y: ankle.y + 1 }, { x: options.x + 200, y: options.y }, 6);
await wait(150);
s = await state();
check('1: outside the lists the bar stays at the end', s.libMarker === s.libRows - 1, s.libMarker);
await page.mouse.up();
await wait(400);
s = await state();
check('1: RELEASED: a copy at the end of Голеностоп', s.ankle.exercises.length === 31
  && s.ankle.exercises[30] === kneeFirst, JSON.stringify(s.ankle.exercises.slice(-2)));
check('1: Колено keeps its own', s.knee.exercises.length === 2 && s.knee.exercises[0] === kneeFirst);
check('1: the list is scrolled on to the new last row', Math.abs(s.lib.top - s.lib.max) <= 1, JSON.stringify(s.lib));
check('1: «Отменить перенос в Голеностоп»', s.undo === 'Отменить перенос в Голеностоп (Ctrl+Z) 5', s.undo);
check('1: the drag is over (the park is gone)', !s.park);
await page.screenshot({ path: OUT + '/cross-1-done.png' });

await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
await wait(250);
s = await state();
check('1: Ctrl+Z takes the copy back out', s.ankle.exercises.length === 30, s.ankle.exercises.length);

// ============================================================
// 2. cancelled with Escape: the parked node still gets its dragend
// ============================================================

await open();
from = await centre('.column--exercise .exercise-row', 0);
ankle = await button(0);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await glide(from, ankle);
await page.mouse.move(ankle.x + 2, ankle.y + 1);
await wait(250);
await page.keyboard.press('Escape');
await wait(300);
await page.mouse.up();
await wait(300);
s = await state();
check('2: ESCAPE cancels: nothing copied', s.ankle.exercises.length === 30 && s.knee.exercises.length === 2);
check('2: and the drag is cleaned up (dragend reached the parked node)', !s.park && s.anyMarker === 0,
  JSON.stringify([s.park, s.anyMarker]));

// A reorder inside the category still works afterwards - the drag state was
// really cleared, not merely hidden.
await page.evaluate(() => { document.querySelector(".exercise-list").scrollTop = 0; });
await wait(100);
const r0 = await centre('.column--exercise .exercise-row', 0);
const r2 = await centre('.column--exercise .exercise-row', 2, 0.75);
const names0 = (await state()).ankle.exercises.slice(0, 3);
await page.mouse.move(r0.x, r0.y);
await page.mouse.down();
await glide(r0, r2, 10);
await wait(150);
await page.mouse.up();
await wait(400);
const names1 = (await state()).ankle.exercises.slice(0, 3);
check('2: an ordinary reorder works after the cancel',
  names1[0] === names0[1] && names1[2] === names0[0], JSON.stringify([names0, names1]));

// ============================================================
// From here on, puppeteer's drag interception instead of a native drag.
// ============================================================
//
// A native drag in headless Chrome lags behind the mouse and can drop the
// last dragover and the drop itself - even with no category switch at all,
// which is why the other drag suites intercept too. The two native sections
// above prove what only a native drag can (the session survives the switch,
// dragend finds the parked node); exact positions are checked here, where
// every event is dispatched deterministically.

page = await browser.newPage();
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1500, height: 800, deviceScaleFactor: 1 });
await page.setDragInterception(true);

// Pick up `from`, carry it onto the category button and hold it there.
async function carry(from, onto) {
  const data = await page.mouse.drag(from, onto);
  await page.mouse.dragEnter(onto, data);
  await page.mouse.dragOver(onto, data);
  await wait(150);
  return data;
}
async function hover(point, data) {
  await page.mouse.dragEnter(point, data);
  await page.mouse.dragOver(point, data);
  await wait(120);
}
async function release(point, data) {
  await page.mouse.drop(point, data);
  await page.mouse.up(); // gotcha 17
  await wait(350);
}

// ============================================================
// 3. an exercise into Exercise_list, at a place
// ============================================================

await open();
s0 = await state();
let data = await carry(await centre('.column--exercise .exercise-row', 1), await button(0));
check('3: (the category opened)', (await state()).active === 0);
// The top half of the row second from the bottom: it goes before that row.
const libTarget = await centre('.column--exercise .exercise-row', 28, 0.25);
await hover(libTarget, data);
const before = await page.evaluate(() =>
  [...document.querySelectorAll('.column--exercise .exercise-row')].findIndex((n) => n.classList.contains('exercise-row--drop-before')));
check('3: inside Exercise_list the marker follows the pointer', before === 28, before);
await page.screenshot({ path: OUT + '/cross-3-place.png' });
await release(libTarget, data);
s = await state();
check('3: THE COPY LANDS THERE', s.ankle.exercises.length === 31 && s.ankle.exercises[28] === s0.knee.exercises[1],
  JSON.stringify(s.ankle.exercises.slice(27, 30)));

// ============================================================
// 4. a complex, released on the button itself
// ============================================================

await open();
s0 = await state();
const onto = await button(0);
data = await carry(await centre('.complex__side', 0), onto);
s = await state();
check('4: a complex opens the category too', s.active === 0);
check('4: Complex_list is scrolled to the very bottom', s.cx && s.cx.max > 0 && Math.abs(s.cx.top - s.cx.max) <= 1,
  JSON.stringify(s.cx));
check('4: Exercise_list is NOT', s.lib && s.lib.top === 0, JSON.stringify(s.lib));
check('4: the bar is under the last complex', s.cxMarker === s.cxCount - 1, s.cxMarker + '/' + s.cxCount);
await page.screenshot({ path: OUT + '/cross-4-hover.png' });
await hover(onto, data);
await release(onto, data);
s = await state();
check('4: RELEASED ON THE BUTTON: the complex is copied to the end', s.ankle.complexes === s0.ankle.complexes + 1
  && s.ankle.complexNames[s.ankle.complexNames.length - 1] === s0.knee.exercises[0],
  JSON.stringify(s.ankle.complexNames.slice(-2)));
check('4: and its exercise is added to Exercise_list', s.ankle.exercises.length === 31
  && s.ankle.exercises[30] === s0.knee.exercises[0], JSON.stringify(s.ankle.exercises.slice(-2)));
check('4: Complex_list scrolled on to the new last complex', Math.abs(s.cx.top - s.cx.max) <= 1, JSON.stringify(s.cx));
check('4: Колено keeps its complex', s.knee.complexes === 2);
check('4: «Отменить перенос в Голеностоп»', s.undo === 'Отменить перенос в Голеностоп (Ctrl+Z) 5', s.undo);

// ============================================================
// 5. a complex into Complex_list, at a boundary
// ============================================================

await open();
s0 = await state();
data = await carry(await centre('.complex__side', 1), await button(0));
const n = s0.ankle.complexes;
// The top edge of the complex third from the end.
const edge = await page.evaluate((i) => {
  const r = document.querySelectorAll('.complex-list .complex')[i].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 4) };
}, n - 3);
await hover(edge, data);
const marked = await page.evaluate(() =>
  [...document.querySelectorAll('.complex-list .complex')].findIndex((c) => c.classList.contains('complex--drop-before')));
check('5: inside Complex_list the marker follows the pointer', marked === n - 3, marked);
await release(edge, data);
s = await state();
check('5: THE COMPLEX LANDS AT THAT BOUNDARY', s.ankle.complexes === n + 1
  && s.ankle.complexNames[n - 3] === s0.knee.exercises[1], JSON.stringify(s.ankle.complexNames.slice(n - 4, n - 1)));

// ============================================================
// 6. an exercise into Complex_list becomes a complex there; a complex is
//    refused by Exercise_list
// ============================================================

await open();
s0 = await state();
data = await carry(await centre('.column--exercise .exercise-row', 0), await button(0));
// Over the middle of a row of the complex third from the end, upper half:
// a row, but exercises from elsewhere only ever make a complex of their own.
const m = s0.ankle.complexes;
const cxPoint = await page.evaluate((i) => {
  const r = document.querySelectorAll('.complex-list .complex')[i].querySelector('.exercise-row').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.3) };
}, m - 3);
await hover(cxPoint, data);
const cxMarked = await page.evaluate(() =>
  [...document.querySelectorAll('.complex-list .complex')].findIndex((c) => c.classList.contains('complex--drop-before')));
check('6: an exercise over Complex_list marks a complex boundary', cxMarked === m - 3, cxMarked);
await page.screenshot({ path: OUT + '/cross-6-as-complex.png' });
await release(cxPoint, data);
s = await state();
check('6: RELEASED: a new complex of it at that boundary', s.ankle.complexes === m + 1
  && s.ankle.complexNames[m - 3] === s0.knee.exercises[0], JSON.stringify(s.ankle.complexNames.slice(m - 4, m - 1)));
check('6: and the exercise at the end of Exercise_list', s.ankle.exercises.length === 31
  && s.ankle.exercises[30] === s0.knee.exercises[0], JSON.stringify(s.ankle.exercises.slice(-2)));

await open();
s0 = await state();
data = await carry(await centre('.complex__side', 0), await button(0));
const libPoint = await centre('.column--exercise .exercise-row', 5);
await hover(libPoint, data);
s = await state();
check('6: a complex over Exercise_list shows no marker', s.anyMarker === 0, s.anyMarker);
await release(libPoint, data);
s = await state();
check('6: and released there copies nothing', s.ankle.exercises.length === 30 && s.ankle.complexes === s0.ankle.complexes,
  JSON.stringify([s.ankle.exercises.length, s.ankle.complexes]));

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
