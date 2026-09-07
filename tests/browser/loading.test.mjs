// The loading screen.
//
// It is only on screen while the first fetch is in flight, so the API call is
// held open to keep it there long enough to measure. Everything here is visual
// or timing, which is why it is a browser suite and not a jsdom one.

import puppeteer from 'puppeteer-core';

import { OUT, BASE, findChrome } from '../helpers/env.mjs';

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

// Hold the data repo's answer, so the screen it covers stays up.
await page.setRequestInterception(true);
page.on('request', async (request) => {
  if (request.url().includes('api.github.com')) {
    await new Promise((r) => setTimeout(r, 12000));
  }
  try { await request.continue(); } catch { /* page already gone */ }
});

// The design's frame: 393x852.
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2 });
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.loading__logo', { timeout: 10000 });

// ---------- 1. what is on screen ----------

const shape = await page.evaluate(() => {
  const logo = document.querySelector('.loading__logo');
  const screen = document.querySelector('.loading');
  const box = logo.getBoundingClientRect();
  const outer = screen.getBoundingClientRect();
  const style = getComputedStyle(logo);
  return {
    tag: logo.tagName,
    src: (logo.getAttribute('src') || ''),
    width: Math.round(box.width),
    height: Math.round(box.height),
    offCentreX: Math.abs((box.left + box.width / 2) - (outer.left + outer.width / 2)),
    offCentreY: Math.abs((box.top + box.height / 2) - (outer.top + outer.height / 2)),
    // A mask would paint one flat colour over the shape; the file's own
    // gradient only survives if the file itself is being drawn.
    mask: style.maskImage || style.webkitMaskImage || 'none',
    role: screen.getAttribute('role'),
    hiddenText: screen.querySelector('.visually-hidden').textContent,
    loaded: logo.naturalWidth > 0,
    ground: getComputedStyle(document.body).backgroundColor,
  };
});
lines.push('\nlogo: ' + JSON.stringify(shape) + '\n');

check('1: THE LOGO FILE ITSELF IS DRAWN, so it keeps its gradient',
  shape.tag === 'IMG' && shape.src === 'assets/icons/app_logo.svg',
  shape.tag + ' ' + shape.src);
check('1: and it is not being masked to a flat colour',
  shape.mask === 'none', shape.mask);
check('1: the file actually loaded', shape.loaded === true, shape.loaded);
check('1: 236px wide, the design\'s size', shape.width === 236, shape.width);
check('1: undistorted - height follows the file\'s own 15:12',
  Math.abs(shape.height - 189) <= 1, shape.height);
check('1: CENTRED ON BOTH AXES',
  shape.offCentreX < 1 && shape.offCentreY < 1,
  shape.offCentreX.toFixed(1) + ' / ' + shape.offCentreY.toFixed(1));
check('1: on the --bg ground', shape.ground === 'rgb(10, 10, 11)', shape.ground);
check('1: it announces itself to a screen reader',
  shape.role === 'status' && shape.hiddenText === 'Загрузка…',
  shape.role + ' / ' + shape.hiddenText);

// The gradient is four brand colours; sampling the pixels is the only way to
// know it is really there rather than one flat fill.
await page.evaluate(() => {
  const l = document.querySelector('.loading__logo');
  l.style.animation = 'none';
  l.style.transform = 'none';
});
await new Promise((r) => setTimeout(r, 100));
await page.screenshot({ path: OUT + '/loading-flat.png' });

const colours = await page.evaluate(async () => {
  const logo = document.querySelector('.loading__logo');
  const box = logo.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width);
  canvas.height = Math.round(box.height);

  const drawn = new Image();
  drawn.src = logo.src;
  await drawn.decode();
  canvas.getContext('2d').drawImage(drawn, 0, 0, canvas.width, canvas.height);

  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    // Only opaque pixels are the logo; everything else is the page behind it.
    if (data[i + 3] > 200) seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
  }
  return seen.size;
});
lines.push('\ndistinct opaque colours in the drawn logo: ' + colours + '\n');
check('1: IT IS A GRADIENT, not a single fill', colours > 50, colours);

// ---------- 2. the turn ----------

const spin = await page.evaluate(() => {
  const logo = document.querySelector('.loading__logo');
  logo.style.animation = '';
  const s = getComputedStyle(logo);
  return {
    name: s.animationName,
    duration: s.animationDuration,
    easing: s.animationTimingFunction,
    iterations: s.animationIterationCount,
    direction: s.animationDirection,
  };
});
lines.push('\nanimation: ' + JSON.stringify(spin) + '\n');

check('2: 800ms, ease-in-out, for ever',
  spin.name === 'loading-flip' && spin.duration === '0.8s'
    && spin.easing === 'ease-in-out' && spin.iterations === 'infinite',
  JSON.stringify(spin));
check('2: AND ALTERNATE, which is what plays the second half in reverse',
  spin.direction === 'alternate', spin.direction);

// Restart it so t=0 is known, then watch the horizontal scale.
await page.evaluate(() => {
  const l = document.querySelector('.loading__logo');
  l.style.transform = '';
  l.style.animation = 'none';
  void l.offsetWidth;
  l.style.animation = 'loading-flip 800ms ease-in-out infinite alternate';
});

const scaleNow = () => page.evaluate(() => {
  const t = getComputedStyle(document.querySelector('.loading__logo')).transform;
  return t === 'none' ? 1 : +new DOMMatrixReadOnly(t).m11.toFixed(3);
});

// Sampled past the half-cycle on purpose, so the turn back is observed rather
// than merely read off the computed style. Each round trip costs a few ms, so
// only the first eight samples are safely inside the first 800ms - asserting
// monotonicity across the boundary is asserting something false, which is
// exactly how this test was flaky when it was first written.
const curve = [];
for (let i = 0; i < 12; i += 1) {
  curve.push(await scaleNow());
  if (i === 4) await page.screenshot({ path: OUT + '/loading-mid.png' });
  await new Promise((r) => setTimeout(r, 100));
}
const outward = curve.slice(0, 8);
lines.push('\nhorizontal scale, ~100ms apart: ' + curve.join(' ') + '\n');

check('2: IT STARTS FACING FRONT', curve[0] > 0.95, curve[0]);
check('2: IS EDGE ON HALFWAY - a vertical axis, not a spin in the plane',
  Math.abs(curve[4]) < 0.35, curve[4]);
check('2: AND REACHES FULLY TURNED', Math.min(...curve) < -0.9, Math.min(...curve));
check('2: turning one way throughout the first half, never back on itself',
  outward.every((v, i) => i === 0 || v <= outward[i - 1] + 0.02), outward.join(' '));
check('2: THEN IT COMES BACK - alternate, seen rather than assumed',
  curve[11] > Math.min(...curve) + 0.05,
  'lowest ' + Math.min(...curve) + ', later ' + curve[11]);
// Ease-in-out: barely moves at the start, races through the middle.
check('2: EASED IN AND OUT, not linear',
  (curve[0] - curve[1]) < (curve[3] - curve[4]) / 3,
  'first 100ms moved ' + (curve[0] - curve[1]).toFixed(3)
    + ', middle 100ms moved ' + (curve[3] - curve[4]).toFixed(3));

// ---------- 3. it goes away ----------

await page.setRequestInterception(false);
await page.goto(BASE + '/index.html?offline=1', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 600));

check('3: THE SCREEN IS GONE once the data is in',
  (await page.$$('.loading')).length === 0, (await page.$$('.loading')).length);
check('3: and the app is mounted in its place',
  (await page.$$('.page')).length === 1);

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
