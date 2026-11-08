// Opening a category shows today. Complex_list puts the Date_pointer in its
// middle; Exercise_list lines up the first exercise of the complex after the
// pointer with that exercise's block in the complex, top edge to top edge.
// Both on the first mount and on a click onto another category's button - and
// a drag carried into another category keeps its "both lists at the end"
// behaviour instead (browser/cross-category covers that in full).

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

// Everything the two checks need, measured in one go. The pointer's position is
// read through the complex after it, because the pointer itself is sticky.
const measure = () => page.evaluate(() => {
  const cx = document.querySelector('.complex-list');
  const lib = document.querySelector('.exercise-list');
  const pointer = cx && cx.querySelector('.date-pointer');
  if (!pointer) return null;
  const next = pointer.nextElementSibling;
  const lb = cx.getBoundingClientRect();
  const out = {
    cxTop: Math.round(cx.scrollTop),
    cxMax: cx.scrollHeight - cx.clientHeight,
    libTop: Math.round(lib.scrollTop),
    pointerFromMiddle: null,
    itemTop: null,
    rowTop: null,
  };
  if (next && next.classList.contains('complex')) {
    out.pointerFromMiddle = +(next.getBoundingClientRect().top - 1 - (lb.top + lb.height / 2)).toFixed(1);
    const item = next.querySelector('.exercise-row');
    out.itemName = item.querySelector('.exercise-row__title').textContent;
    out.itemTop = Math.round(item.getBoundingClientRect().top);
    const row = [...lib.querySelectorAll('.exercise-row')]
      .find((r) => r.querySelector('.exercise-row__title').textContent === out.itemName);
    out.rowTop = row ? Math.round(row.getBoundingClientRect().top) : null;
  }
  return out;
});

// ---------- 1. the first mount ----------

// Twenty one-exercise complexes, the pointer in front of the eleventh, and a
// window short enough that both lists scroll a long way.
await page.setViewport({ width: 1400, height: 560, deviceScaleFactor: 1 });
await page.goto(harness('seed=exercises&rows=20&complexes=' + Array(20).fill(1).join(',') + '&start=-10&multi'),
  { waitUntil: 'networkidle2' });
await page.waitForSelector('.complex-list .complex');
await wait(300);

let m = await measure();
check('1: Complex_list is scrolled at all', m && m.cxTop > 0 && m.cxTop < m.cxMax, JSON.stringify(m));
check('1: the Date_pointer is in the middle of Complex_list', m && Math.abs(m.pointerFromMiddle) <= 1,
  m && m.pointerFromMiddle);
check('1: Exercise_list is scrolled at all', m && m.libTop > 0, m && m.libTop);
check('1: the current complex\'s first exercise lines up across the two lists',
  m && m.rowTop !== null && Math.abs(m.rowTop - m.itemTop) <= 1, m && JSON.stringify([m.itemName, m.itemTop, m.rowTop]));
await page.screenshot({ path: OUT + '/open-scroll-1-mount.png' });

// ---------- 2. away and back again by clicking ----------

const buttonOf = (name) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('.categories .category-list .menu-button')]
    .find((x) => x.querySelector('.menu-button__sizer')?.textContent === n);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, name);
const homeName = await page.evaluate(() =>
  document.querySelector('.categories .menu-button--active .menu-button__sizer').textContent);
const otherName = await page.evaluate((home) =>
  [...document.querySelectorAll('.categories .category-list .menu-button__sizer')]
    .map((n) => n.textContent).find((t) => t !== home && t), homeName);

// Scroll both lists to the top by hand, so coming back has to move them.
await page.evaluate(() => {
  document.querySelector('.complex-list').scrollTop = 0;
  document.querySelector('.exercise-list').scrollTop = 0;
});
let at = await buttonOf('Колено');
await page.mouse.click(at.x, at.y);
await wait(200);
at = await buttonOf(homeName);
await page.mouse.click(at.x, at.y);
await wait(200);
m = await measure();
check('2: clicking back into the category re-centres the Date_pointer', m && Math.abs(m.pointerFromMiddle) <= 1,
  m && JSON.stringify(m));
check('2: and lines the exercise up again', m && m.rowTop !== null && Math.abs(m.rowTop - m.itemTop) <= 1,
  m && JSON.stringify([m.itemTop, m.rowTop]));

// Clicking the category that is already open moves nothing.
await page.evaluate(() => { document.querySelector('.complex-list').scrollTop = 7; });
await page.mouse.click(at.x, at.y);
await wait(200);
m = await measure();
check('2: clicking the open category leaves the lists where they are', m && m.cxTop === 7, m && m.cxTop);

// ---------- 3. a drag carried into another category is not re-aimed ----------

// Back to the middle first, then carry an exercise from Колено onto it.
at = await buttonOf('Колено');
await page.mouse.click(at.x, at.y);
await wait(200);
const from = await page.evaluate(() => {
  const r = document.querySelector('.column--exercise .exercise-row').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
const to = await buttonOf(homeName);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 12; i += 1) {
  await page.mouse.move(from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12);
  await wait(15);
}
await page.mouse.move(to.x + 2, to.y + 1);
await wait(250);
m = await measure();
check('3: a drag into the category leaves Complex_list at its end, not at today',
  m && Math.abs(m.cxTop - m.cxMax) <= 1, m && JSON.stringify([m.cxTop, m.cxMax]));
await page.keyboard.press('Escape');
await page.mouse.up();
await wait(300);

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
