// Category buttons: add, rename in place, delete, and migration of a
// version-1 save (which had no category names and no explicit order).

import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

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

// ---------- seed a version-1 record, as saved by the previous build ----------
const V1 = {
  version: 1,
  categories: {
    ankle: { exercises: [{ id: 'ex_a', name: 'Старое упражнение', description: 'd',
             equipment: ['mat'], images: [], favorite: true, lastDurationSec: 120,
             feedback: { technique: [], rangeOfMotion: [], strength: [] } }],
             complexes: [], scheduleEnabled: true, scheduleStartDate: '19 сен', intervalDays: 3 },
    hip: { exercises: [], complexes: [], scheduleEnabled: false, scheduleStartDate: '', intervalDays: 1 },
  },
  lastEquipment: ['roller'],
  ui: { activeCategory: 'ankle', showIndicators: true, showFavorites: false,
        onlyEnabledComplexes: false, favoritesOnly: false },
};

await new Promise((resolve, reject) => {
  const request = indexedDB.open('fitness_app', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('state');
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(V1, 'current');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
  request.onerror = () => reject(request.error);
});

const store = await mod('store.js');
const { mountSchedulePage } = await mod('schedule-page.js');
const { DEFAULT_CATEGORIES, NEW_CATEGORY_NAME } = await mod('model.js');

await store.initStore();

// ---------- migration ----------
const s = store.getState();
check('migration: version bumped to 2', s.version === 2, s.version);
check('migration: category order rebuilt', Array.isArray(s.categoryOrder), s.categoryOrder);
check('migration: only the saved categories are kept',
  s.categoryOrder.join() === 'ankle,hip', s.categoryOrder.join());
check('migration: names recovered from the seed list',
  s.categories.ankle.name === 'Голеностоп' && s.categories.hip.name === 'ТБС',
  s.categories.ankle.name + '/' + s.categories.hip.name);
check('migration: exercises preserved',
  s.categories.ankle.exercises.length === 1 &&
  s.categories.ankle.exercises[0].name === 'Старое упражнение',
  s.categories.ankle.exercises.length);
check('migration: exercise fields preserved',
  s.categories.ankle.exercises[0].favorite === true);
check('migration: per-category settings preserved',
  s.categories.ankle.scheduleStartDate === '19 сен' &&
  s.categories.ankle.intervalDays === 3 &&
  s.categories.hip.scheduleEnabled === false);
check('migration: lastEquipment preserved', s.lastEquipment.join() === 'roller');
check('migration: ui flags preserved', s.ui.showIndicators === true);
check('migration: active category preserved', s.ui.activeCategory === 'ankle');

// ---------- render ----------
mountSchedulePage(document.getElementById('app'));
const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const buttons = () => $$('.menu-button');
const names = () => buttons().map(b => b.querySelector('.menu-button__sizer').textContent);
const activeButton = () => $('.menu-button--active');
const click = (node, init) => node.dispatchEvent(new dom.window.MouseEvent('click', Object.assign({ bubbles: true }, init)));
const dbl = (node) => node.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
const key = (node, k, init) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, init)));

check('renders one button per stored category', buttons().length === 2, buttons().length);
check('button labels come from state', names().join() === 'Голеностоп,ТБС', names().join());
check('the active button is marked', activeButton().querySelector('.menu-button__sizer').textContent === 'Голеностоп');
check('a sizer span exists to fix the width', $$('.menu-button__sizer').length === 2);
check('the visible label is separate from the sizer', $$('.menu-button__label').length === 2);

// close button only on the active one
check('close button only on the active button', $$('.menu-button__close').length === 1);
check('close button lives inside the active button',
  Boolean(activeButton().querySelector('.menu-button__close')));

// ---------- switching ----------
click(buttons()[1]);
check('clicking a button activates its category', store.getState().ui.activeCategory === 'hip');
check('close button moved to the new active button',
  activeButton().querySelector('.menu-button__sizer').textContent === 'ТБС');

// ---------- rename: double-click, Enter ----------
dbl(buttons()[1]);
let input = $('.menu-button__input');
check('double-click opens an input', Boolean(input));
check('input carries the current name', input && input.value === 'ТБС', input && input.value);
check('all of the name is selected',
  input.selectionStart === 0 && input.selectionEnd === 'ТБС'.length,
  input && (input.selectionStart + '-' + input.selectionEnd));
check('caret sits at the end of the name', input.selectionEnd === input.value.length);
check('the sizer still holds the OLD name, freezing the width',
  buttons()[1].querySelector('.menu-button__sizer').textContent === 'ТБС');
check('editing button is styled as editing', buttons()[1].classList.contains('menu-button--editing'));

input.value = 'Бедро';
key(input, 'Enter');
check('Enter saves the new name', store.getState().categories.hip.name === 'Бедро',
  store.getState().categories.hip.name);
check('editing state left behind', !$('.menu-button__input'));
check('the sizer now carries the new name, so the width follows it',
  names().join() === 'Голеностоп,Бедро', names().join());

// ---------- rename: Esc cancels ----------
dbl(buttons()[1]);
input = $('.menu-button__input');
input.value = 'Выброшенное имя';
key(input, 'Escape');
check('Esc keeps the old name', store.getState().categories.hip.name === 'Бедро',
  store.getState().categories.hip.name);
check('Esc leaves the editing state', !$('.menu-button__input'));

// ---------- rename: blur commits (click outside) ----------
dbl(buttons()[1]);
input = $('.menu-button__input');
input.value = 'ТБС и бедро';
input.dispatchEvent(new dom.window.Event('blur'));
check('clicking outside saves the name', store.getState().categories.hip.name === 'ТБС и бедро',
  store.getState().categories.hip.name);

// ---------- rename: an empty name is rejected ----------
dbl(buttons()[1]);
input = $('.menu-button__input');
input.value = '   ';
key(input, 'Enter');
check('a blank name keeps the previous one',
  store.getState().categories.hip.name === 'ТБС и бедро', store.getState().categories.hip.name);
check('blank name still exits editing', !$('.menu-button__input'));

// ---------- add a category ----------
const addButton = $('.add-category-button');
check('the add button is a real button', addButton && addButton.tagName === 'BUTTON');
click(addButton);
check('a category was added', store.getState().categoryOrder.length === 3, store.getState().categoryOrder.length);
const newId = store.getState().categoryOrder[2];
check('the new category is named "Новая категория"',
  store.getState().categories[newId].name === NEW_CATEGORY_NAME,
  store.getState().categories[newId].name);
check('the new category becomes active', store.getState().ui.activeCategory === newId);
check('the new category opens straight into editing', Boolean($('.menu-button__input')));
input = $('.menu-button__input');
check('its name is preselected', input.selectionStart === 0 && input.selectionEnd === NEW_CATEGORY_NAME.length);
input.value = 'МФР рук';
key(input, 'Enter');
check('typing a name over it saves', store.getState().categories[newId].name === 'МФР рук',
  store.getState().categories[newId].name);
check('three buttons now', names().join() === 'Голеностоп,ТБС и бедро,МФР рук', names().join());

// the new category is empty, so the page shows the empty state
check('new category shows the add-exercise empty state', Boolean($('.empty-state')));

// ---------- delete via the close button ----------
store.setActiveCategory('ankle');
check('ankle is active with its exercise', $$('.exercise-row').length === 1, $$('.exercise-row').length);
click(activeButton().querySelector('.menu-button__close'));
check('the category is gone', store.getState().categoryOrder.join() === 'hip,' + newId,
  store.getState().categoryOrder.join());
check('the NEXT category is opened', store.getState().ui.activeCategory === 'hip',
  store.getState().ui.activeCategory);
check('its exercises went with it', !store.getState().categories.ankle);

// deleting the last one falls back to the previous
store.setActiveCategory(newId);
click(activeButton().querySelector('.menu-button__close'));
check('deleting the last category falls back to the previous',
  store.getState().ui.activeCategory === 'hip', store.getState().ui.activeCategory);

// deleting the only remaining one leaves nothing selected
click(activeButton().querySelector('.menu-button__close'));
check('all categories can be deleted', store.getState().categoryOrder.length === 0);
check('no active category left', store.getState().ui.activeCategory === null,
  store.getState().ui.activeCategory);
check('page still renders without categories', Boolean($('.page')));
check('no columns and no empty state without a category', !$('.main') && !$('.empty-state'));
check('the add button is still there', Boolean($('.add-category-button')));
check('no category buttons remain', buttons().length === 0);

// and adding one recovers
click($('.add-category-button'));
check('adding recovers from an empty category list',
  store.getState().categoryOrder.length === 1 && Boolean($('.menu-button__input')));
key($('.menu-button__input'), 'Escape');
check('the recovered category keeps the default name',
  store.getState().categories[store.getState().categoryOrder[0]].name === NEW_CATEGORY_NAME);

// ---------- persistence round-trip ----------
await new Promise(r => setTimeout(r, 300));   // let the debounced save land
const reloaded = await (await mod('db.js')).loadState();
check('state persisted with the new shape',
  reloaded && reloaded.version === 2 && Array.isArray(reloaded.categoryOrder),
  reloaded && reloaded.version);
check('persisted category has a name',
  reloaded && reloaded.categories[reloaded.categoryOrder[0]].name === NEW_CATEGORY_NAME);

// ---------- report ----------
console.error = origError;
const real = errors.filter((e) => !/MODULE_TYPELESS|Save failed|Could not load/.test(e));
console.log(results.join('\n'));
console.log('\nunexpected console errors: ' + real.length);
if (real.length) console.log(real.join('\n'));
console.log('\n' + (failures === 0 && real.length === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 && real.length === 0 ? 0 : 1);
