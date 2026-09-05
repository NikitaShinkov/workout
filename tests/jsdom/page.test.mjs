// Runtime smoke test for the Schedule page under jsdom.
// Covers everything that does not need real image decoding.

import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

import { PROJECT } from '../helpers/env.mjs';
const mod = (p) => import(pathToFileURL(PROJECT + '/js/' + p).href);

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

// Expose the browser globals the modules expect.
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.Blob = dom.window.Blob;
global.URL.createObjectURL = (b) => 'blob:fake/' + (b && b.size);
// indexedDB is intentionally left undefined: db.js must degrade gracefully.

let failures = 0;
const results = [];
function check(name, condition, detail) {
  if (condition) {
    results.push('  PASS  ' + name);
  } else {
    failures += 1;
    results.push('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

const errors = [];
dom.window.addEventListener('error', (e) => errors.push(String(e.message)));
const origError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); };

const { initStore, getState, activeCategory, addExercise, deleteExercises,
        toggleFavorite, setActiveCategory, setUiFlag } = await mod('store.js');
const { mountSchedulePage } = await mod('schedule-page.js');
const { createExercise, DEFAULT_CATEGORIES: CATEGORIES } = await mod('model.js');
const { createSequenceAnimation } = await mod('animation.js');
const { chunk } = await mod('dom.js');

// ---------- boot ----------
await initStore();
mountSchedulePage(document.getElementById('app'));

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

check('page renders', Boolean($('.page')));
check('7 category buttons', $$('.menu-button').length === 7, $$('.menu-button').length);
check('first category active by default', $('.menu-button').classList.contains('menu-button--active'));
check('empty category shows only the empty state', Boolean($('.empty-state')) && !$('.main'));
check('empty state has an add button', Boolean($('.empty-state .main-button')));
check('view options: 2 icon buttons + 2 checkboxes',
  $$('.view-options .icon-button').length === 2 && $$('.view-options .checkbox-line').length === 2);

// ---------- add exercises ----------
const fakeBlob = new dom.window.Blob(['x'], { type: 'image/jpeg' });
for (const name of ['Первое', 'Второе', 'Третье', 'Четвёртое']) {
  addExercise(createExercise({ name, description: 'описание ' + name, images: [fakeBlob], equipment: ['mat'] }));
}

check('4 rows rendered', $$('.exercise-row').length === 4, $$('.exercise-row').length);
check('columns appear once exercises exist', Boolean($('.main')) && $$('.column').length === 2);
check('schedule toolbar present', Boolean($('.schedule-toolbar .switch')));
check('exercise toolbar add button present', Boolean($('.exercise-toolbar .main-button')));
check('no empty state now', !$('.empty-state'));
check('row title text', $('.exercise-row__title').textContent === 'Первое');
check('indicators hidden by default', $$('.indicators').length === 0);
check('stars hidden by default', $$('.favorite-star').length === 0);

// ---------- view options drive row extras ----------
setUiFlag('showIndicators', true);
check('indicators shown when enabled', $$('.indicators').length === 4);
check('3 indicator rows per exercise', $$('.exercise-row')[0].querySelectorAll('.indicator').length === 3);
check('5 slots per indicator', $$('.exercise-row')[0].querySelectorAll('.indicator .color-line__cell').length === 15);
const cells = $$('.exercise-row')[0].querySelectorAll('.color-line__cell');
check('no feedback -> all slots show the "not selected" grey',
  Array.from(cells).every((c) => c.style.background === 'var(--not-selected)'),
  cells[0] && cells[0].style.background);

setUiFlag('showFavorites', true);
check('stars shown when enabled', $$('.favorite-star').length === 4);
check('star not active initially', !$('.favorite-star').classList.contains('favorite-star--active'));

// ---------- favorite toggle ----------
$('.favorite-star').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('favorite flag set on data', activeCategory().exercises[0].favorite === true);
check('star renders active', $('.favorite-star').classList.contains('favorite-star--active'));
check('clicking the star did not select the row', $$('.exercise-row--selected').length === 0);
$('.favorite-star').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('favorite toggles back off', activeCategory().exercises[0].favorite === false);

// ---------- selection ----------
const click = (i, init) => $$('.exercise-row')[i].dispatchEvent(
  new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, init)));

click(1);
check('plain click selects one', $$('.exercise-row--selected').length === 1);

click(3, { shiftKey: true });
check('shift click selects the range', $$('.exercise-row--selected').length === 3);

click(0, { ctrlKey: true });
check('ctrl click adds to the selection', $$('.exercise-row--selected').length === 4);

click(0, { ctrlKey: true });
check('ctrl click on a selected row removes it', $$('.exercise-row--selected').length === 3);

click(2);
check('plain click resets to one', $$('.exercise-row--selected').length === 1);

// ---------- delete ----------
click(1);
click(2, { shiftKey: true });
check('two selected before delete', $$('.exercise-row--selected').length === 2);
document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
check('Delete removed the selected rows', activeCategory().exercises.length === 2, activeCategory().exercises.length);
check('remaining rows re-rendered', $$('.exercise-row').length === 2);
check('selection cleared after delete', $$('.exercise-row--selected').length === 0);

// ---------- Delete must not fire while typing in a field ----------
const before = activeCategory().exercises.length;
click(0);
const dateInput = $('.input--date');
dateInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
check('Delete inside an input does not delete exercises', activeCategory().exercises.length === before);

// ---------- category isolation ----------
setActiveCategory(CATEGORIES[1].id);
check('switching category shows its own (empty) state', Boolean($('.empty-state')));
check('other category has no exercises', activeCategory().exercises.length === 0);
setActiveCategory(CATEGORIES[0].id);
check('switching back restores exercises', activeCategory().exercises.length === before);
check('exercises still isolated per category',
  getState().categories[CATEGORIES[1].id].exercises.length === 0);

// ---------- animation module ----------
const holder = document.createElement('div');
const anim = createSequenceAnimation(holder, { intervalMs: 200 });
anim.setFrames(['a.jpg', 'b.jpg', 'c.jpg']);
check('animation created an img', Boolean(holder.querySelector('img')));
check('animation shows the first frame', holder.querySelector('img').getAttribute('src') === 'a.jpg');
anim.setFrames(['c.jpg', 'a.jpg', 'b.jpg']);
check('reordering frames restarts at the new first frame',
  holder.querySelector('img').getAttribute('src') === 'c.jpg');
anim.setFrames([]);
check('empty frame list clears the img', !holder.querySelector('img').hasAttribute('src'));
anim.destroy();
check('destroy removes the img', !holder.querySelector('img'));

// ---------- images_preview_line chunking ----------
check('2 images -> 1 line', chunk([1, 2], 4).length === 1);
check('4 images -> 1 line', chunk([1, 2, 3, 4], 4).length === 1);
check('7 images -> 2 lines', chunk([1, 2, 3, 4, 5, 6, 7], 4).length === 2);
check('7 images -> second line holds 3', chunk([1, 2, 3, 4, 5, 6, 7], 4)[1].length === 3);
check('10 images -> 3 lines', chunk([1,2,3,4,5,6,7,8,9,10], 4).length === 3);

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/Save failed|Could not load saved data/.test(e));
console.log(results.join('\n'));
console.log('\nconsole/window errors (excluding expected no-IndexedDB warnings): ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
