// Keyboard selection on the schedule page, and the two lists read together.
//
//   Up/Down move the selected block, Shift extends a range, Ctrl+Shift takes
//   that range to the end of the list - and inside a complex "the list" is that
//   complex's own blocks.
//   Enter groups everything selected in Exercise_list into one complex.
//   Selecting a block in a complex points Exercise_list at the exercise it
//   references, in the hover fill, without selecting it.
//
// The centring scroll that goes with that highlight is geometry, so it is
// browser/complex-layout's job; jsdom has no layout engine.

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

store.resetStore();
mountSchedulePage(document.getElementById('app'));

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const blob = () => new dom.window.Blob(['x'], { type: 'image/jpeg' });

const NAMES = ['Первое', 'Второе', 'Третье', 'Четвёртое', 'Пятое', 'Шестое'];
for (const name of NAMES) {
  store.addExercise(createExercise({ name, description: name, images: [blob()], equipment: ['mat'] }));
}

const category = () => store.activeCategory();
const complexes = () => category().complexes;
const nameById = () => new Map(category().exercises.map((e) => [e.id, e.name]));

const libraryRows = () => $$('.column--exercise .exercise-row');
const complexRows = () => $$('.complex-list .exercise-row');
const complexNodes = () => $$('.complex-list .complex');

// The names of the selected library rows, in display order.
const librarySelection = () =>
  $$('.column--exercise .exercise-row--selected')
    .map((node) => nameById().get(node.dataset.id))
    .join(',');

// Blocks selected inside complexes, as positions in the flat list of rows -
// which is what says whether a range stayed inside one complex.
const itemSelection = () =>
  complexRows()
    .map((node, i) => (node.classList.contains('exercise-row--selected') ? i : -1))
    .filter((i) => i >= 0)
    .join(',');

// The one library row wearing the borrowed hover fill, by name. Reports the
// count instead when it is not exactly one, so a failure says what went wrong.
function linked() {
  const nodes = $$('.exercise-row--linked');
  if (nodes.length !== 1) return nodes.length + ' linked';
  return nameById().get(nodes[0].dataset.id);
}

// The whole schedule in one line: the names inside each complex.
function shape() {
  const names = nameById();
  return complexes()
    .map((complex) => complex.items.map((item) => names.get(item.exerciseId)).join('+'))
    .join(' | ');
}

const click = (node, init) =>
  node.dispatchEvent(new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, init)));

const key = (init) =>
  document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init)));

// A real mouse movement, over `node`. The target matters: the handler ends the
// borrowed highlight only for a movement that happened inside Exercise_list.
const moveOver = (node, x, y) => node.dispatchEvent(
  new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));

// Anywhere that is not a block: drops the selection.
const clickAway = () => click($('.header'));

// ---------- 1. Up/Down in Exercise_list ----------

click(libraryRows()[0]);
check('1: a click selects one row', librarySelection() === 'Первое', librarySelection());

key({ key: 'ArrowDown' });
check('1: Down moves the selection to the next block',
  librarySelection() === 'Второе', librarySelection());

key({ key: 'ArrowDown' });
check('1: and again', librarySelection() === 'Третье', librarySelection());

key({ key: 'ArrowUp' });
check('1: Up moves it back', librarySelection() === 'Второе', librarySelection());

key({ key: 'ArrowUp' });
key({ key: 'ArrowUp' });
check('1: Up at the top of the list is a no-op',
  librarySelection() === 'Первое', librarySelection());

click(libraryRows()[5]);
key({ key: 'ArrowDown' });
check('1: Down at the bottom is a no-op', librarySelection() === 'Шестое', librarySelection());

// A key with nothing selected has no current block to move.
clickAway();
key({ key: 'ArrowDown' });
check('1: Down with nothing selected selects nothing',
  librarySelection() === '', librarySelection());

// ---------- 2. Shift+Up/Down extend a range ----------

click(libraryRows()[1]);
key({ key: 'ArrowDown', shiftKey: true });
check('2: Shift+Down adds the block below',
  librarySelection() === 'Второе,Третье', librarySelection());

key({ key: 'ArrowDown', shiftKey: true });
check('2: again, and it keeps growing',
  librarySelection() === 'Второе,Третье,Четвёртое', librarySelection());

key({ key: 'ArrowUp', shiftKey: true });
check('2: Shift+Up shrinks it back toward the anchor',
  librarySelection() === 'Второе,Третье', librarySelection());

key({ key: 'ArrowUp', shiftKey: true });
key({ key: 'ArrowUp', shiftKey: true });
check('2: past the anchor it grows the other way',
  librarySelection() === 'Первое,Второе', librarySelection());

// A plain arrow after a range collapses it again.
key({ key: 'ArrowDown' });
check('2: a plain Down leaves one block selected',
  librarySelection() === 'Второе', librarySelection());

// ---------- 3. Ctrl+Shift+Up/Down reach the ends ----------

click(libraryRows()[2]);
key({ key: 'ArrowDown', shiftKey: true, ctrlKey: true });
check('3: Ctrl+Shift+Down selects through to the last block',
  librarySelection() === 'Третье,Четвёртое,Пятое,Шестое', librarySelection());

click(libraryRows()[2]);
key({ key: 'ArrowUp', shiftKey: true, ctrlKey: true });
check('3: Ctrl+Shift+Up selects through to the first',
  librarySelection() === 'Первое,Второе,Третье', librarySelection());

// ---------- 4. Enter groups the library selection ----------

clickAway();
key({ key: 'Enter' });
check('4: Enter with nothing selected is a no-op', complexes().length === 0, complexes().length);

click(libraryRows()[0]);
click(libraryRows()[2], { ctrlKey: true });
key({ key: 'Enter' });
check('4: Enter made one complex', complexes().length === 1, complexes().length);
check('4: holding both selected exercises, in list order',
  shape() === 'Первое+Третье', shape());
check('4: the library is untouched', libraryRows().length === 6, libraryRows().length);

// A second complex, to prove it appends rather than replaces.
click(libraryRows()[3]);
key({ key: 'ArrowDown', shiftKey: true });
key({ key: 'Enter' });
check('4: a second Enter appends a complex at the end',
  shape() === 'Первое+Третье | Четвёртое+Пятое', shape());

// Enter is Exercise_list's key: a selection inside a complex must not group.
click(complexRows()[0]);
key({ key: 'Enter' });
check('4: Enter on a block selected inside a complex is a no-op',
  complexes().length === 2, complexes().length);

// ---------- 5. Up/Down inside a complex stay inside it ----------

// Complex 0 holds two blocks and complex 1 holds two, so a range that ran on
// would show up immediately.
store.createComplexFromExercises(
  [category().exercises[5].id, category().exercises[4].id, category().exercises[3].id], 2);
check('5: a third complex to navigate in',
  shape() === 'Первое+Третье | Четвёртое+Пятое | Шестое+Пятое+Четвёртое', shape());
check('5: seven rows across the three complexes',
  complexRows().length === 7, complexRows().length);

click(complexRows()[2]); // the first block of complex 1
key({ key: 'ArrowDown' });
check('5: Down moves to the next block of the complex',
  itemSelection() === '3', itemSelection());

key({ key: 'ArrowDown' });
check('5: Down at the end of a complex does not enter the next one',
  itemSelection() === '3', itemSelection());

key({ key: 'ArrowUp' });
key({ key: 'ArrowUp' });
check('5: nor does Up leave it at the top',
  itemSelection() === '2', itemSelection());

// Ctrl+Shift over the whole "list" - which here means this complex.
key({ key: 'ArrowDown', shiftKey: true, ctrlKey: true });
check('5: Ctrl+Shift+Down selects to the end of THIS complex only',
  itemSelection() === '2,3', itemSelection());

click(complexRows()[5]); // the middle block of complex 2
key({ key: 'ArrowUp', shiftKey: true, ctrlKey: true });
check('5: Ctrl+Shift+Up stops at the top of its own complex',
  itemSelection() === '4,5', itemSelection());

key({ key: 'ArrowDown', shiftKey: true, ctrlKey: true });
check('5: and Down from the same anchor reaches its last block',
  itemSelection() === '5,6', itemSelection());

// The selection is still one complex's, so Del would never reach another's.
const selectedIn = () =>
  complexNodes().findIndex((node) => node.querySelector('.exercise-row--selected'));
check('5: everything selected belongs to one complex', selectedIn() === 2, selectedIn());

// ---------- 6. Complex_list points Exercise_list at the exercise ----------

click(complexRows()[0]); // complex 0, first block: Первое
check('6: the library row for that exercise is highlighted',
  linked() === 'Первое', linked());
check('6: the highlighted row is NOT selected',
  $$('.column--exercise .exercise-row--selected').length === 0);
check('6: the selection is still the block in the complex',
  itemSelection() === '0', itemSelection());

key({ key: 'ArrowDown' }); // complex 0, second block: Третье
check('6: Down re-points the highlight', linked() === 'Третье', linked());
check('6: still exactly one highlighted row',
  $$('.exercise-row--linked').length === 1, $$('.exercise-row--linked').length);

// A range keeps the highlight on the block the run started from.
key({ key: 'ArrowUp', shiftKey: true });
check('6: Shift+Up leaves the highlight where it was',
  linked() === 'Третье', linked());
check('6: while the range itself grew', itemSelection() === '0,1', itemSelection());

click(complexRows()[0]);
click(complexRows()[1], { ctrlKey: true });
check('6: Ctrl+click leaves it on the block selected first',
  linked() === 'Первое', linked());

// The pointer arriving in Exercise_list ends the borrowed highlight - but a
// crossing event on its own does not, because every keyboard move re-renders
// the list and Chrome fires mouseenter on the new node under a pointer that
// never moved. See gotcha 26.
$('.exercise-list').dispatchEvent(new dom.window.MouseEvent('mouseenter'));
check('6: a crossing while hover is parked is not the pointer arriving',
  $$('.exercise-row--linked').length === 1, $$('.exercise-row--linked').length);

// Moving the mouse over the list is, and that is what a real pointer does to
// get there.
moveOver($('.exercise-list'), 400, 200);
check('6: the pointer moving inside Exercise_list clears it',
  $$('.exercise-row--linked').length === 0, $$('.exercise-row--linked').length);

// And it must not come back on the next render.
store.setUiFlag('showIndicators', !store.getState().ui.showIndicators);
check('6: nor does a re-render bring it back',
  $$('.exercise-row--linked').length === 0, $$('.exercise-row--linked').length);

// Selecting in Exercise_list itself highlights nothing extra: the selection is
// the highlight there.
click(libraryRows()[0]);
check('6: a library selection adds no second highlight',
  $$('.exercise-row--linked').length === 0, $$('.exercise-row--linked').length);
check('6: it is simply selected', librarySelection() === 'Первое', librarySelection());

// Clicking away drops both.
click(complexRows()[0]);
check('6: highlighted again', linked() === 'Первое', linked());
clickAway();
check('6: clicking away drops the highlight with the selection',
  $$('.exercise-row--linked').length === 0 && itemSelection() === '',
  $$('.exercise-row--linked').length + '/' + itemSelection());

// ---------- 7. a keyboard move parks hover ----------
//
// jsdom has no :hover, so what can be checked here is the switch the
// stylesheet is guarded on - body.hover-off - and exactly when it goes on and
// off. browser/list-sync checks what it does to the fills.

const parked = () => document.body.classList.contains('hover-off');
const move = (x, y) => document.dispatchEvent(
  new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));

click(libraryRows()[0]);
move(100, 100);
check('7: a click and a mouse move leave hover alone', parked() === false, parked());

key({ key: 'ArrowDown' });
check('7: a keyboard move parks hover', parked() === true, parked());

// A mousemove that did not actually move must not lift it: Chrome emits those
// after a programmatic scroll, and a keyboard move scrolls both lists.
move(100, 100);
check('7: a mousemove at the same position does not lift the park',
  parked() === true, parked());

move(101, 100);
check('7: the first real movement lifts it', parked() === false, parked());

key({ key: 'ArrowDown', shiftKey: true });
check('7: Shift+Down parks it too', parked() === true, parked());

move(120, 130);
key({ key: 'ArrowUp', shiftKey: true, ctrlKey: true });
check('7: and so does Ctrl+Shift+Up', parked() === true, parked());
move(140, 150);

// A key that cannot move changes nothing, so there is nothing to hide.
click(libraryRows()[0]);
move(160, 170);
key({ key: 'ArrowUp' });
check('7: a key that could not move does not park hover', parked() === false, parked());

// It parks from a complex just the same.
click(complexRows()[0]);
move(180, 190);
key({ key: 'ArrowDown' });
check('7: a move inside a complex parks hover as well', parked() === true, parked());
move(200, 210);
check('7: and one movement is enough to bring it back', parked() === false, parked());

// ---------- report ----------

check('no console errors', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
process.exit(failures === 0 ? 0 : 1);
