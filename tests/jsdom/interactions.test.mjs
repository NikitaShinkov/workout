// Tests for the nine requested changes.

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
const origError = console.error;
console.error = (...a) => errors.push(a.map(String).join(' '));

const { initStore, activeCategory, addExercise, setUiFlag } = await mod('store.js');
const { mountSchedulePage } = await mod('schedule-page.js');
const { openExerciseModal, closeModal, isModalOpen } = await mod('exercise-modal.js');
const { createExercise } = await mod('model.js');

await initStore();
mountSchedulePage(document.getElementById('app'));

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const blob = () => new dom.window.Blob(['x'], { type: 'image/jpeg' });

// Four exercises; the first has three images so hover can animate.
addExercise(createExercise({ name: 'Первое', description: 'd1', images: [blob(), blob(), blob()], equipment: ['mat'] }));
addExercise(createExercise({ name: 'Второе', description: 'd2', images: [blob()], equipment: ['mat'] }));
addExercise(createExercise({ name: 'Третье', description: 'd3', images: [blob()], equipment: ['mat'] }));
addExercise(createExercise({ name: 'Четвёртое', description: 'd4', images: [blob()], equipment: ['mat'] }));

const names = () => activeCategory().exercises.map((e) => e.name).join(',');
const rows = () => $$('.exercise-row');
const click = (i, init) => rows()[i].dispatchEvent(
  new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, init)));

// ---------- 3. click outside the list clears the selection ----------
click(0);
check('3: a row is selected', $$('.exercise-row--selected').length === 1);
$('.schedule-toolbar').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('3: clicking outside the list deselects', $$('.exercise-row--selected').length === 0);

click(1);
click(2, { shiftKey: true });
check('3: multi-selection made', $$('.exercise-row--selected').length === 2);
$('.header').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('3: clicking the header clears the whole selection', $$('.exercise-row--selected').length === 0);

// Empty space inside the list is not a row, so it deselects too.
click(0);
$('.exercise-list').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('3: clicking empty space INSIDE the list also deselects',
  $$('.exercise-row--selected').length === 0, $$('.exercise-row--selected').length);

click(0);
document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('3: clicking the body deselects', $$('.exercise-row--selected').length === 0);

// Clicking a descendant of a row still counts as clicking the row.
click(0);
rows()[0].querySelector('.exercise-row__title')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('3: clicking a row’s inner text keeps the selection',
  $$('.exercise-row--selected').length === 1, $$('.exercise-row--selected').length);
document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

// ---------- 4. hover animates the row images ----------
const firstBox = () => rows()[0].querySelector('.exercise-row__image-box');
const enter = (i) => rows()[i].dispatchEvent(new dom.window.MouseEvent('mouseenter'));
const leave = (i) => rows()[i].dispatchEvent(new dom.window.MouseEvent('mouseleave'));

check('4: still image before hover', Boolean(firstBox().querySelector('.exercise-row__image')));
check('4: no animation before hover', !firstBox().querySelector('.seq-anim__img'));
enter(0);
check('4: hover adds the animation img', Boolean(firstBox().querySelector('.seq-anim__img')));
check('4: hover hides the still image', firstBox().querySelector('.exercise-row__image').hidden === true);
leave(0);
check('4: leaving removes the animation', !firstBox().querySelector('.seq-anim__img'));
check('4: leaving restores the still image', firstBox().querySelector('.exercise-row__image').hidden === false);

// A single-image row has nothing to animate.
const secondBox = () => rows()[1].querySelector('.exercise-row__image-box');
enter(1);
check('4: a one-image row does not animate', !secondBox().querySelector('.seq-anim__img'));
leave(1);

// ---------- 5. drag rows to reorder ----------
function dragTransfer() {
  const store = {};
  return { effectAllowed: '', dropEffect: '', setData(k, v) { store[k] = String(v); }, getData(k) { return store[k]; } };
}
function fire(node, type, dt, clientY) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  Object.defineProperty(event, 'clientY', { value: clientY });
  node.dispatchEvent(event);
}

check('5: rows are draggable', rows()[0].getAttribute('draggable') === 'true');
check('5: starting order', names() === 'Первое,Второе,Третье,Четвёртое', names());

// Drag row 0 below row 2 (clientY > 0 lands on the lower half in jsdom).
let dt = dragTransfer();
fire(rows()[0], 'dragstart', dt, 0);
fire(rows()[2], 'dragover', dt, 1);
fire(rows()[2], 'drop', dt, 1);
check('5: single row moved down', names() === 'Второе,Третье,Первое,Четвёртое', names());

// Drag the last row to the very top.
dt = dragTransfer();
fire(rows()[3], 'dragstart', dt, 0);
fire(rows()[0], 'dragover', dt, 0);
fire(rows()[0], 'drop', dt, 0);
check('5: single row moved to the top', names() === 'Четвёртое,Второе,Третье,Первое', names());

// Multi-selection drag: select rows 0 and 1, drop them below row 3.
click(0);
click(1, { ctrlKey: true });
check('5: two rows selected for dragging', $$('.exercise-row--selected').length === 2);
dt = dragTransfer();
fire(rows()[0], 'dragstart', dt, 0);
check('5: both dragged rows get the dragging class',
  $$('.exercise-row--dragging').length === 2, $$('.exercise-row--dragging').length);
fire(rows()[3], 'dragover', dt, 1);
fire(rows()[3], 'drop', dt, 1);
check('5: both selected rows moved together, order preserved',
  names() === 'Третье,Первое,Четвёртое,Второе', names());

// Dragging an unselected row moves only that row and leaves the selection be.
click(0);
dt = dragTransfer();
fire(rows()[2], 'dragstart', dt, 0);
check('5: dragging an unselected row drags only it',
  $$('.exercise-row--dragging').length === 1, $$('.exercise-row--dragging').length);
fire(rows()[0], 'dragover', dt, 0);
fire(rows()[0], 'drop', dt, 0);
check('5: unselected row moved alone', names() === 'Четвёртое,Третье,Первое,Второе', names());

// Dropping in place must not reorder.
const before = names();
dt = dragTransfer();
fire(rows()[1], 'dragstart', dt, 0);
fire(rows()[1], 'dragover', dt, 0);
fire(rows()[1], 'drop', dt, 0);
check('5: dropping a row in place is a no-op', names() === before, names());

// ---------- 6. indicator slots show the "not selected" grey ----------
setUiFlag('showIndicators', true);
const cells = rows()[0].querySelectorAll('.color-line__cell');
check('6: 15 slots (3 lines x 5)', cells.length === 15, cells.length);
check('6: every empty slot is the not-selected grey',
  Array.from(cells).every((c) => c.style.background === 'var(--not-selected)'),
  cells[0].style.background);
check('6: no slot is transparent',
  !Array.from(cells).some((c) => c.style.background === 'transparent'));

// With real feedback the colours come through.
const target = activeCategory().exercises[0];
target.feedback.technique = [
  { date: '2026-09-01', level: 'easy' },
  { date: '2026-09-02', level: 'hard' },
];
setUiFlag('showIndicators', true); // triggers a re-render
const techCells = Array.from(rows()[0].querySelectorAll('.indicator'))[0]
  .querySelectorAll('.color-line__cell');
check('6: rated slots use their level colour',
  techCells[3].style.background === 'var(--easy)' && techCells[4].style.background === 'var(--hard)',
  techCells[3].style.background + ' / ' + techCells[4].style.background);
check('6: unrated slots stay grey', techCells[0].style.background === 'var(--not-selected)');

// ---------- 9. Ctrl+D opens the add flow ----------
const picker = Array.from(document.querySelectorAll('input[type=file]'))
  .find((i) => i.classList.contains('visually-hidden'));
let pickerClicks = 0;
picker.addEventListener('click', () => { pickerClicks += 1; });

const ctrlD = (extra) => {
  const event = new dom.window.KeyboardEvent('keydown',
    Object.assign({ code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true }, extra));
  document.dispatchEvent(event);
  return event;
};

let event = ctrlD({ key: 'd' });
check('5: Ctrl+D opens the file picker', pickerClicks === 1, pickerClicks);
check('5: Ctrl+D suppresses the browser default', event.defaultPrevented === true);

// The real reason it failed before: on a Russian layout the D key reports
// event.key === 'в', so a key-based match never fires.
event = ctrlD({ key: 'в' });
check('5: works on a Russian layout (event.key === "в")', pickerClicks === 2, pickerClicks);
check('5: still suppresses the browser default on a Russian layout',
  event.defaultPrevented === true);

// Capital / Shift variants and other layouts all share the same physical code.
ctrlD({ key: 'D' });
check('5: capital D also works', pickerClicks === 3, pickerClicks);

document.dispatchEvent(new dom.window.KeyboardEvent('keydown',
  { code: 'KeyD', key: 'd', bubbles: true, cancelable: true }));
check('5: D without Ctrl does nothing', pickerClicks === 3, pickerClicks);

document.dispatchEvent(new dom.window.KeyboardEvent('keydown',
  { code: 'KeyF', key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
check('5: Ctrl+F is left alone', pickerClicks === 3, pickerClicks);

// ---------- 7. edit popup title is the exercise name ----------
const existing = activeCategory().exercises[0];
openExerciseModal({ images: existing.images, exercise: existing, onSubmit: () => {} });
check('7: edit popup title is the exercise name',
  $('.popup__title').textContent === existing.name, $('.popup__title').textContent);
check('7: edit popup button still says Сохранить', $('.popup .main-button').textContent === 'Сохранить');
closeModal();

openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: () => {} });
check('7: create popup keeps the generic title',
  $('.popup__title').textContent === 'Новое упражнение', $('.popup__title').textContent);
closeModal();

// A nameless exercise still gets a heading.
const nameless = createExercise({ name: '', description: '', images: [blob()] });
openExerciseModal({ images: nameless.images, exercise: nameless, onSubmit: () => {} });
check('7: a nameless exercise falls back to "Упражнение"',
  $('.popup__title').textContent === 'Упражнение', $('.popup__title').textContent);
closeModal();

// ---------- 8. Enter submits, Ctrl+Enter inserts a newline ----------
let submitted = null;
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: (f) => { submitted = f; } });
$('.input--text').value = 'Название';
$('.input--text').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
check('8: Enter in the name field submits', submitted !== null && submitted.name === 'Название',
  submitted && submitted.name);
check('8: Enter closed the popup', !isModalOpen());

submitted = null;
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: (f) => { submitted = f; } });
const area = $('.input--textarea');
area.value = 'первая';
area.selectionStart = area.selectionEnd = area.value.length;
area.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
check('8: Ctrl+Enter inserts a newline in the description', area.value === 'первая\n', JSON.stringify(area.value));
check('8: Ctrl+Enter did not submit', submitted === null && isModalOpen());

area.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
check('8: plain Enter in the description submits instead of adding a line',
  submitted !== null, submitted === null ? 'not submitted' : 'ok');
check('8: description keeps the Ctrl+Enter newline',
  submitted && submitted.description === 'первая', JSON.stringify(submitted && submitted.description));
check('8: popup closed', !isModalOpen());

// Enter on a focused button must activate that button, not submit the form.
submitted = null;
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: (f) => { submitted = f; } });
let pickerOpened = 0;
$('.popup input[type=file]').addEventListener('click', () => { pickerOpened += 1; });
const changeButton = $('.change-image-button');
const keyEvent = new dom.window.KeyboardEvent('Enter', { key: 'Enter', bubbles: true, cancelable: true });
changeButton.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
check('8: Enter on a button does not submit the popup', submitted === null && isModalOpen());
closeModal();

// ---------- 4. Enter works with no field focused ----------
const enterOn = (node) => node.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

submitted = null;
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: (f) => { submitted = f; } });
$('.input--text').value = 'Без фокуса';
$('.input--text').blur();
check('4: nothing is focused', document.activeElement === document.body ||
  document.activeElement === null, document.activeElement && document.activeElement.tagName);
enterOn(document.body);
check('4: Enter submits with no field focused', submitted !== null && submitted.name === 'Без фокуса',
  submitted && submitted.name);
check('4: popup closed', !isModalOpen());

// Also from the overlay and from a checkbox, neither of which is a text field.
submitted = null;
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: (f) => { submitted = f; } });
$('.input--text').value = 'С оверлея';
enterOn($('.overlay'));
check('4: Enter submits when the overlay has focus', submitted !== null && submitted.name === 'С оверлея',
  submitted && submitted.name);

submitted = null;
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: (f) => { submitted = f; } });
$('.input--text').value = 'С чекбокса';
enterOn($('.equipment-options .checkbox__input'));
check('4: Enter submits from a focused checkbox', submitted !== null && submitted.name === 'С чекбокса',
  submitted && submitted.name);

// Escape must still work from outside the popup too.
openExerciseModal({ images: [blob()], defaultEquipment: ['mat'], onSubmit: () => { submitted = 'BAD'; } });
submitted = null;
document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
check('4: Escape still closes with nothing focused', !isModalOpen() && submitted === null);

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/Save failed|Could not load saved data|MODULE_TYPELESS/.test(e));
console.log(results.join('\n'));
console.log('\nunexpected console errors: ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
