// Workout page: what there is to do today, tomorrow and the day after.
//
// Built for a phone held during a workout - the Schedule and the Calendar are
// not wanted there, so on a narrow screen the header goes away entirely and the
// three blocks take the whole viewport. On a desktop the same three blocks keep
// the phone's measure (400px) under the ordinary header, so the page reads the
// way it will on the device it is for.
//
// Three blocks, top to bottom:
//   Date_selector   today / tomorrow / the day after, today by default
//   image_block     the selected complex's exercises, animated, with Preview_bar
//   Complex_list    the complexes scheduled for the selected day
//
// Read-only, like the calendar: nothing here drags, nothing is edited. The one
// thing it would do - starting a workout - has no page to open yet, so the
// Начать button is rendered disabled.

import { el, clear } from './dom.js';
import {
  getState,
  subscribe,
  setActiveCategory,
  addCategory,
} from './store.js';
import { buildCalendar, dayKey, formatDate, addDays, startOfDay } from './schedule.js';
import { renderPageSelector } from './page-selector.js';
import { editCategoryOnOpen } from './schedule-page.js';
import { categoryButtonContents, categoryButtonClass } from './category-button.js';
import { createSequenceAnimation } from './animation.js';
import { blobUrl } from './images.js';
import { EQUIPMENT, DEFAULT_DURATION_SEC } from './model.js';

// Only today carries its date; the other two are named, not dated, exactly as
// the design writes them.
const DAY_LABELS = ['Сегодня', 'Завтра', 'Послезавтра'];

// How far a pointer has to travel across image_block before it counts as a
// swipe rather than a tap.
const SWIPE_MIN_PX = 40;

// At the ends of a complex there is nothing to swipe to, so the block gives a
// little and no more: it follows this fraction of the finger, up to this many
// pixels, and springs back when the finger lifts. The end is felt, not hit.
const EDGE_RESISTANCE = 0.28;
const EDGE_MAX_PX = 56;

// The settle once the finger lifts. Short, and sharper than the 1:1 tracking it
// takes over from - it starts fast and decelerates into place, so the gesture
// reads as completed rather than merely continued. The spring back from an end
// has nothing to complete, so it is a touch longer and gentler.
const SETTLE_MS = 200;
const SETTLE_EASING = 'cubic-bezier(0.2, 0.85, 0.3, 1)';
const SPRING_MS = 260;
const SPRING_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

// Transient, like the calendar's open tabs: a reload starts on today again.
let selectedDay = 0;
let selectedComplexId = null;
let previewIndex = 0;

// The running image sequences, one per rendered slide. A render throws their
// <img>s away, so they are torn down and rebuilt every time rather than left
// ticking against detached nodes.
let animations = [];

// The swipe in progress, and the timer that finishes it. Both hold nodes from
// the current render, so both are dropped whenever the page is rebuilt.
let drag = null;
let settleTimer = null;

let root = null;
let onNavigate = null;

export function mountWorkoutPage(container, navigate) {
  root = container;
  onNavigate = navigate;

  const unsubscribe = subscribe(render);
  render();

  return function destroy() {
    unsubscribe();
    stopAnimations();
    cancelSettle();
    drag = null;
    clear(root);
    root = null;
    onNavigate = null;
  };
}

function stopAnimations() {
  for (const animation of animations) animation.destroy();
  animations = [];
}

function cancelSettle() {
  if (settleTimer === null) return;
  clearTimeout(settleTimer);
  settleTimer = null;
}

// --- the data behind the page ----------------------------------------------

// The three days, each with whatever the schedule puts on it. buildCalendar has
// already dropped the categories that are switched out of the schedule and the
// complexes whose own switch is off, so what arrives here is exactly what is
// meant to be performed.
export function buildWorkoutDays(state, now = new Date()) {
  const today = startOfDay(now);
  const byKey = new Map(buildCalendar(state, now).map((day) => [day.key, day]));

  return DAY_LABELS.map((label, offset) => {
    const date = addDays(today, offset);
    const day = byKey.get(dayKey(date));
    return {
      offset,
      date,
      label: offset === 0 ? label + ', ' + formatDate(date) : label,
      cards: (day ? day.entries : []).map((entry) => describeComplex(state, entry)),
    };
  });
}

// An exercise that has never been performed takes the default two minutes; once
// it has, the time it actually took is what the next estimate is built from.
function durationOf(exercise) {
  const seconds = Number(exercise.lastDurationSec);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_DURATION_SEC;
}

function describeComplex(state, entry) {
  const category = state.categories[entry.categoryId];
  const byId = new Map((category ? category.exercises : []).map((e) => [e.id, e]));

  const exercises = entry.complex.items
    .map((item) => byId.get(item.exerciseId))
    .filter(Boolean);

  // The union of what every exercise in the complex asks for, with no
  // duplicates. Walked in EQUIPMENT order rather than in the order the
  // exercises happen to mention things, so the same complex always reads the
  // same way.
  const wanted = new Set(exercises.flatMap((exercise) => exercise.equipment || []));
  const equipment = EQUIPMENT.filter((item) => wanted.has(item.id)).map((item) => item.name);

  const seconds = exercises.reduce((total, exercise) => total + durationOf(exercise), 0);

  return {
    id: entry.complex.id,
    categoryId: entry.categoryId,
    name: entry.name,
    exercises,
    equipment,
    minutes: Math.round(seconds / 60),
  };
}

// 1 упражнение / 2 упражнения / 5 упражнений, including the 11-14 exception.
export function plural(count, one, few, many) {
  const teens = count % 100;
  if (teens >= 11 && teens <= 14) return many;

  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

// "Коврик, короткая лента, рол": the list is stored lower case, and only the
// line as a whole is capitalised.
function equipmentLine(names) {
  if (names.length === 0) return '—';
  const line = names.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function metaLine(card) {
  const count = card.exercises.length;
  return count + ' ' + plural(count, 'упражнение', 'упражнения', 'упражнений')
    + ', ' + card.minutes + ' мин';
}

// --- rendering ---------------------------------------------------------------

function render() {
  const state = getState();
  const days = buildWorkoutDays(state);
  const day = days[selectedDay] || days[0];

  // The selected complex may have been deleted, or the day switched under it;
  // either way the day's first complex takes over, as the design shows.
  let card = day.cards.find((c) => c.id === selectedComplexId) || null;
  if (!card) {
    card = day.cards[0] || null;
    selectedComplexId = card ? card.id : null;
    previewIndex = 0;
  }
  if (card) previewIndex = Math.min(previewIndex, Math.max(0, card.exercises.length - 1));

  stopAnimations();
  // Everything a gesture in flight is holding belongs to the render about to be
  // thrown away, so it cannot survive one.
  cancelSettle();
  drag = null;
  clear(root);

  root.appendChild(
    el(
      'div',
      { class: 'page page--workout' },
      renderHeader(state),
      el(
        'div',
        { class: 'workout' },
        renderDateSelector(days),
        renderPreview(card),
        renderComplexList(day, card)
      )
    )
  );

  startAnimations(card);
}

// The same categories block as the other two pages, in the same place, so
// switching pages never moves it. No view_options: neither the indicators nor
// the favourites column has anything to act on here.
function renderHeader(state) {
  return el(
    'div',
    { class: 'header' },
    el(
      'div',
      { class: 'categories' },
      renderPageSelector('workout', (page) => onNavigate(page)),
      renderCategoryList(state),
      el('button', {
        class: 'add-category-button',
        type: 'button',
        title: 'Добавить категорию',
        'aria-label': 'Добавить категорию',
        onClick: () => {
          const id = addCategory();
          editCategoryOnOpen(id);
          onNavigate('schedule');
        },
      })
    )
  );
}

// Navigation, as on the calendar: the workout page is not scoped to a category,
// so none of them is drawn active and picking one leaves for its schedule.
function renderCategoryList(state) {
  return el(
    'div',
    { class: 'category-list' },
    state.categoryOrder.map((id) => {
      const category = state.categories[id];
      const open = () => {
        setActiveCategory(id);
        onNavigate('schedule');
      };

      return el(
        'div',
        {
          class: categoryButtonClass(category),
          role: 'button',
          tabindex: '0',
          title: 'Открыть расписание: ' + category.name,
          dataset: { id },
          onClick: open,
          onKeydown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            open();
          },
        },
        categoryButtonContents(category.name)
      );
    })
  );
}

function renderDateSelector(days) {
  return el(
    'div',
    { class: 'date-selector' },
    el(
      'div',
      { class: 'date-list', role: 'tablist' },
      days.map((day) =>
        el('button', {
          class: 'date-button' + (day.offset === selectedDay ? ' date-button--active' : ''),
          type: 'button',
          role: 'tab',
          text: day.label,
          dataset: { day: String(day.offset) },
          'aria-selected': day.offset === selectedDay ? 'true' : 'false',
          onClick: () => selectDay(day.offset),
        })
      )
    )
  );
}

function selectDay(offset) {
  if (offset === selectedDay) return;
  selectedDay = offset;
  // A new day means a new list, so neither the complex nor the frame it was
  // showing means anything any more.
  selectedComplexId = null;
  previewIndex = 0;
  render();
}

// image_block plus its Preview_bar. The bar has one segment per exercise in the
// selected complex, so it says both where you are and how much is left.
//
// The block is a viewport over a track carrying the exercise on screen and its
// two neighbours, parked one block-width to either side. The swipe slides the
// track, so the one arriving and the one leaving move together and the gesture
// has something to follow - see attachSwipe.
function renderPreview(card) {
  const exercises = card ? card.exercises : [];
  const current = exercises[previewIndex] || null;

  const track = el(
    'div',
    { class: 'workout-preview__track' },
    // Only the neighbours that exist: at either end of a complex there is
    // nothing to bring in, which is exactly what the resistance says.
    [previewIndex - 1, previewIndex, previewIndex + 1]
      .filter((index) => exercises[index])
      .map((index) =>
        el('div', {
          class: 'workout-preview__slide',
          dataset: { index: String(index) },
          style: { left: (index - previewIndex) * 100 + '%' },
        })
      )
  );

  const image = el(
    'div',
    {
      class: 'workout-preview__image',
      'aria-label': current ? current.name : 'Нет выбранного комплекса',
    },
    current ? track : el('span', { class: 'workout-preview__empty', text: 'Выберите комплекс' })
  );

  if (current) attachSwipe(image, track, exercises.length);

  return el(
    'div',
    { class: 'workout-preview' },
    image,
    el(
      'div',
      { class: 'preview-bar' },
      exercises.map((exercise, index) =>
        el('span', {
          class:
            'preview-bar__segment' +
            (index === previewIndex ? ' preview-bar__segment--active' : ''),
        })
      )
    )
  );
}

// A horizontal drag across image_block steps through the complex. It does not
// wrap: swiping right on the first exercise and left on the last are both
// no-ops, so the ends of a complex are felt rather than looped past.
//
// The track follows the finger 1:1 while the gesture is live and is only
// committed once it ends - re-rendering mid-gesture would replace the very node
// being dragged, which is the same rule the schedule page's drag lives by.
function attachSwipe(viewport, track, count) {
  viewport.addEventListener('pointerdown', (event) => {
    // A settle in flight owns the track until it lands, and a second finger
    // must not fight the first.
    if (drag || settleTimer !== null) return;
    // Left button only: a right-click is not a swipe.
    if (event.button) return;

    drag = {
      startX: event.clientX,
      track,
      count,
      // Read once: this is what a full slide of travel means, and it cannot
      // change mid-gesture.
      width: viewport.getBoundingClientRect().width || 1,
    };
    // The finger drives it directly from here; nothing may smooth that.
    track.style.transition = 'none';

    // So the gesture keeps its events even when the finger leaves the block.
    if (typeof viewport.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try { viewport.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!drag) return;
    track.style.transform = 'translateX(' + followed(event.clientX - drag.startX) + 'px)';
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

// How far the track actually moves for a given travel of the finger: all of it
// while there is something to bring in, a damped fraction of it when there is
// not, so the end of a complex resists rather than stops dead.
function followed(travelled) {
  const wanted = previewIndex + (travelled < 0 ? 1 : -1);
  if (wanted >= 0 && wanted < drag.count) return travelled;

  return Math.sign(travelled) * Math.min(Math.abs(travelled) * EDGE_RESISTANCE, EDGE_MAX_PX);
}

// The finger has lifted. Either the track carries on to the next slide and the
// index follows it there, or it goes back where it started.
function release(travelled) {
  const { track, count, width } = drag;
  drag = null;

  const step = travelled <= -SWIPE_MIN_PX ? 1 : travelled >= SWIPE_MIN_PX ? -1 : 0;
  const target = previewIndex + step;
  const commits = step !== 0 && target >= 0 && target < count;

  if (!commits) {
    // Not far enough, or nothing there to go to. Either way the block is
    // sitting off-centre and has to come back.
    glide(track, 0, SPRING_MS, SPRING_EASING);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      track.style.transition = '';
    }, SPRING_MS);
    return;
  }

  // The next slide is parked one width to the right, the previous one to the
  // left, so bringing either into view moves the track the other way.
  glide(track, -step * width, SETTLE_MS, SETTLE_EASING);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    previewIndex = target;
    // The render rebuilds the track around the new index, back at zero.
    render();
  }, SETTLE_MS);
}

function glide(track, x, ms, easing) {
  track.style.transition = 'transform ' + ms + 'ms ' + easing;
  track.style.transform = 'translateX(' + x + 'px)';
}

function renderComplexList(day, selected) {
  if (day.cards.length === 0) {
    return el(
      'div',
      { class: 'complex-list complex-list--workout' },
      el('p', { class: 'workout-complex__empty', text: 'На этот день комплексов нет' })
    );
  }

  return el(
    'div',
    { class: 'complex-list complex-list--workout' },
    day.cards.map((card) => renderComplexCard(day, card, Boolean(selected) && card.id === selected.id))
  );
}

function renderComplexCard(day, card, isActive) {
  return el(
    'div',
    {
      class: 'workout-complex' + (isActive ? ' workout-complex--active' : ''),
      role: 'button',
      tabindex: '0',
      dataset: { complex: card.id },
      'aria-pressed': isActive ? 'true' : 'false',
      onClick: () => selectComplex(card.id),
      onKeydown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectComplex(card.id);
      },
    },
    el(
      'div',
      { class: 'workout-complex__text' },
      el(
        'div',
        { class: 'workout-complex__head' },
        el('p', { class: 'workout-complex__name', text: card.name }),
        el('p', { class: 'workout-complex__equipment', text: equipmentLine(card.equipment) })
      ),
      el('p', { class: 'workout-complex__meta', text: metaLine(card) })
    ),
    // Only today's complexes can be started, so only they carry the button. The
    // page it would open is not built, so it is there and disabled.
    day.offset === 0
      ? el('button', {
          class: 'main-button',
          type: 'button',
          text: 'Начать',
          disabled: true,
          title: 'Страница выполнения упражнений ещё не готова',
        })
      : null
  );
}

function selectComplex(id) {
  if (id === selectedComplexId) return;
  selectedComplexId = id;
  previewIndex = 0;
  render();
}

// One sequence per rendered slide, so the exercise arriving is already playing
// as it slides in rather than coming to life once it lands. At most three run
// at a time - the one on screen and its two neighbours.
function startAnimations(card) {
  if (!card) return;

  for (const slide of root.querySelectorAll('.workout-preview__slide')) {
    const exercise = card.exercises[Number(slide.dataset.index)];
    if (!exercise || !exercise.images.length) continue;

    const animation = createSequenceAnimation(slide);
    animation.setFrames(exercise.images.map(blobUrl));
    animations.push(animation);
  }
}

// Exposed for the tests: a fresh page starts on today, with nothing chosen.
export function resetWorkoutState() {
  selectedDay = 0;
  selectedComplexId = null;
  previewIndex = 0;
}
