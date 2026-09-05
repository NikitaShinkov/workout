import puppeteer from 'puppeteer-core';
import { OUT, BASE, harness, findChrome } from '../helpers/env.mjs';
const CHROME = findChrome();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu','--no-sandbox'] });
let failures = 0; const lines = [];
const check = (n, ok, d) => { if (ok) lines.push('  PASS  ' + n); else { failures++; lines.push('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };

const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 4 });
await page.goto(harness('popup=1'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('fitness_app'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.goto(harness('popup=1'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.equipment-options .checkbox-line'); await new Promise(r => setTimeout(r, 800));

const m = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.checkbox-line__label')];
  return all.map(l => {
    const cs = getComputedStyle(l);
    const r = l.getBoundingClientRect();
    return {
      text: l.textContent,
      trim: cs.textBoxTrim, edge: cs.textBoxEdge,
      h: +r.height.toFixed(1),
      // full line box (~14.5px) means ascent+descent are inside the clip;
      // ~8.7px would mean the box was trimmed to cap height and clips glyphs
      clipsGlyphs: r.height < 12,
      overflow: cs.overflow,
    };
  });
});
lines.push('\n' + JSON.stringify(m, null, 1) + '\n');

check('labels use standard trim', m.every(l => l.trim === 'none'), m[0].trim);
check('label boxes are the full line box, not cap height',
  m.every(l => !l.clipsGlyphs), m.map(l => l.h).join('/'));
check('ellipsis capability retained', m.every(l => l.overflow === 'hidden'));
check('all 10 labels checked (2 view options + 8 equipment)', m.length === 10, m.length);

// crop the equipment list and the view options for a visual read
const eq = await page.evaluate(() => {
  const f = document.querySelector('.equipment-options').getBoundingClientRect();
  return { x: Math.round(f.left - 4), y: Math.round(f.top - 4), width: Math.round(f.width / 2), height: Math.round(f.height + 8) };
});
await page.screenshot({ path: OUT + '/cbx-equipment.png', clip: eq });
const vo = await page.evaluate(() => {
  const f = document.querySelector('.view-options').getBoundingClientRect();
  return { x: Math.round(f.left), y: Math.round(f.top - 3), width: Math.round(f.width), height: Math.round(f.height + 6) };
});
await page.screenshot({ path: OUT + '/cbx-viewoptions.png', clip: vo });

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL CHECKBOX LABEL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
