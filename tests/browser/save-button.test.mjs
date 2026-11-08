// «Обновить» in real Chrome: where it sits, its three looks (default, hover,
// done), «Добавить» beside it, that Ctrl+S drives it and the browser's own
// Ctrl+S is suppressed, and that the upload runs on behind the 1.5-second
// «Обновлено» - with the "leave site?" guard held while it is in flight.
//
// The page's fetch is replaced by a fake GitHub that can hold the final ref
// update open, so the upload stays in flight long enough to look at. Nothing
// here reaches the network.

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
await page.setViewport({ width: 1500, height: 800, deviceScaleFactor: 2 });

const geometry = () => page.evaluate(() => {
  const b = document.querySelector('.categories .save-button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const list = document.querySelector('.categories .category-list').getBoundingClientRect();
  return {
    right: window.innerWidth - r.right, centreDy: Math.abs((r.top + r.height / 2) - (list.top + list.height / 2)),
    lastInRow: b === document.querySelector('.categories').lastElementChild,
    label: b.querySelector('.save-button__label').textContent,
  };
});

const look = () => page.evaluate(() => {
  const b = document.querySelector('.save-button');
  const s = getComputedStyle(b);
  const icon = b.querySelector('.save-button__icon');
  const label = b.querySelector('.save-button__label');
  const r = b.getBoundingClientRect();
  const ir = icon.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  const is = getComputedStyle(icon);
  return {
    width: r.width, height: r.height, radius: s.borderRadius,
    bg: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopColor, color: s.color,
    iconLeft: ir.left - r.left, iconW: ir.width, iconH: ir.height, iconBg: is.backgroundColor,
    gap: lr.left - ir.right, label: label.textContent, labelRight: r.right - lr.right,
    mask: is.maskImage || is.webkitMaskImage, status: b.dataset.status,
  };
});

const shoot = async (name, selector = '.save-button') => page.screenshot({
  path: OUT + '/' + name + '.png',
  clip: await page.$eval(selector, (n) => {
    const r = n.getBoundingClientRect();
    return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12 };
  }),
});

// ============================================================
// 1. it is there on every page, at the right of the categories row
// ============================================================

for (const [name, query] of [
  ['schedule', 'seed=exercises&complexes=2,1,1'],
  ['calendar', 'seed=exercises&complexes=2,1,1&page=calendar'],
  ['workout', 'seed=exercises&complexes=2,1,1&start=today&page=workout'],
]) {
  await page.goto(harness(query), { waitUntil: 'networkidle2' });
  await page.waitForSelector('.save-button');
  await wait(200);
  const g = await geometry();
  check(`1 ${name}: the button is in the categories row, last`, g && g.lastInRow, JSON.stringify(g));
  check(`1 ${name}: at its right-hand end, 16px in from the edge`, g && Math.abs(g.right - 16) <= 1,
    g && g.right);
  check(`1 ${name}: centred on the category list`, g && g.centreDy <= 1, g && g.centreDy);
  check(`1 ${name}: it reads «Обновить»`, g && g.label === 'Обновить', g && g.label);
  await page.screenshot({ path: OUT + `/save-button-${name}.png`, clip: { x: 0, y: 0, width: 1500, height: 90 } });
}

// ============================================================
// 2. the default look, the hover look, and «Добавить» beside it
// ============================================================

await page.goto(harness('seed=exercises&complexes=2,1,1'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.save-button');
await wait(200);

let l = await look();
check('2: 97 x 24, radius 6', l.width === 97 && l.height === 24 && l.radius === '6px', JSON.stringify(l));
check('2: default: #1D1D1D ground, 1px #525252 border', l.bg === 'rgb(29, 29, 29)'
  && l.border === '1px rgb(82, 82, 82)', JSON.stringify(l));
check('2: default: white text and icon', l.color === 'rgb(255, 255, 255)'
  && l.iconBg === 'rgb(255, 255, 255)', JSON.stringify(l));
check('2: 6px padding inside the 1px border, so the icon starts at 7', Math.abs(l.iconLeft - 7) < 0.5, l.iconLeft);
check('2: icon 13x12, then 6px, then «Обновить»',
  l.iconW === 13 && l.iconH === 12 && Math.abs(l.gap - 6) < 0.5 && l.label === 'Обновить', JSON.stringify(l));
check('2: the icon is reset_icon', /reset_icon\.svg/.test(l.mask), l.mask);
await shoot('save-button-default');

// The icon files are used as masks, so a leftover opaque background in them
// would turn the icon into a solid square.
const clean = await page.evaluate(async () => {
  const out = {};
  for (const name of ['reset_icon', 'done_icon']) {
    const img = new Image();
    img.src = 'assets/icons/' + name + '.svg';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 13; c.height = 12;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 13, 12);
    const d = ctx.getImageData(0, 0, 13, 12).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) opaque += 1;
    out[name] = { corner: d[3], opaque };
  }
  return out;
});
check('2: NEITHER ICON CARRIES A BACKGROUND (corners transparent, glyph only)',
  Object.values(clean).every((v) => v.corner === 0 && v.opaque > 10 && v.opaque < 120), JSON.stringify(clean));

const box = await page.$eval('.save-button', (n) => {
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await wait(100);
l = await look();
check('2: hover: white ground and border, black text and icon',
  l.bg === 'rgb(255, 255, 255)' && l.border === '1px rgb(255, 255, 255)'
  && l.color === 'rgb(0, 0, 0)' && l.iconBg === 'rgb(0, 0, 0)', JSON.stringify(l));
check('2: hover moves nothing', Math.abs(l.iconLeft - 7) < 0.5 && l.width === 97, JSON.stringify(l));
await shoot('save-button-hover');
await page.mouse.move(10, 400);
await wait(100);

const add = await page.evaluate(() => {
  const b = document.querySelector('.exercise-toolbar .main-button');
  const s = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const icon = b.querySelector('.main-button__icon').getBoundingClientRect();
  const text = [...b.childNodes].find((n) => n.nodeType === 3 || (n.nodeType === 1 && n.tagName !== 'IMG'));
  const range = document.createRange();
  range.selectNodeContents(text);
  const t = range.getBoundingClientRect();
  return { padL: s.paddingLeft, padR: s.paddingRight, gap: s.columnGap,
    iconLeft: icon.left - r.left, textGap: t.left - icon.right, textRight: r.right - t.right };
});
check('2: «Добавить»: 6px padding, 6px between icon and text',
  add.padL === '6px' && add.padR === '6px' && add.gap === '6px'
  && Math.abs(add.iconLeft - 6) < 0.5 && Math.abs(add.textGap - 6) < 0.5 && Math.abs(add.textRight - 6) < 0.5,
  JSON.stringify(add));
await shoot('save-button-add', '.exercise-toolbar .main-button');

// ============================================================
// 3. Ctrl+S, and the done look
// ============================================================

const prevented = await page.evaluate(() => {
  window.__ctrlS = null;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyS') setTimeout(() => { window.__ctrlS = e.defaultPrevented; }, 0);
  }, true);
  return true;
});
await page.keyboard.down('Control');
await page.keyboard.press('KeyS');
await page.keyboard.up('Control');
await wait(100);
check('3: CTRL+S IS PREVENTED - no "save page" dialog',
  prevented && (await page.evaluate(() => window.__ctrlS)) === true,
  await page.evaluate(() => window.__ctrlS));
l = await look();
check('3: and it pressed the button: «Обновлено» at once', l.status === 'done' && l.label === 'Обновлено',
  JSON.stringify(l));
check('3: done: white ground and border, black text and icon', l.bg === 'rgb(255, 255, 255)'
  && l.border === '1px rgb(255, 255, 255)' && l.color === 'rgb(0, 0, 0)' && l.iconBg === 'rgb(0, 0, 0)',
  JSON.stringify(l));
check('3: done: the tick (done_icon)', /done_icon\.svg/.test(l.mask), l.mask);
check('3: «Обновлено» fits in the 97px, 6px from the icon',
  l.width === 97 && Math.abs(l.gap - 6) < 0.5 && l.labelRight >= 1, JSON.stringify(l));
await shoot('save-button-done');
await wait(1200);
check('3: still done at 1.3s', (await look()).status === 'done');
await wait(400);
l = await look();
check('3: back to «Обновить» after 1.5s', l.status === 'idle' && l.label === 'Обновить'
  && l.bg === 'rgb(29, 29, 29)', JSON.stringify(l));

// Ctrl+S from inside the date field commits what was typed first.
await page.click('.input--date');
await page.keyboard.type('1510');
await page.keyboard.down('Control');
await page.keyboard.press('KeyS');
await page.keyboard.up('Control');
await wait(300);
check('3: CTRL+S INSIDE A FIELD COMMITS THE FIELD FIRST',
  await page.evaluate(async () => /-10-15$/.test((await import('/js/store.js')).activeCategory().scheduleStartDate)),
  await page.evaluate(async () => (await import('/js/store.js')).activeCategory().scheduleStartDate));
await wait(2000);

// ============================================================
// 4. a real upload, held mid-flight: it goes on behind the button
// ============================================================

await page.evaluate(async () => {
  const sync = await import('/js/sync.js');
  const store = await import('/js/store.js');
  const github = await import('/js/github.js');
  const save = await import('/js/save-button.js');

  // A fake GitHub with one real state.json, and a ref update that waits.
  const files = { 'data/state.json': JSON.stringify({
    version: 2, categoryOrder: ['a'], lastEquipment: [],
    categories: { a: { name: 'Тест', exercises: [], complexes: [], scheduleEnabled: true,
      scheduleStartDate: '2026-09-03', intervalDays: 1 } },
  }), 'data/log.json': JSON.stringify({ version: 1, ops: [] }) };
  let release;
  window.__held = new Promise((r) => { release = r; });
  window.__release = () => release();
  window.__commits = 0;
  const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const u = String(url);
    if (method === 'GET' && u.includes('/contents/')) {
      const name = decodeURIComponent(u.split('/contents/')[1]);
      return name in files ? json(files[name]) : json('Not Found', 404);
    }
    if (u.includes('/git/ref/')) return json({ object: { sha: 'c0' } });
    if (method === 'GET' && u.includes('/git/commits/')) return json({ tree: { sha: 't0' } });
    if (u.endsWith('/git/blobs')) return json({ sha: 'b1' });
    if (u.endsWith('/git/trees')) return json({ sha: 't1' });
    if (method === 'POST' && u.endsWith('/git/commits')) return json({ sha: 'c1' });
    if (method === 'PATCH') { await window.__held; window.__commits += 1; return json({ object: { sha: 'c1' } }); }
    return json('Not Found', 404);
  };

  github.setToken('fake-token');
  sync.resetSync();
  save.resetSaveButton();
  store.resetStore(await sync.loadFromRepo());
  store.setCategoryField('intervalDays', 4);   // a structural change to send
});
await wait(250);

const held = () => page.evaluate(() => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});

await page.click('.save-button');
await wait(50);
l = await look();
check('4: the press shows «Обновлено» at once, before GitHub has answered',
  l.status === 'done' && (await page.evaluate(() => window.__commits)) === 0, JSON.stringify(l));
await wait(250);
check('4: CLOSING OR RELOADING NOW ASKS FIRST (beforeunload is held)', await held());
await wait(1400);
l = await look();
check('4: after 1.5s it reads «Обновить» again, though the upload is still held',
  l.status === 'idle' && (await page.evaluate(() => window.__commits)) === 0, JSON.stringify(l));
check('4: and the tab is still held meanwhile', await held());

await page.evaluate(() => window.__release());
await page.evaluate(async () => { await (await import('/js/save-button.js')).saveInFlight(); });
await wait(100);
check('4: the upload lands', (await page.evaluate(() => window.__commits)) >= 1);
check('4: the leave-site guard is released', !(await held()));
check('4: nothing is left pending',
  await page.evaluate(async () => !(await import('/js/sync.js')).hasPendingChanges(
    (await import('/js/store.js')).getState())));
check('4: and the button did not change when it landed', (await look()).status === 'idle');

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
