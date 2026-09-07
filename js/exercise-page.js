// The exercise page: one exercise of one complex, being performed right now.
//
// It is what the workout page's Начать opens, and the only page in the app that
// WRITES what a workout produced - the three ratings, how long the exercise
// took, and the fact that it was got through at all. Everything it writes is a
// log field rather than structure, so none of it ever touches state.json; see
// the "what a workout produced" block in js/store.js.
//
// Four blocks, and image_block takes whatever the other three leave:
//   top_block                 the close button, floating over the picture
//   image_block               the animation, or every image at once
//   Description_block         the name, the star, the description
//   Toolbar                   three indicators and Button_next
//
// A session is deliberately NOT persisted. The start time is what a duration is
// measured from, and a workout that was closed and picked up an hour later did
// not take an hour - so closing the page throws the clock away, and starting
// the complex again begins timing the first exercise that is still to do.

import { el, svg, clear } from './dom.js';
import {
  getState,
  subscribe,
  recordRating,
  recordDuration,
  setItemDone,
  setComplexDone,
  isItemDone,
  toggleFavorite,
  today,
} from './store.js';
import {
  INDICATORS,
  DEFAULT_RATING_LEVEL,
  exerciseDuration,
  nextRatingLevel,
  ratingIcon,
  ratingLabel,
} from './model.js';
import { createSequenceAnimation } from './animation.js';
import { blobUrl } from './images.js';
import { renderFavoriteStar } from './exercise-row.js';
import {
  followed,
  swipeStep,
  glide,
  SETTLE_MS,
  SETTLE_EASING,
  SPRING_MS,
  SPRING_EASING,
} from './gesture.js';

// The two views image_block swipes between. Swiping left brings in the sheet of
// every image; swiping right goes back to the animation.
const ANIMATION = 0;
const SHEET = 1;

// The gap between images on the sheet, horizontally and vertically.
export const SHEET_GAP_PX = 4;

// Button_next. 82 across with a 4px ring, so the ring's centre line sits at
// r=39 and its outer edge lands exactly on the edge of the box.
const RING_SIZE = 82;
const RING_STROKE = 4;
// Between segments, along the arc. It is drawn for a single segment too, which
// leaves one 2px nick at the top - the mark the ring is counted from.
const RING_GAP_PX = 2;

// --- the session ------------------------------------------------------------
//
// Module state, like the workout page's chosen day: it is what one workout is
// doing now, and a reload is a new workout.

// {categoryId, complexId, itemId, startedAt} while a complex is being performed.
let session = null;

// The complex whose last exercise was just confirmed. The workout page reads it
// on the way back in and drops its highlight, so the first complex with
// anything left to do takes over. It is passed this way round - the exercise
// page publishing, the workout page pulling - so that neither of the two
// modules has to import the other.
let finished = null;

// Which of the two views is on screen, and the frame the animation had reached.
// The frame survives a render for the same reason it does on the workout page:
// without it every render restarts the sequence and the picture flinches.
let view = ANIMATION;
let frame = 0;

// How far the sheet has been scrolled, when it is tall enough to scroll at all.
// A render rebuilds it and would otherwise snap it back to the top - so tapping
// an indicator while looking at the fifth picture would lose your place. It
// belongs to the sheet alone; the animation beside it has no scroll to affect.
let sheetScroll = 0;

// The swipe in progress and the timer that finishes it. Both hold nodes from
// the current render, so both are dropped whenever the page is rebuilt.
let drag = null;
let settleTimer = null;

let animation = null;
let root = null;
let onNavigate = null;

// Image url -> its width/height. Measuring costs a decode and the sheet's
// arrangement depends on it, so it is remembered.
const aspects = new Map();

// --- opening and closing ----------------------------------------------------

// What the workout page's Начать calls. The clock starts here rather than at
// mount, because this is the moment the user began.
export function startComplex(categoryId, complexId) {
  const itemId = firstUnfinishedItem(getState(), categoryId, complexId);
  if (!itemId) return false;

  session = { categoryId, complexId, itemId, startedAt: Date.now() };
  view = ANIMATION;
  frame = 0;
  sheetScroll = 0;
  return true;
}

export function hasExerciseSession() {
  return session !== null;
}

// Read once, by the workout page, on its way back in.
export function takeFinishedComplex() {
  const id = finished;
  finished = null;
  return id;
}

// Exposed for the tests: no session, nothing remembered.
export function resetExerciseState() {
  session = null;
  finished = null;
  view = ANIMATION;
  frame = 0;
  sheetScroll = 0;
  aspects.clear();
}

// The first exercise of the complex still to do today. Начать opens this rather
// than the first exercise, so a complex picked up again carries on from where
// it was left rather than starting over.
function firstUnfinishedItem(state, categoryId, complexId) {
  const complex = findComplex(state, categoryId, complexId);
  if (!complex) return null;

  const date = today();
  const next = complex.items.find((item) => !isItemDone(state, item.id, date));
  // Every one of them is done: nothing to open. The workout page hides Начать
  // in that case, so this is a guard rather than a path.
  return next ? next.id : null;
}

function findComplex(state, categoryId, complexId) {
  const category = state.categories[categoryId];
  if (!category) return null;
  return (category.complexes || []).find((complex) => complex.id === complexId) || null;
}

// --- the data behind the page -----------------------------------------------

// Everything one render needs, or null if the complex or the item has gone -
// deleted on the other device, or edited out from under a page left open.
function describeSession(state) {
  if (!session) return null;

  const category = state.categories[session.categoryId];
  const complex = findComplex(state, session.categoryId, session.complexId);
  if (!category || !complex) return null;

  const byId = new Map((category.exercises || []).map((exercise) => [exercise.id, exercise]));
  const date = today();

  const items = complex.items.map((item) => ({
    id: item.id,
    exercise: byId.get(item.exerciseId) || null,
    done: isItemDone(state, item.id, date),
  }));

  const index = items.findIndex((item) => item.id === session.itemId);
  if (index === -1 || !items[index].exercise) return null;

  // This exercise and everything after it that is still to do. Ordinary use
  // never leaves a gap - a complex is walked from the front - but summing what
  // is LEFT rather than simply what follows means a skipped exercise cannot
  // make the estimate lie either.
  const remainingSec = items
    .slice(index)
    .filter((item, at) => item.exercise && (at === 0 || !item.done))
    .reduce((total, item) => total + exerciseDuration(item.exercise), 0);

  return {
    categoryId: session.categoryId,
    complex,
    items,
    index,
    exercise: items[index].exercise,
    remainingSec,
    // Which segment of the ring is which. The one being performed is not marked
    // done yet, so it gets a state - and a colour - of its own.
    segments: items.map((item, at) => (at === index ? 'current' : item.done ? 'done' : 'todo')),
  };
}

// The level an indicator shows: what was recorded for the exercise today if
// anything was, and otherwise Easy. Easy is only ever DISPLAYED here - it is
// not written until the user either taps an indicator or confirms the exercise,
// so merely opening a page cannot invent a rating.
export function shownLevel(exercise, axis, date = today()) {
  const history = (exercise.feedback && exercise.feedback[axis]) || [];
  const entry = history.find((item) => item.date === date);
  return entry ? entry.level : DEFAULT_RATING_LEVEL;
}

// min:sec, as the design writes it.
export function formatRemaining(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

// --- how the images are laid out --------------------------------------------

// Where the images go on the sheet, given their shapes and the box they have.
// A pure function of the numbers, so it can be checked without a browser.
//
//   one image     as large as it goes, whichever edge runs out first
//   two images    side by side or one above the other, whichever leaves them
//                 bigger - so a pair of wide photographs stacks and a pair of
//                 tall ones sits in a row, which is what the brief describes
//   more          two columns, filling the box
export function chooseSheetLayout(shapes, width, height, gap = SHEET_GAP_PX) {
  if (shapes.length <= 1) return 'single';
  if (shapes.length > 2) return 'grid';

  const side = shapes.reduce(
    (total, shape) => total + fittedArea(shape, (width - gap) / 2, height), 0);
  const stacked = shapes.reduce(
    (total, shape) => total + fittedArea(shape, width, (height - gap) / 2), 0);

  // A tie goes to the row: with nothing measured yet every shape is taken to be
  // square, and a row is then the arrangement that needs no correcting.
  return stacked > side ? 'column' : 'row';
}

// How much of a box an image actually covers once it is scaled to fit inside it
// without being cropped - which is what "occupy the maximum amount of screen
// space" has to be measured as.
function fittedArea(shape, width, height) {
  const ratio = Number(shape) > 0 ? Number(shape) : 1;
  if (width <= 0 || height <= 0) return 0;

  const scale = Math.min(width / ratio, height);
  return ratio * scale * scale;
}

// The arrangement depends on the size of the box, which is not known until the
// page has been laid out - so the class is applied after the append rather than
// chosen during the render, and re-applied on a resize without rebuilding
// anything.
function applySheetLayout() {
  if (!root) return;

  const sheet = root.querySelector('.exercise-sheet');
  const box = root.querySelector('.exercise-image');
  if (!sheet || !box) return;

  const rect = box.getBoundingClientRect();
  const shapes = Array.from(sheet.querySelectorAll('.exercise-sheet__image'))
    .map((img) => aspects.get(img.dataset.url) || 1);
  const layout = chooseSheetLayout(shapes, rect.width, rect.height);

  for (const name of ['single', 'row', 'column', 'grid']) {
    sheet.classList.toggle('exercise-sheet--' + name, name === layout);
  }
}

// Only a pair actually needs the measurements, but they are taken for every
// exercise: the animation has already fetched all of them, so this costs
// nothing and the sheet is right the first time it is swiped to.
function measureImages(urls) {
  const missing = urls.filter((url) => url && !aspects.has(url));
  if (missing.length === 0) return;

  Promise.all(missing.map(measureImage)).then(() => {
    // Nothing is rebuilt: the images are already on the sheet, and only their
    // arrangement was waiting on their shapes.
    applySheetLayout();
  });
}

function measureImage(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    const settle = (ratio) => {
      aspects.set(url, ratio);
      resolve(ratio);
    };
    probe.onload = () => settle(
      probe.naturalHeight > 0 ? probe.naturalWidth / probe.naturalHeight : 1);
    // An image that will not load has no shape to lay out by; square is the
    // assumption that does no harm.
    probe.onerror = () => settle(1);
    probe.src = url;
  });
}

// --- mounting ---------------------------------------------------------------

export function mountExercisePage(container, navigate) {
  root = container;
  onNavigate = navigate;

  const unsubscribe = subscribe(render);
  window.addEventListener('resize', onResize);
  render();

  // Nothing to perform - the URL named this page directly, or the complex went
  // away. Deferred, because navigating from inside a mount would leave the
  // shell holding this page's teardown for the page that replaced it.
  if (!session) leave();

  return function destroy() {
    unsubscribe();
    window.removeEventListener('resize', onResize);
    stopAnimation();
    cancelSettle();
    drag = null;
    clear(root);
    root = null;
    onNavigate = null;
  };
}

function onResize() {
  // A resize during a gesture would move the ground under the finger; the
  // arrangement can wait until it has lifted.
  if (!drag) applySheetLayout();
}

function stopAnimation() {
  if (!animation) return;
  frame = animation.index;
  animation.destroy();
  animation = null;
}

function cancelSettle() {
  if (settleTimer === null) return;
  clearTimeout(settleTimer);
  settleTimer = null;
}

// --- rendering --------------------------------------------------------------

function render() {
  if (!root) return;

  const model = describeSession(getState());

  stopAnimation();
  cancelSettle();
  drag = null;
  captureSheetScroll();
  clear(root);

  if (!model) {
    // The complex is gone. There is no error worth reporting here, just nothing
    // left to perform.
    session = null;
    leave();
    return;
  }

  const urls = (model.exercise.images || []).map(blobUrl).filter(Boolean);

  root.appendChild(
    el(
      'div',
      { class: 'page page--exercise' },
      el(
        'div',
        { class: 'exercise-view' },
        renderTopBlock(),
        renderImageBlock(model, urls),
        renderBottomBlock(model)
      )
    )
  );

  startAnimation(urls);
  // Before the scroll is put back: the class is what makes the sheet a
  // scrollport, so until it is applied there is nothing to scroll.
  applySheetLayout();
  restoreSheetScroll();
  measureImages(urls);
}

function captureSheetScroll() {
  const sheet = root && root.querySelector('.exercise-sheet');
  if (sheet) sheetScroll = sheet.scrollTop;
}

function restoreSheetScroll() {
  const sheet = root && root.querySelector('.exercise-sheet');
  if (sheet) sheet.scrollTop = sheetScroll;
}

// Leaving from inside a render or a mount has to be deferred: the shell is part
// way through swapping pages, and mounting the next one now would leave it
// holding the wrong teardown function.
function leave() {
  setTimeout(() => { if (onNavigate) onNavigate('workout'); }, 0);
}

// top_block: the close button alone, floating over the picture rather than
// taking a strip of its own - image_block is meant to have the whole screen.
function renderTopBlock() {
  return el(
    'div',
    { class: 'exercise-top' },
    el(
      'button',
      {
        class: 'exercise-close',
        type: 'button',
        title: 'Закрыть',
        'aria-label': 'Закрыть',
        onClick: close,
      },
      el('img', { class: 'exercise-close__icon', src: 'assets/icons/close.svg', alt: '' })
    )
  );
}

// Everything the user chose is already recorded - each indicator writes its op
// as it is tapped, and so does the star - so closing has nothing to save. All
// it does is throw the clock away.
//
// The complex stays highlighted on the workout page without being told to: the
// workout page selected it when Начать was pressed, and that outlives the page.
function close() {
  session = null;
  if (onNavigate) onNavigate('workout');
}

// image_block: a viewport over a track carrying the animation and the sheet of
// every image, the sheet parked one width to the right. The swipe slides the
// track, so the one arriving and the one leaving move together.
function renderImageBlock(model, urls) {
  const panels = [
    el('div', { class: 'exercise-image__panel exercise-image__panel--animation' }),
    el(
      'div',
      { class: 'exercise-image__panel exercise-image__panel--sheet' },
      el(
        'div',
        { class: 'exercise-sheet' },
        urls.map((url) =>
          el('img', {
            class: 'exercise-sheet__image',
            src: url,
            alt: '',
            // An <img> is natively draggable, and starting that drag CANCELS
            // the pointer that began it - so a swipe begun on a picture would
            // never get its pointerup. See gotcha 18.
            draggable: 'false',
            dataset: { url },
          })
        )
      )
    ),
  ];

  panels.forEach((panel, index) => {
    panel.style.left = (index - view) * 100 + '%';
  });

  const track = el('div', { class: 'exercise-image__track' }, panels);

  const viewport = el(
    'div',
    { class: 'exercise-image', 'aria-label': model.exercise.name },
    urls.length
      ? track
      : el('span', { class: 'exercise-image__empty', text: 'У упражнения нет изображений' })
  );

  if (urls.length) attachSwipe(viewport, track);
  return viewport;
}

// One sequence, in the animation panel. It plays whichever view is on screen:
// the sheet is only a swipe away, and the picture should not have to come back
// to life when it returns.
function startAnimation(urls) {
  const panel = root.querySelector('.exercise-image__panel--animation');
  if (!panel || urls.length === 0) return;

  animation = createSequenceAnimation(panel);
  animation.setFrames(urls, frame);
}

// The gesture: two views, so it commits to one or the other and resists at both
// ends. It is only committed once the finger lifts - re-rendering mid-gesture
// would replace the very node being dragged, which is the rule every drag in
// this app lives by.
function attachSwipe(viewport, track) {
  viewport.addEventListener('pointerdown', (event) => {
    // A settle in flight owns the track until it lands, and a second finger
    // must not fight the first.
    if (drag || settleTimer !== null) return;
    if (event.button) return;

    drag = {
      startX: event.clientX,
      track,
      // Read once: this is what a full view of travel means, and it cannot
      // change mid-gesture.
      width: viewport.getBoundingClientRect().width || 1,
    };
    // The finger drives it directly from here; nothing may smooth that.
    track.style.transition = 'none';
    // Hold the picture still for the length of the gesture, so the frame the
    // finger is dragging cannot change under it.
    if (animation) animation.stop();

    if (typeof viewport.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try { viewport.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const travelled = event.clientX - drag.startX;
    const wanted = view + (travelled < 0 ? 1 : -1);
    track.style.transform =
      'translateX(' + followed(travelled, wanted >= ANIMATION && wanted <= SHEET) + 'px)';
  });

  viewport.addEventListener('pointerup', (event) => {
    if (!drag) return;
    release(event.clientX - drag.startX);
  });

  // The browser took the gesture over - a native drag, a scroll. Put it back.
  viewport.addEventListener('pointercancel', () => {
    if (drag) release(0);
  });
}

function release(travelled) {
  const { track, width } = drag;
  drag = null;

  if (animation) animation.start();

  const step = swipeStep(travelled);
  const target = view + step;
  const commits = step !== 0 && target >= ANIMATION && target <= SHEET;

  if (!commits) {
    // Not far enough, or nothing there to go to. Either way the track is
    // sitting off-centre and has to come back.
    glide(track, 0, SPRING_MS, SPRING_EASING);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      track.style.transition = '';
    }, SPRING_MS);
    return;
  }

  // The sheet is parked one width to the right, so bringing it into view moves
  // the track the other way.
  glide(track, -step * width, SETTLE_MS, SETTLE_EASING);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    view = target;
    // The render rebuilds the track around the new view, back at zero.
    render();
  }, SETTLE_MS);
}

// --- Description_and_toolbar ------------------------------------------------

function renderBottomBlock(model) {
  return el(
    'div',
    { class: 'exercise-bottom' },
    renderDescription(model),
    renderToolbar(model)
  );
}

function renderDescription(model) {
  const { exercise } = model;

  return el(
    'div',
    { class: 'exercise-description' },
    el(
      'div',
      { class: 'exercise-description__head' },
      el('p', { class: 'exercise-description__name', text: exercise.name }),
      // The same star as everywhere else, so its two states are drawn from one
      // source. toggleFavorite records its own op, so this needs no save.
      renderFavoriteStar(exercise, () => toggleFavorite(exercise.id, model.categoryId))
    ),
    exercise.description
      ? el('p', { class: 'exercise-description__text', text: exercise.description })
      : null
  );
}

function renderToolbar(model) {
  return el(
    'div',
    { class: 'exercise-controls' },
    INDICATORS.map((indicator) => renderIndicatorButton(model, indicator)),
    renderNextButton(model)
  );
}

// The whole block is the button, not just the icon inside it: it is aimed at
// with a thumb mid-exercise, so it takes a third of the width and all of its
// own height.
function renderIndicatorButton(model, indicator) {
  const level = shownLevel(model.exercise, indicator.id);

  return el(
    'button',
    {
      class: 'indicator-button',
      type: 'button',
      dataset: { axis: indicator.id, level },
      // The name says what it is set to as well as which axis it is: the icon
      // carries the value visually and nothing else would say it out loud.
      title: ratingLabel(indicator, level),
      'aria-label': ratingLabel(indicator, level),
      onClick: () => {
        // Written the moment it is tapped, so closing the page cannot lose it
        // and there is nothing to save on the way out.
        recordRating(model.exercise.id, indicator.id, nextRatingLevel(level),
          today(), model.categoryId);
      },
    },
    el(
      'span',
      { class: 'indicator-button__icons' },
      el('img', { class: 'indicator-button__icon', src: ratingIcon(indicator, level), alt: '' })
    ),
    el('span', { class: 'indicator-button__name', text: indicator.name })
  );
}

function renderNextButton(model) {
  // Nothing else in the complex is waiting, so this button ends it rather than
  // going on to another exercise.
  const last = model.items.every((item, at) => at === model.index || item.done);

  return el(
    'button',
    {
      class: 'next-button',
      type: 'button',
      title: last ? 'Завершить комплекс' : 'Следующее упражнение',
      'aria-label': last ? 'Завершить комплекс' : 'Следующее упражнение',
      onClick: confirmExercise,
    },
    renderProgressRing(model.segments),
    el(
      'span',
      { class: 'next-button__face' },
      el('img', { class: 'next-button__arrow', src: 'assets/icons/arrow.svg', alt: '' }),
      el('span', { class: 'next-button__time', text: formatRemaining(model.remainingSec) })
    )
  );
}

// The ring: one segment per exercise in the complex, starting at the top and
// going clockwise. Each is a circle of its own carrying a single dash, which is
// what lets the number of them follow the complex rather than the asset - the
// exported Progress_ellipse files are one drawing of one four-segment case.
export function renderProgressRing(segments) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const centre = RING_SIZE / 2;
  const circumference = 2 * Math.PI * radius;
  const per = circumference / Math.max(1, segments.length);
  // Half the gap comes off each end, so neighbours sit RING_GAP_PX apart
  // however many of them there are.
  const length = Math.max(1, per - RING_GAP_PX);

  const circles = segments.map((state, index) => {
    const start = index * per + RING_GAP_PX / 2;
    return (
      '<circle class="next-button__segment next-button__segment--' + state + '"' +
      ' cx="' + centre + '" cy="' + centre + '" r="' + radius + '"' +
      ' stroke-width="' + RING_STROKE + '"' +
      // One dash of `length`, then a gap as long as the whole path - so the
      // pattern cannot repeat and each circle draws exactly its own segment.
      ' stroke-dasharray="' + length.toFixed(3) + ' ' + circumference.toFixed(3) + '"' +
      ' stroke-dashoffset="' + (-start).toFixed(3) + '"></circle>'
    );
  });

  return svg(
    '<svg class="next-button__ring" width="' + RING_SIZE + '" height="' + RING_SIZE + '"' +
    ' viewBox="0 0 ' + RING_SIZE + ' ' + RING_SIZE + '" aria-hidden="true">' +
    // A circle is drawn from three o'clock; turning it a quarter back is what
    // starts the count at the top.
    '<g transform="rotate(-90 ' + centre + ' ' + centre + ')">' + circles.join('') + '</g>' +
    '</svg>'
  );
}

// Button_next: this exercise is done. What it took, how it went and the fact
// that it was got through are all written now, and the next one opens.
function confirmExercise() {
  const model = describeSession(getState());
  if (!model || !session) return;

  const { exercise } = model;
  const date = today();

  // Measured from the moment Начать was pressed, or from the moment the
  // previous exercise of this complex was confirmed.
  recordDuration(exercise.id, (Date.now() - session.startedAt) / 1000, model.categoryId);

  // All three, whether they were touched or not: what is on screen is what the
  // user saw and let stand, and one record per exercise per day is what the
  // history is built out of.
  for (const indicator of INDICATORS) {
    recordRating(exercise.id, indicator.id, shownLevel(exercise, indicator.id, date),
      date, model.categoryId);
  }

  setItemDone(session.complexId, session.itemId, true, date);

  // Anything still to do: from here on, and then from the top. Ordinary use
  // only ever goes forwards, but wrapping means an exercise that was somehow
  // skipped is still reached rather than stranded.
  const rest = [...model.items.slice(model.index + 1), ...model.items.slice(0, model.index)];
  const next = rest.find((item) => !item.done && item.exercise);

  if (next) {
    // A different exercise: a different set of pictures, so neither the frame
    // nor the place in the sheet means anything any more.
    session = { ...session, itemId: next.id, startedAt: Date.now() };
    view = ANIMATION;
    frame = 0;
    sheetScroll = 0;
    render();
    return;
  }

  // That was the last of them. The complex is recorded as finished, and the
  // workout page picks out the first one with anything left to do.
  setComplexDone(session.complexId, true, date);
  finished = session.complexId;
  session = null;
  if (onNavigate) onNavigate('workout');
}
