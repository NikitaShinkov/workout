// «Обновить» in real Chrome: where it sits, that it is a main-button with a
// clean icon, that Ctrl+S drives it and the browser's own Ctrl+S is
// suppressed, and the three states an upload goes through - with the "leave
// site?" guard held while one is in flight.
//
// The page's fetch is replaced by a fake GitHub that can hold the final ref
// update open, so the busy state stays put long enough to look at. Nothing
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
  const row = document.querySelector('.categories').getBoundingClientRect();
  const list = document.querySelector('.categories .category-list').getBoundingClientRect();
  const s = getComputedStyle(b);
  return {
    right: window.innerWidth - r.right, centreDy: Math.abs((r.top + r.height / 2) - (list.top + list.height / 2)),
    lastInRow: b === document.querySelector('.categories').lastElementChild,
    height: r.height, width: r.width, bg: s.backgroundColor, radius: s.borderRadius,
    rowRight: window.innerWidth - row.right,
    label: b.querySelector('.save-button__label').textContent,
    gap: b.querySelector('.save-button__label').getBoundingClientRect().left
      - b.querySelector('.save-button__icon').getBoundingClientRect().right,
    padRight: r.right - b.querySelector('.save-button__label').getBoundingClientRect().right,
    status: b.dataset.status,
  };
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
// 2. it is a main-button, and its icon is clean
// ============================================================

await page.goto(harness('seed=exercises&complexes=2,1,1'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.save-button');
await wait(200);

const looks = await page.evaluate(async () => {
  const save = document.querySelector('.save-button');
  const add = document.querySelector('.main-button:not(.save-button)');
  const a = getComputedStyle(save);
  const b = getComputedStyle(add);
  const icon = save.querySelector('.save-button__icon');
  await icon.decode().catch(() => {});
  // The export carried two opaque background rectangles. Drawn to a canvas, a
  // clean icon is transparent in its corner; the export would be #1E1E1E.
  const c = document.createElement('canvas');
  c.width = 13; c.height = 12;
  const ctx = c.getContext('2d');
  ctx.drawImage(icon, 0, 0, 13, 12);
  const corner = ctx.getImageData(0, 0, 1, 1).data[3];
  const arrow = ctx.getImageData(6, 2, 1, 1).data; // on the arrow's shaft
  return {
    same: ['height', 'borderRadius', 'backgroundColor', 'paddingLeft', 'gap', 'fontSize', 'color']
      .every((k) => a[k] === b[k]),
    diff: ['height', 'borderRadius', 'backgroundColor', 'paddingLeft', 'gap', 'fontSize', 'color']
      .filter((k) => a[k] !== b[k]).map((k) => k + ':' + a[k] + '/' + b[k]),
    loaded: icon.naturalWidth > 0, iconW: icon.getBoundingClientRect().width,
    corner, arrow: Array.from(arrow),
  };
});
check('2: styled exactly like the «Добавить» main-button', looks.same, looks.diff.join(' '));
const rest = await geometry();
check('2: at rest it is laid out like one too: icon, 7px, label, 6px',
  Math.abs(rest.gap - 7) < 0.5 && Math.abs(rest.padRight - 6) < 0.5, JSON.stringify(rest));
check('2: the icon loads, 13px wide', looks.loaded && looks.iconW === 13, JSON.stringify(looks));
check('2: NO DARK SQUARE behind the icon', looks.corner === 0, looks.corner);
check('2: and the arrow itself is white', looks.arrow[0] > 240 && looks.arrow[3] > 200,
  looks.arrow.join(','));
await page.screenshot({ path: OUT + '/save-button-close.png',
  clip: await page.$eval('.save-button', (n) => {
    const r = n.getBoundingClientRect();
    return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12 };
  }) });

// ============================================================
// 3. Ctrl+S: the browser's own is suppressed, the button's runs
// ============================================================

// The harness loads nothing from a repo, so an upload is refused - which is
// exactly what shows the shortcut reached the button.
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
await wait(300);
check('3: CTRL+S IS PREVENTED - no "save page" dialog',
  prevented && (await page.evaluate(() => window.__ctrlS)) === true,
  await page.evaluate(() => window.__ctrlS));
let g = await geometry();
check('3: and it ran the button: refused, and says so', g.status === 'error' && g.label === 'Не сохранено',
  JSON.stringify(g));
check('3: the refusal is red', g.bg === 'rgb(255, 69, 58)', g.bg);
check('3: the reason is in its title',
  (await page.$eval('.save-button', (n) => n.title)).includes('нет токена'),
  await page.$eval('.save-button', (n) => n.title));

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

// ============================================================
// 4. a real upload, held mid-flight: busy, guarded, then confirmed
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

await page.click('.save-button');
await wait(300);
g = await geometry();
check('4: while it uploads it says «Сохраняю…»', g.status === 'busy' && g.label === 'Сохраняю…',
  JSON.stringify(g));
check('4: the icon is animated', await page.$eval('.save-button__icon',
  (n) => getComputedStyle(n).animationName) === 'save-button-pulse');
check('4: it stays anchored at the right edge', Math.abs(g.right - 16) <= 1, g.right);
check('4: CLOSING OR RELOADING NOW ASKS FIRST (beforeunload is held)',
  await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }));
check('4: nothing has been confirmed yet', (await page.evaluate(() => window.__commits)) === 0);
await page.screenshot({ path: OUT + '/save-button-busy.png', clip: { x: 1300, y: 0, width: 200, height: 50 } });

await page.evaluate(() => window.__release());
await wait(400);
g = await geometry();
check('4: ONLY AFTER GITHUB CONFIRMS does it say «Сохранено»',
  g.status === 'done' && g.label === 'Сохранено' && (await page.evaluate(() => window.__commits)) >= 1,
  JSON.stringify(g));
check('4: the leave-site guard is released',
  await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return !e.defaultPrevented;
  }));
check('4: nothing is left pending',
  await page.evaluate(async () => !(await import('/js/sync.js')).hasPendingChanges(
    (await import('/js/store.js')).getState())));
await page.screenshot({ path: OUT + '/save-button-done.png', clip: { x: 1300, y: 0, width: 200, height: 50 } });

await wait(2700);
g = await geometry();
check('4: and then reads «Обновить» again', g.status === 'idle' && g.label === 'Обновить', JSON.stringify(g));

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
