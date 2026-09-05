// A real HTML5 drag in Chrome. The point of interest is that :hover stays
// applied to the drag source, so the close button and the truncated name would
// persist through the gesture unless the hover state is explicitly dropped.

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
await page.setDragInterception(true);

const centreOf = (nth) => page.evaluate((n) => {
  const b = document.querySelectorAll('.menu-button')[n].getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
}, nth);

const names = () => page.evaluate(() =>
  [...document.querySelectorAll('.menu-button__sizer')].map((s) => s.textContent));

const stateOf = (nth) => page.evaluate((n) => {
  const b = document.querySelectorAll('.menu-button')[n];
  const close = b.querySelector('.menu-button__close');
  return {
    name: b.querySelector('.menu-button__sizer').textContent,
    active: b.classList.contains('menu-button--active'),
    armed: b.classList.contains('menu-button--hover-armed'),
    dragging: b.classList.contains('menu-button--dragging'),
    closeDisplay: close ? getComputedStyle(close).display : 'absent',
    labelRight: getComputedStyle(b.querySelector('.menu-button__label')).right,
    opacity: getComputedStyle(b).opacity,
    background: getComputedStyle(b).backgroundColor,
    activeCount: document.querySelectorAll('.menu-button--active').length,
  };
}, nth);

const shot = async (name) => {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.categories').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top - 2), width: 620, height: Math.round(r.height + 4) };
  });
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

// ---------- get the active button into the hovered state (X visible) ----------
const first = await centreOf(0);
await page.mouse.move(first.x, first.y + 160);   // leave, to arm
await new Promise((r) => setTimeout(r, 150));
await page.mouse.move(first.x, first.y);         // second hover
await new Promise((r) => setTimeout(r, 200));

const hovered = await stateOf(0);
lines.push('\nbefore dragging: ' + JSON.stringify(hovered) + '\n');
check('the active button shows the X before dragging',
  hovered.closeDisplay === 'flex' && hovered.labelRight === '26px',
  hovered.closeDisplay + '/' + hovered.labelRight);
await shot('drag-0-hovered');

// ---------- start a real drag from that button ----------
const third = await centreOf(2);
const data = await page.mouse.drag(first, third);
check('the drag actually started', Boolean(data));

const during = await stateOf(0);
lines.push('during the drag: ' + JSON.stringify(during) + '\n');
check('DRAGGING HIDES THE X', during.closeDisplay === 'none', during.closeDisplay);
check('DRAGGING SHOWS THE FULL NAME (no truncation)',
  during.labelRight === '8px', during.labelRight);
check('the hover state was dropped', during.armed === false);
check('it is marked as dragging', during.dragging === true);
// What travels with the cursor is the drag image, snapshotted in the active
// state; the button left behind in the list must not look active.
check('THE BUTTON LEFT IN PLACE IS NOT ACTIVE', during.active === false, during.active);
check('NO button in the list looks active mid-drag',
  during.activeCount === 0, during.activeCount);
check('OPACITY IS NOT REDUCED', during.opacity === '1', during.opacity);
check('the one left behind has no active background',
  during.background === 'rgba(0, 0, 0, 0)', during.background);
await shot('drag-1-during');

// ---------- finish the drag ----------
await page.mouse.dragEnter(third, data);
await page.mouse.dragOver(third, data);
await page.mouse.drop(third, data);
await new Promise((r) => setTimeout(r, 300));

const after = await names();
lines.push('order after the drop: ' + after.join(', ') + '\n');
check('the category moved', after[0] !== hovered.name, after.join(','));
check('it landed in third place', after[2] === hovered.name, after.join(','));

const settled = await page.evaluate((n) => {
  const b = [...document.querySelectorAll('.menu-button')]
    .find((x) => x.querySelector('.menu-button__sizer').textContent === n);
  const close = b.querySelector('.menu-button__close');
  return {
    active: b.classList.contains('menu-button--active'),
    armed: b.classList.contains('menu-button--hover-armed'),
    dragging: b.classList.contains('menu-button--dragging'),
    closeDisplay: close ? getComputedStyle(close).display : 'absent',
    activeCount: document.querySelectorAll('.menu-button--active').length,
  };
}, hovered.name);
check('the dragged category is now the selected one', settled.active === true);
check('the dragging class was cleaned up', settled.dragging === false);
check('still exactly one active button', settled.activeCount === 1, settled.activeCount);
check('it stays disarmed after the drop, so no X under the cursor',
  settled.closeDisplay === 'none' && settled.armed === false,
  settled.closeDisplay + '/' + settled.armed);
await shot('drag-2-after');

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();

console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL DRAG CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
