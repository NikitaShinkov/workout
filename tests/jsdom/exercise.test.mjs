// The exercise page: walking a complex, what the indicators do, what gets
// written when Button_next is pressed, and what the workout page says about a
// complex that is part done.
//
// Geometry - the sheet's gaps, the 82px button, the ring, top_block floating
// over the picture - is in tests/browser/exercise-layout, which has a layout
// engine. What is here is behaviour and arithmetic.

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
global.Image = dom.window.Image;
global.localStorage = dom.window.localStorage;
global.URL.createObjectURL = (b) => 'blob:fake/' + (b && b.size);

let failures = 0;
const results = [];
function check(name, condition, detail) {
  if (condition) {
    results.push('  PASS  ' + name);
  } else {
    failures += 1;
    results.push('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}

const errors = [];
dom.window.addEventListener('error', (e) => errors.push(String(e.message)));
console.error = (...args) => { errors.push(args.map(String).join(' ')); };
console.warn = () => {};

const {
  resetStore, getState, activeCategory, addExercise, setActiveCategory,
  setCategoryField, createComplexFromExercises, recordRating, recordDuration,
  isItemDone, today,
} = await mod('store.js');
const {
  mountExercisePage, startComplex, hasExerciseSession, takeFinishedComplex,
  resetExerciseState, chooseSheetLayout, formatRemaining, shownLevel,
  renderProgressRing, SHEET_GAP_PX,
} = await mod('exercise-page.js');
const { mountWorkoutPage, buildWorkoutDays, resetWorkoutState } = await mod('workout-page.js');
const { createExercise, nextRatingLevel, DEFAULT_DURATION_SEC } = await mod('model.js');
const { formatDate, startOfDay } = await mod('schedule.js');
const { applyOps } = await mod('sync.js');

const app = document.getElementById('app');
const $ = (sel) => app.querySelector(sel);
const $$ = (sel) => Array.from(app.querySelectorAll(sel));
const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const DATE = today();

// ============================================================
// 1. where the images go - a pure function, so no DOM at all
// ============================================================
//
// The brief gives two examples and they are the two that matter: a pair of
// strongly landscape images belongs one above the other, a pair of portrait
// ones side by side. Both fall out of measuring which arrangement leaves the
// images covering more of the block, rather than out of a rule about shape.

check('1: one image is laid out on its own', chooseSheetLayout([1.5], 393, 500) === 'single');
check('1: and so is one image of any shape', chooseSheetLayout([0.2], 393, 500) === 'single');

// 16:9, on a phone-shaped block.
check('1: A PAIR OF WIDE IMAGES STACKS - the brief\'s own example',
  chooseSheetLayout([16 / 9, 16 / 9], 393, 600) === 'column',
  chooseSheetLayout([16 / 9, 16 / 9], 393, 600));
check('1: A PAIR OF TALL IMAGES SITS IN A ROW - likewise',
  chooseSheetLayout([9 / 16, 9 / 16], 393, 600) === 'row',
  chooseSheetLayout([9 / 16, 9 / 16], 393, 600));
check('1: the block\'s own shape is part of it, not just the images\'',
  chooseSheetLayout([16 / 9, 16 / 9], 1600, 200) === 'row',
  chooseSheetLayout([16 / 9, 16 / 9], 1600, 200));
check('1: more than two is always the two-column grid',
  ['grid', 'grid', 'grid'].every((want, at) =>
    chooseSheetLayout(new Array(at + 3).fill(1.5), 393, 500) === want));
check('1: nothing at all still answers with a layout',
  chooseSheetLayout([], 393, 500) === 'single');
check('1: an unmeasured box does not throw and picks the row',
  chooseSheetLayout([1, 1], 0, 0) === 'row');
check('1: the gap is the design\'s 4px', SHEET_GAP_PX === 4);

// ============================================================
// 2. min:sec
// ============================================================

check('2: the design writes 25:00', formatRemaining(1500) === '25:00', formatRemaining(1500));
check('2: seconds are padded, minutes are not',
  formatRemaining(65) === '1:05', formatRemaining(65));
check('2: under a minute', formatRemaining(9) === '0:09', formatRemaining(9));
check('2: nothing left', formatRemaining(0) === '0:00', formatRemaining(0));
check('2: and a negative can never be printed', formatRemaining(-5) === '0:00');

// ============================================================
// 3. the indicator cycle
// ============================================================

check('3: EASY -> MODERATE -> HARD -> NOT SELECTED -> EASY',
  ['medium', 'hard', 'none', 'easy'].every((want, at) =>
    nextRatingLevel(['easy', 'medium', 'hard', 'none'][at]) === want));
check('3: and anything unrecognised starts the cycle',
  nextRatingLevel(undefined) === 'easy' && nextRatingLevel('nonsense') === 'easy');

// ============================================================
// a complex of three exercises, scheduled today
// ============================================================

resetStore();
resetExerciseState();
resetWorkoutState();

const blob = new dom.window.Blob(['x'], { type: 'image/jpeg' });
const [first, second] = getState().categoryOrder;

setActiveCategory(first);
setCategoryField('scheduleStartDate', formatDate(startOfDay()));
for (const name of ['Первое', 'Второе', 'Третье']) {
  addExercise(createExercise({
    name, description: 'о ' + name, images: [blob, blob], equipment: ['mat'],
  }));
}
const ids = activeCategory().exercises.map((e) => e.id);
createComplexFromExercises(ids, 0);

// A second complex, on the same day, so "the first one with anything left to
// do" has something to choose between.
setActiveCategory(second);
setCategoryField('scheduleStartDate', formatDate(startOfDay()));
addExercise(createExercise({ name: 'Другое', images: [blob], equipment: ['wall'] }));
createComplexFromExercises(activeCategory().exercises.map((e) => e.id), 0);
setActiveCategory(first);

const complexId = getState().categories[first].complexes[0].id;
const itemIds = getState().categories[first].complexes[0].items.map((i) => i.id);

// ============================================================
// 4. opening it
// ============================================================

check('4: there is no session until a complex is started', hasExerciseSession() === false);
check('4: STARTING ONE OPENS THE FIRST EXERCISE', startComplex(first, complexId) === true);
check('4: and there is a session now', hasExerciseSession() === true);

const navigated = [];
let destroy = mountExercisePage(app, (page) => navigated.push(page));

check('4: the page is on screen', Boolean($('.page--exercise')));
check('4: it has no header - it is the whole screen while a workout is on',
  $('.header') === null);
check('4: the first exercise of the complex is showing',
  $('.exercise-description__name').textContent === 'Первое',
  $('.exercise-description__name').textContent);
check('4: with its description', $('.exercise-description__text').textContent === 'о Первое');
check('4: top_block carries the close button and nothing else',
  $$('.exercise-top button').length === 1 && Boolean($('.exercise-close')));
check('4: image_block is playing the sequence', Boolean($('.exercise-image .seq-anim__img')));
check('4: and the sheet of every image is on the track, ready to be swiped to',
  $$('.exercise-sheet__image').length === 2, $$('.exercise-sheet__image').length);
check('4: NOTHING ON THE SHEET IS DRAGGABLE - a native drag cancels the swipe',
  $$('.exercise-sheet__image').every((img) => img.getAttribute('draggable') === 'false'));

// --- the three indicators ---

const indicators = () => $$('.indicator-button');
const levels = () => indicators().map((b) => b.dataset.level);
const iconNames = () => $$('.indicator-button__icon')
  .map((img) => img.getAttribute('src').split('/').pop());

check('4: three indicators, one per axis',
  indicators().map((b) => b.dataset.axis).join(',') === 'technique,rangeOfMotion,strength',
  indicators().map((b) => b.dataset.axis).join(','));
check('4: THEY DEFAULT TO EASY, never having been rated',
  levels().join(',') === 'easy,easy,easy', levels().join(','));
check('4: and each draws its own axis at that level',
  iconNames().join(',') === 'technique_easy.svg,motion_easy.svg,strength_easy.svg',
  iconNames().join(','));
check('4: they are named under the icon, as the design writes them',
  $$('.indicator-button__name').map((s) => s.textContent).join(',') === 'Техника,Амплитуда,Сила',
  $$('.indicator-button__name').map((s) => s.textContent).join(','));
// The icon carries the value visually, and nothing else would say it out loud.
check('4: AND THE ACCESSIBLE NAME SAYS WHAT EACH IS SET TO',
  indicators().map((b) => b.getAttribute('aria-label')).join(' | ')
    === 'Техника: легко | Амплитуда: легко | Сила: легко',
  indicators().map((b) => b.getAttribute('aria-label')).join(' | '));
check('4: MERELY OPENING THE PAGE RECORDS NO RATING - Easy is only displayed',
  getState().categories[first].exercises[0].feedback.technique.length === 0,
  JSON.stringify(getState().categories[first].exercises[0].feedback));

// --- Button_next ---

check('4: the remaining time is this exercise and the two after it',
  $('.next-button__time').textContent === formatRemaining(3 * DEFAULT_DURATION_SEC),
  $('.next-button__time').textContent);

const segments = () => $$('.next-button__segment').map((c) =>
  c.getAttribute('class').replace(/.*next-button__segment--/, ''));

check('4: ONE RING SEGMENT PER EXERCISE IN THE COMPLEX',
  segments().length === 3, segments().length);
check('4: the one being performed blinks, the rest are still to do',
  segments().join(',') === 'current,todo,todo', segments().join(','));

// ============================================================
// 5. tapping an indicator
// ============================================================

click(indicators()[0]);
check('5: A TAP CYCLES IT ON, easy to moderate',
  levels()[0] === 'medium', levels().join(','));
check('5: and the icon follows', iconNames()[0] === 'technique_moderate.svg', iconNames()[0]);
check('5: the other two are untouched', levels().slice(1).join(',') === 'easy,easy');
check('5: IT IS RECORDED AGAINST TODAY at once, not saved up for the end',
  JSON.stringify(getState().categories[first].exercises[0].feedback.technique)
    === JSON.stringify([{ date: DATE, level: 'medium' }]),
  JSON.stringify(getState().categories[first].exercises[0].feedback.technique));

// The op buffer is the durable half of that: written synchronously into
// localStorage, so a phone killed from the app manager a moment later has it.
const buffered = () => JSON.parse(localStorage.getItem('workout.ops') || '[]');
check('5: AND BUFFERED FOR THE REPO, synchronously',
  buffered().some((op) => op.kind === 'rate' && op.axis === 'technique'
    && op.level === 'medium' && op.date === DATE),
  JSON.stringify(buffered().slice(-1)));

click(indicators()[0]);
click(indicators()[0]);
check('5: round to Not selected', levels()[0] === 'none', levels()[0]);
check('5: which is a rating of its own, not the absence of one',
  iconNames()[0] === 'technique_not_selected.svg'
    && getState().categories[first].exercises[0].feedback.technique[0].level === 'none',
  iconNames()[0]);
click(indicators()[0]);
check('5: and back to Easy', levels()[0] === 'easy', levels()[0]);
check('5: STILL ONE RECORD FOR THE DAY, however many taps',
  getState().categories[first].exercises[0].feedback.technique.length === 1,
  JSON.stringify(getState().categories[first].exercises[0].feedback.technique));

// --- the star ---

click(indicators()[1]);
click($('.favorite-star'));
check('5: the star adds it to the favourites', getState().categories[first].exercises[0].favorite);
check('5: and says so', $('.favorite-star').classList.contains('favorite-star--active'));

// ============================================================
// 6. closing, and picking it up again
// ============================================================

click($('.exercise-close'));
check('6: closing leaves for the workout page',
  navigated[navigated.length - 1] === 'workout', navigated.join(','));
check('6: AND THE CLOCK IS THROWN AWAY WITH IT', hasExerciseSession() === false);
check('6: nothing was marked done - the exercise was not confirmed',
  isItemDone(getState(), itemIds[0], DATE) === false);

destroy();

check('6: WHAT WAS CHOSEN BEFORE CLOSING SURVIVED',
  getState().categories[first].exercises[0].feedback.rangeOfMotion[0].level === 'medium'
    && getState().categories[first].exercises[0].favorite === true,
  JSON.stringify(getState().categories[first].exercises[0].feedback.rangeOfMotion));

startComplex(first, complexId);
destroy = mountExercisePage(app, (page) => navigated.push(page));

check('6: starting again opens the first exercise still to do',
  $('.exercise-description__name').textContent === 'Первое',
  $('.exercise-description__name').textContent);
check('6: AND THE VALUES CHOSEN LAST TIME ARE BACK ON SCREEN',
  levels().join(',') === 'easy,medium,easy', levels().join(','));

// ============================================================
// 7. confirming an exercise
// ============================================================

const before = Date.now();
click($('.next-button'));

check('7: the next exercise opens',
  $('.exercise-description__name').textContent === 'Второе',
  $('.exercise-description__name').textContent);
check('7: THE ONE JUST FINISHED IS MARKED DONE',
  isItemDone(getState(), itemIds[0], DATE) === true);
check('7: and its duration is what it actually took, not the default',
  getState().categories[first].exercises[0].lastDurationSec !== DEFAULT_DURATION_SEC
    && getState().categories[first].exercises[0].lastDurationSec >= 1,
  getState().categories[first].exercises[0].lastDurationSec);
check('7: ALL THREE VALUES ARE WRITTEN, touched or not',
  ['technique', 'rangeOfMotion', 'strength'].every((axis) =>
    getState().categories[first].exercises[0].feedback[axis].length === 1),
  JSON.stringify(getState().categories[first].exercises[0].feedback));
check('7: and they are the ones that were on screen',
  ['technique', 'rangeOfMotion', 'strength'].map((axis) =>
    getState().categories[first].exercises[0].feedback[axis][0].level).join(',')
    === 'easy,medium,easy',
  ['technique', 'rangeOfMotion', 'strength'].map((axis) =>
    getState().categories[first].exercises[0].feedback[axis][0].level).join(','));
check('7: ONE RECORD PER EXERCISE PER DATE, whatever was tapped on the way',
  buffered().filter((op) => op.kind === 'rate' && op.exerciseId === ids[0]
    && op.axis === 'technique' && op.date !== DATE).length === 0);
check('7: the completion is buffered for the repo too',
  buffered().some((op) => op.kind === 'done' && op.itemId === itemIds[0]
    && op.date === DATE && op.done === true),
  JSON.stringify(buffered().filter((op) => op.kind === 'done')));

check('7: THE RING IS REDRAWN - one behind, one on screen, one to come',
  segments().join(',') === 'done,current,todo', segments().join(','));
check('7: and the remaining time no longer counts the one behind us',
  $('.next-button__time').textContent === formatRemaining(2 * DEFAULT_DURATION_SEC),
  $('.next-button__time').textContent);
check('7: the second exercise starts from Easy again - nothing was rated for it',
  levels().join(',') === 'easy,easy,easy', levels().join(','));
check('7: and the clock restarted with it', Date.now() >= before);

// ============================================================
// 8. what the workout page says about a complex part done
// ============================================================

const cards = () => buildWorkoutDays(getState())[0].cards
  .filter((card) => card.categoryId === first);

check('8: one of the three is behind us',
  cards()[0].remaining === 2 && cards()[0].total === 3,
  JSON.stringify({ remaining: cards()[0].remaining, total: cards()[0].total }));

destroy();
resetWorkoutState();
let destroyWorkout = mountWorkoutPage(app, (page) => navigated.push(page));

// Null-safe on purpose: a broken selection or a missing card has to report as
// a FAIL with something readable in it, not crash the suite before it prints.
const cardOf = (name) => $$('.workout-complex').find((node) =>
  node.querySelector('.workout-complex__name').textContent === name) || null;
const metaOf = (name) => {
  const card = cardOf(name);
  return card ? card.querySelector('.workout-complex__meta').textContent : '(no such card)';
};
const activeName = () => {
  const node = $('.workout-complex--active .workout-complex__name');
  return node ? node.textContent : '(nothing selected)';
};

check('8: "2 ИЗ 3 УПРАЖНЕНИЙ" - part way through, the count is what is LEFT',
  metaOf(getState().categories[first].name) === '2 из 3 упражнений, 4 мин',
  metaOf(getState().categories[first].name));
check('8: an untouched complex still reads the way it always did',
  metaOf(getState().categories[second].name) === '1 упражнение, 2 мин',
  metaOf(getState().categories[second].name));
check('8: and a part-done complex still offers Начать',
  $$('.workout-complex .main-button').length === 2,
  $$('.workout-complex .main-button').length);

destroyWorkout();

// ============================================================
// 9. finishing the complex
// ============================================================

startComplex(first, complexId);
destroy = mountExercisePage(app, (page) => navigated.push(page));

check('9: it picks up at the second exercise, not the first',
  $('.exercise-description__name').textContent === 'Второе',
  $('.exercise-description__name').textContent);

click($('.next-button'));
check('9: on to the third', $('.exercise-description__name').textContent === 'Третье',
  $('.exercise-description__name').textContent);
check('9: which is the last, so the button ends the complex',
  $('.next-button').getAttribute('aria-label') === 'Завершить комплекс',
  $('.next-button').getAttribute('aria-label'));
check('9: and the ring says so', segments().join(',') === 'done,done,current',
  segments().join(','));

click($('.next-button'));
check('9: THE LAST ONE CONFIRMED LEAVES FOR THE WORKOUT PAGE',
  navigated[navigated.length - 1] === 'workout', navigated.join(','));
check('9: the session is over', hasExerciseSession() === false);
check('9: every exercise of the complex is done',
  itemIds.every((id) => isItemDone(getState(), id, DATE)));
check('9: and the complex itself is recorded as finished',
  (getState().complexLog[complexId] || {})[DATE] === true,
  JSON.stringify(getState().complexLog));

destroy();

// --- back on the workout page ---

destroyWorkout = mountWorkoutPage(app, (page) => navigated.push(page));

check('9: A FINISHED COMPLEX CARRIES NO НАЧАТЬ AT ALL',
  $$('.workout-complex .main-button').length === 1,
  $$('.workout-complex .main-button').length);
check('9: THE FIRST COMPLEX WITH ANYTHING LEFT TO DO IS SELECTED',
  $$('.workout-complex--active').length === 1
    && activeName() === getState().categories[second].name,
  activeName());
// The count goes back to the whole complex, and the time is the one the
// workout just produced rather than the estimate it started from. Each of the
// three was confirmed in well under a second here, so it rounds to nothing.
check('9: A FINISHED COMPLEX READS AS A WHOLE ONE AGAIN, at what it really took',
  metaOf(getState().categories[first].name) === '3 упражнения, 0 мин',
  metaOf(getState().categories[first].name));

// The same thing at a believable scale: the brief's own example is a complex
// estimated at 25 minutes that turned out to take 17.
destroyWorkout();
for (const id of ids) recordDuration(id, 340, first);
destroyWorkout = mountWorkoutPage(app, (page) => navigated.push(page));
check('9: "3 УПРАЖНЕНИЯ, 17 МИН" - the new total, not the old estimate',
  metaOf(getState().categories[first].name) === '3 упражнения, 17 мин',
  metaOf(getState().categories[first].name));
check('9: the handoff is read exactly once', takeFinishedComplex() === null);

destroyWorkout();

// ============================================================
// 10. the history, across days
// ============================================================

recordRating(ids[0], 'technique', 'hard', '2026-01-01', first);
const history = getState().categories[first].exercises[0].feedback.technique;

check('10: a different day APPENDS rather than replacing',
  history.length === 2, JSON.stringify(history));
check('10: and the history stays chronological, as exercise-row expects',
  history[0].date === '2026-01-01' && history[1].date === DATE,
  JSON.stringify(history));
check('10: A DURATION HAS NO HISTORY - only its latest value is kept',
  buffered().filter((op) => op.kind === 'duration' && op.exerciseId === ids[0]).length >= 1
    && typeof getState().categories[first].exercises[0].lastDurationSec === 'number');

// ============================================================
// 11. the log round-trips, which is the only thing that persists
// ============================================================
//
// The ops in the buffer are what the next launch merges over state.json. If
// applyOps cannot read back what this page wrote, the whole workout is lost the
// moment the tab is closed.

const bare = {
  categoryOrder: ['a'],
  categories: { a: { name: 'A', exercises: [{ id: ids[0], name: 'Первое', images: [] }] } },
};
const reloaded = applyOps(bare, { ops: buffered() });

check('11: THE RATINGS COME BACK OFF THE LOG',
  reloaded.categories.a.exercises[0].feedback.technique.some((e) => e.date === DATE),
  JSON.stringify(reloaded.categories.a.exercises[0].feedback.technique));
check('11: so does the favourite', reloaded.categories.a.exercises[0].favorite === true);
check('11: so does the duration',
  reloaded.categories.a.exercises[0].lastDurationSec >= 1,
  reloaded.categories.a.exercises[0].lastDurationSec);
check('11: AND SO DOES THE COMPLETION, which is what resumes a complex',
  itemIds.every((id) => reloaded.doneLog[id] && reloaded.doneLog[id][DATE] === true),
  JSON.stringify(reloaded.doneLog));
check('11: replaying the whole log twice changes nothing',
  JSON.stringify(applyOps(reloaded, { ops: buffered() }).doneLog)
    === JSON.stringify(reloaded.doneLog));

// ============================================================
// 12. the ring's geometry
// ============================================================

const ring = renderProgressRing(['done', 'current', 'todo', 'todo']);
const circles = Array.from(ring.querySelectorAll('circle'));
const dash = (c) => c.getAttribute('stroke-dasharray').split(' ').map(Number);
const circumference = 2 * Math.PI * 39;

check('12: 82px across with a 4px ring, so its edge lands on the box',
  ring.getAttribute('width') === '82'
    && circles.every((c) => c.getAttribute('stroke-width') === '4'
      && c.getAttribute('r') === '39'));
check('12: THE SEGMENTS SHARE THE CIRCUMFERENCE, 2px apart',
  circles.every((c) => Math.abs(dash(c)[0] - (circumference / 4 - 2)) < 0.01),
  dash(circles[0]).join('/'));
check('12: each starts a quarter further round than the last',
  circles.every((c, at) =>
    Math.abs(-Number(c.getAttribute('stroke-dashoffset'))
      - (at * circumference / 4 + 1)) < 0.01),
  circles.map((c) => c.getAttribute('stroke-dashoffset')).join(','));
check('12: THE COUNT STARTS AT THE TOP, not at three o\'clock',
  ring.querySelector('g').getAttribute('transform') === 'rotate(-90 41 41)',
  ring.querySelector('g').getAttribute('transform'));
check('12: a single exercise is still a ring, with one nick in it',
  Math.abs(dash(renderProgressRing(['current']).querySelector('circle'))[0]
    - (circumference - 2)) < 0.01);
check('12: and eight of them do not overlap',
  renderProgressRing(new Array(8).fill('todo')).querySelectorAll('circle').length === 8);

// ============================================================
// 13. a page with nothing to show
// ============================================================

resetExerciseState();
destroy = mountExercisePage(app, (page) => navigated.push(page));
check('13: mounting with no session draws nothing', app.children.length === 0,
  app.innerHTML.slice(0, 80));
await new Promise((r) => setTimeout(r, 5));
check('13: AND LEAVES FOR THE WORKOUT PAGE rather than sitting there empty',
  navigated[navigated.length - 1] === 'workout', navigated.join(','));
destroy();

check('13: a complex whose every exercise is done cannot be started',
  startComplex(first, complexId) === false);
check('13: nor can one that does not exist', startComplex(first, 'cx_nonsense') === false);

// --- teardown ---

resetExerciseState();
startComplex(first, getState().categories[first].complexes[0].id);

// ============================================================
// 14. shownLevel, on its own
// ============================================================

const rated = { feedback: { technique: [{ date: '2026-01-01', level: 'hard' }] } };
check('14: a rating from another day is history, not the current value',
  shownLevel(rated, 'technique', DATE) === 'easy', shownLevel(rated, 'technique', DATE));
check('14: today\'s is the current value',
  shownLevel(rated, 'technique', '2026-01-01') === 'hard');
check('14: an exercise with no feedback at all still answers',
  shownLevel({}, 'technique', DATE) === 'easy');

check('no unexpected errors', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
process.exit(failures === 0 ? 0 : 1);
