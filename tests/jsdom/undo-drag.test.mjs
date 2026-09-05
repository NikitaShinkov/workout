// Hover arming, the 5-second undo window, and category drag-reorder.

import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

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
global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

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

await store.initStore();
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

// reordering survives a save/load round trip
await new Promise((r) => setTimeout(r, 300));
const reloaded = await (await mod('db.js')).loadState();
check('3: the new order was persisted', reloaded.categoryOrder.join() === held.join(),
  reloaded.categoryOrder.join());

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

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/MODULE_TYPELESS|Save failed|Could not load/.test(e));
console.log(results.join('\n'));
console.log('\nunexpected console errors: ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
