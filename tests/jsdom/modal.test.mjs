// Runtime test for Add_exercise_popup: structure, drag reordering, equipment
// memory, and the submit / discard semantics.

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
// Distinct sizes so each blob gets a distinguishable fake URL.
global.URL.createObjectURL = (b) => 'blob:' + b.size;

let failures = 0;
const results = [];
function check(name, condition, detail) {
  if (condition) results.push('  PASS  ' + name);
  else { failures += 1; results.push('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.map(String).join(' '));

const { openExerciseModal, closeModal, isModalOpen } = await mod('exercise-modal.js');
const { initStore, getState, activeCategory, addExercise } = await mod('store.js');
const { createExercise } = await mod('model.js');
await initStore();

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const blob = (n) => new dom.window.Blob(['x'.repeat(n)], { type: 'image/jpeg' });

// ---------- structure with 2 images ----------
openExerciseModal({ images: [blob(1), blob(2)], defaultEquipment: ['mat'], onSubmit: () => {} });

check('modal is open', isModalOpen());
check('overlay present', Boolean($('.overlay')));
check('popup present', Boolean($('.popup')));
check('title text', $('.popup__title').textContent === 'Новое упражнение');
check('4 field rows', $$('.popup__fields .field').length === 4, $$('.popup__fields .field').length);
check('name input present', Boolean($('.input--text')));
check('description textarea present', Boolean($('.input--textarea')));
check('animation preview present', Boolean($('.animation-preview')));
check('animation img present', Boolean($('.animation-preview img')));
check('2 images -> one preview line', $$('.images-preview-line').length === 1);
check('2 real thumbs', $$('.image-thumb:not(.image-thumb--reserved)').length === 2);
check('2 reserved slots keep the row at 4', $$('.image-thumb--reserved').length === 2);
check('change photo button present', Boolean($('.change-image-button')));
check('8 equipment checkboxes', $$('.equipment-options .checkbox-line').length === 8);
check('mat checked by default',
  $$('.equipment-options .checkbox__input')[0].checked === true);
check('only mat checked',
  $$('.equipment-options .checkbox__input').filter((i) => i.checked).length === 1);
check('create mode button label', $('.popup .main-button').textContent === 'Добавить упражнение');
check('animation starts on the first image',
  $('.animation-preview img').getAttribute('src') === 'blob:1',
  $('.animation-preview img').getAttribute('src'));

// ---------- Esc discards ----------
let submitted = null;
document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Esc closes the modal', !isModalOpen());
check('Esc removed the overlay', !$('.overlay'));
check('Esc did not submit', submitted === null);

// ---------- click outside discards, click inside does not ----------
openExerciseModal({ images: [blob(1)], defaultEquipment: ['mat'], onSubmit: () => { submitted = 'yes'; } });
$('.popup').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('click inside the popup keeps it open', isModalOpen());
$('.overlay').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('click on the overlay closes it', !isModalOpen());
check('outside click did not submit', submitted === null);

// ---------- 7 images -> two lines ----------
openExerciseModal({
  images: [1, 2, 3, 4, 5, 6, 7].map(blob),
  defaultEquipment: ['mat'],
  onSubmit: () => {},
});
check('7 images -> two preview lines', $$('.images-preview-line').length === 2);
check('7 real thumbs', $$('.image-thumb:not(.image-thumb--reserved)').length === 7);
check('one reserved slot on the second line', $$('.image-thumb--reserved').length === 1);
check('first line holds 4',
  $$('.images-preview-line')[0].querySelectorAll('.image-thumb').length === 4);
check('second line holds 4 slots',
  $$('.images-preview-line')[1].querySelectorAll('.image-thumb').length === 4);
closeModal();

// ---------- drag reordering ----------
function dragTransfer() {
  const store = {};
  return {
    effectAllowed: '',
    dropEffect: '',
    setData(k, v) { store[k] = String(v); },
    getData(k) { return store[k]; },
  };
}

function fire(node, type, dt, clientX) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  Object.defineProperty(event, 'clientX', { value: clientX });
  node.dispatchEvent(event);
}

function order() {
  return $$('.image-thumb:not(.image-thumb--reserved) .image-thumb__img')
    .map((i) => i.getAttribute('src'));
}

// Move the first image to the end. jsdom reports a zero-size rect, so
// clientX > 0 lands on the "after" half of the target thumb.
openExerciseModal({ images: [blob(1), blob(2), blob(3)], defaultEquipment: ['mat'], onSubmit: () => {} });
check('initial order', order().join() === 'blob:1,blob:2,blob:3', order().join());

let thumbs = $$('.image-thumb:not(.image-thumb--reserved)');
let dt = dragTransfer();
fire(thumbs[0], 'dragstart', dt, 0);
fire(thumbs[2], 'dragover', dt, 1);
fire(thumbs[2], 'drop', dt, 1);
check('dragging the first image to the end reorders it',
  order().join() === 'blob:2,blob:3,blob:1', order().join());
check('animation picks up the new first frame immediately',
  $('.animation-preview img').getAttribute('src') === 'blob:2',
  $('.animation-preview img').getAttribute('src'));

// Move the last image to the front (drop on the "before" half of thumb 0).
thumbs = $$('.image-thumb:not(.image-thumb--reserved)');
dt = dragTransfer();
fire(thumbs[2], 'dragstart', dt, 0);
fire(thumbs[0], 'dragover', dt, 0);
fire(thumbs[0], 'drop', dt, 0);
check('dragging the last image to the front reorders it',
  order().join() === 'blob:1,blob:2,blob:3', order().join());
check('animation follows again',
  $('.animation-preview img').getAttribute('src') === 'blob:1');

// Dropping an image back onto its own position changes nothing.
thumbs = $$('.image-thumb:not(.image-thumb--reserved)');
dt = dragTransfer();
fire(thumbs[1], 'dragstart', dt, 0);
fire(thumbs[1], 'dragover', dt, 0);
fire(thumbs[1], 'drop', dt, 0);
check('dropping in place is a no-op', order().join() === 'blob:1,blob:2,blob:3', order().join());

// ---------- drag across the two lines ----------
closeModal();
openExerciseModal({ images: [1, 2, 3, 4, 5].map(blob), defaultEquipment: ['mat'], onSubmit: () => {} });
check('5 images -> two lines', $$('.images-preview-line').length === 2);
thumbs = $$('.image-thumb:not(.image-thumb--reserved)');
dt = dragTransfer();
fire(thumbs[4], 'dragstart', dt, 0);   // image 5, on line two
fire(thumbs[0], 'dragover', dt, 0);    // drop before image 1, on line one
fire(thumbs[0], 'drop', dt, 0);
check('image dragged from line two to line one',
  order().join() === 'blob:5,blob:1,blob:2,blob:3,blob:4', order().join());
check('line one now starts with the moved image',
  $$('.images-preview-line')[0].querySelector('.image-thumb__img').getAttribute('src') === 'blob:5');
closeModal();

// ---------- submit ----------
let payload = null;
openExerciseModal({
  images: [blob(1), blob(2)],
  defaultEquipment: ['mat'],
  onSubmit: (fields) => { payload = fields; },
});
$('.input--text').value = '  Скручивание ТБС  ';
$('.input--textarea').value = '  Описание упражнения  ';
const boxes = $$('.equipment-options .checkbox__input');
boxes[2].checked = true; boxes[2].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
boxes[0].checked = false; boxes[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
$('.popup .main-button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

check('submit closed the modal', !isModalOpen());
check('name is trimmed', payload && payload.name === 'Скручивание ТБС', payload && payload.name);
check('description is trimmed', payload && payload.description === 'Описание упражнения');
check('equipment reflects the boxes', payload && payload.equipment.join() === 'long_band',
  payload && payload.equipment.join());
check('images passed through in order', payload && payload.images.length === 2);

// ---------- equipment is remembered for the next exercise ----------
addExercise(createExercise(payload));
check('exercise added to the active category', activeCategory().exercises.length === 1);
check('store remembered the equipment', getState().lastEquipment.join() === 'long_band',
  getState().lastEquipment.join());

openExerciseModal({ images: [blob(1)], defaultEquipment: getState().lastEquipment, onSubmit: () => {} });
const nowChecked = $$('.equipment-options .checkbox__input')
  .map((i, idx) => (i.checked ? idx : null)).filter((v) => v !== null);
check('next exercise pre-ticks the previous equipment', nowChecked.join() === '2', nowChecked.join());
closeModal();

// ---------- edit mode ----------
const existing = activeCategory().exercises[0];
openExerciseModal({
  images: existing.images,
  exercise: existing,
  onSubmit: () => {},
});
check('edit mode button says Сохранить', $('.popup .main-button').textContent === 'Сохранить');
check('edit mode prefills the name', $('.input--text').value === 'Скручивание ТБС');
check('edit mode prefills the description', $('.input--textarea').value === 'Описание упражнения');
check('edit mode prefills the equipment',
  $$('.equipment-options .checkbox__input').filter((i) => i.checked).length === 1);
closeModal();
check('everything cleaned up', !$('.overlay') && !isModalOpen());

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/Save failed|Could not load saved data|MODULE_TYPELESS/.test(e));
console.log(results.join('\n'));
console.log('\nunexpected console errors: ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
