// Complex_list in real Chrome: the side block's geometry, the two hover fills,
// the switch that only appears on hover, and the sticky date pointer. None of
// this can be judged in jsdom - there is no layout and no :hover.

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

// Deliberately short, so four complexes overflow the list and the pointer has
// somewhere to stick to.
await page.setViewport({ width: 1400, height: 360, deviceScaleFactor: 2 });
await page.goto(harness('seed=exercises'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase('fitness_app');
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.goto(harness('seed=exercises&complexes=2,1,1&off=1'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.complex');
await new Promise((r) => setTimeout(r, 700));

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

const box = (selector, index = 0) => page.evaluate((s, i) => {
  const n = document.querySelectorAll(s)[i];
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return {
    x: +r.left.toFixed(1), y: +r.top.toFixed(1),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    bottom: +r.bottom.toFixed(1),
  };
}, selector, index);

const style = (selector, prop, index = 0) => page.evaluate((s, p, i) => {
  const n = document.querySelectorAll(s)[i];
  return n ? getComputedStyle(n)[p] : null;
}, selector, prop, index);

// ---------- structure ----------

const counts = await page.evaluate(() => ({
  complexes: document.querySelectorAll('.complex').length,
  rows: document.querySelectorAll('.complex .exercise-row').length,
  pointers: document.querySelectorAll('.date-pointer').length,
  dates: [...document.querySelectorAll('.complex__date')].map((n) => n.textContent),
}));

check('three complexes from sizes 2,1,1', counts.complexes === 3, counts.complexes);
check('four exercise blocks across them', counts.rows === 4, counts.rows);
check('exactly one date pointer', counts.pointers === 1, counts.pointers);
check('the complex switched off shows an em dash',
  counts.dates[1] === '—', counts.dates.join(','));
check('the ones still scheduled run consecutively',
  counts.dates[0] === '3 сен' && counts.dates[2] === '4 сен', counts.dates.join(','));

const stacked = await page.evaluate(() => {
  const [a, b] = document.querySelectorAll('.complex');
  return +(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom).toFixed(1);
});
check('complexes are stacked flush, with no gap between them', stacked === 0, stacked);

// ---------- Date_pointer ----------

const pointer = await page.evaluate(() => {
  const line = document.querySelector('.date-pointer');
  const icon = document.querySelector('.date-pointer__icon');
  const lineBox = line.getBoundingClientRect();
  const iconBox = icon.getBoundingClientRect();
  const lineStyle = getComputedStyle(line);
  return {
    lineColor: lineStyle.backgroundColor,
    lineHeight: +lineBox.height.toFixed(1),
    iconColor: getComputedStyle(icon).borderLeftColor,
    iconW: +iconBox.width.toFixed(1),
    iconH: +iconBox.height.toFixed(1),
    // Negative = the rule starts to the LEFT of the marker's right edge, i.e.
    // it runs underneath it and cannot leave a gap at the taper.
    gapAtTaper: +(lineBox.left - iconBox.right).toFixed(1),
    // How far the marker hangs off the rule, above and below.
    above: +(lineBox.top - iconBox.top).toFixed(1),
    below: +(iconBox.bottom - lineBox.bottom).toFixed(1),
  };
});

check('the pointer rule is white', pointer.lineColor === 'rgb(255, 255, 255)', pointer.lineColor);
check('so is the marker', pointer.iconColor === 'rgb(255, 255, 255)', pointer.iconColor);
check('the rule is 2px tall', pointer.lineHeight === 2, pointer.lineHeight);
check('the marker is 14x18', pointer.iconW === 14 && pointer.iconH === 18,
  pointer.iconW + 'x' + pointer.iconH);
check('the rule runs under the marker, so the taper leaves no gap',
  pointer.gapAtTaper <= -14, pointer.gapAtTaper);
check('the marker is centred on the rule', Math.abs(pointer.above - pointer.below) < 0.6,
  pointer.above + ' / ' + pointer.below);

// ---------- Complex_side_block geometry ----------

const side = await box('.complex__side');
const dateBox = await box('.complex__date');
const toolbar = await box('.schedule-toolbar');
const complex = await box('.complex');

check('side block is 68px wide', side.w === 68, side.w);
check('the date column is 42px', dateBox.w === 42, dateBox.w);
check('the date starts 16px in, level with the toolbar',
  Math.abs(dateBox.x - (toolbar.x + 16)) < 0.6, dateBox.x + ' vs ' + (toolbar.x + 16));
// 10px of air on the right, so the switch does not butt up against the block.
const firstRowBox = await box('.complex .exercise-row');
check('the date column clears the exercise block by 10px',
  Math.abs(firstRowBox.x - (dateBox.x + dateBox.w + 10)) < 0.6,
  firstRowBox.x + ' vs ' + (dateBox.x + dateBox.w + 10));
check('the side block is as tall as its complex',
  Math.abs(side.h - complex.h) < 0.6, side.h + ' vs ' + complex.h);
check('a two-row complex is two rows tall', Math.abs(complex.h - 132) < 0.6, complex.h);
check('the side block is the drag handle',
  (await page.$eval('.complex__side', (n) => n.getAttribute('draggable'))) === 'true');
check('an exercise block inside a complex is draggable too',
  (await page.$eval('.complex .exercise-row', (n) => n.getAttribute('draggable'))) === 'true');

// ---------- hover: two distinct fills ----------

const idleComplexBg = await style('.complex', 'backgroundColor');
const idleSwitch = await style('.switch--complex', 'visibility');
check('a complex is unfilled when not hovered',
  idleComplexBg === 'rgba(0, 0, 0, 0)', idleComplexBg);
check('the switch is hidden when not hovered', idleSwitch === 'hidden', idleSwitch);
await shot('complex-idle', '.complex-list');

// Hovering the side block puts the complex - and only the complex - in hover.
await page.hover('.complex__side');
await new Promise((r) => setTimeout(r, 150));
const hoveredComplexBg = await style('.complex', 'backgroundColor');
const hoveredSwitch = await style('.switch--complex', 'visibility');
const hoveredRowBg = await style('.complex .exercise-row', 'backgroundColor');

check('hovering a complex fills it with hover_bg #1D1D1D',
  hoveredComplexBg === 'rgb(29, 29, 29)', hoveredComplexBg);
check('the switch appears on hover', hoveredSwitch === 'visible', hoveredSwitch);
check('its rows stay unfilled, so the complex reads as one block',
  hoveredRowBg === 'rgba(0, 0, 0, 0)', hoveredRowBg);
await shot('complex-hover', '.complex-list');

// A row inside a complex gets the lighter fill, so it is visible against it.
await page.hover('.complex .exercise-row');
await new Promise((r) => setTimeout(r, 150));
const rowHoverBg = await style('.complex .exercise-row', 'backgroundColor');
check('hovering a block inside a complex uses hover_bg_block #3A3A3A',
  rowHoverBg === 'rgb(58, 58, 58)', rowHoverBg);
check('and the complex behind it is still filled',
  (await style('.complex', 'backgroundColor')) === 'rgb(29, 29, 29)');
await shot('complex-row-hover', '.complex-list');

// Selecting a block uses the same fill as hovering one.
await page.click('.complex .exercise-row');
await page.mouse.move(1200, 400);
await new Promise((r) => setTimeout(r, 150));
check('a selected block keeps the lighter fill',
  (await style('.complex .exercise-row--selected', 'backgroundColor')) === 'rgb(58, 58, 58)',
  await style('.complex .exercise-row--selected', 'backgroundColor'));
await shot('complex-row-selected', '.complex-list');

// ---------- the date pointer sticks to both edges ----------

const listBox = await box('.complex-list');
const scrollable = await page.$eval('.complex-list', (n) => n.scrollHeight - n.clientHeight);
check('the list actually overflows, so sticking is testable', scrollable > 40, scrollable);

// Which complex the pointer sits before depends on today's date, so the start
// date is driven from here rather than left at the harness default - otherwise
// this suite would quietly change meaning as the calendar moves.
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const russian = (date) => date.getDate() + ' ' + MONTHS[date.getMonth()];

// Driven the way a user drives it: the field edits as a "DD.MM" mask and
// commits on blur, so the date is typed as four digits and entered.
async function setStart(date) {
  const digits = String(date.getDate()).padStart(2, '0')
    + String(date.getMonth() + 1).padStart(2, '0');
  await page.click('.input--date');
  await page.keyboard.type(digits);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 200));
}

const thisYear = (month, day) => new Date(new Date().getFullYear(), month, day);

const pointerAt = async (scrollTop) => {
  await page.$eval('.complex-list', (n, top) => { n.scrollTop = top; }, scrollTop);
  await new Promise((r) => setTimeout(r, 80));
  return box('.date-pointer');
};

// Starting today puts the pointer at the head of the list. Scrolling down would
// carry it off the top, so it has to park against the top edge instead.
await setStart(new Date());

const highIndex = await page.evaluate(() =>
  [...document.querySelector('.complex-list').children]
    .findIndex((n) => n.classList.contains('date-pointer')));
check('starting today, the pointer comes first', highIndex === 0, highIndex);

const highNatural = await pointerAt(0);
check('unscrolled it sits at its natural place, the top of the list',
  Math.abs(highNatural.y - listBox.y) < 1, highNatural.y + ' vs ' + listBox.y);
check('the pointer spans the width of the list',
  Math.abs(highNatural.w - listBox.w) < 10, highNatural.w + ' vs ' + listBox.w);

const highStuck = await pointerAt(9999);
const firstComplex = await box('.complex');
check('scrolled down, the RULE stays at the top of the list',
  Math.abs(highStuck.y - listBox.y) < 1, highStuck.y + ' vs list top ' + listBox.y);
check('while the complex it precedes has scrolled up out of view - so it stuck',
  firstComplex.y < listBox.y - 10, firstComplex.y + ' vs ' + listBox.y);

// The marker is what overflows, not the rule: the list edge lines up with the
// rule and clips the marker's upper half.
const markerAtTop = await box('.date-pointer__icon');
check('the marker hangs above the list edge and is clipped there',
  markerAtTop.y < listBox.y - 6, markerAtTop.y + ' vs ' + listBox.y);
await shot('complex-pointer-top', '.complex-list');

// A schedule entirely in the past puts the pointer after the last complex, out
// of sight at the top of the list - it should park against the bottom edge.
await setStart(thisYear(0, 1));
const lastIndex = await page.evaluate(() => {
  const kids = [...document.querySelector('.complex-list').children];
  return kids.length - 1 - kids.slice().reverse().findIndex((n) => n.classList.contains('date-pointer'));
});
const kidCount = await page.$eval('.complex-list', (n) => n.children.length);
check('an all-past schedule puts the pointer after the last complex',
  lastIndex === kidCount - 1, lastIndex + '/' + kidCount);

const lowStuck = await pointerAt(0);
const lastComplex = await page.evaluate(() => {
  const nodes = document.querySelectorAll('.complex');
  return +nodes[nodes.length - 1].getBoundingClientRect().bottom.toFixed(1);
});
check('scrolled above it, the pointer sticks to the bottom of the list',
  Math.abs(lowStuck.bottom - (listBox.y + listBox.h)) < 1,
  lowStuck.bottom + ' vs list bottom ' + (listBox.y + listBox.h));
check('while the complex it follows is still below the fold - so it stuck',
  lastComplex > listBox.y + listBox.h + 10, lastComplex + ' vs ' + (listBox.y + listBox.h));

// Parked at the bottom edge the marker's lower half is off the list; scrolling
// all the way down brings the whole of it into view, which is what proves the
// edge was clipping it rather than the marker simply being small.
const markerStuck = await box('.date-pointer__icon');
check('parked at the bottom, the marker hangs past the list edge',
  markerStuck.bottom > listBox.y + listBox.h + 6,
  markerStuck.bottom + ' vs ' + (listBox.y + listBox.h));

await pointerAt(9999);
const markerAtEnd = await box('.date-pointer__icon');
check('scrolled to the end the whole marker is inside the list',
  markerAtEnd.bottom <= listBox.y + listBox.h + 0.6,
  markerAtEnd.bottom + ' vs ' + (listBox.y + listBox.h));
await shot('complex-pointer-bottom', '.complex-list');

await pointerAt(0);
await setStart(thisYear(8, 3));

// ---------- the filter checkbox ----------

await page.evaluate(() => {
  const label = [...document.querySelectorAll('.checkbox-line')]
    .find((l) => l.textContent.includes('только включённые'));
  const input = label.querySelector('.checkbox__input');
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 150));
const filtered = await page.evaluate(() => ({
  complexes: document.querySelectorAll('.complex').length,
  dates: [...document.querySelectorAll('.complex__date')].map((n) => n.textContent),
}));
check('the checkbox hides the complexes that are switched off',
  filtered.complexes === 2, filtered.complexes);
check('what is left reads as consecutive days',
  filtered.dates.join(',') === '3 сен,4 сен', filtered.dates.join(','));
await shot('complex-only-enabled', '.complex-list');

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
