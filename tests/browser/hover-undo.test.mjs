// The hover-arming sequence and the undo countdown, driven with real mouse
// input in Chrome. jsdom cannot express ":hover", so this is the only place the
// core of change 1 can actually be verified.

import puppeteer from 'puppeteer-core';

import { OUT, BASE, harness, findChrome } from '../helpers/env.mjs';
const CHROME = findChrome();
const browser = await puppeteer.launch({
  executablePath: CHROME,
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

await page.setViewport({ width: 1400, height: 500, deviceScaleFactor: 3 });
await page.goto(harness('seed=plain'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase('fitness_app');
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.goto(harness('seed=plain'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.menu-button');
await new Promise((r) => setTimeout(r, 700));

const centreOf = (nth) => page.evaluate((n) => {
  const b = document.querySelectorAll('.menu-button')[n].getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}, nth);

// Reads the state of whichever button is active.
const activeState = () => page.evaluate(() => {
  const b = document.querySelector('.menu-button--active');
  const close = b.querySelector('.menu-button__close');
  return {
    name: b.querySelector('.menu-button__sizer').textContent,
    armed: b.classList.contains('menu-button--hover-armed'),
    closeDisplay: close ? getComputedStyle(close).display : 'absent',
    labelRight: getComputedStyle(b.querySelector('.menu-button__label')).right,
    width: Number(b.getBoundingClientRect().width.toFixed(2)),
  };
});

const shot = async (name) => {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.categories').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top - 2), width: 700, height: Math.round(r.height + 4) };
  });
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

// ---------- 1. the exact scenario: click, cursor stays, no X ----------
const target = await centreOf(1); // "Колено"
await page.mouse.move(target.x, target.y);
await new Promise((r) => setTimeout(r, 120));
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 250));

const afterClick = await activeState();
lines.push('\nafter clicking with the cursor still on the button: ' + JSON.stringify(afterClick) + '\n');
check('1: the clicked category became active', afterClick.name === 'Колено', afterClick.name);
check('1: NO close button while the cursor has not left yet',
  afterClick.closeDisplay === 'none', afterClick.closeDisplay);
check('1: the label is not narrowed either', afterClick.labelRight === '8px', afterClick.labelRight);
check('1: the button is not armed yet', afterClick.armed === false);
await shot('hover-1-after-click');

// move away
await page.mouse.move(target.x, target.y + 160);
await new Promise((r) => setTimeout(r, 200));
const afterLeave = await activeState();
check('1: leaving arms the button', afterLeave.armed === true);
check('1: still no X while the cursor is away', afterLeave.closeDisplay === 'none', afterLeave.closeDisplay);

// hover again - the second hover
await page.mouse.move(target.x, target.y);
await new Promise((r) => setTimeout(r, 200));
const secondHover = await activeState();
lines.push('on the SECOND hover: ' + JSON.stringify(secondHover) + '\n');
check('1: the X appears on the second hover', secondHover.closeDisplay === 'flex', secondHover.closeDisplay);
check('1: the label narrows to make room', secondHover.labelRight === '26px', secondHover.labelRight);
check('1: the width is unchanged throughout',
  Math.abs(secondHover.width - afterClick.width) < 0.02,
  afterClick.width + ' -> ' + secondHover.width);
await shot('hover-2-second-hover');

// switching to another category disarms again
const other = await centreOf(3);
await page.mouse.move(other.x, other.y);
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 250));
const switched = await activeState();
check('1: switching to a different category disarms it again',
  switched.closeDisplay === 'none' && switched.armed === false,
  switched.closeDisplay + '/' + switched.armed);

// ---------- 2. undo button and its countdown ----------
await page.mouse.move(other.x, other.y + 160);   // leave, to arm
await new Promise((r) => setTimeout(r, 150));
await page.mouse.move(other.x, other.y);         // second hover -> X visible
await new Promise((r) => setTimeout(r, 200));

const deletedName = (await activeState()).name;
const closeBox = await page.evaluate(() => {
  const r = document.querySelector('.menu-button--active .menu-button__close').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(closeBox.x, closeBox.y);
await new Promise((r) => setTimeout(r, 250));

const undo = () => page.evaluate(() => {
  const b = document.querySelector('.undo-button');
  if (!b) return null;
  const cs = getComputedStyle(b);
  const icon = b.querySelector('.undo-button__icon');
  return {
    text: b.querySelector('span').textContent,
    bg: cs.backgroundColor,
    height: Number(b.getBoundingClientRect().height.toFixed(1)),
    radius: cs.borderRadius,
    gap: cs.gap,
    iconW: Number(icon.getBoundingClientRect().width.toFixed(1)),
    afterAdd: Boolean(document.querySelector('.add-category-button')
      .compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
  };
});

const u1 = await undo();
lines.push('undo button: ' + JSON.stringify(u1) + '\n');
check('2: the undo button is shown', u1 !== null);
check('2: it names the deleted category',
  u1.text === 'Восстановить ' + deletedName + ' (Ctrl+Z) 5', u1.text);
check('2: blue background #478cf6', u1.bg === 'rgb(71, 140, 246)', u1.bg);
check('2: 24px tall, 6px radius, 7px gap',
  u1.height === 24 && u1.radius === '6px' && u1.gap === '7px',
  u1.height + '/' + u1.radius + '/' + u1.gap);
check('2: 12x12 icon', u1.iconW === 12, u1.iconW);
check('2: positioned after the add button', u1.afterAdd === true);
check('2: the deleted button is hidden', !(await page.evaluate((n) =>
  [...document.querySelectorAll('.menu-button__sizer')].some((s) => s.textContent === n),
  deletedName)));

// The category that takes over must NOT show its X under the cursor that just
// clicked the previous one, or a second click would delete it too.
const afterDelete = await activeState();
check('2: the category that takes over is disarmed',
  afterDelete.closeDisplay === 'none' && afterDelete.armed === false,
  afterDelete.name + ' ' + afterDelete.closeDisplay + '/' + afterDelete.armed);
await shot('undo-1-shown');

// the countdown must actually run down
await new Promise((r) => setTimeout(r, 2200));
const u2 = await undo();
check('2: the countdown decreases', /\(Ctrl\+Z\) [23]$/.test(u2.text), u2.text);
await shot('undo-2-counting');

// restore by clicking
await page.click('.undo-button');
await new Promise((r) => setTimeout(r, 250));
check('2: clicking undo brings the button back', await page.evaluate((n) =>
  [...document.querySelectorAll('.menu-button__sizer')].some((s) => s.textContent === n),
  deletedName));
check('2: the undo button disappears', (await undo()) === null);
await shot('undo-3-restored');

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();

console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL HOVER/UNDO CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
