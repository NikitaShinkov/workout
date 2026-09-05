// Category button layout in real Chrome: the width-freezing behaviour and the
// hover / editing / pressed visuals, none of which jsdom can judge.

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

const widthOf = (sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? Number(n.getBoundingClientRect().width.toFixed(2)) : null;
}, sel);

const info = () => page.evaluate(() => {
  const b = document.querySelector('.menu-button--active');
  const label = b.querySelector('.menu-button__label');
  const close = b.querySelector('.menu-button__close');
  const cs = close ? getComputedStyle(close) : null;
  const cl = getComputedStyle(label);
  return {
    buttonW: Number(b.getBoundingClientRect().width.toFixed(2)),
    labelRight: cl.right,
    labelEllipsis: cl.textOverflow,
    labelTruncated: label.scrollWidth > label.clientWidth,
    closeDisplay: cs && cs.display,
    closeBg: cs && cs.backgroundColor,
    closeW: close ? Number(close.getBoundingClientRect().width.toFixed(1)) : null,
    closeH: close ? Number(close.getBoundingClientRect().height.toFixed(1)) : null,
    closeRadius: cs && cs.borderRadius,
    iconW: close ? Number(close.querySelector('img').getBoundingClientRect().width.toFixed(1)) : null,
  };
});

const shot = async (name) => {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.categories').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top - 2), width: 440, height: Math.round(r.height + 4) };
  });
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

const dblclick = (sel) => page.evaluate((s) => {
  document.querySelector(s).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}, sel);

// ---------- not hovered ----------
const before = await info();
check('close button hidden when not hovered', before.closeDisplay === 'none', before.closeDisplay);
check('label spans the full padding box', before.labelRight === '8px', before.labelRight);
check('label is not truncated when not hovered', before.labelTruncated === false);
await shot('cat-idle');

// ---------- hovered ----------
await page.hover('.menu-button--active');
await new Promise((r) => setTimeout(r, 200));
const hovered = await info();
lines.push('\nactive button width  idle: ' + before.buttonW + '  hovered: ' + hovered.buttonW + '\n');

check('WIDTH IS UNCHANGED on hover', Math.abs(hovered.buttonW - before.buttonW) < 0.02,
  before.buttonW + ' -> ' + hovered.buttonW);
check('close button appears on hover', hovered.closeDisplay === 'flex', hovered.closeDisplay);
check('close button is a 16x16 circle',
  hovered.closeW === 16 && hovered.closeH === 16 && hovered.closeRadius === '24px',
  hovered.closeW + 'x' + hovered.closeH + ' r' + hovered.closeRadius);
check('close background is #565656', hovered.closeBg === 'rgb(86, 86, 86)', hovered.closeBg);
check('close icon is 8x8', hovered.iconW === 8, hovered.iconW);
check('label yields 26px for it', hovered.labelRight === '26px', hovered.labelRight);
check('label truncates with an ellipsis on hover',
  hovered.labelTruncated === true && hovered.labelEllipsis === 'ellipsis',
  hovered.labelTruncated + '/' + hovered.labelEllipsis);
await shot('cat-hover');

// ---------- editing: width frozen ----------
await dblclick('.menu-button--active');
await page.waitForSelector('.menu-button__input');
const editW = await widthOf('.menu-button--editing');
check('editing keeps the pre-edit width', Math.abs(editW - before.buttonW) < 0.02,
  before.buttonW + ' -> ' + editW);
await shot('cat-editing-selected');

await page.type('.menu-button__input', 'Очень длинное название категории');
const typedW = await widthOf('.menu-button--editing');
check('WIDTH IS UNCHANGED while a much longer name is typed',
  Math.abs(typedW - before.buttonW) < 0.02, before.buttonW + ' -> ' + typedW);
await shot('cat-editing-typed');

// ---------- saving: width follows the new name ----------
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
const savedW = await widthOf('.menu-button--active');
check('width grows to fit the saved name', savedW > before.buttonW + 40,
  before.buttonW + ' -> ' + savedW);
const savedName = await page.evaluate(() =>
  document.querySelector('.menu-button--active .menu-button__sizer').textContent);
check('the saved name is shown', savedName === 'Очень длинное название категории', savedName);
await shot('cat-saved-long');

// ---------- a shorter name shrinks it again ----------
await dblclick('.menu-button--active');
await page.waitForSelector('.menu-button__input');
await page.evaluate(() => { document.querySelector('.menu-button__input').value = 'Шея'; });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
const shortW = await widthOf('.menu-button--active');
check('width shrinks to fit a shorter saved name', shortW < before.buttonW, shortW);

// ---------- add button pressed state ----------
const idleBg = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.add-category-button')).backgroundImage);
const box = await page.evaluate(() => {
  const r = document.querySelector('.add-category-button').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await new Promise((r) => setTimeout(r, 150));
const pressedBg = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.add-category-button')).backgroundImage);
await shot('cat-add-pressed');
await page.mouse.up();

check('add button idle uses add-category.svg', /add-category\.svg/.test(idleBg), idleBg);
check('add button pressed swaps to add-category-active.svg',
  /add-category-active\.svg/.test(pressedBg), pressedBg);

// mouse-up created a category in editing mode; cancel it
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 150));

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();

console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL CATEGORY LAYOUT CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
