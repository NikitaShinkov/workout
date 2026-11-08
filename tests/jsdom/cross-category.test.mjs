// Carrying exercises and complexes into another category by dragging them onto
// its button: the category opens mid-drag, its list scrolls to the end with the
// marker there, and the release COPIES - to the end, or to a place in the
// matching list. The originals stay; the copies are independent; the whole
// thing can be undone.
//
// jsdom has no layout, so the rows get fake rects (layout()) wherever a drop
// position depends on geometry, as in complexes.test.mjs.

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

const ex = (id, name, extra = {}) => ({
  ...createExercise({ name, description: 'о ' + name, images: ['data/images/' + id + '.jpg'], equipment: ['mat'] }),
  id, ...extra,
});
const seed = () => ({
  version: 2, categoryOrder: ['a', 'b', 'c'],
  categories: {
    a: {
      name: 'Колено', scheduleEnabled: true, scheduleStartDate: '2026-09-03', intervalDays: 1, includeWeekends: true,
      exercises: [ex('a1', 'Присед', { favorite: true, lastDurationSec: 300 }), ex('a2', 'Выпад'), ex('a3', 'Мост')],
      complexes: [
        { id: 'ac1', enabled: true, items: [{ id: 'ai1', exerciseId: 'a1' }, { id: 'ai2', exerciseId: 'a2' }] },
        { id: 'ac2', enabled: false, items: [{ id: 'ai3', exerciseId: 'a3' }, { id: 'ai4', exerciseId: 'a1' }] },
      ],
    },
    b: {
      name: 'Спина и очень длинное имя категории', scheduleEnabled: true, scheduleStartDate: '2026-09-03',
      intervalDays: 1, includeWeekends: true,
      exercises: [ex('b1', 'Планка'), ex('b2', 'Кошка')],
      complexes: [
        { id: 'bc1', enabled: true, items: [{ id: 'bi1', exerciseId: 'b1' }] },
        { id: 'bc2', enabled: true, items: [{ id: 'bi2', exerciseId: 'b2' }] },
      ],
    },
    c: { name: 'Пустая', exercises: [], complexes: [] },
  },
  ui: { activeCategory: 'a' },
});

store.resetStore(seed());
mountSchedulePage(document.getElementById('app'));

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const S = () => store.getState();
const cat = (id) => S().categories[id];
const names = (id) => cat(id).exercises.map((e) => e.name).join(',');
const shape = (id) => {
  const byId = new Map(cat(id).exercises.map((e) => [e.id, e.name]));
  return cat(id).complexes
    .map((c) => (c.enabled ? '' : '(off)') + c.items.map((i) => byId.get(i.exerciseId)).join('+')).join(' | ');
};
const button = (id) => $('.categories .menu-button[data-id="' + id + '"]')
  || $$('.categories .menu-button').find((n) => n.querySelector('.menu-button__sizer').textContent === cat(id).name);
const libRows = () => $$('.column--exercise .exercise-row');
const sides = () => $$('.complex__side');
const label = () => ($('.undo-button span') || {}).textContent || '';

function setRect(node, top, height) {
  node.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 900, width: 900 });
}
const ROW_H = 66;
function layout() {
  let y = 0;
  for (const complexNode of $$('.complex-list .complex')) {
    const rows = Array.from(complexNode.querySelectorAll('.exercise-row'));
    setRect(complexNode, y, rows.length * ROW_H);
    rows.forEach((row, i) => setRect(row, y + i * ROW_H, ROW_H));
    y += rows.length * ROW_H;
  }
  libRows().forEach((row, i) => setRect(row, i * ROW_H, ROW_H));
}

function transfer() {
  const bag = {};
  return {
    effectAllowed: '', dropEffect: '',
    setData(k, v) { bag[k] = String(v); }, getData(k) { return bag[k]; }, setDragImage() {},
  };
}
function fire(node, type, dt, clientY = 0) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'clientX', { value: 10 });
  node.dispatchEvent(event);
  return event;
}
const click = (n, init) => n.dispatchEvent(new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, init)));
const undoKey = () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown',
  { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));

function reset() {
  for (let i = 0; i < 10 && $('.undo-button'); i += 1) undoKey();
  store.resetStore(seed());
  layout();
}

// ============================================================
// 1. one exercise onto another category's button, released there
// ============================================================

reset();
let dt = transfer();
let source = libRows()[0];                         // Присед
fire(source, 'dragstart', dt);
let over = fire(button('b'), 'dragover', dt);

check('1: hovering a category button opens that category', S().ui.activeCategory === 'b',
  S().ui.activeCategory);
check('1: its button is the selected one now',
  button('b').classList.contains('menu-button--active') && !button('a').classList.contains('menu-button--active'));
check('1: the page shows its exercises', $$('.column--exercise .exercise-row').length === 2);
check('1: the drop is accepted, as a copy', over.defaultPrevented && dt.dropEffect === 'copy',
  over.defaultPrevented + ' ' + dt.dropEffect);
check('1: the blue bar is under the LAST exercise',
  libRows()[1].classList.contains('exercise-row--drop-after')
  && $$('.exercise-row--drop-after, .exercise-row--drop-before').length === 1);
check('1: and not in the complex list', $$('.complex--drop-after, .complex--drop-before, .complex-list--drop').length === 0);
check('1: the node the drag began on is still in the document (its dragend can fire)',
  document.contains(source) && Boolean(source.closest('.drag-source-park')));

fire(button('b'), 'drop', dt);
fire(source, 'dragend', dt);
check('1: RELEASED ON THE BUTTON: copied to the end', names('b') === 'Планка,Кошка,Присед', names('b'));
check('1: the original stays where it was', names('a') === 'Присед,Выпад,Мост', names('a'));
const copy = cat('b').exercises[2];
const original = cat('a').exercises[0];
check('1: the copy is a NEW exercise, with its own id', copy.id !== original.id && copy.id.startsWith('ex'), copy.id);
check('1: with the same name, description, equipment and pictures',
  copy.name === original.name && copy.description === original.description
  && copy.equipment.join() === original.equipment.join() && copy.images.join() === original.images.join());
check('1: but none of the original\'s history (favourite, duration)',
  copy.favorite === false && copy.lastDurationSec === 120, JSON.stringify([copy.favorite, copy.lastDurationSec]));
check('1: no complexes were touched', shape('b') === 'Планка | Кошка' && shape('a') === 'Присед+Выпад | (off)Мост+Присед');
check('1: the undo button names the category, cut to 20',
  label().startsWith('Отменить перенос в Спина и очень длинно... (Ctrl+Z) '), label());
check('1: the park is cleared', !$('.drag-source-park'));

// Independent: editing the copy leaves the original alone, and the other way.
store.updateExercise(copy.id, { name: 'Присед в Спине' }, 'b');
check('1: renaming the copy does not rename the original', cat('a').exercises[0].name === 'Присед');
store.updateExercise('a1', { description: 'новое' }, 'a');
check('1: nor the other way round', cat('b').exercises[2].description === 'о Присед');

undoKey();
check('1: CTRL+Z UNDOES THE TRANSFER', names('b') === 'Планка,Кошка', names('b'));
check('1: and leaves the original', names('a') === 'Присед,Выпад,Мост', names('a'));
check('1: the undo opens the category it undid', S().ui.activeCategory === 'b');

// ============================================================
// 2. released elsewhere on the page, not in a list
// ============================================================

reset();
dt = transfer();
source = libRows()[1];                             // Выпад
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
over = fire($('.schedule-toolbar'), 'dragover', dt);
check('2: anywhere on the page but the lists accepts', over.defaultPrevented && dt.dropEffect === 'copy');
check('2: and still marks the end', libRows()[1].classList.contains('exercise-row--drop-after'));
fire($('.schedule-toolbar'), 'drop', dt);
fire(source, 'dragend', dt);
check('2: released over the toolbar: appended', names('b') === 'Планка,Кошка,Выпад', names('b'));

// ============================================================
// 3. into the matching list, at a position
// ============================================================

reset();
click(libRows()[0]);
click(libRows()[2], { ctrlKey: true });            // Присед + Мост
layout();
dt = transfer();
source = libRows()[2];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
layout();
over = fire(libRows()[0], 'dragover', dt, 10);     // top half of Планка
check('3: inside Exercise_list the marker follows the pointer',
  libRows()[0].classList.contains('exercise-row--drop-before')
  && !libRows()[1].classList.contains('exercise-row--drop-after'));
check('3: as a copy', over.defaultPrevented && dt.dropEffect === 'copy');
fire(libRows()[0], 'drop', dt, 10);
fire(source, 'dragend', dt);
check('3: A GROUP lands where it was dropped, in list order', names('b') === 'Присед,Мост,Планка,Кошка', names('b'));
check('3: both originals stay', names('a') === 'Присед,Выпад,Мост');
check('3: «Отменить перенос в …»', label().startsWith('Отменить перенос в '), label());
click($('.undo-button'));
check('3: the undo button takes both copies back out', names('b') === 'Планка,Кошка', names('b'));

// ============================================================
// 4. exercises into Complex_list become a complex there
// ============================================================

reset();
click(libRows()[0]);
click(libRows()[2], { ctrlKey: true });            // Присед + Мост
layout();
dt = transfer();
source = libRows()[0];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
layout();
// Over Кошка's row, above its middle: the boundary between the two complexes.
// Over a row, too - exercises from elsewhere never join an existing complex.
const kosh = $$('.complex-list .exercise-row')[1];
const intoComplexes = fire(kosh, 'dragover', dt, 70);
check('4: exercises over Complex_list ARE accepted, as a copy',
  intoComplexes.defaultPrevented && dt.dropEffect === 'copy', intoComplexes.defaultPrevented + ' ' + dt.dropEffect);
check('4: the marker is a complex boundary, not a slot inside a complex',
  $$('.complex-list .complex')[1].classList.contains('complex--drop-before')
  && $$('.exercise-row--drop-after, .exercise-row--drop-before').length === 0);
fire(kosh, 'drop', dt, 70);
fire(source, 'dragend', dt);
check('4: ONE new complex of them, at that boundary', shape('b') === 'Планка | Присед+Мост | Кошка', shape('b'));
check('4: the exercises are added to the end of Exercise_list', names('b') === 'Планка,Кошка,Присед,Мост', names('b'));
check('4: the new complex points at the copies',
  cat('b').complexes[1].items.every((i) => cat('b').exercises.slice(2).some((e) => e.id === i.exerciseId)));
check('4: the originals stay', names('a') === 'Присед,Выпад,Мост' && shape('a') === 'Присед+Выпад | (off)Мост+Присед');
check('4: «Отменить перенос в …»', label().startsWith('Отменить перенос в '), label());
undoKey();
check('4: undo takes out the complex and the exercises', shape('b') === 'Планка | Кошка' && names('b') === 'Планка,Кошка',
  shape('b') + ' / ' + names('b'));
check('4: the drag is fully ended (park gone)', !$('.drag-source-park'));

// Into a category whose Complex_list is empty, below nothing at all.
reset();
store.resetStore({ ...seed(), categories: { ...seed().categories,
  c: { name: 'Пустая', exercises: [ex('c1', 'Вис')], complexes: [] } } });
layout();
dt = transfer();
source = libRows()[1];                             // Выпад
fire(source, 'dragstart', dt);
fire(button('c'), 'dragover', dt);
over = fire($('.complex-list'), 'dragover', dt, 10);
check('4: an empty Complex_list takes them too', over.defaultPrevented
  && $('.complex-list').classList.contains('complex-list--drop'));
fire($('.complex-list'), 'drop', dt, 10);
fire(source, 'dragend', dt);
check('4: as its first complex', shape('c') === 'Выпад' && names('c') === 'Вис,Выпад', shape('c') + ' / ' + names('c'));

// ============================================================
// 5. a complex, released on the button
// ============================================================

reset();
dt = transfer();
source = sides()[1];                               // (off) Мост+Присед
fire(source, 'dragstart', dt);
check('5: a complex drag allows copy as well as move', dt.effectAllowed === 'copyMove', dt.effectAllowed);
fire(button('b'), 'dragover', dt);
check('5: the category opens', S().ui.activeCategory === 'b');
check('5: the blue bar is under the LAST complex',
  $$('.complex-list .complex')[1].classList.contains('complex--drop-after'));
check('5: and not in Exercise_list', $$('.exercise-row--drop-after, .exercise-row--drop-before').length === 0);
fire(button('b'), 'drop', dt);
fire(source, 'dragend', dt);
check('5: the complex is copied to the end, switched off as it was',
  shape('b') === 'Планка | Кошка | (off)Мост+Присед', shape('b'));
check('5: ITS EXERCISES ARE ADDED to the end of Exercise_list', names('b') === 'Планка,Кошка,Мост,Присед', names('b'));
const bx = cat('b');
const copied = bx.complexes[2];
check('5: the copied complex points at the COPIES, not the originals',
  copied.items.every((i) => bx.exercises.some((e) => e.id === i.exerciseId))
  && copied.items.every((i) => !cat('a').exercises.some((e) => e.id === i.exerciseId)));
check('5: new complex and item ids', copied.id !== 'ac2' && copied.items.every((i) => !i.id.startsWith('ai')));
check('5: the original complex is untouched', shape('a') === 'Присед+Выпад | (off)Мост+Присед');

// Undo removes the complex and the exercises it brought.
undoKey();
check('5: undo takes out the complex AND its exercises',
  shape('b') === 'Планка | Кошка' && names('b') === 'Планка,Кошка', shape('b') + ' / ' + names('b'));

// ============================================================
// 6. several complexes, into a place in Complex_list
// ============================================================

reset();
click(sides()[0]);
click(sides()[1], { ctrlKey: true });
layout();
dt = transfer();
source = sides()[0];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
layout();
// Over the first complex's top half: the boundary before it.
over = fire($$('.complex-list .exercise-row')[0], 'dragover', dt, 5);
check('6: inside Complex_list the marker follows the pointer',
  $$('.complex-list .complex')[0].classList.contains('complex--drop-before'));
check('6: as a copy', over.defaultPrevented && dt.dropEffect === 'copy');
fire($$('.complex-list .exercise-row')[0], 'drop', dt, 5);
fire(source, 'dragend', dt);
check('6: both complexes land there, in order',
  shape('b') === 'Присед+Выпад | (off)Мост+Присед | Планка | Кошка', shape('b'));
check('6: an exercise in BOTH complexes is copied once and shared, as it was',
  names('b') === 'Планка,Кошка,Присед,Выпад,Мост', names('b'));
const [p1, p2] = [cat('b').complexes[0].items[0].exerciseId, cat('b').complexes[1].items[1].exerciseId];
check('6: (both blocks point at the one copy of Присед)', p1 === p2);
check('6: «Отменить перенос в …»', label().startsWith('Отменить перенос в '), label());

// ============================================================
// 7. complexes are refused by Exercise_list
// ============================================================

reset();
dt = transfer();
source = sides()[0];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
layout();
const intoLibrary = fire(libRows()[0], 'dragover', dt, 10);
check('7: a complex over Exercise_list is not accepted', !intoLibrary.defaultPrevented);
check('7: and the end marker comes off',
  $$('.complex--drop-after, .complex--drop-before, .complex-list--drop').length === 0);
fire(source, 'dragend', dt);
check('7: nothing copied', shape('b') === 'Планка | Кошка');

// ============================================================
// 8. passing over categories, and coming home
// ============================================================

reset();
dt = transfer();
source = libRows()[0];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
fire(button('c'), 'dragover', dt);
check('8: the next category hovered opens instead', S().ui.activeCategory === 'c');
fire(button('a'), 'dragover', dt);
check('8: hovering the category it came from goes back', S().ui.activeCategory === 'a');
over = fire($('.schedule-toolbar'), 'dragover', dt);
check('8: and at home a release outside the lists is NOT a copy', !over.defaultPrevented);
fire(source, 'dragend', dt);
check('8: nothing was copied anywhere',
  names('a') === 'Присед,Выпад,Мост' && names('b') === 'Планка,Кошка' && names('c') === '');

// Into an empty category - which has no lists at all, only the add button.
reset();
dt = transfer();
source = sides()[0];
fire(source, 'dragstart', dt);
fire(button('c'), 'dragover', dt);
over = fire($('.empty-state') || $('.page'), 'dragover', dt);
check('8: an empty category accepts', over.defaultPrevented);
fire($('.empty-state') || $('.page'), 'drop', dt);
fire(source, 'dragend', dt);
check('8: and gets the complex and its exercises', shape('c') === 'Присед+Выпад' && names('c') === 'Присед,Выпад',
  shape('c') + ' / ' + names('c'));

// ============================================================
// 9. a block inside a complex does not travel
// ============================================================

reset();
dt = transfer();
source = $$('.complex-list .exercise-row')[0];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
check('9: a block from a complex does not open another category', S().ui.activeCategory === 'a');
fire(source, 'dragend', dt);

// ============================================================
// 10. what is written, and undo order
// ============================================================

reset();
dt = transfer();
source = sides()[0];
fire(source, 'dragstart', dt);
fire(button('b'), 'dragover', dt);
fire(button('b'), 'drop', dt);
fire(source, 'dragend', dt);
const { serializeForRepo } = await mod('sync.js');
const { out } = await serializeForRepo(S());
const written = out.categories.b;
check('10: the copies are written into the target category of state.json',
  written.exercises.length === 4 && written.complexes.length === 3);
check('10: their images are the same content-addressed files',
  written.exercises[2].images[0] === 'data/images/a1.jpg', written.exercises[2].images.join());

// Then delete one of the copies: the undo stack is shared, newest first.
click(libRows()[2]);
document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
check('10: a deletion after the transfer is offered first', label().startsWith('Восстановить Присед'), label());
undoKey();
check('10: then the transfer', label().startsWith('Отменить перенос в '), label());
undoKey();
check('10: and both undone leave the category as it was',
  names('b') === 'Планка,Кошка' && shape('b') === 'Планка | Кошка', names('b') + ' / ' + shape('b'));

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/MODULE_TYPELESS|Save failed|Could not load/.test(e));
console.log(results.join('\n'));
console.log('\nunexpected console errors: ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
