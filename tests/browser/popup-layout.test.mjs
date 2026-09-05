import puppeteer from 'puppeteer-core';
import { OUT, BASE, harness, findChrome } from '../helpers/env.mjs';
const CHROME = findChrome();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu','--no-sandbox'] });
let failures = 0; const lines = [];
const check = (n, ok, d) => { if (ok) lines.push('  PASS  ' + n); else { failures++; lines.push('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };

async function shot(name, count) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(harness('popup=' + count), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('fitness_app'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.goto(harness('popup=' + count), { waitUntil: 'networkidle2' });
  await page.waitForSelector('.popup .image-thumb', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 500));
  const m = await page.evaluate(() => {
    const box = s => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      popup: box('.popup'),
      preview: box('.animation-preview'),
      thumb: box('.image-thumb'),
      lines: document.querySelectorAll('.images-preview-line').length,
      real: document.querySelectorAll('.image-thumb:not(.image-thumb--reserved)').length,
      reserved: document.querySelectorAll('.image-thumb--reserved').length,
      equip: document.querySelectorAll('.equipment-options .checkbox-line').length,
      label: box('.field__label'),
      textarea: box('.input--textarea'),
      button: document.querySelector('.popup .main-button').textContent,
      lineGap: (() => { const ls = document.querySelectorAll('.images-preview-line'); if (ls.length < 2) return null;
        return Math.round(ls[1].getBoundingClientRect().top - ls[0].getBoundingClientRect().bottom); })(),
      thumbGap: (() => { const t = document.querySelectorAll('.images-preview-line')[0].querySelectorAll('.image-thumb');
        return Math.round(t[1].getBoundingClientRect().left - t[0].getBoundingClientRect().right); })(),
    };
  });
  await page.screenshot({ path: OUT + '/' + name + '.png' });
  await page.close();
  return { m, errs };
}

const two = await shot('popup-2', 2);
lines.push('\n2 images: ' + JSON.stringify(two.m) + '\n');
check('popup is 600px wide', two.m.popup.w === 600, two.m.popup.w);
check('label column is 70px', two.m.label.w === 70, two.m.label.w);
check('preview keeps the 52/29 ratio', Math.abs(two.m.preview.w / two.m.preview.h - 52/29) < 0.02, (two.m.preview.w/two.m.preview.h).toFixed(3));
check('thumbnails keep the 52/29 ratio', Math.abs(two.m.thumb.w / two.m.thumb.h - 52/29) < 0.03, (two.m.thumb.w/two.m.thumb.h).toFixed(3));
check('thumbnail gap is 4px', two.m.thumbGap === 4, two.m.thumbGap);
check('2 images -> one line', two.m.lines === 1, two.m.lines);
check('2 real + 2 reserved slots', two.m.real === 2 && two.m.reserved === 2, two.m.real + '/' + two.m.reserved);
check('textarea is 100px tall', two.m.textarea.h === 100, two.m.textarea.h);
check('8 equipment rows', two.m.equip === 8, two.m.equip);
check('create-mode label', two.m.button === 'Добавить упражнение', two.m.button);
check('no popup errors (2)', two.errs.length === 0, two.errs.join(' | '));

const seven = await shot('popup-7', 7);
lines.push('7 images: ' + JSON.stringify(seven.m) + '\n');
check('7 images -> two lines', seven.m.lines === 2, seven.m.lines);
check('7 real + 1 reserved', seven.m.real === 7 && seven.m.reserved === 1, seven.m.real + '/' + seven.m.reserved);
check('gap between lines is 8px', seven.m.lineGap === 8, seven.m.lineGap);
check('no popup errors (7)', seven.errs.length === 0, seven.errs.join(' | '));

await browser.close();
console.log(lines.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL POPUP LAYOUT CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
