// The workout page's geometry: the phone measure it keeps on a desktop, the
// header it drops on a phone, the two halves, and a real swipe across
// image_block. None of this can be checked without a layout engine.

import puppeteer from 'puppeteer-core';

import { OUT, BASE, harness, findChrome } from '../helpers/env.mjs';

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

const DESKTOP = { width: 1500, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 393, height: 800, deviceScaleFactor: 2 };

await page.setViewport(DESKTOP);
await page.goto(harness('seed=exercises'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase('fitness_app');
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.goto(harness('seed=exercises&complexes=2,1,1&multi&start=today'),
  { waitUntil: 'networkidle2' });
await page.waitForSelector('.complex');
await new Promise((r) => setTimeout(r, 800));

const shot = async (name, selector) => {
  const clip = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left) - 4), y: Math.max(0, Math.round(r.top) - 4),
      width: Math.round(r.width) + 8, height: Math.min(900, Math.round(r.height) + 8),
    };
  }, selector);
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

const box = (selector) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return {
    left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1),
    width: +r.width.toFixed(1), height: +r.height.toFixed(1),
  };
}, selector);

const style = (selector, prop) => page.evaluate((s, p) => {
  const n = document.querySelector(s);
  return n ? getComputedStyle(n)[p] : null;
}, selector, prop);

const goTo = async (name) => {
  await page.evaluate((p) => {
    [...document.querySelectorAll('.page-button')].find((b) => b.dataset.page === p).click();
  }, name);
  await new Promise((r) => setTimeout(r, 400));
};

// ---------- 1. the categories block does not move ----------
//
// Switching pages rebuilds the header from scratch; if the workout page built
// it differently the whole strip would jump as you arrive.

const onSchedule = await box('.categories');
await goTo('calendar');
const onCalendar = await box('.categories');
await goTo('workout');
await page.waitForSelector('.workout');
const onWorkout = await box('.categories');

lines.push('\ncategories box: schedule ' + JSON.stringify(onSchedule)
  + ' calendar ' + JSON.stringify(onCalendar) + ' workout ' + JSON.stringify(onWorkout) + '\n');

check('1: THE CATEGORIES BLOCK STAYS EXACTLY WHERE IT WAS',
  JSON.stringify(onSchedule) === JSON.stringify(onWorkout),
  JSON.stringify(onSchedule) + ' vs ' + JSON.stringify(onWorkout));
check('1: and it is the same on the calendar too',
  JSON.stringify(onCalendar) === JSON.stringify(onWorkout));
check('1: exactly one header survived the swap', (await page.$$('.header')).length === 1);
check('1: no view options here', (await page.$$('.view-options')).length === 0);

// ---------- 2. the phone measure, kept on a desktop ----------

const workout = await box('.workout');
check('2: THE CONTENT IS CAPPED AT 400px on a wide window',
  workout.width === 400, workout.width + ' in a ' + DESKTOP.width + 'px window');
check('2: and centred under the header',
  Math.abs(workout.left - (DESKTOP.width - 400) / 2) < 1, workout.left);
check('2: the header is visible on a desktop',
  (await style('.header', 'display')) !== 'none', await style('.header', 'display'));

// ---------- 3. the three blocks, top to bottom ----------

const order = await page.$$eval('.workout > *', (n) => n.map((c) => c.className));
check('3: Date_selector, image_block, Complex_list, in that order',
  order.join('|') === 'date-selector|workout-preview|complex-list complex-list--workout',
  order.join('|'));

const dateSelector = await box('.date-selector');
const preview = await box('.workout-preview');
const list = await box('.complex-list--workout');

lines.push('\nblocks: date ' + dateSelector.height + ' preview ' + preview.height
  + ' list ' + list.height + '\n');

check('3: Date_selector carries the design\'s 40/20/20 padding',
  (await style('.date-selector', 'padding')) === '40px 20px 20px', await style('.date-selector', 'padding'));
check('3: THE PREVIEW AND THE LIST SPLIT WHAT IS LEFT IN HALF',
  Math.abs(preview.height - list.height) < 1, preview.height + ' vs ' + list.height);
check('3: and together they fill the page below the selector',
  Math.abs((preview.height + list.height) - (workout.height - dateSelector.height)) < 1);

// ---------- 4. Date_selector ----------

const dateList = await box('.date-list');
const buttons = await page.$$eval('.date-button', (n) => n.map((b) => {
  const r = b.getBoundingClientRect();
  const s = getComputedStyle(b);
  return {
    text: b.textContent, width: +r.width.toFixed(1), height: +r.height.toFixed(1),
    bg: s.backgroundColor, color: s.color, active: b.classList.contains('date-button--active'),
  };
}));
lines.push('\ndate buttons: ' + JSON.stringify(buttons, null, 0) + '\n');

check('4: the shell is 26px - three 24px buttons plus its border',
  dateList.height === 26, dateList.height);
check('4: it carries the same shell as the Page_selector',
  (await style('.date-list', 'backgroundColor')) === 'rgb(29, 29, 29)'
    && (await style('.date-list', 'borderTopColor')) === 'rgb(82, 82, 82)'
    && (await style('.date-list', 'borderRadius')) === '6px',
  await style('.date-list', 'backgroundColor'));
check('4: THE THREE SHARE THE WIDTH EQUALLY, as the design\'s 117px thirds do',
  buttons.every((b) => Math.abs(b.width - buttons[0].width) < 1)
    && Math.abs(buttons[0].width - (dateList.width - 2) / 3) < 1,
  buttons.map((b) => b.width).join(' | '));
check('4: each is 24px tall', buttons.every((b) => b.height === 24),
  buttons.map((b) => b.height).join(','));
check('4: the active one inverts to a white ground',
  buttons[0].active && buttons[0].bg === 'rgb(255, 255, 255)' && buttons[0].color === 'rgb(0, 0, 0)',
  buttons[0].bg + ' / ' + buttons[0].color);
check('4: the other two are transparent and white',
  buttons.slice(1).every((b) => b.bg === 'rgba(0, 0, 0, 0)' && b.color === 'rgb(255, 255, 255)'),
  buttons.slice(1).map((b) => b.bg + '/' + b.color).join(' | '));

// The date label has descenders ("Сегодня") and the shell clips - the cap /
// alphabetic trim would cut them off, so this button opts out of it.
const descenders = await page.evaluate(() => {
  const button = document.querySelector('.date-button--active');
  const range = document.createRange();
  range.selectNodeContents(button);
  const text = range.getBoundingClientRect();
  const shell = document.querySelector('.date-list').getBoundingClientRect();
  return {
    trim: getComputedStyle(button).textBox || getComputedStyle(button).textBoxTrim,
    room: +(shell.bottom - text.bottom).toFixed(1),
  };
});
lines.push('\ndate label: ' + JSON.stringify(descenders) + '\n');
check('4: THE DESCENDERS OF "Сегодня" ARE NOT CLIPPED by the shell',
  descenders.room > 2, JSON.stringify(descenders));

// ---------- 5. Preview_bar ----------

const segments = await page.$$eval('.preview-bar__segment', (n) => n.map((s) => {
  const r = s.getBoundingClientRect();
  return {
    width: +r.width.toFixed(1), height: +r.height.toFixed(1), left: +r.left.toFixed(1),
    bg: getComputedStyle(s).backgroundColor,
  };
}));
lines.push('\nsegments: ' + JSON.stringify(segments, null, 0) + '\n');

check('5: one segment per exercise in the selected complex',
  segments.length === 2, segments.length);
check('5: 4px tall, as the design draws them',
  segments.every((s) => s.height === 4), segments.map((s) => s.height).join(','));
check('5: 2px apart',
  Math.abs((segments[1].left - (segments[0].left + segments[0].width)) - 2) < 0.5,
  segments[1].left - (segments[0].left + segments[0].width));
check('5: THE ONE ON SCREEN IS WHITE, the rest hover_bg',
  segments[0].bg === 'rgb(255, 255, 255)' && segments[1].bg === 'rgb(29, 29, 29)',
  segments.map((s) => s.bg).join(' | '));
check('5: the bar spans the block, inside the same 20px margin',
  Math.abs(segments[0].left - (workout.left + 20)) < 0.5, segments[0].left - workout.left);

// ---------- 6. Complex_block ----------

const blocks = await page.$$eval('.workout-complex', (n) => n.map((c) => {
  const s = getComputedStyle(c);
  const start = c.querySelector('.main-button');
  const r = c.getBoundingClientRect();
  return {
    name: c.querySelector('.workout-complex__name').textContent,
    radius: s.borderRadius, padding: s.padding, bg: s.backgroundColor,
    active: c.classList.contains('workout-complex--active'),
    width: +r.width.toFixed(1),
    start: start && {
      text: start.textContent, disabled: start.disabled,
      bg: getComputedStyle(start).backgroundColor,
      height: +start.getBoundingClientRect().height.toFixed(1),
      opacity: getComputedStyle(start).opacity,
      // It must sit against the right edge of the block, as the design has it.
      gap: +(r.right - start.getBoundingClientRect().right).toFixed(1),
    },
  };
}));
lines.push('\nblocks: ' + JSON.stringify(blocks, null, 0) + '\n');

check('6: 14px corners and 20px padding', blocks.every((b) => b.radius === '14px' && b.padding === '20px'),
  blocks.map((b) => b.radius + '/' + b.padding).join(' | '));
check('6: THE ACTIVE BLOCK IS FILLED #1D1D1D, the others are not',
  blocks[0].active && blocks[0].bg === 'rgb(29, 29, 29)' && blocks[1].bg === 'rgba(0, 0, 0, 0)',
  blocks.map((b) => b.bg).join(' | '));
check('6: Начать is the --active blue, 24px tall, at the right edge',
  blocks.every((b) => b.start && b.start.bg === 'rgb(71, 140, 246)' && b.start.height === 24
    && Math.abs(b.start.gap - 20) < 0.5),
  JSON.stringify(blocks.map((b) => b.start)));
check('6: IT IS DISABLED AND READS AS SUCH',
  blocks.every((b) => b.start.disabled === true && b.start.opacity === '0.5'),
  blocks.map((b) => b.start.disabled + '/' + b.start.opacity).join(' | '));

await shot('workout-desktop', '.page');

// ---------- 7. a real swipe ----------

const activeSegment = () => page.evaluate(() => [...document.querySelectorAll('.preview-bar__segment')]
  .findIndex((s) => s.classList.contains('preview-bar__segment--active')));
const frameSrc = () => page.evaluate(() => {
  const img = document.querySelector('.workout-preview__image img');
  return img ? img.getAttribute('src') : null;
});

const centre = await box('.workout-preview__image');
const y = centre.top + centre.height / 2;
const mid = centre.left + centre.width / 2;

// The x the track has actually been painted at, read off the live transform
// matrix rather than the inline style - this is what the eye sees.
const paintedX = () => page.evaluate(() => {
  const track = document.querySelector('.workout-preview__track');
  if (!track) return null;
  const t = getComputedStyle(track).transform;
  if (!t || t === 'none') return 0;
  return +new DOMMatrixReadOnly(t).m41.toFixed(1);
});
const slideOffsets = () => page.$$eval('.workout-preview__slide', (n) => n.map((s) => {
  const r = s.getBoundingClientRect();
  return { index: s.dataset.index, left: +r.left.toFixed(0), width: +r.width.toFixed(0) };
}));

// Longer than both the settle (200ms) and the spring back (260ms).
const settled = () => new Promise((r) => setTimeout(r, 420));

const swipe = async (dx) => {
  await page.mouse.move(mid, y);
  await page.mouse.down();
  await page.mouse.move(mid + dx / 2, y);
  await page.mouse.move(mid + dx, y);
  await page.mouse.up();
  await settled();
};

check('7: the preview is playing the first exercise', Boolean(await frameSrc()));
check('7: a horizontal drag here is not claimed by the browser as a pan',
  (await style('.workout-preview__image', 'touchAction')) === 'pan-y',
  await style('.workout-preview__image', 'touchAction'));

// The track carries the exercise on screen and its neighbours, parked exactly a
// block-width to either side - that is what makes one slide in as the other
// slides out instead of the picture simply being swapped.
const parked = await slideOffsets();
lines.push('\nslides at rest: ' + JSON.stringify(parked) + '\n');
check('7: the neighbours are on the track, one block-width away',
  parked.length === 2 && parked[0].index === '0'
    && Math.abs((parked[1].left - parked[0].left) - parked[0].width) < 1,
  JSON.stringify(parked));
check('7: and the block clips them until they are swiped in',
  (await style('.workout-preview__image', 'overflow')) === 'hidden',
  await style('.workout-preview__image', 'overflow'));
check('7: the track starts unmoved', (await paintedX()) === 0, await paintedX());

// --- the gesture follows the finger, before it is committed ---

await page.mouse.move(mid, y);
await page.mouse.down();
await page.mouse.move(mid - 60, y);
check('7: THE TRACK FOLLOWS THE FINGER 1:1 while the gesture is live',
  Math.abs((await paintedX()) - -60) < 1, await paintedX());
check('7: with nothing smoothing it mid-gesture',
  (await style('.workout-preview__track', 'transitionDuration')) === '0s',
  await style('.workout-preview__track', 'transitionDuration'));
check('7: THE NEXT EXERCISE IS ALREADY ON SCREEN, sliding in behind the finger',
  (await slideOffsets())[1].left < centre.right - 1,
  JSON.stringify(await slideOffsets()));
check('7: and it is already playing, not a frozen still',
  (await page.$$('.workout-preview__slide .seq-anim__img')).length === 2,
  (await page.$$('.workout-preview__slide .seq-anim__img')).length);
await shot('workout-mid-swipe', '.workout-preview');

// Releasing hands it to a short, sharper transition rather than a jump.
await page.mouse.move(mid - 150, y);
await page.mouse.up();
const settling = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.workout-preview__track'));
  return { duration: s.transitionDuration, property: s.transitionProperty, easing: s.transitionTimingFunction };
});
lines.push('\nsettle: ' + JSON.stringify(settling) + '\n');
check('7: RELEASING TRANSITIONS THE TRACK HOME rather than snapping it',
  settling.property === 'transform' && settling.duration === '0.2s',
  JSON.stringify(settling));
check('7: and it is short enough to stay unobtrusive',
  parseFloat(settling.duration) <= 0.3, settling.duration);
await settled();

check('7: SWIPING LEFT SHOWS THE NEXT EXERCISE', (await activeSegment()) === 1,
  await activeSegment());
check('7: the track is back at rest around the new one', (await paintedX()) === 0,
  await paintedX());

await swipe(-10);
check('7: a short drag is a tap, not a swipe', (await activeSegment()) === 1,
  await activeSegment());
check('7: and it settles back to centre', (await paintedX()) === 0, await paintedX());

// --- the ends of the complex resist, then spring back ---

await page.mouse.move(mid, y);
await page.mouse.down();
await page.mouse.move(mid - 200, y);
const resisted = await paintedX();
check('7: AT THE END THE BLOCK ONLY GIVES A LITTLE, and in the swipe direction',
  resisted < 0 && Math.abs(resisted) < 200 * 0.5, resisted);
check('7: never more than the cap', Math.abs(resisted) <= 56.5, resisted);
await page.mouse.up();
await settled();

check('7: SWIPING LEFT ON THE LAST ONE DOES NOT WRAP', (await activeSegment()) === 1,
  await activeSegment());
check('7: IT SPRINGS BACK TO WHERE IT STARTED', (await paintedX()) === 0, await paintedX());

await swipe(150);
check('7: swiping right goes back', (await activeSegment()) === 0, await activeSegment());

await page.mouse.move(mid, y);
await page.mouse.down();
await page.mouse.move(mid + 200, y);
const resistedRight = await paintedX();
check('7: the first exercise resists a swipe right the same way',
  resistedRight > 0 && resistedRight <= 56.5, resistedRight);
await page.mouse.up();
await settled();
check('7: SWIPING RIGHT ON THE FIRST ONE DOES NOT WRAP', (await activeSegment()) === 0,
  await activeSegment());
check('7: and springs back here too', (await paintedX()) === 0, await paintedX());

// ---------- 8. the phone ----------

await page.setViewport(PHONE);
await new Promise((r) => setTimeout(r, 400));

const phoneWorkout = await box('.workout');
check('8: THE HEADER IS GONE - no page or category switching mid-workout',
  (await style('.header', 'display')) === 'none', await style('.header', 'display'));
check('8: the content takes the full width', phoneWorkout.width === PHONE.width,
  phoneWorkout.width);
check('8: and starts at the very top', phoneWorkout.top === 0, phoneWorkout.top);
check('8: and the full height', phoneWorkout.height === PHONE.height, phoneWorkout.height);
await shot('workout-phone', '.page');

// The two halves still split what is left.
const phonePreview = await box('.workout-preview');
const phoneList = await box('.complex-list--workout');
check('8: the halves hold on a phone too',
  Math.abs(phonePreview.height - phoneList.height) < 1,
  phonePreview.height + ' vs ' + phoneList.height);

// ---------- 9. the list scrolls rather than pushing the preview off ----------

await page.setViewport({ width: 393, height: 420, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 400));

const scroll = await page.evaluate(() => {
  const n = document.querySelector('.complex-list--workout');
  return {
    overflow: getComputedStyle(n).overflowY,
    clientHeight: n.clientHeight,
    scrollHeight: n.scrollHeight,
    pageHeight: Math.round(document.querySelector('.page').getBoundingClientRect().height),
  };
});
lines.push('\nscroll: ' + JSON.stringify(scroll) + '\n');

check('9: THE LIST SCROLLS WHEN THE BLOCKS DO NOT FIT',
  scroll.overflow === 'auto' && scroll.scrollHeight > scroll.clientHeight,
  JSON.stringify(scroll));
check('9: and the page itself does not grow past the viewport',
  scroll.pageHeight === 420, scroll.pageHeight);
check('9: the preview is still on screen above it',
  (await box('.workout-preview')).height > 0);
await shot('workout-scroll', '.page');

// ---------- 10. opening it straight from a link ----------
//
// This is how it reaches the phone: a URL, not a click through two other pages.
// So the hash - and only the hash - can name the page to start on. Uses the
// real index.html rather than the harness, because it is mountApp's own
// behaviour that is under test.

const mounted = () => page.evaluate(() => (
  document.querySelector('.workout') ? 'workout'
    : document.querySelector('.complex-list--calendar') ? 'calendar'
    : 'schedule'
));

await page.goto(BASE + '/index.html#workout', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 500));
check('10: #workout OPENS THE WORKOUT PAGE DIRECTLY', (await mounted()) === 'workout',
  await mounted());

// A query string forces a real reload rather than a same-document hash change.
await page.goto(BASE + '/index.html?a=1', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 500));
check('10: with no hash it still opens on the schedule', (await mounted()) === 'schedule',
  await mounted());
check('10: and the hash names the page on screen',
  (await page.evaluate(() => location.hash)) === '#schedule',
  await page.evaluate(() => location.hash));

await page.goto(BASE + '/index.html?a=2#nonsense', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 500));
check('10: a hash that names no page falls back to the schedule',
  (await mounted()) === 'schedule', await mounted());

// The phone's back button walks back through the pages that were visited.
await page.evaluate(() => [...document.querySelectorAll('.page-button')]
  .find((b) => b.dataset.page === 'workout').click());
await new Promise((r) => setTimeout(r, 500));
check('10: clicking through puts the page in the hash', (await mounted()) === 'workout'
  && (await page.evaluate(() => location.hash)) === '#workout',
  await page.evaluate(() => location.hash));

await page.goBack();
await new Promise((r) => setTimeout(r, 600));
check('10: AND BACK RETURNS TO THE PAGE BEFORE IT', (await mounted()) === 'schedule',
  await mounted());

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
