import puppeteer from 'puppeteer-core';
import { OUT, BASE, harness, findChrome } from '../helpers/env.mjs';
const CHROME = findChrome();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu','--no-sandbox'] });
let failures = 0; const lines = [];
const check = (n, ok, d) => { if (ok) lines.push('  PASS  ' + n); else { failures++; lines.push('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };

const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 1600, height: 900 });
await page.goto(harness('seed=exercises'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('fitness_app'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(harness('seed=exercises&extras'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.exercise-row .indicators');
await new Promise(r => setTimeout(r, 600));

const m = await page.evaluate(() => {
  const box = s => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
  const rows = [...document.querySelectorAll('.exercise-row')];
  const cs = s => getComputedStyle(document.querySelector(s));
  const t = document.querySelector('.exercise-row__title');
  const d = document.querySelector('.exercise-row__subtitle');
  return {
    rowH: box('.exercise-row').h,
    rowPadding: cs('.exercise-row').padding,
    listGap: cs('.exercise-list').rowGap,
    rowPitch: rows.length > 1 ? +(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top).toFixed(1) : null,
    rowSeam: rows.length > 1 ? +(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom).toFixed(1) : null,
    // Box height is cap height plus the 4px headroom that keeps diacritics
    // inside the overflow clip.
    titleH: +t.getBoundingClientRect().height.toFixed(1),
    titlePad: parseFloat(getComputedStyle(t).paddingTop),
    titleTrim: cs('.exercise-row__title').textBoxTrim || cs('.exercise-row__title').webkitTextBoxTrim,
    titleEdge: cs('.exercise-row__title').textBoxEdge,
    titlePadBottom: parseFloat(getComputedStyle(t).paddingBottom),
    // Content-edge gap: the raw box edges sit closer together because the clip
    // headroom lives inside each box - above the title's cap edge, below its
    // baseline edge, and above the description's cap edge.
    titleToDesc: +(d.getBoundingClientRect().top + parseFloat(getComputedStyle(d).paddingTop)
      - (t.getBoundingClientRect().bottom - parseFloat(getComputedStyle(t).paddingBottom))
    ).toFixed(1),
    imageBox: box('.exercise-row__image-box'),
    indicatorLabelH: +document.querySelector('.indicator__label').getBoundingClientRect().height.toFixed(1),
    toolbarLabelH: +document.querySelector('.toolbar-label').getBoundingClientRect().height.toFixed(1),
    menuButtonH: box('.menu-button').h,
    cellBg: getComputedStyle(document.querySelector('.color-line__cell')).backgroundColor,
    draggable: document.querySelector('.exercise-row').getAttribute('draggable'),
  };
});
lines.push('\nmeasured: ' + JSON.stringify(m, null, 0) + '\n');

// 1. cap-height trim
check('1: title uses text-box-trim: trim-both', m.titleTrim === 'trim-both', m.titleTrim);
check('1: title edge is cap alphabetic', /cap/.test(m.titleEdge) && /alphabetic/.test(m.titleEdge), m.titleEdge);
// Headroom at both edges: the cap edge would shave diacritics off the top and
// the baseline edge would shave descenders off the bottom.
check('1: title is one cap-height line plus clip headroom at both edges',
  Math.abs(m.titleH - (8.7 + m.titlePad + m.titlePadBottom)) < 0.6,
  m.titleH + ' pad ' + m.titlePad + '/' + m.titlePadBottom);
check('1: the title has descender room below the baseline edge',
  m.titlePadBottom >= 3, m.titlePadBottom);
check('1: title-to-description gap is the specified 8px', Math.abs(m.titleToDesc - 8) < 0.6, m.titleToDesc);
check('1: indicator label also trimmed to cap height', m.indicatorLabelH < 10.5, m.indicatorLabelH);
check('1: toolbar label also trimmed', m.toolbarLabelH < 10.5, m.toolbarLabelH);
check('1: menu button keeps its 24px height', Math.abs(m.menuButtonH - 24) < 0.6, m.menuButtonH);

// 2. padding + gap
check('2: row padding is 8px 10px', m.rowPadding === '8px 10px', m.rowPadding);
check('2: exercise-list gap removed', m.listGap === 'normal' || m.listGap === '0px', m.listGap);
check('2: rows are contiguous (no seam)', m.rowSeam === 0, m.rowSeam);
check('2: row is 66px tall', Math.abs(m.rowH - 66) < 0.6, m.rowH);
check('2: pitch still matches the design 66px', Math.abs(m.rowPitch - 66) < 0.6, m.rowPitch);
check('2: the 50px image still fits', m.imageBox.h === 50 && m.imageBox.w === 89, m.imageBox.w + 'x' + m.imageBox.h);

// 6. not-selected grey
check('6: empty indicator slot is rgb(91,91,98)', m.cellBg === 'rgb(91, 91, 98)', m.cellBg);

// 5. draggable rows
check('5: rows are draggable in the browser', m.draggable === 'true', m.draggable);

// 4. hover animation in a real browser
await page.hover('.exercise-row');
await new Promise(r => setTimeout(r, 700));
const hover = await page.evaluate(() => ({
  anim: Boolean(document.querySelector('.exercise-row .seq-anim__img')),
  stillHidden: document.querySelector('.exercise-row .exercise-row__image').hidden,
  src: (document.querySelector('.exercise-row .seq-anim__img') || {}).src || '',
}));
check('4: hovering shows the animation in the browser', hover.anim && hover.stillHidden,
  JSON.stringify(hover));
await page.screenshot({ path: OUT + '/rows-hover.png' });

await page.mouse.move(10, 500);
await new Promise(r => setTimeout(r, 300));
const off = await page.evaluate(() => ({
  anim: Boolean(document.querySelector('.exercise-row .seq-anim__img')),
  stillHidden: document.querySelector('.exercise-row .exercise-row__image').hidden,
}));
check('4: leaving restores the still image in the browser', !off.anim && !off.stillHidden, JSON.stringify(off));

await page.screenshot({ path: OUT + '/rows-final.png' });
check('no page errors', errs.length === 0, errs.join(' | '));
await page.close();
await browser.close();
console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL LAYOUT CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
