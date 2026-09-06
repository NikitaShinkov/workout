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

// Transient, like the calendar's open tabs: a reload starts on today again.
let selectedDay = 0;
let selectedComplexId = null;
let previewIndex = 0;

// The running image sequence. A render throws its <img> away, so it is torn
// down and rebuilt every time rather than left ticking against a detached node.
let animation = null;

let root = null;
let onNavigate = null;

export function mountWorkoutPage(container, navigate) {
  root = container;
  onNavigate = navigate;

  const unsubscribe = subscribe(render);
  render();

  return function destroy() {
    unsubscribe();
    stopAnimation();
    clear(root);
    root = null;
    onNavigate = null;
  };
}

function stopAnimation() {
  if (!animation) return;
  animation.destroy();
  animation = null;
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

  stopAnimation();
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

  startAnimation(card);
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
function renderPreview(card) {
  const exercises = card ? card.exercises : [];
  const current = exercises[previewIndex] || null;

  const image = el(
    'div',
    {
      class: 'workout-preview__image',
      'aria-label': current ? current.name : 'Нет выбранного комплекса',
    },
    current ? null : el('span', { class: 'workout-preview__empty', text: 'Выберите комплекс' })
  );

  attachSwipe(image, exercises.length);

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
function attachSwipe(node, count) {
  let startX = null;

  node.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
  });
  node.addEventListener('pointercancel', () => {
    startX = null;
  });
  node.addEventListener('pointerup', (event) => {
    if (startX === null) return;

    const travelled = event.clientX - startX;
    startX = null;
    if (Math.abs(travelled) < SWIPE_MIN_PX) return;

    // Swipe left (the content moves left, under the finger) = the next one.
    stepPreview(travelled < 0 ? 1 : -1, count);
  });
}

function stepPreview(step, count) {
  const next = previewIndex + step;
  if (next < 0 || next >= count) return;

  previewIndex = next;
  render();
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

function startAnimation(card) {
  const exercise = card ? card.exercises[previewIndex] : null;
  if (!exercise || !exercise.images.length) return;

  const box = root.querySelector('.workout-preview__image');
  if (!box) return;

  animation = createSequenceAnimation(box);
  animation.setFrames(exercise.images.map(blobUrl));
}

// Exposed for the tests: a fresh page starts on today, with nothing chosen.
export function resetWorkoutState() {
  selectedDay = 0;
  selectedComplexId = null;
  previewIndex = 0;
}
