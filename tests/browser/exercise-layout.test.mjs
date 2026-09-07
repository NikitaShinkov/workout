// The exercise page's geometry: top_block floating over the picture, the
// description sizing itself to its text, the Toolbar, Button_next and its ring,
// and the swipe onto the sheet of every image.
//
// None of this can be checked without a layout engine - the sheet's whole point
// is how it divides a box, and jsdom's rects are all zero. The behaviour and
// the arithmetic are in tests/jsdom/exercise.

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

const DESKTOP = { width: 1500, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 393, height: 800, deviceScaleFactor: 2 };

// A complex of three exercises with two images each, opened on the first of
// them. Only today's complexes can be started, hence &start=today.
const OPEN = 'seed=exercises&complexes=3&start=today&page=exercise';

const box = (selector) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return {
    left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1),
    bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1),
  };
}, selector);

const boxes = (selector) => page.$$eval(selector, (nodes) => nodes.map((n) => {
  const r = n.getBoundingClientRect();
  return {
    left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1),
    bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1),
  };
}));

const style = (selector, prop) => page.evaluate((s, p) => {
  const n = document.querySelector(s);
  return n ? getComputedStyle(n)[p] : null;
}, selector, prop);

const text = (selector) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? n.textContent : null;
}, selector);

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

const near = (a, b, slack = 1) => Math.abs(a - b) <= slack;

// Longer than both the settle (200ms) and the spring back (260ms).
const settled = () => new Promise((r) => setTimeout(r, 420));

const open = async (query = OPEN) => {
  await page.goto(harness(query), { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page--exercise');
  // The images are drawn on a canvas and handed over as blobs; give the first
  // frame and the sheet's measurements time to land.
  await new Promise((r) => setTimeout(r, 700));
};

// ---------- 1. the three blocks, and the phone's measure ----------

await page.setViewport(PHONE);
await open();

const view = await box('.exercise-view');
const image = await box('.exercise-image');
const bottom = await box('.exercise-bottom');
lines.push('\nblocks: ' + JSON.stringify({ view, image, bottom }) + '\n');

check('1: the page fills the viewport and does not grow past it',
  view.height === 800 && view.top === 0, JSON.stringify(view));
check('1: IMAGE_BLOCK TAKES EVERYTHING THE OTHERS LEAVE',
  image.top === view.top && near(image.bottom, bottom.top)
    && near(image.height + bottom.height, view.height),
  JSON.stringify({ image, bottom }));
check('1: and it is the full width of the page',
  image.width === view.width, image.width);
check('1: Description_and_toolbar sits on the bottom edge',
  near(bottom.bottom, view.bottom), bottom.bottom);
check('1: 20px of padding all round it, as the design has',
  (await style('.exercise-bottom', 'padding')) === '20px',
  await style('.exercise-bottom', 'padding'));
check('1: on a phone it drops the desktop measure',
  (await style('.exercise-view', 'maxWidth')) === 'none',
  await style('.exercise-view', 'maxWidth'));
check('1: a horizontal drag on the picture is not claimed by the browser',
  (await style('.exercise-image', 'touchAction')) === 'pan-y',
  await style('.exercise-image', 'touchAction'));
check('1: and the block clips whatever has not been swiped in yet',
  (await style('.exercise-image', 'overflow')) === 'hidden');

await shot('exercise-phone', '.page');

// ---------- 2. top_block floats over the picture ----------

const top = await box('.exercise-top');
const close = await box('.exercise-close');
lines.push('top: ' + JSON.stringify({ top, close }) + '\n');

check('2: THE CLOSE BUTTON IS OVER IMAGE_BLOCK, not above it',
  close.top > image.top && close.bottom < image.bottom,
  JSON.stringify({ close, image }));
check('2: 20px of padding over a 44px button is the design\'s 64px',
  near(top.top, 0) && near(close.top, 20) && near(close.bottom, 64),
  JSON.stringify({ top, close }));
check('2: it is 44x44 and round',
  close.width === 44 && close.height === 44
    && (await style('.exercise-close', 'borderRadius')) === '50%',
  JSON.stringify(close) + '/' + await style('.exercise-close', 'borderRadius'));
check('2: 20px in from the right edge',
  near(close.right, view.right - 20), close.right);
check('2: half-transparent over the picture, with the --stroke outline',
  (await style('.exercise-close', 'backgroundColor')) === 'rgba(29, 29, 29, 0.5)'
    && (await style('.exercise-close', 'borderColor')) === 'rgb(82, 82, 82)',
  await style('.exercise-close', 'backgroundColor'));
check('2: it is drawn above the picture',
  Number(await style('.exercise-top', 'zIndex')) > 0,
  await style('.exercise-top', 'zIndex'));
check('2: BUT THE STRIP ITSELF TAKES NO CLICKS - a swipe may start up here',
  (await style('.exercise-top', 'pointerEvents')) === 'none'
    && (await style('.exercise-close', 'pointerEvents')) === 'auto',
  await style('.exercise-top', 'pointerEvents'));

// The button is the topmost thing at its own centre, and the picture is the
// topmost thing beside it - which is what "floating over" has to mean.
const hitAt = (x, y) => page.evaluate((px, py) => {
  const n = document.elementFromPoint(px, py);
  return n ? (n.closest('.exercise-close') ? 'close'
    : n.closest('.exercise-image') ? 'image' : n.className) : null;
}, x, y);

check('2: clicking the button reaches the button',
  (await hitAt(close.left + 22, close.top + 22)) === 'close');
check('2: and clicking beside it reaches the picture',
  (await hitAt(20, 40)) === 'image', await hitAt(20, 40));

// ---------- 3. Description_block is as tall as its text ----------

const name = await box('.exercise-description__name');
const desc = await box('.exercise-description');
const star = await box('.favorite-star');

check('3: the name is 16px bold, as the design writes it',
  (await style('.exercise-description__name', 'fontSize')) === '16px'
    && (await style('.exercise-description__name', 'fontWeight')) === '700',
  await style('.exercise-description__name', 'fontSize'));
check('3: THE STAR IS TO THE RIGHT OF THE NAME, on the same line',
  star.left > name.right - 1 && near(star.top, name.top, 2) && star.width === 23,
  JSON.stringify({ name, star }));
check('3: 8px between the name and the description',
  near((await box('.exercise-description__text')).top - name.bottom, 8),
  (await box('.exercise-description__text')).top - name.bottom);
check('3: and 10px between Description_block and the Toolbar',
  near((await box('.exercise-controls')).top - desc.bottom, 10),
  (await box('.exercise-controls')).top - desc.bottom);

// The same page seeded with a shorter description: the block has to follow the
// text rather than being a fixed height.
const tall = { bottom: bottom.height, image: image.height };
await open('seed=text&complexes=3&start=today&page=exercise');
const shortBottom = await box('.exercise-bottom');
const shortImage = await box('.exercise-image');
lines.push('short vs tall: ' + JSON.stringify({ tall, short: {
  bottom: shortBottom.height, image: shortImage.height } }) + '\n');

check('3: A SHORTER DESCRIPTION MAKES A SHORTER BLOCK',
  shortBottom.height < tall.bottom, shortBottom.height + ' vs ' + tall.bottom);
check('3: and image_block gets exactly what it gives back',
  shortImage.height > tall.image
    && near(tall.bottom - shortBottom.height, shortImage.height - tall.image),
  JSON.stringify({ short: shortBottom.height, tall: tall.bottom }));
check('3: THE TOOLBAR IS ALWAYS ITS OWN HEIGHT',
  (await box('.exercise-controls')).height === 82,
  (await box('.exercise-controls')).height);
check('3: NOTHING IN THE BLOCK SCROLLS - the whole description is on screen',
  (await style('.exercise-description', 'overflowY')) === 'visible'
    && (await style('.exercise-bottom', 'maxHeight')) === 'none',
  (await style('.exercise-description', 'overflowY'))
    + '/' + await style('.exercise-bottom', 'maxHeight'));
const shortDesc = await box('.exercise-description');
const shortText = await box('.exercise-description__text');
const shortControls = await box('.exercise-controls');
check('3: and the whole of the text sits inside the block, above the Toolbar',
  shortText.bottom <= shortDesc.bottom + 1 && shortDesc.bottom < shortControls.top,
  JSON.stringify({ shortText, shortDesc, controls: shortControls.top }));

await open();

// ---------- 4. the Toolbar ----------

const controls = await box('.exercise-controls');
const indicators = await boxes('.indicator-button');
const next = await box('.next-button');
lines.push('toolbar: ' + JSON.stringify({ controls, indicators, next }) + '\n');

check('4: three indicators and one Button_next', indicators.length === 3);
check('4: THEY ARE A FIXED 69px TALL',
  indicators.every((b) => b.height === 69), indicators.map((b) => b.height).join(','));
check('4: THEY SHARE ALL THE WIDTH BUTTON_NEXT LEAVES',
  near(indicators[0].width, indicators[1].width, 0.5)
    && near(indicators[1].width, indicators[2].width, 0.5)
    && near(indicators[0].left, controls.left)
    && near(indicators[2].right, next.left - 5),
  JSON.stringify(indicators.map((b) => b.width)));
check('4: 5px between each of them, as the design has',
  near(indicators[1].left - indicators[0].right, 5)
    && near(indicators[2].left - indicators[1].right, 5),
  (indicators[1].left - indicators[0].right).toFixed(1));
check('4: they all sit on the bottom edge with Button_next',
  indicators.every((b) => near(b.bottom, next.bottom)),
  indicators.map((b) => b.bottom).join(','));
check('4: the icon box is the design\'s 40px, so the three line up',
  (await boxes('.indicator-button__icons')).every((b) => b.height === 40),
  (await boxes('.indicator-button__icons')).map((b) => b.height).join(','));
check('4: and the axis is named under it',
  (await page.$$eval('.indicator-button__name', (n) => n.map((s) => s.textContent))).join(',')
    === 'Техника,Амплитуда,Сила');

// --- the whole block takes the tap, not just the icon ---

const levels = () => page.$$eval('.indicator-button', (n) => n.map((b) => b.dataset.level));
check('4: they start at Easy', (await levels()).join(',') === 'easy,easy,easy',
  (await levels()).join(','));

// The bottom-left corner of the first indicator: inside the button, and well
// clear of both the icon and the label.
await page.mouse.click(indicators[0].left + 3, indicators[0].bottom - 3);
await new Promise((r) => setTimeout(r, 100));
check('4: A TAP IN THE CORNER OF THE BLOCK COUNTS - the whole block is the button',
  (await levels())[0] === 'medium', (await levels()).join(','));
check('4: and the accessible name followed it',
  (await page.$eval('.indicator-button', (b) => b.getAttribute('aria-label')))
    === 'Техника: средне',
  await page.$eval('.indicator-button', (b) => b.getAttribute('aria-label')));
check('4: and only that one changed', (await levels()).slice(1).join(',') === 'easy,easy');

const iconSrc = () => page.$$eval('.indicator-button__icon',
  (n) => n.map((i) => i.getAttribute('src').split('/').pop()));
check('4: the icon drawn is the one for that axis at that level',
  (await iconSrc()).join(',') === 'technique_moderate.svg,motion_easy.svg,strength_easy.svg',
  (await iconSrc()).join(','));
check('4: and each exported file carries its own colour, so it is an <img>',
  (await page.$$eval('.indicator-button__icon', (n) => n.every((i) => i.tagName === 'IMG'))));

await shot('exercise-toolbar', '.exercise-bottom');

// ---------- 5. Button_next and its ring ----------

const segments = await boxes('.next-button__segment');
const ringInfo = await page.evaluate(() => {
  const svg = document.querySelector('.next-button__ring');
  const circles = [...svg.querySelectorAll('circle')];
  return {
    width: svg.getAttribute('width'),
    strokes: circles.map((c) => c.getAttribute('stroke-width')),
    radii: circles.map((c) => c.getAttribute('r')),
    states: circles.map((c) => c.getAttribute('class').replace(/.*segment--/, '')),
    turn: svg.querySelector('g').getAttribute('transform'),
  };
});
lines.push('ring: ' + JSON.stringify(ringInfo) + '\n');

check('5: BUTTON_NEXT IS 82x82', next.width === 82 && next.height === 82,
  JSON.stringify(next));
check('5: with a 4px ring whose outer edge lands on the box',
  ringInfo.strokes.every((s) => s === '4') && ringInfo.radii.every((r) => r === '39')
    && ringInfo.width === '82',
  JSON.stringify(ringInfo.radii));
check('5: ONE SEGMENT PER EXERCISE IN THE COMPLEX',
  segments.length === 3, segments.length);
check('5: the one being performed is marked apart from those still to do',
  ringInfo.states.join(',') === 'current,todo,todo', ringInfo.states.join(','));
check('5: and the count starts at the top rather than at three o\'clock',
  ringInfo.turn === 'rotate(-90 41 41)', ringInfo.turn);

// Where each segment actually lands on the ring, in degrees clockwise from
// twelve. Measured in SCREEN space, because getPointAtLength answers in the
// element's own coordinates and would report the ring untransformed - the
// dash arithmetic alone cannot say that the rotation put the count where it
// was meant to go.
const arcs = await page.evaluate(() => {
  const svg = document.querySelector('.next-button__ring');
  const box = svg.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const clock = (p) => Math.round((Math.atan2(p.x - cx, cy - p.y) * 180 / Math.PI + 360) % 360);

  return [...document.querySelectorAll('.next-button__segment')].map((c) => {
    const len = c.getTotalLength();
    const dash = c.getAttribute('stroke-dasharray').split(' ').map(Number);
    const start = -Number(c.getAttribute('stroke-dashoffset'));
    const m = c.getScreenCTM();
    const at = (d) => clock(c.getPointAtLength(d % len).matrixTransform(m));
    return { state: c.getAttribute('class').replace(/.*segment--/, ''),
      from: at(start), to: at(start + dash[0]) };
  });
});
lines.push('arcs: ' + JSON.stringify(arcs) + '\n');

check('5: THE FIRST SEGMENT BEGINS AT THE TOP OF THE CIRCLE',
  arcs[0].from <= 2, JSON.stringify(arcs[0]));
check('5: AND THEY RUN CLOCKWISE, a third of the ring each',
  arcs.every((a, at) => Math.abs(a.from - at * 120) <= 3
    && Math.abs(((a.to - a.from) + 360) % 360 - 120) <= 4),
  JSON.stringify(arcs));
check('5: with the 2px gaps between them and nowhere else',
  arcs.every((a, at) => {
    const next = arcs[(at + 1) % arcs.length];
    return ((next.from - a.to) + 360) % 360 <= 4;
  }), JSON.stringify(arcs.map((a) => a.to)));
check('5: butt caps, or a round one would eat into the 2px between neighbours',
  (await style('.next-button__segment', 'strokeLinecap')) === 'butt');
check('5: the arrow is centred in it at the design\'s 29px',
  (await box('.next-button__arrow')).width === 29, (await box('.next-button__arrow')).width);
check('5: with the remaining time under it - three exercises at two minutes',
  (await text('.next-button__time')) === '6:00', await text('.next-button__time'));
check('5: the face takes no clicks, so every part of the button is the button',
  (await style('.next-button__face', 'pointerEvents')) === 'none');

// --- the blink ---
//
// 200ms of --active, 200ms of #3B3B3B, for ever. Sampled over more than two
// full cycles, so a sample landing on a boundary cannot decide the result.

const seen = new Set();
// 26 samples 100ms apart is over 2.5s: more than two full cycles, so no single
// sample landing on a boundary can decide the result.
for (let i = 0; i < 26; i += 1) {
  seen.add(await style('.next-button__segment--current', 'stroke'));
  await new Promise((r) => setTimeout(r, 100));
}
lines.push('blink: ' + JSON.stringify([...seen]) + '\n');

check('5: THE CURRENT SEGMENT ALTERNATES between --active and #3B3B3B',
  seen.size === 2 && seen.has('rgb(71, 140, 246)') && seen.has('rgb(59, 59, 59)'),
  [...seen].join(' | '));
check('5: A HALF-SECOND EACH WAY, so a 1s cycle',
  (await style('.next-button__segment--current', 'animationDuration')) === '1s',
  await style('.next-button__segment--current', 'animationDuration'));
check('5: and it is a switch, not a fade',
  (await style('.next-button__segment--current', 'animationTimingFunction')) === 'steps(1)',
  await style('.next-button__segment--current', 'animationTimingFunction'));
check('5: a segment still to do is the --active blue and stays there',
  (await page.$eval('.next-button__segment--todo',
    (n) => getComputedStyle(n).stroke)) === 'rgb(71, 140, 246)');

// ---------- 6. the swipe onto the sheet and back ----------

const paintedX = () => page.evaluate(() => {
  const track = document.querySelector('.exercise-image__track');
  if (!track) return null;
  const t = getComputedStyle(track).transform;
  return t && t !== 'none' ? +new DOMMatrixReadOnly(t).m41.toFixed(1) : 0;
});
const panels = () => boxes('.exercise-image__panel');
const showing = async () => {
  const [animation, sheet] = await panels();
  const centre = image.left + image.width / 2;
  return animation.left <= centre && animation.right > centre ? 'animation'
    : sheet.left <= centre && sheet.right > centre ? 'sheet' : 'neither';
};

const y = image.top + image.height / 2;
const mid = image.left + image.width / 2;
const swipe = async (dx) => {
  await page.mouse.move(mid, y);
  await page.mouse.down();
  await page.mouse.move(mid + dx / 2, y);
  await page.mouse.move(mid + dx, y);
  await page.mouse.up();
  await settled();
};

const parked = await panels();
lines.push('panels at rest: ' + JSON.stringify(parked) + '\n');

check('6: the animation is on screen and the sheet is parked beside it',
  (await showing()) === 'animation'
    && near(parked[1].left - parked[0].left, parked[0].width),
  JSON.stringify(parked));
check('6: the picture is playing', Boolean(await box('.exercise-image .seq-anim__img')));
check('6: and it is contained, so none of the pose is cropped',
  (await style('.exercise-image .seq-anim__img', 'objectFit')) === 'contain');

// The finger drives the track directly before the gesture is committed.
await page.mouse.move(mid, y);
await page.mouse.down();
await page.mouse.move(mid - 70, y);
check('6: THE TRACK FOLLOWS THE FINGER 1:1 while the gesture is live',
  near(await paintedX(), -70), await paintedX());
await page.mouse.move(mid + 70, y);
check('6: and it RESISTS at the end, where there is nothing to bring in',
  (await paintedX()) > 0 && (await paintedX()) < 70 * 0.5,
  await paintedX());
await page.mouse.up();
await settled();
check('6: which springs back rather than committing',
  (await showing()) === 'animation' && near(await paintedX(), 0),
  (await showing()) + '/' + await paintedX());

await swipe(-10);
check('6: a short drag is a tap, not a swipe', (await showing()) === 'animation',
  await showing());

await swipe(-120);
check('6: SWIPING LEFT BRINGS IN EVERY IMAGE AT ONCE', (await showing()) === 'sheet',
  await showing());
check('6: and the track is back at rest around the new view',
  near(await paintedX(), 0), await paintedX());

await swipe(120);
check('6: SWIPING RIGHT GOES BACK TO THE ANIMATION', (await showing()) === 'animation',
  await showing());

// ---------- 7. how the sheet divides the block ----------

const sheetShot = async (name) => {
  await swipe(-120);
  await shot(name, '.exercise-image');
};

// Two landscape images: stacked, because that is what leaves them biggest -
// the brief's own example.
await sheetShot('exercise-sheet-pair');
let cells = await boxes('.exercise-sheet__image');
lines.push('pair: ' + JSON.stringify(cells) + '\n');

check('7: A PAIR OF WIDE IMAGES STACKS', cells.length === 2
  && near(cells[0].left, cells[1].left) && cells[1].top > cells[0].bottom,
  JSON.stringify(cells));
check('7: 4px between them',
  near(cells[1].top - cells[0].bottom, 4), cells[1].top - cells[0].bottom);
check('7: THEY FILL THE BLOCK, both ways',
  cells.every((c) => near(c.width, image.width))
    && near(cells[0].top, image.top) && near(cells[1].bottom, image.bottom),
  JSON.stringify({ image, cells }));
check('7: and each is contained in its half, so neither is cropped',
  (await style('.exercise-sheet__image', 'objectFit')) === 'contain');
check('7: NOTHING ON THE SHEET IS DRAGGABLE - a native drag cancels the swipe',
  await page.$$eval('.exercise-sheet__image',
    (n) => n.every((i) => i.getAttribute('draggable') === 'false')));

// Five images: two columns, three rows, read 1 2 / 3 4 / 5. The rows are the
// height of the PICTURES, so the only space between two of them is the 4px gap.
await open('seed=exercises&complexes=3&start=today&images=5&page=exercise');
await sheetShot('exercise-sheet-grid');
cells = await boxes('.exercise-sheet__image');
const gridImage = await box('.exercise-image');
const sheetBox = await box('.exercise-sheet');
const scrolls = () => page.evaluate(() => {
  const n = document.querySelector('.exercise-sheet');
  return { over: n.scrollHeight > n.clientHeight + 1, scrollHeight: n.scrollHeight,
    clientHeight: n.clientHeight, top: n.scrollTop };
});
lines.push('grid: ' + JSON.stringify({ cells, sheetBox }) + '\n');

check('7: MORE THAN TWO MAKES A TWO-COLUMN GRID', cells.length === 5
  && near(cells[0].left, cells[2].left) && near(cells[2].left, cells[4].left)
  && near(cells[1].left, cells[3].left) && cells[1].left > cells[0].left,
  JSON.stringify(cells.map((c) => c.left)));
check('7: read 1 2 / 3 4 / 5, so the odd one out sits in the first column',
  near(cells[0].top, cells[1].top) && cells[2].top > cells[0].bottom
    && near(cells[2].top, cells[3].top) && cells[4].top > cells[2].bottom,
  JSON.stringify(cells.map((c) => c.top)));
check('7: 4PX BETWEEN THE COLUMNS AND BETWEEN THE ROWS, and nothing else',
  near(cells[1].left - cells[0].right, 4) && near(cells[2].top - cells[0].bottom, 4)
    && near(cells[4].top - cells[2].bottom, 4),
  (cells[1].left - cells[0].right) + '/' + (cells[2].top - cells[0].bottom));
check('7: it fills the WIDTH of the block',
  near(cells[0].left, gridImage.left) && near(cells[1].right, gridImage.right),
  JSON.stringify({ gridImage, first: cells[0] }));
check('7: A ROW IS THE PICTURE\'S OWN HEIGHT, not a share of the block',
  near(cells[0].width / cells[0].height, 520 / 290, 0.03)
    && cells[0].height < gridImage.height / 3,
  (cells[0].width / cells[0].height).toFixed(3) + ' vs ' + (520 / 290).toFixed(3));
check('7: the rows are equal, since the pictures are',
  near(cells[0].height, cells[2].height, 1.5) && near(cells[2].height, cells[4].height, 1.5),
  cells.map((c) => c.height).join(','));
check('7: SO IT IS CENTRED IN THE BLOCK rather than sitting at the top',
  cells[0].top > gridImage.top + 1
    && near(cells[0].top - gridImage.top, gridImage.bottom - cells[4].bottom, 1.5),
  JSON.stringify({ above: cells[0].top - gridImage.top,
    below: gridImage.bottom - cells[4].bottom }));
check('7: AND IT DOES NOT SCROLL, because it all fits',
  (await scrolls()).over === false, JSON.stringify(await scrolls()));

// Twelve images: six rows, taller than the block, so the sheet becomes a
// scrollport of its own.
await open('seed=exercises&complexes=3&start=today&images=12&page=exercise');
await sheetShot('exercise-sheet-scroll');
cells = await boxes('.exercise-sheet__image');
const tallBlock = await box('.exercise-image');
const tallSheet = await box('.exercise-sheet');
lines.push('tall grid: ' + JSON.stringify({ scroll: await scrolls(), tallSheet }) + '\n');

check('7: TOO MANY TO FIT AND THE GRID ITSELF SCROLLS',
  (await scrolls()).over === true, JSON.stringify(await scrolls()));
check('7: the scrollport is the block, so nothing else moved',
  near(tallSheet.top, tallBlock.top) && near(tallSheet.height, tallBlock.height),
  JSON.stringify({ tallSheet, tallBlock }));
check('7: THE FIRST ROW IS STILL REACHABLE - centring must not push it out',
  near(cells[0].top, tallBlock.top) && (await scrolls()).top === 0,
  JSON.stringify({ first: cells[0].top, block: tallBlock.top }));
check('7: the rows are still the pictures\' own height and 4px apart',
  near(cells[2].top - cells[0].bottom, 4)
    && near(cells[0].width / cells[0].height, 520 / 290, 0.03),
  (cells[2].top - cells[0].bottom).toFixed(1));

// --- the scroll belongs to the grid alone ---

// Somewhere inside the range it actually has, rather than a number that would
// silently clamp and then be asserted against.
const reach = (await scrolls()).scrollHeight - (await scrolls()).clientHeight;
const target = Math.round(reach * 0.6);
await page.evaluate((to) => { document.querySelector('.exercise-sheet').scrollTop = to; }, target);
await new Promise((r) => setTimeout(r, 100));
check('7: it really scrolls', reach > 20 && (await scrolls()).top === target,
  JSON.stringify({ reach, target, at: (await scrolls()).top }));

const animationPanelTop = () => page.evaluate(() => {
  const panel = document.querySelector('.exercise-image__panel--animation');
  const img = panel.querySelector('img');
  return {
    panelScroll: panel.scrollTop,
    // Where the frame is drawn, relative to the panel it lives in.
    offset: img ? Math.round(img.getBoundingClientRect().top
      - panel.getBoundingClientRect().top) : null,
  };
});

check('7: AND IT DOES NOT REACH THE ANIMATION BESIDE IT',
  JSON.stringify(await animationPanelTop()) === JSON.stringify({ panelScroll: 0, offset: 0 }),
  JSON.stringify(await animationPanelTop()));

await swipe(120);
check('7: swiping back shows the animation, unmoved',
  (await showing()) === 'animation'
    && JSON.stringify(await animationPanelTop())
      === JSON.stringify({ panelScroll: 0, offset: 0 }),
  (await showing()) + '/' + JSON.stringify(await animationPanelTop()));

await swipe(-120);
check('7: and the grid comes back where it was left',
  (await scrolls()).top === target,
  JSON.stringify({ target, at: (await scrolls()).top }));

// One image on its own.
await open('seed=text&complexes=3&start=today&page=exercise');
await sheetShot('exercise-sheet-single');
cells = await boxes('.exercise-sheet__image');
const oneImage = await box('.exercise-image');

check('7: ONE IMAGE HAS THE WHOLE BLOCK', cells.length === 1
  && near(cells[0].width, oneImage.width) && near(cells[0].height, oneImage.height),
  JSON.stringify({ oneImage, cells }));

// ---------- 8. closing, and walking the complex ----------

await open();
const started = await text('.exercise-description__name');

await page.click('.exercise-close');
await new Promise((r) => setTimeout(r, 400));

const mounted = () => page.evaluate(() => (
  document.querySelector('.page--exercise') ? 'exercise'
    : document.querySelector('.workout') ? 'workout' : 'other'));

check('8: CLOSING OPENS THE WORKOUT PAGE', (await mounted()) === 'workout', await mounted());
check('8: AND THE COMPLEX THAT WAS BEING PERFORMED IS HIGHLIGHTED',
  (await page.$$eval('.workout-complex--active', (n) => n.length)) === 1,
  await page.$$eval('.workout-complex--active', (n) => n.length));
check('8: the complex still offers Начать - nothing was confirmed',
  (await page.$$eval('.workout-complex .main-button', (n) => n.length)) === 1);
check('8: and it still reads as untouched',
  (await text('.workout-complex__meta')) === '3 упражнения, 6 мин',
  await text('.workout-complex__meta'));

// --- Начать, then confirm one exercise ---

await page.click('.workout-complex .main-button');
await page.waitForSelector('.page--exercise');
await new Promise((r) => setTimeout(r, 400));

check('8: НАЧАТЬ OPENS THE EXERCISE PAGE', (await mounted()) === 'exercise', await mounted());
check('8: on the exercise it was left on',
  (await text('.exercise-description__name')) === started,
  await text('.exercise-description__name'));

await page.click('.next-button');
await new Promise((r) => setTimeout(r, 400));

check('8: BUTTON_NEXT OPENS THE NEXT EXERCISE',
  (await text('.exercise-description__name')) !== started,
  await text('.exercise-description__name'));
check('8: the ring is redrawn - one behind, one on screen, one to come',
  (await page.$$eval('.next-button__segment',
    (n) => n.map((c) => c.getAttribute('class').replace(/.*segment--/, '')).join(',')))
    === 'done,current,todo',
  await page.$$eval('.next-button__segment',
    (n) => n.map((c) => c.getAttribute('class').replace(/.*segment--/, '')).join(',')));
check('8: and the remaining time no longer counts the one behind us',
  (await text('.next-button__time')) === '4:00', await text('.next-button__time'));

await page.click('.exercise-close');
await new Promise((r) => setTimeout(r, 400));

check('8: BACK ON THE WORKOUT PAGE THE COMPLEX SAYS WHAT IS LEFT OF IT',
  (await text('.workout-complex__meta')) === '2 из 3 упражнений, 4 мин',
  await text('.workout-complex__meta'));
await shot('exercise-part-done', '.page');

// --- and to the end of it ---

// Начать once more, and then Button_next carries straight on from the second
// exercise to the third without coming back here in between.
await page.click('.workout-complex .main-button');
await page.waitForSelector('.page--exercise');
await new Promise((r) => setTimeout(r, 300));

await page.click('.next-button');
await new Promise((r) => setTimeout(r, 400));
check('8: it walks on to the third without returning to the workout page',
  (await mounted()) === 'exercise', await mounted());

await page.click('.next-button');
await new Promise((r) => setTimeout(r, 400));

check('8: THE LAST ONE CONFIRMED LEAVES FOR THE WORKOUT PAGE',
  (await mounted()) === 'workout', await mounted());
check('8: A FINISHED COMPLEX CARRIES NO НАЧАТЬ AT ALL',
  (await page.$$eval('.workout-complex .main-button', (n) => n.length)) === 0,
  await page.$$eval('.workout-complex .main-button', (n) => n.length));
// The count goes back to the whole complex and the time is the REAL one - each
// exercise was confirmed in well under a second here, so it rounds to nothing.
// "0 из 3" would have been true and useless.
check('8: IT READS AS A WHOLE COMPLEX AGAIN, at the time it actually took',
  (await text('.workout-complex__meta')) === '3 упражнения, 0 мин',
  await text('.workout-complex__meta'));

// ---------- 9. the measure it keeps on a desktop ----------

await page.setViewport(DESKTOP);
await open();

const wide = await box('.exercise-view');
check('9: on a desktop it keeps the phone\'s 400px measure',
  wide.width === 400, wide.width);
check('9: centred in the window',
  near(wide.left, (1500 - 400) / 2), wide.left);
check('9: and it is still the whole height',
  wide.height === 900, wide.height);
await shot('exercise-desktop', '.page');

// ---------- 10. it cannot be opened by naming it ----------
//
// A session is which complex, which exercise and when the clock started, and
// none of that is persisted. A bookmark of #exercise is therefore not a
// workout, and has to land somewhere that is.

await page.goto(harness('seed=exercises&complexes=3&start=today') + '#exercise',
  { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 500));
check('10: #EXERCISE WITH NO WORKOUT IN PROGRESS FALLS BACK',
  (await mounted()) !== 'exercise', await mounted());

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
