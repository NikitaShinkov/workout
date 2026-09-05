// Complex_list: building complexes, dragging blocks in and between them,
// the schedule dates, the Switch, the filter checkbox and Del.
//
// jsdom has no layout engine, so every drag test installs a fake one first -
// see layout() - because all of this code decides what a drop means from the
// geometry of what is under the cursor.

import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

import { PROJECT } from '../helpers/env.mjs';
const mod = (p) => import(pathToFileURL(PROJECT + '/js/' + p).href);

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.Blob = dom.window.Blob;
let urlCounter = 0;
global.URL.createObjectURL = () => 'blob:' + (++urlCounter);

let failures = 0;
const results = [];
function check(name, ok, detail) {
  if (ok) results.push('  PASS  ' + name);
  else { failures += 1; results.push('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

const errors = [];
console.error = (...a) => errors.push(a.map(String).join(' '));

const store = await mod('store.js');
const { mountSchedulePage } = await mod('schedule-page.js');
const { createExercise } = await mod('model.js');

await store.initStore();
mountSchedulePage(document.getElementById('app'));

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const blob = () => new dom.window.Blob(['x'], { type: 'image/jpeg' });

const NAMES = ['Первое', 'Второе', 'Третье', 'Четвёртое', 'Пятое'];
for (const name of NAMES) {
  store.addExercise(createExercise({ name, description: name, images: [blob()], equipment: ['mat'] }));
}

const category = () => store.activeCategory();
const complexes = () => category().complexes;
const libraryRows = () => $$('.column--exercise .exercise-row');
const complexNodes = () => $$('.complex-list .complex');
const complexRows = () => $$('.complex-list .exercise-row');
const dates = () => $$('.complex__date').map((n) => n.textContent);

// The names inside each complex, as "a+b | c" - the whole schedule in one line.
function shape() {
  const byId = new Map(category().exercises.map((e) => [e.id, e.name]));
  return complexes()
    .map((complex) => complex.items.map((item) => byId.get(item.exerciseId)).join('+'))
    .join(' | ');
}

// ---------- a fake layout engine ----------
//
// Every complex is as tall as its rows, and they are stacked flush. Rects are
// assigned after each render, so clientY in a drag event means the same thing
// it would in a browser.
function setRect(node, top, height) {
  node.getBoundingClientRect = () => ({
    top, height, bottom: top + height, left: 0, right: 900, width: 900,
  });
}

const ROW_H = 66;
function layout() {
  let y = 0;
  for (const complexNode of complexNodes()) {
    const rows = Array.from(complexNode.querySelectorAll('.exercise-row'));
    setRect(complexNode, y, rows.length * ROW_H);
    rows.forEach((row, i) => setRect(row, y + i * ROW_H, ROW_H));
    y += rows.length * ROW_H;
  }
  libraryRows().forEach((row, i) => setRect(row, i * ROW_H, ROW_H));
}

// Must match BOUNDARY_BAND in schedule-page.js.
const BAND = 12;

// Halves of a complex row, kept clear of the boundary bands at a complex's
// outer edges - these mean "into this complex, above / below this block".
const rowTop = (i) => complexRows()[i].getBoundingClientRect().top + BAND + 4;
const rowBottom = (i) => complexRows()[i].getBoundingClientRect().bottom - BAND - 4;

// The boundary bands themselves: the top edge of a complex's first row and the
// bottom edge of its last, which mean "a new complex here". Each comes with the
// row the cursor would actually be over.
const firstRowOf = (i) => complexNodes()[i].querySelector('.exercise-row');
const lastRowOf = (i) => {
  const rows = complexNodes()[i].querySelectorAll('.exercise-row');
  return rows[rows.length - 1];
};
const boundaryBefore = (i) => complexNodes()[i].getBoundingClientRect().top + 1;
const boundaryAfter = (i) => complexNodes()[i].getBoundingClientRect().bottom - 1;
// Past the end of every complex, in the empty space below the list.
const belowAll = () => 99999;

function transfer() {
  const bag = {};
  return {
    effectAllowed: '', dropEffect: '',
    setData(k, v) { bag[k] = String(v); },
    getData(k) { return bag[k]; },
    setDragImage() {},
  };
}

function fire(node, type, dt, clientY) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  Object.defineProperty(event, 'clientY', { value: clientY });
  node.dispatchEvent(event);
  return event;
}

// Drag `from` onto the complex list and drop at clientY. `over` is the node the
// cursor is actually above, which is what decides the kind of drop.
function dragTo(from, over, clientY) {
  const dt = transfer();
  fire(from, 'dragstart', dt, 0);
  fire(over, 'dragover', dt, clientY);
  fire(over, 'drop', dt, clientY);
  fire(from, 'dragend', dt, clientY);
  layout();
}

// Both of these re-render, which throws away the nodes the fake rects were
// installed on - so the layout has to be laid out again straight after.
function click(node, init) {
  node.dispatchEvent(new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, init)));
  layout();
}

function key(init) {
  document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init)));
  layout();
}

// Flip a checkbox or switch input and let the change handler re-render.
function toggle(input, checked) {
  input.checked = checked;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  layout();
}

// ---------- 1. Ctrl+G groups a library selection ----------

layout();
click(libraryRows()[0]);
click(libraryRows()[1], { ctrlKey: true });
key({ code: 'KeyG', ctrlKey: true });
layout();

check('1: Ctrl+G made one complex', complexes().length === 1, complexes().length);
check('1: it holds both selected exercises', shape() === 'Первое+Второе', shape());
check('1: the library still has all five rows', libraryRows().length === 5, libraryRows().length);
check('1: two rows rendered inside the complex', complexRows().length === 2, complexRows().length);

// Ctrl+G with nothing selected in the library must do nothing.
click($('.header'));
layout();
key({ code: 'KeyG', ctrlKey: true });
check('1: Ctrl+G with no selection is a no-op', complexes().length === 1, complexes().length);

// ---------- 2. dragging from Exercise_list is a copy ----------

// Onto the upper half of the first row -> inserted above it.
dragTo(libraryRows()[2], complexRows()[0], rowTop(0));
check('2: dropped on a row, it joined that complex', complexes().length === 1, complexes().length);
check('2: at the position it was dropped', shape() === 'Третье+Первое+Второе', shape());
check('2: the library is untouched', libraryRows().length === 5, libraryRows().length);

// The same exercise again, this time below the last row.
dragTo(libraryRows()[2], complexRows()[2], rowBottom(2));
check('2: the same exercise can be dropped twice',
  shape() === 'Третье+Первое+Второе+Третье', shape());
check('2: the two copies are separate items',
  complexes()[0].items[0].id !== complexes()[0].items[3].id);

// Into the empty space below every complex -> a brand new complex.
dragTo(libraryRows()[3], $('.complex-list'), belowAll());
check('2: dropped in empty space, it made a new complex', complexes().length === 2, complexes().length);
check('2: the new complex is last and holds just it',
  shape() === 'Третье+Первое+Второе+Третье | Четвёртое', shape());

// On the bottom edge of a complex's last block -> a new complex after it,
// rather than one more block appended to it.
dragTo(libraryRows()[4], lastRowOf(0), boundaryAfter(0));
check('2: dropped on a complex\'s bottom edge, a complex appears after it',
  shape() === 'Третье+Первое+Второе+Третье | Пятое | Четвёртое', shape());

// The top edge of the very first block: the only way to put a complex above the
// first one, since the complexes are stacked flush.
dragTo(libraryRows()[3], firstRowOf(0), boundaryBefore(0));
check('2: dropped on the top edge of the first block, a complex appears above',
  shape() === 'Четвёртое | Третье+Первое+Второе+Третье | Пятое | Четвёртое', shape());

// Just inside that band it is an ordinary insertion into the complex again -
// the band must not swallow the first slot.
dragTo(libraryRows()[1], firstRowOf(1), rowTop(1));
check('2: just inside the edge it is still an insert into the complex',
  shape() === 'Четвёртое | Второе+Третье+Первое+Второе+Третье | Пятое | Четвёртое', shape());

// Put the list back the way the rest of the suite expects.
click(complexRows()[0]);
key({ key: 'Delete' });
click(complexRows()[0]);
key({ key: 'Delete' });
check('2: back to three complexes',
  shape() === 'Третье+Первое+Второе+Третье | Пятое | Четвёртое', shape());

// ---------- 3. the schedule ----------

// The default start is 3 сен with an interval of one day.
check('3: consecutive dates from the start date',
  dates().join(',') === '3 сен,4 сен,5 сен', dates().join(','));

const switches = () => $$('.complex__side .switch__input');
toggle(switches()[1], false);

check('3: a complex out of the schedule shows an em dash',
  dates().join(',') === '3 сен,—,4 сен', dates().join(','));
check('3: it keeps its place in the list',
  shape() === 'Третье+Первое+Второе+Третье | Пятое | Четвёртое', shape());
check('3: three complexes still rendered', complexNodes().length === 3, complexNodes().length);
check('3: the disabled one is marked', complexNodes()[1].classList.contains('complex--off'));

// ---------- 4. the "только включённые комплексы" checkbox ----------

const onlyEnabled = () =>
  $$('.checkbox-line').find((l) => l.textContent.includes('только включённые'));

toggle(onlyEnabled().querySelector('.checkbox__input'), true);

check('4: only the two enabled complexes are shown', complexNodes().length === 2, complexNodes().length);
check('4: and they read as consecutive days',
  dates().join(',') === '3 сен,4 сен', dates().join(','));
check('4: nothing was deleted', complexes().length === 3, complexes().length);

toggle(onlyEnabled().querySelector('.checkbox__input'), false);
toggle(switches()[1], true);
check('4: unhiding brings it back', complexNodes().length === 3, complexNodes().length);

// ---------- 5. moving blocks that are already scheduled ----------

// Now: [Третье+Первое+Второе+Третье] [Пятое] [Четвёртое]
// Move the first row of complex 0 into complex 1, below its only row.
dragTo(complexRows()[0], complexRows()[4], rowBottom(4));
check('5: a block moved between complexes',
  shape() === 'Первое+Второе+Третье | Пятое+Третье | Четвёртое', shape());

// Move it back, above the first row of the complex it came from.
dragTo(complexRows()[4], complexRows()[0], rowTop(0));
check('5: dropping on a row in another complex inserts at that spot',
  shape() === 'Третье+Первое+Второе+Третье | Пятое | Четвёртое', shape());

// Drag a block onto the bottom edge of the first complex -> its own complex.
dragTo(complexRows()[3], lastRowOf(0), boundaryAfter(0));
check('5: dragged onto a complex edge it becomes a complex of its own',
  shape() === 'Третье+Первое+Второе | Третье | Пятое | Четвёртое', shape());

// A group: select two rows in complex 0 and drag them into the last complex.
click(complexRows()[0]);
click(complexRows()[1], { ctrlKey: true });
check('5: two blocks selected inside a complex',
  $$('.complex-list .exercise-row--selected').length === 2);
dragTo(complexRows()[0], complexRows()[5], rowBottom(5));
check('5: the whole group moved, order preserved',
  shape() === 'Второе | Третье | Пятое | Четвёртое+Третье+Первое', shape());

// Emptying a complex removes it rather than leaving a dateless blank.
dragTo(complexRows()[0], complexRows()[1], rowBottom(1));
check('5: a complex emptied by a move disappears',
  shape() === 'Третье+Второе | Пятое | Четвёртое+Третье+Первое', shape());

// ---------- 6. reordering complexes by the side block ----------

const sides = () => $$('.complex__side');

layout();
dragTo(sides()[0], sides()[2], belowAll());
check('6: a complex dragged by its side block moved to the end',
  shape() === 'Пятое | Четвёртое+Третье+Первое | Третье+Второе', shape());
check('6: the dates followed the new order',
  dates().join(',') === '3 сен,4 сен,5 сен', dates().join(','));

// A group of complexes: select two side blocks and drag them to the top.
click(sides()[1]);
click(sides()[2], { shiftKey: true });
check('6: two complexes selected', $$('.complex--selected').length === 2);
dragTo(sides()[1], complexNodes()[0], complexNodes()[0].getBoundingClientRect().top + 1);
check('6: both complexes moved as a group',
  shape() === 'Четвёртое+Третье+Первое | Третье+Второе | Пятое', shape());

// ---------- 6b. re-rendering keeps the list where the user left it ----------

// A render rebuilds both lists from scratch. Without the scroll being carried
// across, selecting anything or reordering a complex snapped the list back to
// the first complex.
const complexList = () => $('.complex-list');
// jsdom has no layout, so the list reports a zero scroll height and refuses a
// scrollTop - the property is stubbed to make it behave like a real scroller.
let fakeScrollTop = 0;
Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollTop', {
  configurable: true,
  get() { return this.classList.contains('complex-list') ? fakeScrollTop : 0; },
  set(value) { if (this.classList.contains('complex-list')) fakeScrollTop = value; },
});

complexList().scrollTop = 120;
click(sides()[0]);
check('6b: selecting a complex leaves the scroll alone',
  complexList().scrollTop === 120, complexList().scrollTop);

dragTo(sides()[0], sides()[1], boundaryAfter(1));
check('6b: reordering complexes leaves the scroll alone',
  complexList().scrollTop === 120, complexList().scrollTop);

click(complexRows()[0]);
check('6b: selecting a block leaves the scroll alone',
  complexList().scrollTop === 120, complexList().scrollTop);

// Put the order back and drop the stub.
dragTo(sides()[1], sides()[0], boundaryBefore(0));
delete dom.window.HTMLElement.prototype.scrollTop;
check('6b: the order was restored',
  shape() === 'Четвёртое+Третье+Первое | Третье+Второе | Пятое', shape());

// ---------- 7. selection is exclusive across the three lists ----------

click(complexRows()[0]);
check('7: a block inside a complex is selected',
  $$('.complex-list .exercise-row--selected').length === 1);
click(sides()[0]);
check('7: selecting a complex clears the block selection',
  $$('.exercise-row--selected').length === 0 && $$('.complex--selected').length === 1);
click(libraryRows()[0]);
check('7: selecting in the library clears the complex selection',
  $$('.complex--selected').length === 0 &&
  $$('.column--exercise .exercise-row--selected').length === 1);
click(complexRows()[0]);
check('7: and back the other way',
  $$('.column--exercise .exercise-row--selected').length === 0 &&
  $$('.complex-list .exercise-row--selected').length === 1);

// ---------- 8. Del follows the selection ----------

// Currently: [Четвёртое+Третье+Первое] [Третье+Второе] [Пятое]
key({ key: 'Delete' });
layout();
check('8: Del removed the selected block',
  shape() === 'Третье+Первое | Третье+Второе | Пятое', shape());
check('8: the library is untouched', category().exercises.length === 5);

click(sides()[1]);
key({ key: 'Delete' });
layout();
check('8: Del on a selected complex removed the whole complex',
  shape() === 'Третье+Первое | Пятое', shape());
check('8: still no exercise lost', category().exercises.length === 5);

// Deleting the last block of a complex takes the complex with it.
click(complexRows()[2]);
key({ key: 'Delete' });
layout();
check('8: a complex emptied by Del disappears', shape() === 'Третье+Первое', shape());

// ---------- 9. deleting an exercise unschedules it ----------

const thirdId = category().exercises[2].id; // Третье
click(libraryRows()[2]);
key({ key: 'Delete' });
layout();

check('9: the exercise is gone from the library', category().exercises.length === 4);
check('9: and from every complex it was in', shape() === 'Первое', shape());
check('9: no complex still points at it',
  complexes().every((c) => c.items.every((i) => i.exerciseId !== thirdId)));

// Removing the last remaining exercise of a complex prunes it.
click(libraryRows()[0]);
key({ key: 'Delete' });
layout();
check('9: the emptied complex was pruned', complexes().length === 0, complexes().length);
// A lone rule under the toolbar would read as a glitch, not as "today".
check('9: an empty list shows no date pointer', $$('.date-pointer').length === 0);

// ---------- 10. the date pointer ----------

// Four one-day complexes starting today - the pointer belongs before the first.
const ids = category().exercises.map((e) => e.id);
for (const id of ids) store.createComplexFromExercises([id], complexes().length);
store.setCategoryField('scheduleStartDate', formatToday());
layout();

function formatToday() {
  const now = new Date();
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return now.getDate() + ' ' + months[now.getMonth()];
}

const listChildren = () => Array.from($('.complex-list').children).map((n) => n.className.split(' ')[0]);

check('10: starting today, the pointer comes first',
  listChildren()[0] === 'date-pointer', listChildren().join(','));

// A schedule entirely in the past puts it after the last complex.
store.setCategoryField('scheduleStartDate', '1 янв');
layout();
const past = listChildren();
check('10: an all-past schedule puts the pointer last',
  past[past.length - 1] === 'date-pointer', past.join(','));

// Starting two days ago with three complexes: today is the third.
const twoDaysAgo = new Date();
twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
store.setCategoryField('scheduleStartDate', twoDaysAgo.getDate() + ' ' + months[twoDaysAgo.getMonth()]);
layout();
check('10: otherwise it sits before the first complex due today or later',
  listChildren().indexOf('date-pointer') === 2, listChildren().join(','));
check('10: exactly one pointer in the list', $$('.date-pointer').length === 1);

// ---------- report ----------

check('no console errors', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
process.exit(failures === 0 ? 0 : 1);
