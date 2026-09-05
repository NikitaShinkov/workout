// Schedule_toolbar in real Chrome: the masked start-date field, the guarded
// interval field, the category switch, and the "только избранные" filter.
//
// The two fields are keyboard machines - overwrite-in-place, per-slot digit
// ranges, commit on blur - so they are driven with real key events. jsdom has
// no selection model worth the name, which is why this lives here.

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

await page.setViewport({ width: 1500, height: 800, deviceScaleFactor: 2 });
await page.goto(harness('seed=exercises'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase('fitness_app');
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.goto(harness('seed=exercises&complexes=2,1,1'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.complex');
await new Promise((r) => setTimeout(r, 700));

const dateValue = () => page.$eval('.input--date', (n) => n.value);
const intervalValue = () => page.$eval('.input--interval', (n) => n.value);
const stored = () => page.evaluate(async () => {
  const store = await import('/js/store.js');
  const c = store.activeCategory();
  return { start: c.scheduleStartDate, interval: c.intervalDays, enabled: c.scheduleEnabled };
});
const selection = () => page.$eval('.input--date', (n) => [n.selectionStart, n.selectionEnd]);
const blurAll = () => page.evaluate(() => document.activeElement.blur());

const shot = async (name, selector) => {
  const clip = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left) - 4), y: Math.max(0, Math.round(r.top) - 4),
      width: Math.round(r.width) + 8, height: Math.round(r.height) + 8,
    };
  }, selector);
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

// ---------- 1. the start date field ----------

check('1: it reads as a day and a three-letter month', (await dateValue()) === '3 сен',
  await dateValue());
await shot('toolbar-idle', '.schedule-toolbar');

await page.click('.input--date');
await new Promise((r) => setTimeout(r, 120));
check('1: clicking switches it to the numeric form', (await dateValue()) === '03.09',
  await dateValue());
check('1: and selects all of it',
  (await selection()).join(',') === '0,5', (await selection()).join(','));
await shot('toolbar-editing', '.schedule-toolbar');

// "21.10" is typed as "2110" - the dot is furniture and is stepped over.
await page.keyboard.type('2110');
check('1: four digits fill the mask, the dot untouched', (await dateValue()) === '21.10',
  await dateValue());

await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
check('1: Enter commits and shows the month name again', (await dateValue()) === '21 окт',
  await dateValue());
check('1: and the store has it', (await stored()).start === '21 окт', (await stored()).start);
check('1: the schedule follows',
  (await page.$$eval('.complex__date', (n) => n.map((d) => d.textContent))).join(',')
    === '21 окт,22 окт,23 окт',
  await page.$$eval('.complex__date', (n) => n.map((d) => d.textContent)));

// Per-slot digit ranges: day 0-3 then 0-9, month 0-1 then 0-9.
await page.click('.input--date');
await page.keyboard.type('9');            // > 3, refused at the first day slot
check('1: the first day digit refuses anything above 3', (await dateValue()) === '21.10',
  await dateValue());
await page.keyboard.type('3');
await page.keyboard.type('1');
await page.keyboard.type('5');            // > 1, refused at the first month slot
check('1: the first month digit refuses anything above 1', (await dateValue()) === '31.10',
  await dateValue());
await page.keyboard.type('1');
await page.keyboard.type('2');
check('1: the remaining slots take any digit', (await dateValue()) === '31.12',
  await dateValue());
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
check('1: 31 дек committed', (await dateValue()) === '31 дек', await dateValue());

// Letters and punctuation never reach the value.
await page.click('.input--date');
await page.keyboard.type('ab-/');
check('1: non-digits are ignored outright', (await dateValue()) === '31.12', await dateValue());

// A date the calendar does not have puts the last good one back.
await page.keyboard.type('3102');         // 31 февраля
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
check('1: AN IMPOSSIBLE DATE REVERTS to the last good one',
  (await dateValue()) === '31 дек', await dateValue());
check('1: and the store was not touched', (await stored()).start === '31 дек',
  (await stored()).start);

// Escape abandons the edit.
await page.click('.input--date');
await page.keyboard.type('0101');
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 200));
check('1: Escape abandons the edit', (await dateValue()) === '31 дек', await dateValue());

// Back to something the rest of the suite can read.
await page.click('.input--date');
await page.keyboard.type('0309');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
check('1: reset to 3 сен', (await dateValue()) === '3 сен', await dateValue());

// Editing the date must survive a live selection - the click that focuses the
// field used to re-render the page and tear the field out from under it.
await page.click('.complex .exercise-row');
await new Promise((r) => setTimeout(r, 150));
check('1: a block is selected', (await page.$$('.exercise-row--selected')).length === 1);
await page.click('.input--date');
await page.keyboard.type('0410');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
check('1: THE FIELD STILL WORKS WITH A SELECTION LIVE', (await dateValue()) === '4 окт',
  await dateValue());
await page.click('.input--date');
await page.keyboard.type('0309');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));

// ---------- 2. the interval field ----------

check('2: it starts at 1', (await intervalValue()) === '1', await intervalValue());

await page.click('.input--interval');
await page.keyboard.type('3');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
check('2: a plain number commits', (await intervalValue()) === '3', await intervalValue());
check('2: the store has it as a number', (await stored()).interval === 3, (await stored()).interval);
check('2: and the dates step by it',
  (await page.$$eval('.complex__date', (n) => n.map((d) => d.textContent))).join(',')
    === '3 сен,6 сен,9 сен',
  await page.$$eval('.complex__date', (n) => n.map((d) => d.textContent)));

// Focusing selects the value; letters are refused outright, so the selection
// survives them and the value is untouched.
await page.click('.input--interval');
await page.keyboard.type('abc');
check('2: letters never reach it', (await intervalValue()) === '3', await intervalValue());

await page.keyboard.press('Backspace');
check('2: it can still be emptied', (await intervalValue()) === '', await intervalValue());
await blurAll();
await new Promise((r) => setTimeout(r, 200));
check('2: an empty value reverts', (await intervalValue()) === '3', await intervalValue());

// The example from the spec: four digits the schedule cannot step by.
await page.click('.input--interval');
await page.keyboard.type('0542');
await blurAll();
await new Promise((r) => setTimeout(r, 200));
check('2: "0542" REVERTS TO THE LAST GOOD VALUE', (await intervalValue()) === '3',
  await intervalValue());
check('2: the store kept the old interval', (await stored()).interval === 3,
  (await stored()).interval);

await page.click('.input--interval');
await page.keyboard.type('0');
await blurAll();
await new Promise((r) => setTimeout(r, 200));
check('2: zero reverts too - the schedule cannot step by it',
  (await intervalValue()) === '3', await intervalValue());

await page.click('.input--interval');
await page.keyboard.type('1');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));

// ---------- 3. the category switch ----------

const menuOpacity = () => page.$$eval('.menu-button', (nodes) =>
  nodes.map((n) => getComputedStyle(n.querySelector('.menu-button__label')).opacity));

check('3: every category reads at full strength to begin with',
  (await menuOpacity()).every((o) => o === '1'), (await menuOpacity()).join(','));

await page.evaluate(() => {
  const input = document.querySelector('.schedule-toolbar .switch__input');
  input.checked = false;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 200));

check('3: switching the category off is stored', (await stored()).enabled === false);
const opacities = await menuOpacity();
check('3: ITS MENU BUTTON FADES TO 50%', opacities[0] === '0.5', opacities.join(','));
check('3: the other categories are untouched',
  opacities.slice(1).every((o) => o === '1'), opacities.join(','));
await shot('toolbar-category-off', '.categories');

await page.evaluate(() => {
  const input = document.querySelector('.schedule-toolbar .switch__input');
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 200));
check('3: switching it back restores the name',
  (await menuOpacity())[0] === '1', (await menuOpacity())[0]);

// ---------- 4. "только избранные" ----------

// Star the first and third exercises. They are one apiece in complexes 0 and 1.
await page.evaluate(async () => {
  const store = await import('/js/store.js');
  const ids = store.activeCategory().exercises.map((e) => e.id);
  store.toggleFavorite(ids[0]);
  store.toggleFavorite(ids[2]);
});
await new Promise((r) => setTimeout(r, 200));

const counts = () => page.evaluate(() => ({
  library: document.querySelectorAll('.column--exercise .exercise-row').length,
  complexes: document.querySelectorAll('.complex').length,
  rows: document.querySelectorAll('.complex .exercise-row').length,
  dates: [...document.querySelectorAll('.complex__date')].map((n) => n.textContent),
}));

const before = await counts();
check('4: four exercises and three complexes before filtering',
  before.library === 4 && before.complexes === 3 && before.rows === 4,
  JSON.stringify(before));

const setFavoritesOnly = (on) => page.evaluate((value) => {
  const label = [...document.querySelectorAll('.checkbox-line')]
    .find((l) => l.textContent.includes('только избранные'));
  const input = label.querySelector('.checkbox__input');
  input.checked = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, on);

await setFavoritesOnly(true);
await new Promise((r) => setTimeout(r, 200));
const filtered = await counts();

check('4: THE LIBRARY SHOWS ONLY THE FAVOURITES',
  filtered.library === 2, filtered.library);
check('4: so do the complexes', filtered.rows === 2, filtered.rows);
check('4: a complex with nothing left to show is hidden',
  filtered.complexes === 2, filtered.complexes);
check('4: the dates did NOT renumber - filtering only hides',
  filtered.dates.join(',') === before.dates.filter((_, i) => i !== 2).join(','),
  filtered.dates.join(',') + ' from ' + before.dates.join(','));
await shot('toolbar-favorites-only', '.main');

// Nothing was deleted.
const stillThere = await page.evaluate(async () => {
  const store = await import('/js/store.js');
  const c = store.activeCategory();
  return { exercises: c.exercises.length, complexes: c.complexes.length };
});
check('4: nothing was deleted',
  stillThere.exercises === 4 && stillThere.complexes === 3, JSON.stringify(stillThere));

await setFavoritesOnly(false);
await new Promise((r) => setTimeout(r, 200));
const restored = await counts();
check('4: unticking brings everything back',
  restored.library === 4 && restored.complexes === 3 && restored.rows === 4,
  JSON.stringify(restored));

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
