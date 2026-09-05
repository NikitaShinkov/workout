// Page_selector and the calendar page.
//
// Switching pages tears one page down and builds another, so the things worth
// checking are that nothing survives the swap - no doubled headers, no stale
// store subscription rendering underneath - and that the calendar lays a day
// out from every category at once.

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
await page.goto(harness('seed=exercises&complexes=2,1,1&multi'), { waitUntil: 'networkidle2' });
await page.waitForSelector('.complex');
await new Promise((r) => setTimeout(r, 800));

const shot = async (name, selector) => {
  const clip = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left) - 4), y: Math.max(0, Math.round(r.top) - 4),
      width: Math.round(r.width) + 8, height: Math.min(520, Math.round(r.height) + 8),
    };
  }, selector);
  await page.screenshot({ path: OUT + '/' + name + '.png', clip });
};

// The buttons carry icons, not text, so they are addressed by data-page and
// named by the aria-label the icon needs anyway.
const buttonLabels = () =>
  page.$$eval('.page-button', (n) => n.map((b) => b.getAttribute('aria-label')));
// Null on the schedule page: it has no button of its own, so nothing is active.
const activePage = () => page.evaluate(() => {
  const active = document.querySelector('.page-button--active');
  return active ? active.dataset.page : null;
});
const style = (selector, prop) => page.evaluate((s, p) => {
  const n = document.querySelector(s);
  return n ? getComputedStyle(n)[p] : null;
}, selector, prop);

// ---------- 1. the selector ----------

check('1: it sits in the header before the categories', await page.evaluate(() => {
  const selector = document.querySelector('.page-selector');
  const list = document.querySelector('.category-list');
  return Boolean(selector) && Boolean(list)
    && (selector.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}));
check('1: TWO BUTTONS - CALENDAR AND WORKOUT, NO SCHEDULE',
  (await buttonLabels()).join(',') === 'Календарь,Тренировка', (await buttonLabels()).join(','));
check('1: on the schedule page nothing in the selector is active',
  (await activePage()) === null, await activePage());

// Page_selector and Category_list carry the same shell.
for (const selector of ['.page-selector', '.category-list']) {
  check('1: ' + selector + ' has the hover_bg ground',
    (await style(selector, 'backgroundColor')) === 'rgb(29, 29, 29)',
    await style(selector, 'backgroundColor'));
  check('1: ' + selector + ' has the stroke border',
    (await style(selector, 'borderTopColor')) === 'rgb(82, 82, 82)'
      && (await style(selector, 'borderTopWidth')) === '1px',
    await style(selector, 'borderTopColor') + ' ' + await style(selector, 'borderTopWidth'));
  check('1: ' + selector + ' is rounded 6px',
    (await style(selector, 'borderRadius')) === '6px', await style(selector, 'borderRadius'));
}
// Each button is an exported icon, drawn as a mask so one white file can also
// go black on the active button's white ground.
const icons = await page.evaluate(() => [...document.querySelectorAll('.page-button')].map((b) => {
  const icon = b.querySelector('.page-button__icon');
  const style = getComputedStyle(icon);
  const box = icon.getBoundingClientRect();
  return {
    page: b.dataset.page,
    mask: (style.maskImage || style.webkitMaskImage || '').replace(/^.*\/assets/, 'assets')
      .replace(/["')].*$/, ''),
    color: style.backgroundColor,
    size: +box.width.toFixed(0) + 'x' + +box.height.toFixed(0),
    text: b.textContent.trim(),
  };
}));
lines.push('\nicons: ' + JSON.stringify(icons, null, 0) + '\n');

check('1: THE BUTTONS CARRY ICONS, NOT TEXT', icons.every((i) => i.text === ''),
  icons.map((i) => i.text).join('|'));
check('1: each uses its own exported asset',
  icons[0].mask === 'assets/icons/Page_selector_calendar.svg'
    && icons[1].mask === 'assets/icons/Page_selector_workout.svg',
  icons.map((i) => i.mask).join(' | '));
check('1: each keeps its exported size',
  icons[0].size === '12x12' && icons[1].size === '15x12',
  icons.map((i) => i.size).join(' | '));
check('1: an inactive icon is white', icons[0].color === 'rgb(255, 255, 255)', icons[0].color);
check('1: the unbuilt page reads as unavailable',
  icons[1].color === 'rgb(91, 91, 98)', icons[1].color);

await shot('pages-header', '.header');

// The third page is not built: clicking it must go nowhere.
await page.evaluate(() => {
  [...document.querySelectorAll('.page-button')]
    .find((b) => b.dataset.page === 'workout').click();
});
await new Promise((r) => setTimeout(r, 250));
check('1: THE WORKOUT BUTTON DOES NOT NAVIGATE', (await activePage()) === null,
  await activePage());
check('1: and the schedule page is still the one rendered',
  (await page.$$('.column--exercise')).length === 1);

// ---------- 2. switching to the calendar ----------

await page.evaluate(() => {
  [...document.querySelectorAll('.page-button')]
    .find((b) => b.dataset.page === 'calendar').click();
});
await new Promise((r) => setTimeout(r, 350));

check('2: the calendar is active', (await activePage()) === 'calendar', await activePage());
check('2: THE ACTIVE ICON INVERTS TO BLACK on the white ground',
  (await page.$eval('.page-button--active .page-button__icon',
    (n) => getComputedStyle(n).backgroundColor)) === 'rgb(0, 0, 0)',
  await page.$eval('.page-button--active .page-button__icon',
    (n) => getComputedStyle(n).backgroundColor));
check('2: exactly one header survived the swap',
  (await page.$$('.header')).length === 1, (await page.$$('.header')).length);
check('2: exactly one page selector', (await page.$$('.page-selector')).length === 1);
check('2: the exercise column is gone', (await page.$$('.column--exercise')).length === 0);

// The categories come with it, as navigation.
const headerCategories = () => page.$$eval('.header .category-list .menu-button',
  (n) => n.map((b) => b.querySelector('.menu-button__label').textContent));
check('2: THE CATEGORY LIST IS IN THE HEADER',
  (await headerCategories()).length === 7, (await headerCategories()).length);
check('2: and the add-category button',
  (await page.$$('.add-category-button')).length === 1);
check('2: none of them is drawn active - the calendar is not scoped to one',
  (await page.$$('.header .category-list .menu-button--active')).length === 0);
check('2: they carry no close button or rename input',
  (await page.$$('.header .menu-button__close, .header .menu-button__input')).length === 0);

// ---------- 2b. the header button is the SAME button on both pages ----------
//
// It used to be built here from bare text rather than the sizer/label pair the
// schedule page uses. Two bugs came out of that single difference.

const labelBox = () => page.$eval('.header .category-list .menu-button__label', (n) => {
  const button = n.closest('.menu-button');
  const b = n.getBoundingClientRect();
  const outer = button.getBoundingClientRect();
  return {
    // Where the name sits inside its button, which is what the eye catches.
    offset: +(b.top - outer.top).toFixed(1),
    height: +b.height.toFixed(1),
    lineHeight: getComputedStyle(n).lineHeight,
  };
});

const onCalendar = await labelBox();
await page.evaluate(() => {
  document.querySelectorAll('.header .category-list .menu-button')[0].click();
});
await new Promise((r) => setTimeout(r, 350));
const onSchedule = await labelBox();
await page.evaluate(() => {
  [...document.querySelectorAll('.page-button')].find((b) => b.dataset.page === 'calendar').click();
});
await new Promise((r) => setTimeout(r, 350));

lines.push('\nlabel box - calendar ' + JSON.stringify(onCalendar)
  + ' schedule ' + JSON.stringify(onSchedule) + '\n');
check('2b: THE NAME SITS AT THE SAME HEIGHT ON BOTH PAGES - no 1-2px jump',
  Math.abs(onCalendar.offset - onSchedule.offset) < 0.2
    && Math.abs(onCalendar.height - onSchedule.height) < 0.2,
  JSON.stringify(onCalendar) + ' vs ' + JSON.stringify(onSchedule));
check('2b: both centre it by line-height, not by the flex box',
  onCalendar.lineHeight === '24px' && onSchedule.lineHeight === '24px',
  onCalendar.lineHeight + ' / ' + onSchedule.lineHeight);

// ---------- 2c. a category out of the schedule stays faded here ----------

const fadeOf = (name) => page.evaluate((wanted) => {
  const label = [...document.querySelectorAll('.header .category-list .menu-button__label')]
    .find((n) => n.textContent === wanted);
  return label ? getComputedStyle(label).opacity : null;
}, name);

const victim = (await headerCategories())[2];
check('2c: it reads at full strength to begin with', (await fadeOf(victim)) === '1',
  await fadeOf(victim));

await page.evaluate(async (name) => {
  const store = await import('/js/store.js');
  const id = store.getState().categoryOrder
    .find((key) => store.getState().categories[key].name === name);
  store.getState().categories[id].scheduleEnabled = false;
  store.setUiFlag('showFavorites', store.getState().ui.showFavorites); // force a render
}, victim);
await new Promise((r) => setTimeout(r, 250));

check('2c: SWITCHING ITS SCHEDULE OFF FADES IT ON THE CALENDAR TOO',
  (await fadeOf(victim)) === '0.5', await fadeOf(victim));
check('2c: the others are untouched',
  (await fadeOf((await headerCategories())[1])) === '1');
await shot('calendar-category-off', '.header');

// And it survives the trip to the schedule page and back.
await page.evaluate(() => {
  document.querySelectorAll('.header .category-list .menu-button')[0].click();
});
await new Promise((r) => setTimeout(r, 350));
check('2c: still faded on the schedule page', (await fadeOf(victim)) === '0.5',
  await fadeOf(victim));

await page.evaluate(async (name) => {
  const store = await import('/js/store.js');
  const id = store.getState().categoryOrder
    .find((key) => store.getState().categories[key].name === name);
  store.getState().categories[id].scheduleEnabled = true;
  store.setUiFlag('showFavorites', store.getState().ui.showFavorites);
}, victim);
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(() => {
  [...document.querySelectorAll('.page-button')].find((b) => b.dataset.page === 'calendar').click();
});
await new Promise((r) => setTimeout(r, 350));
check('2: the two icon buttons are there',
  (await page.$$('.view-options .icon-button')).length === 2,
  (await page.$$('.view-options .icon-button')).length);
check('2: and neither checkbox', (await page.$$('.view-options .checkbox-line')).length === 0);

const toolbar = await page.$eval('.schedule-toolbar', (n) => n.textContent);
check('2: the toolbar reads "Календарь с ... по ..."', /^Календарь с .+ по .+$/.test(toolbar),
  toolbar);
check('2: no schedule switch or fields in it',
  (await page.$$('.schedule-toolbar .switch, .schedule-toolbar .input')).length === 0);

// ---------- 3. the days ----------

const days = await page.evaluate(() => [...document.querySelectorAll('.complex-list .complex')].map((c) => ({
  date: c.querySelector('.complex__date').textContent,
  tabs: [...c.querySelectorAll('.category-block .menu-button__label')].map((b) => b.textContent),
  active: c.querySelector('.category-block .menu-button--active .menu-button__label').textContent,
  rows: c.querySelectorAll('.exercise-row').length,
  hasSwitch: Boolean(c.querySelector('.switch')),
  sideDraggable: c.querySelector('.complex__side').getAttribute('draggable'),
  rowDraggable: [...c.querySelectorAll('.exercise-row')].map((r) => r.getAttribute('draggable')),
})));

lines.push('\ndays: ' + JSON.stringify(days, null, 0) + '\n');

check('3: three complexes in one category and two in the other = three days',
  days.length === 3, days.length);
check('3: the dates run consecutively',
  days.map((d) => d.date).join(',') === '3 сен,4 сен,5 сен', days.map((d) => d.date).join(','));
check('3: A DAY LISTS EVERY CATEGORY SCHEDULED FOR IT',
  days[0].tabs.length === 2 && days[1].tabs.length === 2, JSON.stringify(days.map((d) => d.tabs)));
check('3: the last day has only the category that reaches it',
  days[2].tabs.length === 1, days[2].tabs.join(','));
check('3: the first tab is open by default', days[0].active === days[0].tabs[0], days[0].active);
check('3: THE SIDE BLOCK HAS NO SWITCH', days.every((d) => d.hasSwitch === false));
check('3: nothing on the page drags',
  days.every((d) => d.sideDraggable === null && d.rowDraggable.every((v) => v === 'false')),
  JSON.stringify(days.map((d) => [d.sideDraggable, d.rowDraggable])));
check('3: the date pointer is still drawn', (await page.$$('.date-pointer')).length === 1);
await shot('calendar-page', '.page');

// Switching the tab swaps which category's blocks the day shows.
const firstDayRows = () => page.evaluate(() => {
  const day = document.querySelector('.complex');
  return [...day.querySelectorAll('.exercise-row__title')].map((t) => t.textContent);
});
const before = await firstDayRows();
await page.evaluate(() => {
  const day = document.querySelector('.complex');
  [...day.querySelectorAll('.category-block .menu-button')]
    .find((b) => !b.classList.contains('menu-button--active')).click();
});
await new Promise((r) => setTimeout(r, 250));
const after = await firstDayRows();

check('3: THE TAB SWITCHES THE DAY TO THE OTHER CATEGORY',
  after.join(',') !== before.join(','), before.join(',') + ' -> ' + after.join(','));
check('3: only that day changed - the others keep their own tab',
  (await page.$eval('.complex:last-of-type .category-block .menu-button--active',
    (n) => n.textContent)).length > 0);
await shot('calendar-tab-switched', '.complex-list');

// ---------- 4. back to the schedule ----------

// There is no schedule button any more: a category IS the way back, and it
// takes that category's schedule with it. Index 1 is the one &multi seeded, so
// it has exercises - an empty category would land on the empty state, which is
// correct but tells us less.
const target = await page.$$eval('.header .category-list .menu-button',
  (n) => n[1].querySelector('.menu-button__label').textContent);
await page.evaluate((name) => {
  [...document.querySelectorAll('.header .category-list .menu-button')]
    .find((b) => b.querySelector('.menu-button__label').textContent === name).click();
}, target);
await new Promise((r) => setTimeout(r, 350));

check('4: the schedule is back', (await page.$$('.column--exercise')).length === 1);
check('4: nothing in the selector is active again', (await activePage()) === null,
  await activePage());
check('4: PICKING A CATEGORY OPENED THAT ONE',
  (await page.$eval('.menu-button--active .menu-button__sizer', (n) => n.textContent)) === target,
  await page.$eval('.menu-button--active .menu-button__sizer', (n) => n.textContent));
check('4: and the store agrees', await page.evaluate(async (name) => {
  const store = await import('/js/store.js');
  return store.activeCategory().name === name;
}, target));
check('4: still exactly one header', (await page.$$('.header')).length === 1);
check('4: the full category buttons are back', (await page.$$('.menu-button__sizer')).length > 0);
check('4: and both columns', (await page.$$('.column')).length === 2,
  (await page.$$('.column')).length);
check('4: no day tabs left over', (await page.$$('.category-block')).length === 0);

// A stale subscription from the calendar would render it again underneath.
await page.evaluate(async () => {
  const store = await import('/js/store.js');
  store.setUiFlag('showFavorites', true);
});
await new Promise((r) => setTimeout(r, 250));
check('4: A MUTATION RENDERS ONE PAGE, NOT TWO',
  (await page.$$('.header')).length === 1 && (await page.$$('.column--exercise')).length === 1,
  (await page.$$('.header')).length + ' headers');

// ---------- 5. adding a category from the calendar ----------

await page.evaluate(() => {
  [...document.querySelectorAll('.page-button')].find((b) => b.dataset.page === 'calendar').click();
});
await new Promise((r) => setTimeout(r, 350));
const countBefore = (await headerCategories()).length;

await page.click('.add-category-button');
await new Promise((r) => setTimeout(r, 400));

// A brand new category has no exercises, so the schedule page lands on its
// empty state - the sizer spans are what say we are on that page at all, since
// the calendar's category buttons carry none.
check('5: adding a category leaves the calendar for the schedule',
  (await page.$$('.menu-button__sizer')).length > 0
    && (await page.$$('.complex-list')).length === 0,
  (await page.$$('.menu-button__sizer')).length + ' sizers');
check('5: the new category was created',
  (await page.$$eval('.menu-button__sizer', (n) => n.length)) === countBefore + 1,
  await page.$$eval('.menu-button__sizer', (n) => n.length));
check('5: IT OPENS STRAIGHT INTO NAME EDITING, as it does on the schedule page',
  (await page.$$('.menu-button__input')).length === 1);
check('5: with the name preselected',
  await page.$eval('.menu-button__input',
    (n) => n.selectionStart === 0 && n.selectionEnd === n.value.length));

await page.keyboard.type('Плечи');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 300));
check('5: the typed name is saved',
  (await page.$eval('.menu-button--active .menu-button__sizer', (n) => n.textContent)) === 'Плечи',
  await page.$eval('.menu-button--active .menu-button__sizer', (n) => n.textContent));
await shot('calendar-added-category', '.header');

check('no page errors', errs.length === 0, errs.join(' | '));

console.log(lines.join('\n'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
