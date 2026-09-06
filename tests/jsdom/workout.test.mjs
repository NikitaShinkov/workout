// The workout page under jsdom: the three days, what a Complex_block says, and
// the swipe that walks the preview through a complex.
//
// Geometry - the 400px cap, the two halves, the header vanishing on a phone -
// is in tests/browser/workout-layout, which has a layout engine.

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
global.URL.createObjectURL = (b) => 'blob:fake/' + (b && b.size);

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

const near = (a, b) => Math.abs(a - b) < 0.001;

const errors = [];
dom.window.addEventListener('error', (e) => errors.push(String(e.message)));
console.error = (...args) => { errors.push(args.map(String).join(' ')); };

const {
  initStore, getState, activeCategory, addExercise, updateExercise,
  setActiveCategory, setCategoryField, createComplexFromExercises,
  setComplexEnabled, setUiFlag,
} = await mod('store.js');
const { mountWorkoutPage, buildWorkoutDays, plural, resetWorkoutState } =
  await mod('workout-page.js');
const { createExercise } = await mod('model.js');
const { formatDate, startOfDay, addDays } = await mod('schedule.js');

// ---------- a schedule that starts today ----------
//
// Two categories, so a day can carry a complex from each. Every category's
// default start date is 3 сен, which is in the past most of the year - moved to
// today, the complexes land on the three days this page shows.

await initStore();
const blob = new dom.window.Blob(['x'], { type: 'image/jpeg' });
const [first, second] = getState().categoryOrder;

// Category one: three complexes, so it reaches all three days. The first has
// two exercises whose equipment overlaps, which is what the union has to fold.
setActiveCategory(first);
setCategoryField('scheduleStartDate', formatDate(startOfDay()));
for (const [name, equipment] of [
  ['Первое', ['mat', 'roller']],
  ['Второе', ['short_band', 'mat']],
  ['Третье', ['mat']],
  ['Четвёртое', ['chair']],
]) {
  addExercise(createExercise({ name, description: 'о ' + name, images: [blob, blob], equipment }));
}
const ids = activeCategory().exercises.map((e) => e.id);
createComplexFromExercises(ids.slice(0, 2), 0);   // today
createComplexFromExercises(ids.slice(2, 3), 1);   // tomorrow
createComplexFromExercises(ids.slice(3, 4), 2);   // the day after

setActiveCategory(second);
setCategoryField('scheduleStartDate', formatDate(startOfDay()));
addExercise(createExercise({ name: 'Второй категории', images: [blob], equipment: ['wall'] }));
createComplexFromExercises(activeCategory().exercises.map((e) => e.id), 0);  // today
setActiveCategory(first);

// ---------- the day model ----------

const days = buildWorkoutDays(getState());
check('three days, no more', days.length === 3, days.length);
check('today carries its date, the others do not',
  days[0].label === 'Сегодня, ' + formatDate(startOfDay())
    && days[1].label === 'Завтра' && days[2].label === 'Послезавтра',
  days.map((d) => d.label).join(' | '));
check('the dates are today, tomorrow and the day after',
  days.every((d, i) => d.date.getTime() === addDays(startOfDay(), i).getTime()),
  days.map((d) => formatDate(d.date)).join(','));
check('TODAY GATHERS EVERY CATEGORY SCHEDULED FOR IT',
  days[0].cards.length === 2, days[0].cards.map((c) => c.name).join(','));
check('and the later days only what reaches them',
  days[1].cards.length === 1 && days[2].cards.length === 1,
  days[1].cards.length + '/' + days[2].cards.length);

const card = days[0].cards[0];
check('a card is named by its category', card.name === getState().categories[first].name,
  card.name);
check('EQUIPMENT IS THE UNION OF THE COMPLEX, DEDUPED AND IN MODEL ORDER',
  card.equipment.join(', ') === 'коврик, короткая лента, рол', card.equipment.join(', '));
check('two untried exercises are the default 2 minutes each',
  card.exercises.length === 2 && card.minutes === 4, card.minutes);

// The recorded time is what the next estimate uses.
updateExercise(ids[0], { lastDurationSec: 360 });
check('a recorded duration replaces the default',
  buildWorkoutDays(getState())[0].cards[0].minutes === 8,
  buildWorkoutDays(getState())[0].cards[0].minutes);
updateExercise(ids[0], { lastDurationSec: 120 });

// A complex switched out of the schedule is not performed, so it is not here.
// The LAST one, because switching a middle complex off does not leave a hole -
// it pulls every later complex a slot earlier, which is the schedule's rule.
const offId = getState().categories[first].complexes[2].id;
setComplexEnabled(offId, false);
check('switching a complex off takes it off the workout page too',
  buildWorkoutDays(getState())[2].cards.length === 0,
  buildWorkoutDays(getState())[2].cards.length);
setComplexEnabled(offId, true);

check('plural: 1 / 2 / 5', plural(1, 'a', 'b', 'c') === 'a' && plural(2, 'a', 'b', 'c') === 'b'
  && plural(5, 'a', 'b', 'c') === 'c');
check('plural: the 11-14 exception', plural(11, 'a', 'b', 'c') === 'c'
  && plural(12, 'a', 'b', 'c') === 'c' && plural(14, 'a', 'b', 'c') === 'c');
check('plural: 21 / 22 / 25', plural(21, 'a', 'b', 'c') === 'a' && plural(22, 'a', 'b', 'c') === 'b'
  && plural(25, 'a', 'b', 'c') === 'c');

// ---------- the page ----------

const navigated = [];
resetWorkoutState();
const destroy = mountWorkoutPage(document.getElementById('app'), (p) => navigated.push(p));

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const text = (sel) => $$(sel).map((n) => n.textContent);

check('the page renders', Boolean($('.page--workout')));
check('the workout button is the active one in the selector',
  $('.page-button--active') && $('.page-button--active').dataset.page === 'workout',
  $('.page-button--active') && $('.page-button--active').dataset.page);
check('THE CATEGORIES BLOCK COMES WITH IT, in the header',
  $$('.header .categories .category-list .menu-button').length === 7,
  $$('.header .categories .category-list .menu-button').length);
check('and the page selector sits before it, as on the other two pages',
  Boolean($('.categories > .page-selector'))
    && $('.categories').children[1].classList.contains('category-list'));
check('none of the categories is drawn active - the page is not scoped to one',
  $$('.header .menu-button--active').length === 0);
check('no view options: nothing here to filter',
  $$('.view-options').length === 0);

// --- Date_selector ---
check('three date buttons', $$('.date-button').length === 3, $$('.date-button').length);
check('reading Сегодня / Завтра / Послезавтра',
  text('.date-button').join('|') === 'Сегодня, ' + formatDate(startOfDay()) + '|Завтра|Послезавтра',
  text('.date-button').join('|'));
check('TODAY IS SELECTED BY DEFAULT',
  $('.date-button--active').dataset.day === '0', $('.date-button--active').dataset.day);

// --- Complex_list ---
const cards = () => $$('.workout-complex');
check('today lists both categories', cards().length === 2, cards().length);
check('a block reads name / equipment / count and time',
  $('.workout-complex__name').textContent === getState().categories[first].name
    && $('.workout-complex__equipment').textContent === 'Коврик, короткая лента, рол'
    && $('.workout-complex__meta').textContent === '2 упражнения, 4 мин',
  [$('.workout-complex__name').textContent, $('.workout-complex__equipment').textContent,
    $('.workout-complex__meta').textContent].join(' / '));
check('the singular reads "1 упражнение"',
  cards()[1].querySelector('.workout-complex__meta').textContent === '1 упражнение, 2 мин',
  cards()[1].querySelector('.workout-complex__meta').textContent);
check('THE FIRST COMPLEX IS ACTIVE BY DEFAULT, as the design draws it',
  cards()[0].classList.contains('workout-complex--active')
    && !cards()[1].classList.contains('workout-complex--active'));

// --- Начать ---
check('every block scheduled for today carries Начать',
  $$('.workout-complex .main-button').length === 2,
  $$('.workout-complex .main-button').length);
check('IT IS DISABLED - the exercise page is not built',
  $$('.workout-complex .main-button').every((b) => b.disabled === true));

// --- image_block and Preview_bar ---
const segments = () => $$('.preview-bar__segment');
const activeSegment = () => segments().findIndex((s) => s.classList.contains('preview-bar__segment--active'));
check('one preview segment per exercise in the selected complex',
  segments().length === 2, segments().length);
check('the first is the one showing', activeSegment() === 0, activeSegment());
check('the image block plays the exercise back',
  Boolean($('.workout-preview__image .seq-anim__img')));

// --- the track ---
//
// The exercise on screen and its neighbours ride one track, so the arriving and
// the departing block move together under the finger.
const slides = () => $$('.workout-preview__slide').map((s) => Number(s.dataset.index));
// The inline transform the swipe writes; jsdom has no layout engine, but these
// are px the page computed itself, so they are readable.
const trackX = () => {
  const track = $('.workout-preview__track');
  const match = /translateX\((-?[\d.]+)px\)/.exec(track ? track.style.transform : '');
  return match ? Number(match[1]) : 0;
};

check('THE TRACK CARRIES THE NEIGHBOURS, not just the exercise on screen',
  slides().join(',') === '0,1', slides().join(','));
check('it starts unmoved', trackX() === 0, trackX());
check('and every slide on it is playing',
  $$('.workout-preview__slide .seq-anim__img').length === 2,
  $$('.workout-preview__slide .seq-anim__img').length);

// --- swiping ---
//
// Left = the next exercise, right = the previous one, and neither wraps. The
// gesture is only committed once the finger lifts and the track has settled, so
// every swipe here has to wait that out.
const box = () => $('.workout-preview__image');
const pointer = (type, x) => box().dispatchEvent(
  new dom.window.MouseEvent(type, { bubbles: true, clientX: x }));

// Longer than both the settle (200ms) and the spring back (260ms).
const settled = () => new Promise((r) => setTimeout(r, 340));

async function swipe(dx) {
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + dx);
  pointer('pointerup', 200 + dx);
  await settled();
}

// The finger drives the track directly while the gesture is live.
pointer('pointerdown', 200);
pointer('pointermove', 140);
check('THE TRACK FOLLOWS THE FINGER 1:1 while there is somewhere to go',
  trackX() === -60, trackX());
check('and nothing is smoothing it mid-gesture',
  $('.workout-preview__track').style.transition === 'none',
  $('.workout-preview__track').style.transition);
// Reversing into the end of the complex picks up the resistance mid-gesture:
// exercise 0 has nothing to its left, so a swipe right is damped from the
// moment the finger crosses back over the start.
pointer('pointermove', 260);
check('and picks up the resistance the moment it turns towards an end',
  near(trackX(), 60 * 0.28), trackX());
pointer('pointerup', 200);
await settled();
check('a gesture that ends where it started changes nothing',
  activeSegment() === 0 && trackX() === 0, activeSegment() + '/' + trackX());

await swipe(-10);
check('a short drag is a tap, not a swipe', activeSegment() === 0, activeSegment());

await swipe(-120);
check('SWIPING LEFT MOVES TO THE NEXT EXERCISE', activeSegment() === 1, activeSegment());
check('and the track is back at rest around the new one',
  trackX() === 0 && slides().join(',') === '0,1', trackX() + ' ' + slides().join(','));

// At the end of the complex there is nothing to bring in, so the block gives a
// little and springs back rather than stopping dead.
pointer('pointerdown', 200);
pointer('pointermove', 100);
check('AT THE END THE BLOCK ONLY GIVES A LITTLE - a damped fraction of the finger',
  near(trackX(), -100 * 0.28), trackX());
pointer('pointermove', 0);
check('and never more than the cap, however far the finger goes',
  trackX() === -56, trackX());
pointer('pointerup', 0);
check('the spring back is a transition, not a jump',
  /transform \d+ms/.test($('.workout-preview__track').style.transition),
  $('.workout-preview__track').style.transition);
await settled();

check('SWIPING LEFT ON THE LAST ONE DOES NOT WRAP TO THE FIRST',
  activeSegment() === 1, activeSegment());
check('IT SPRINGS BACK TO WHERE IT STARTED', trackX() === 0, trackX());

await swipe(120);
check('swiping right moves back', activeSegment() === 0, activeSegment());

// The other end resists the same way.
pointer('pointerdown', 200);
pointer('pointermove', 400);
check('the first exercise resists a swipe right', trackX() === 56, trackX());
pointer('pointerup', 400);
await settled();
check('SWIPING RIGHT ON THE FIRST ONE DOES NOT WRAP TO THE LAST',
  activeSegment() === 0, activeSegment());
check('and it springs back here too', trackX() === 0, trackX());

// --- selecting another complex ---
await swipe(-120);
cards()[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('clicking a block makes it the active one',
  cards()[1].classList.contains('workout-complex--active')
    && !cards()[0].classList.contains('workout-complex--active'));
check('THE PREVIEW FOLLOWS IT, from its first exercise',
  segments().length === 1 && activeSegment() === 0,
  segments().length + '/' + activeSegment());

// --- switching the day ---
$$('.date-button')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('the selected day changes', $('.date-button--active').dataset.day === '1');
check('SWITCHING THE DAY SWITCHES THE LIST',
  cards().length === 1
    && cards()[0].querySelector('.workout-complex__meta').textContent === '1 упражнение, 2 мин',
  cards().length + ': ' + text('.workout-complex__meta').join('|'));
check('NO Начать OUTSIDE TODAY', $$('.workout-complex .main-button').length === 0,
  $$('.workout-complex .main-button').length);
check('and the day\'s first complex is selected again',
  cards()[0].classList.contains('workout-complex--active'));

$$('.date-button')[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('the day after tomorrow works the same way',
  cards().length === 1 && $$('.workout-complex .main-button').length === 0
    && $('.workout-complex__equipment').textContent === 'Стул',
  $('.workout-complex__equipment').textContent);

// --- an empty day ---
setComplexEnabled(getState().categories[first].complexes[2].id, false);
check('a day with nothing on it says so',
  cards().length === 0 && Boolean($('.workout-complex__empty')));
check('and the preview says there is nothing to show',
  Boolean($('.workout-preview__empty')) && segments().length === 0);
setComplexEnabled(getState().categories[first].complexes[2].id, true);

// --- header navigation ---
$$('.header .category-list .menu-button')[3].dispatchEvent(
  new dom.window.MouseEvent('click', { bubbles: true }));
check('picking a category leaves for its schedule',
  navigated[navigated.length - 1] === 'schedule', navigated.join(','));
check('and opens that one', getState().ui.activeCategory === getState().categoryOrder[3],
  getState().ui.activeCategory);

// --- teardown ---
destroy();
check('destroy empties the container', document.getElementById('app').children.length === 0);
setUiFlag('showFavorites', true);
check('A MUTATION AFTER DESTROY RENDERS NOTHING',
  document.getElementById('app').children.length === 0,
  document.getElementById('app').innerHTML.slice(0, 80));

// indexedDB is deliberately left undefined here, so db.js reports that it
// cannot save - which is the graceful degradation it is meant to do, and is
// the one thing the page is allowed to complain about.
const unexpected = errors.filter((e) => !/indexedDB is not defined/.test(e));
check('no errors beyond the missing database', unexpected.length === 0,
  unexpected.join(' | '));

console.log(results.join('\n'));
process.exit(failures === 0 ? 0 : 1);
