import puppeteer from 'puppeteer-core';
import { harness, findChrome } from '../helpers/env.mjs';
const CHROME = findChrome();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu','--no-sandbox'] });
const page = await browser.newPage();
let failures = 0; const lines = [];
const check = (n, ok, d) => { if (ok) lines.push('  PASS  ' + n); else { failures++; lines.push('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
await page.setViewport({ width: 1600, height: 900 });
await page.goto(harness('seed=text'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('fitness_app'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(harness('seed=text'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.exercise-row'); await new Promise(r => setTimeout(r, 700));

const m = await page.evaluate(() => {
  const CAP = 8.7, LINE = 14.5, PAD = 4;
  return [...document.querySelectorAll('.exercise-row')].map(row => {
    const t = row.querySelector('.exercise-row__title');
    const d = row.querySelector('.exercise-row__subtitle');
    const bx = row.querySelector('.exercise-row__subtitle-box');
    const ct = getComputedStyle(t), cd = getComputedStyle(d), cb = getComputedStyle(bx);
    const tb = t.getBoundingClientRect(), db = d.getBoundingClientRect(), bb = bx.getBoundingClientRect();
    const rb = row.getBoundingClientRect();
    return {
      titleH: +tb.height.toFixed(1),
      titleTruncated: t.scrollWidth > t.clientWidth,
      titleWs: ct.whiteSpace, titleTo: ct.textOverflow, titleOv: ct.overflow,
      titlePad: parseFloat(ct.paddingTop),
      // headroom = clip top is this far above the first cap line
      titleHeadroom: parseFloat(ct.paddingTop),
      descH: +db.height.toFixed(1),
      descLinesRendered: Math.round((db.height - PAD - CAP) / LINE) + 1,
      descPad: parseFloat(cd.paddingTop),
      descClamp: cd.webkitLineClamp,
      // the bug: child padding pushed above a clipping parent
      descPaddingInsideBox: db.top >= bb.top - 0.1,
      boxMarginTop: parseFloat(cb.marginTop),
      descWithinBox: db.bottom <= bb.bottom + 0.1,
      descWithinRow: db.bottom <= rb.bottom - 8 + 0.1 && db.top >= rb.top,
      titleWithinRow: tb.top >= rb.top,
    };
  });
});
lines.push('\n' + JSON.stringify(m, null, 1) + '\n');

// 1. one-line title, truncated with an ellipsis
check('1: title is nowrap', m.every(r => r.titleWs === 'nowrap'));
check('1: title has text-overflow: ellipsis', m.every(r => r.titleTo === 'ellipsis'));
check('1: title clips its overflow', m.every(r => r.titleOv === 'hidden'));
check('1: title renders exactly one line (8.7 cap + 4 pad)',
  m.every(r => Math.abs(r.titleH - 12.7) < 0.6), m.map(r => r.titleH).join('/'));
check('1: an over-long title is truncated', m[1].titleTruncated === true);
check('1: a short title is not truncated', m[0].titleTruncated === false);

// 2. diacritics above cap height are not clipped
check('2: title has clip headroom for diacritics', m.every(r => r.titlePad >= 3), m[0].titlePad);
check('2: description has clip headroom', m.every(r => r.descPad >= 3), m[0].descPad);
check('2: that headroom is NOT clipped away by the wrapper',
  m.every(r => r.descPaddingInsideBox), m.map(r => r.descPaddingInsideBox).join('/'));
check('2: the wrapper compensates with a negative margin',
  m.every(r => r.boxMarginTop === -4), m[0].boxMarginTop);
check('2: the title still starts inside the row', m.every(r => r.titleWithinRow));

// 3. at most 2 rendered lines, nothing spills
check('3: clamp is set to 2 lines', m.every(r => r.descClamp === '2'), m[0].descClamp);
check('3: description renders at most 2 lines',
  m.every(r => r.descLinesRendered <= 2), m.map(r => r.descLinesRendered).join('/'));
check('3: the long description renders exactly 2 lines',
  m[1].descLinesRendered === 2, m[1].descLinesRendered);
check('3: description never exceeds its box', m.every(r => r.descWithinBox));
check('3: description never spills past the row content box',
  m.every(r => r.descWithinRow), m.map(r => r.descWithinRow).join('/'));

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL TEXT CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
