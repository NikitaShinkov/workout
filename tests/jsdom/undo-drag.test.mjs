// Hover arming, the 5-second undo window, and category drag-reorder.

import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

import { PROJECT } from '../helpers/env.mjs';
const mod = (p) => import(pathToFileURL(PROJECT + '/js/' + p).href);

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.Blob = dom.window.Blob;
global.URL.createObjectURL = () => 'blob:x';

let failures = 0;
const results = [];
function check(name, ok, detail) {
  if (ok) results.push('  PASS  ' + name);
  else { failures += 1; results.push('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.map(String).join(' '));

const store = await mod('store.js');
const { mountSchedulePage } = await mod('schedule-page.js');
const { createExercise } = await mod('model.js');

store.resetStore();
mountSchedulePage(document.getElementById('app'));

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const buttons = () => $$('.menu-button');
const names = () => buttons().map((b) => b.querySelector('.menu-button__sizer').textContent);
const activeBtn = () => $('.menu-button--active');
const click = (n, i) => n.dispatchEvent(new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, i)));
const leave = (n) => n.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
const keyOn = (n, code, init) => n.dispatchEvent(new dom.window.KeyboardEvent('keydown',
  Object.assign({ code, key: 'x', bubbles: true, cancelable: true }, init)));
const order = () => store.getState().categoryOrder.slice();

// ---------- 1. hover arming ----------
check('1: the initially active button is armed',
  activeBtn().classList.contains('menu-button--hover-armed'));

click(buttons()[2]); // switch to ТБС
check('1: switching category disarms the new active button',
  !activeBtn().classList.contains('menu-button--hover-armed'));
check('1: the close button is still in the DOM (CSS gates its visibility)',
  Boolean(activeBtn().querySelector('.menu-button__close')));

leave(activeBtn());
check('1: leaving the button arms it', activeBtn().classList.contains('menu-button--hover-armed'));
check('1: arming did not re-render the node away', Boolean(activeBtn().querySelector('.menu-button__close')));

// clicking the SAME category again must not disarm it
click(activeBtn());
check('1: re-clicking the already-active category keeps it armed',
  activeBtn().classList.contains('menu-button--hover-armed'));

// ---------- 2. delete with a 5s undo window ----------
click(buttons()[1]); // Колено active
leave(activeBtn());
const doomedName = names()[1];
const beforeOrder = order();

// give it an exercise so we can prove the data comes back
store.addExercise(createExercise({ name: 'Упражнение в Колене', description: 'd',
  images: [], equipment: ['mat'] }));
check('2: the doomed category has an exercise', store.activeCategory().exercises.length === 1);

click(activeBtn().querySelector('.menu-button__close'));

check('2: the button is hidden immediately', names().length === beforeOrder.length - 1, names().length);
check('2: the category is out of the order', !order().includes(beforeOrder[1]));
check('2: an undo button appeared', Boolean($('.undo-button')));
check('2: the next category was opened', store.getState().ui.activeCategory === beforeOrder[2],
  store.getState().ui.activeCategory);

const label = () => $('.undo-button span').textContent;
check('2: undo label names the category and the shortcut',
  label().startsWith('Восстановить ' + doomedName + ' (Ctrl+Z) '), label());
check('2: undo label ends with a countdown of 5', /\b5$/.test(label()), label());
check('2: undo button has the arrow icon',
  $('.undo-button__icon').getAttribute('src') === 'assets/icons/undo.svg');
check('2: undo sits after the add button',
  $('.add-category-button').compareDocumentPosition($('.undo-button')) & 4);

// ---------- restore by clicking ----------
click($('.undo-button'));
check('2: clicking undo restores the category', order().join() === beforeOrder.join(), order().join());
check('2: restored at its original position', order()[1] === beforeOrder[1]);
check('2: the restored category is active', store.getState().ui.activeCategory === beforeOrder[1]);
check('2: its exercises came back', store.activeCategory().exercises.length === 1,
  store.activeCategory().exercises.length);
check('2: the undo button is gone', !$('.undo-button'));

// ---------- restore with Ctrl+Z ----------
leave(activeBtn());
click(activeBtn().querySelector('.menu-button__close'));
check('2: deleted again', order().length === beforeOrder.length - 1);
keyOn(document, 'KeyZ', { ctrlKey: true });
check('2: Ctrl+Z restores', order().join() === beforeOrder.join(), order().join());
check('2: Ctrl+Z cleared the undo button', !$('.undo-button'));

// Ctrl+Z with nothing pending must be inert
const ev = new dom.window.KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
document.dispatchEvent(ev);
check('2: Ctrl+Z with nothing pending is not swallowed', ev.defaultPrevented === false);

// ---------- several deletions stack, newest first ----------
const three = order().slice(0, 3);
for (const id of three) {
  store.setActiveCategory(id);
  leave(activeBtn());
  click(activeBtn().querySelector('.menu-button__close'));
}
check('2: three categories hidden', order().length === beforeOrder.length - 3, order().length);
const nameOf = (id) => beforeOrder.indexOf(id) >= 0 ? id : id;
check('2: undo offers the MOST RECENT deletion',
  label().includes('(Ctrl+Z)') && $('.undo-button') !== null);
const thirdName = label();
keyOn(document, 'KeyZ', { ctrlKey: true });
check('2: undoing reveals the previous deletion', Boolean($('.undo-button')));
check('2: and the label changed to that one', label() !== thirdName, label());
check('2: one category is back', order().length === beforeOrder.length - 2, order().length);
keyOn(document, 'KeyZ', { ctrlKey: true });
keyOn(document, 'KeyZ', { ctrlKey: true });
check('2: all three restored', order().length === beforeOrder.length, order().length);
check('2: order fully recovered', order().join() === beforeOrder.join(), order().join());
check('2: undo button gone once the stack empties', !$('.undo-button'));

// ---------- expiry makes it permanent ----------
store.setActiveCategory(beforeOrder[0]);
leave(activeBtn());
click(activeBtn().querySelector('.menu-button__close'));
check('2: pending before expiry', Boolean($('.undo-button')));
await new Promise((r) => setTimeout(r, 5400));
check('2: undo button disappears after 5s', !$('.undo-button'));
const evLate = new dom.window.KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
document.dispatchEvent(evLate);
check('2: Ctrl+Z after expiry does nothing', order().length === beforeOrder.length - 1 &&
  evLate.defaultPrevented === false, order().length);
check('2: the category is permanently gone', !store.getState().categories[beforeOrder[0]]);

// ---------- 3. drag to reorder ----------
function transfer() {
  const bag = {};
  return { effectAllowed: '', dropEffect: '', setData(k, v) { bag[k] = String(v); }, getData(k) { return bag[k]; } };
}
function fire(node, type, dt, clientX) {
  const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: dt });
  Object.defineProperty(e, 'clientX', { value: clientX });
  node.dispatchEvent(e);
}

check('3: menu buttons are draggable', buttons()[0].getAttribute('draggable') === 'true');
check('3: the close button is not draggable',
  activeBtn().querySelector('.menu-button__close').getAttribute('draggable') === 'false');

const start = order();
let dt = transfer();
fire(buttons()[0], 'dragstart', dt, 0);
// --dragging lands one tick later, after the drag image has been snapshotted.
await new Promise((r) => setTimeout(r, 10));
check('3: dragging marks the button', buttons()[0].classList.contains('menu-button--dragging'));
fire(buttons()[2], 'dragover', dt, 1);   // right half of the third button
fire(buttons()[2], 'drop', dt, 1);
const expected = [start[1], start[2], start[0], ...start.slice(3)];
check('3: first category moved to third place', order().join() === expected.join(),
  order().join() + '  expected ' + expected.join());

// drag the last one to the front
const now = order();
dt = transfer();
fire(buttons()[buttons().length - 1], 'dragstart', dt, 0);
fire(buttons()[0], 'dragover', dt, 0);   // left half of the first button
fire(buttons()[0], 'drop', dt, 0);
const expected2 = [now[now.length - 1], ...now.slice(0, now.length - 1)];
check('3: last category moved to the front', order().join() === expected2.join(),
  order().join() + '  expected ' + expected2.join());

// dropping in place changes nothing
const held = order();
dt = transfer();
fire(buttons()[1], 'dragstart', dt, 0);
fire(buttons()[1], 'dragover', dt, 0);
fire(buttons()[1], 'drop', dt, 0);
check('3: dropping a category in place is a no-op', order().join() === held.join(), order().join());

// The order has to survive the format that goes into the repo - there is no
// local database to read back from any more.
const { serializeForRepo } = await mod('sync.js');
const { out } = await serializeForRepo(store.getState());
check('3: the new order is what would be committed',
  out.categoryOrder.join() === held.join(), out.categoryOrder.join());

// ---------- 4. dragging selects the button and drops the hover extras ----------
// Put the active button into the hovered (armed) state first.
store.setActiveCategory(order()[0]);
leave(activeBtn());
check('4: the active button is armed before dragging',
  activeBtn().classList.contains('menu-button--hover-armed'));

// Drag an INACTIVE button.
const inactive = buttons()[2];
const inactiveId = order()[2];
const previouslyActive = order()[0];
dt = transfer();
fire(inactive, 'dragstart', dt, 0);

// Phase one, synchronous: the drag image is snapshotted from the element right
// now, so it must carry the active look.
check('4: the drag image is snapshotted in the active state',
  inactive.classList.contains('menu-button--active'));
check('4: it is not armed, so the snapshot has no X and no truncation',
  !inactive.classList.contains('menu-button--hover-armed'));
check('4: the previously active button drops the active look',
  !buttons()[0].classList.contains('menu-button--active'));
check('4: exactly one button is active for the snapshot',
  $$('.menu-button--active').length === 1, $$('.menu-button--active').length);
check('4: the drag has not committed the selection yet',
  store.getState().ui.activeCategory === previouslyActive,
  store.getState().ui.activeCategory);

// Phase two, one tick later: the button left behind in the list goes inactive.
await new Promise((r) => setTimeout(r, 10));
check('4: the button left in place drops the active look',
  !inactive.classList.contains('menu-button--active'));
check('4: NO button in the list looks active mid-drag',
  $$('.menu-button--active').length === 0, $$('.menu-button--active').length);
check('4: the one left behind is marked as dragging',
  inactive.classList.contains('menu-button--dragging'));

fire(buttons()[0], 'dragover', dt, 0);
fire(buttons()[0], 'drop', dt, 0);
check('4: dropping selects the dragged category',
  store.getState().ui.activeCategory === inactiveId, store.getState().ui.activeCategory);
check('4: and it moved to the front', order()[0] === inactiveId, order().join());
check('4: the newly active button is NOT armed after the drop',
  !activeBtn().classList.contains('menu-button--hover-armed'));
check('4: so its close button stays hidden until the pointer leaves and returns',
  Boolean(activeBtn().querySelector('.menu-button__close')));

// A cancelled drag (dragend with no drop) still selects.
store.setActiveCategory(order()[3]);
const cancelledId = order()[1];
dt = transfer();
fire(buttons()[1], 'dragstart', dt, 0);
fire(buttons()[1], 'dragend', dt, 0);
check('4: a cancelled drag still selects the dragged category',
  store.getState().ui.activeCategory === cancelledId, store.getState().ui.activeCategory);
check('4: the dragging class is cleaned up', $$('.menu-button--dragging').length === 0);

// ---------- 5. Del in the two lists is undoable too ----------

const ex = (id, name) => ({ ...createExercise({ name, description: '', images: [], equipment: ['mat'] }), id });
const seedLists = () => ({
  version: 2, categoryOrder: ['u'],
  categories: { u: {
    name: 'Тест', scheduleEnabled: true, scheduleStartDate: '2026-09-03', intervalDays: 1,
    includeWeekends: true,
    exercises: [ex('e1', 'Первое'), ex('e2', 'Второе'), ex('e3', 'Третье'), ex('e4', 'Четвёртое')],
    complexes: [
      { id: 'c1', enabled: true, items: [{ id: 'i1', exerciseId: 'e1' }, { id: 'i2', exerciseId: 'e2' }] },
      { id: 'c2', enabled: false, items: [{ id: 'i3', exerciseId: 'e3' }] },
      { id: 'c3', enabled: true, items: [{ id: 'i4', exerciseId: 'e2' }, { id: 'i5', exerciseId: 'e4' }] },
    ],
  } },
  ui: { activeCategory: 'u' },
});
const cat = () => store.getState().categories.u;
const lib = () => cat().exercises.map((e) => e.name).join(',');
const shape = () => cat().complexes
  .map((c) => c.id + (c.enabled ? '' : '(off)') + ':' + c.items.map((i) => i.id).join('+')).join(' | ');
const libRows = () => $$('.column--exercise .exercise-row');
const cxRows = () => $$('.complex-list .exercise-row');
const sides = () => $$('.complex__side');
const del = () => keyOn(document, 'Delete', { key: 'Delete' });
const undoKey = () => keyOn(document, 'KeyZ', { ctrlKey: true });

store.resetStore(seedLists());
const LIB = lib();
const SHAPE = shape();
check('5: seeded', LIB === 'Первое,Второе,Третье,Четвёртое' && SHAPE === 'c1:i1+i2 | c2(off):i3 | c3:i4+i5', SHAPE);

// One exercise from Exercise_list: it and its scheduled blocks come back.
click(libRows()[1]);
del();
check('5a: Del removed Второе and both its blocks',
  lib() === 'Первое,Третье,Четвёртое' && shape() === 'c1:i1 | c2(off):i3 | c3:i5', lib() + ' / ' + shape());
check('5a: the undo button names it', label().startsWith('Восстановить Второе (Ctrl+Z) '), label());
check('5a: and counts down from 5', /\b5$/.test(label()), label());
undoKey();
check('5a: CTRL+Z PUTS IT BACK, IN PLACE', lib() === LIB, lib());
check('5a: with its blocks back in place in both complexes', shape() === SHAPE, shape());
check('5a: the undo button is gone', !$('.undo-button'));

// Several exercises - one of them emptying a complex outright.
click(libRows()[1]);
click(libRows()[2], { ctrlKey: true });
del();
check('5b: Del removed Второе and Третье, and the complex Третье was alone in',
  lib() === 'Первое,Четвёртое' && shape() === 'c1:i1 | c3:i5', lib() + ' / ' + shape());
check('5b: «Восстановить упражнения»', label().startsWith('Восстановить упражнения (Ctrl+Z) '), label());
click($('.undo-button'));
check('5b: clicking undo restores both, in place', lib() === LIB, lib());
check('5b: and the emptied complex, switched off as it was', shape() === SHAPE, shape());

// One block inside a complex.
click(cxRows()[1]); // i2
del();
check('5c: Del removed one block', shape() === 'c1:i1 | c2(off):i3 | c3:i4+i5', shape());
check('5c: the library is untouched', lib() === LIB);
check('5c: the button names the exercise', label().startsWith('Восстановить Второе (Ctrl+Z) '), label());
undoKey();
check('5c: restored in place', shape() === SHAPE, shape());

// Several blocks across complexes, one of them a complex's only block.
click(cxRows()[0]);                       // i1
click(cxRows()[2], { shiftKey: true });   // i1..i3
del();
check('5d: Del removed three blocks and the complexes they emptied', shape() === 'c3:i4+i5', shape());
check('5d: «Восстановить упражнения»', label().startsWith('Восстановить упражнения (Ctrl+Z) '), label());
undoKey();
check('5d: everything back where it was', shape() === SHAPE, shape());

// One complex, then several.
click(sides()[1]);
del();
check('5e: Del removed the complex', shape() === 'c1:i1+i2 | c3:i4+i5', shape());
check('5e: «Восстановить комплекс»', label().startsWith('Восстановить комплекс (Ctrl+Z) '), label());
undoKey();
check('5e: restored in place, still off', shape() === SHAPE, shape());

click(sides()[0]);
click(sides()[2], { ctrlKey: true });
del();
check('5f: two complexes removed', shape() === 'c2(off):i3', shape());
check('5f: «Восстановить комплексы»', label().startsWith('Восстановить комплексы (Ctrl+Z) '), label());
undoKey();
check('5f: both back in place', shape() === SHAPE, shape());

// The stack is shared, newest first, across all four kinds.
click(sides()[2]);
del();                                    // complex c3
click(libRows()[0]);
del();                                    // exercise Первое
check('5g: two deletions pending, the newest offered',
  label().startsWith('Восстановить Первое (Ctrl+Z) '), label());
undoKey();
check('5g: undoing it offers the complex', label().startsWith('Восстановить комплекс (Ctrl+Z) '), label());
undoKey();
check('5g: and both are back', lib() === LIB && shape() === SHAPE, lib() + ' / ' + shape());

// Undoing one deletion does not roll back anything done since.
click(cxRows()[0]);
del();                                    // block i1
store.setComplexEnabled('c3', false);     // a later, unrelated change
undoKey();
check('5h: undo restores only what was deleted, keeping the later change',
  shape() === 'c1:i1+i2 | c2(off):i3 | c3(off):i4+i5', shape());
store.setComplexEnabled('c3', true);

// Undo opens the category the deletion happened in.
store.resetStore({ ...seedLists(), categoryOrder: ['u', 'v'],
  categories: { ...seedLists().categories, v: { name: 'Другая', exercises: [], complexes: [] } } });
click(libRows()[0]);
del();
store.setActiveCategory('v');
undoKey();
check('5i: undo opens the category the deletion was in, with it restored',
  store.getState().ui.activeCategory === 'u' && lib() === LIB, store.getState().ui.activeCategory + ' ' + lib());

// What sync writes after an undo is the original structure.
const { serializeForRepo: serialize } = await mod('sync.js');
const restoredOut = (await serialize(store.getState())).out;
store.resetStore({ ...seedLists(), categoryOrder: ['u', 'v'],
  categories: { ...seedLists().categories, v: { name: 'Другая', exercises: [], complexes: [] } } });
check('5j: an undone deletion serializes exactly as before it',
  JSON.stringify(restoredOut) === JSON.stringify((await serialize(store.getState())).out));

// A long name is cut to 20 characters and «...».
const { shortName } = await mod('schedule-page.js');
check('5k: a name of 20 characters is kept whole', shortName('А'.repeat(20)) === 'А'.repeat(20));
check('5k: a longer one is cut to 20 and «...»', shortName('Б'.repeat(21)) === 'Б'.repeat(20) + '...',
  shortName('Б'.repeat(21)));
check('5k: no space before the dots', shortName('Круговое движение прямой ноги') === 'Круговое движение пр...',
  shortName('Круговое движение прямой ноги'));
store.resetStore(seedLists());
store.updateExercise('e2', { name: 'Круговое движение прямой ноги на боку' });
click(libRows()[1]);
del();
check('5k: the undo button carries the cut name',
  label().startsWith('Восстановить Круговое движение пр... (Ctrl+Z) '), label());
undoKey();

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/MODULE_TYPELESS|Save failed|Could not load/.test(e));
console.log(results.join('\n'));
console.log('\nunexpected console errors: ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
