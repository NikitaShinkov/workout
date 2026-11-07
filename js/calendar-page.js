// Calendar page: every scheduled complex from every category, laid out by the
// day it falls on.
//
// A read view. The order is the schedule's, so no block drags, nothing is
// selected and Del does nothing - the only interactions are switching which
// category a day shows, starring a block, opening one to edit it, and dragging
// the Date_pointer, which moves every category's start date at once.

import { el, clear } from './dom.js';
import { openExerciseModal } from './exercise-modal.js';
import {
  getState,
  subscribe,
  updateExercise,
  toggleFavorite,
  setUiFlag,
  setActiveCategory,
  addCategory,
  setScheduleStartDates,
} from './store.js';
import {
  addDays,
  buildCalendar,
  formatDate,
  pointerIndex,
  startOfDay,
  startDatesForCalendarPointer,
} from './schedule.js';
import { renderDatePointer, cancelDatePointerDrag } from './date-pointer.js';
import { renderPageSelector } from './page-selector.js';
import { renderSaveButton } from './save-button.js';
import { editCategoryOnOpen } from './schedule-page.js';
import { categoryButtonContents, categoryButtonClass } from './category-button.js';
import {
  renderExerciseRow,
  renderIndicators,
  stopAllRowAnimations,
} from './exercise-row.js';

// Which category each day is showing, keyed by day. A day with no entry here
// shows its first category. Transient - a reload starts over.
let openCategoryByDay = new Map();

let root = null;
let onNavigate = null;

export function mountCalendarPage(container, navigate) {
  root = container;
  onNavigate = navigate;

  const unsubscribe = subscribe(render);
  render();

  return function destroy() {
    unsubscribe();
    cancelDatePointerDrag();
    stopAllRowAnimations();
    clear(root);
    root = null;
    onNavigate = null;
  };
}

function render() {
  const state = getState();
  const days = buildCalendar(state);

  // The rows about to be thrown away may have animations still running.
  stopAllRowAnimations();

  const scroll = root.querySelector('.complex-list');
  const scrollTop = scroll ? scroll.scrollTop : 0;

  clear(root);
  root.appendChild(
    el('div', { class: 'page' }, renderHeader(state), renderMain(state, days))
  );

  const restored = root.querySelector('.complex-list');
  if (restored && scrollTop) restored.scrollTop = scrollTop;
}

// The page selector, the categories, and the two icon buttons under them -
// neither of the complex-list checkboxes, which filter a list this page has
// no equivalent of.
function renderHeader(state) {
  return el(
    'div',
    { class: 'header' },
    el(
      'div',
      { class: 'categories' },
      renderPageSelector('calendar', (page) => onNavigate(page)),
      renderCategoryList(state),
      el('button', {
        class: 'add-category-button',
        type: 'button',
        title: 'Добавить категорию',
        'aria-label': 'Добавить категорию',
        onClick: () => {
          // Adding one here means going and filling it in: a category with
          // nothing in it has nothing to show on a calendar.
          const id = addCategory();
          editCategoryOnOpen(id);
          onNavigate('schedule');
        },
      }),
      renderSaveButton()
    ),
    el(
      'div',
      { class: 'view-options' },
      renderIconButton(state, 'showIndicators', 'Показывать индикаторы'),
      renderIconButton(state, 'showFavorites', 'Показывать избранное')
    )
  );
}

// Navigation, not a filter: the calendar is not scoped to a category, so none
// of these is drawn active. Picking one leaves for that category's schedule.
// They carry no close button, no rename and no drag - those belong to the page
// that owns categories.
function renderCategoryList(state) {
  return el(
    'div',
    { class: 'category-list' },
    state.categoryOrder.map((id) => {
      const category = state.categories[id];
      return el(
        'div',
        {
          // Same shell as the schedule page's, so the names do not shift and a
          // category switched out of the schedule stays faded here too.
          class: categoryButtonClass(category),
          role: 'button',
          tabindex: '0',
          title: 'Открыть расписание: ' + category.name,
          dataset: { id },
          onClick: () => openCategory(id),
          onKeydown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openCategory(id);
          },
        },
        categoryButtonContents(category.name)
      );
    })
  );
}

function openCategory(id) {
  setActiveCategory(id);
  onNavigate('schedule');
}

function renderIconButton(state, flag, title) {
  const active = state.ui[flag];

  const contents =
    flag === 'showIndicators'
      ? el(
          'span',
          { class: 'indicator-swatch' },
          el('span', { class: 'indicator-swatch__cell', style: { background: 'var(--hard)' } }),
          el('span', { class: 'indicator-swatch__cell', style: { background: 'var(--avr)' } }),
          el('span', { class: 'indicator-swatch__cell', style: { background: 'var(--easy)' } })
        )
      : el('img', {
          class: 'icon-button__icon',
          src: active ? 'assets/icons/star-btn-active.svg' : 'assets/icons/star-btn.svg',
          alt: '',
        });

  return el(
    'button',
    {
      class: 'icon-button' + (active ? ' icon-button--active' : ''),
      type: 'button',
      title,
      onClick: () => setUiFlag(flag, !active),
    },
    contents
  );
}

function renderMain(state, days) {
  const first = days.length ? formatDate(days[0].date) : '—';
  const last = days.length ? formatDate(days[days.length - 1].date) : '—';

  return el(
    'div',
    { class: 'main main--calendar' },
    el(
      'div',
      { class: 'column column--schedule' },
      el(
        'div',
        { class: 'schedule-toolbar' },
        el('span', { class: 'toolbar-label', text: 'Календарь с ' + first + ' по ' + last })
      ),
      renderDayList(state, days)
    )
  );
}

function renderDayList(state, days) {
  // The pointer wants a date per entry, in the shape pointerIndex reads.
  const dates = new Map(days.map((day) => [day.key, day.date]));
  const pointerAt = days.length
    ? pointerIndex(days.map((day) => ({ id: day.key })), dates, startOfDay())
    : -1;

  const onDrop = (boundary) => onDatePointerDrop(days, boundary);
  const children = [];
  days.forEach((day, index) => {
    if (index === pointerAt) children.push(renderDatePointer({ onDrop }));
    children.push(renderDay(state, day));
  });
  if (days.length && pointerAt >= days.length) children.push(renderDatePointer({ onDrop }));

  return el('div', { class: 'complex-list complex-list--calendar' }, children);
}

// The Date_pointer dropped before day `boundary`: that day becomes today. The
// calendar is every category at once, so every category's start date moves by
// the same number of days - the calendar keeps its shape and slides under the
// pointer. Below the last day means the day after it is today.
function onDatePointerDrop(days, boundary) {
  if (!days.length) return;
  const day = boundary < days.length
    ? days[boundary].date
    : addDays(days[days.length - 1].date, 1);
  setScheduleStartDates(startDatesForCalendarPointer(getState(), day));
}

function renderDay(state, day) {
  const openId = openCategoryByDay.get(day.key);
  const entry = day.entries.find((e) => e.categoryId === openId) || day.entries[0];

  const category = state.categories[entry.categoryId];
  const byId = new Map((category ? category.exercises : []).map((e) => [e.id, e]));

  const rows = entry.complex.items
    .map((item) => byId.get(item.exerciseId))
    .filter(Boolean)
    .map((exercise) =>
      renderExerciseRow(exercise, {
        // The schedule decides the order here, so nothing may be picked up.
        draggable: false,
        showIndicators: state.ui.showIndicators,
        showFavorites: state.ui.showFavorites,
        onToggleFavorite: (target) => toggleFavorite(target.id, entry.categoryId),
        onDblclick: () =>
          openExerciseModal({
            images: exercise.images,
            exercise,
            onSubmit: (fields) => updateExercise(exercise.id, fields, entry.categoryId),
          }),
      })
    );

  return el(
    'div',
    { class: 'complex', dataset: { day: day.key } },
    el(
      'div',
      { class: 'complex__side complex__side--static' },
      el('span', { class: 'complex__date', text: formatDate(day.date) })
    ),
    el(
      'div',
      { class: 'complex__items' },
      // Category_block is the day's first row: which category's complex the
      // rows below belong to, and how to swap to another one.
      renderCategoryBlock(day, entry),
      rows
    )
  );
}

function renderCategoryBlock(day, current) {
  return el(
    'div',
    { class: 'category-block' },
    el(
      'div',
      { class: 'category-list category-list--day' },
      day.entries.map((entry) => {
        const isOpen = entry.categoryId === current.categoryId;
        return el(
          'div',
          {
            // The same shell again - a tab that centred its name differently
            // from the header above it would read as a wobble.
            class: 'menu-button' + (isOpen ? ' menu-button--active' : ''),
            role: 'tab',
            tabindex: '0',
            dataset: { id: entry.categoryId },
            'aria-selected': isOpen ? 'true' : 'false',
            onClick: () => openDayCategory(day.key, entry.categoryId),
            onKeydown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              openDayCategory(day.key, entry.categoryId);
            },
          },
          categoryButtonContents(entry.name)
        );
      })
    )
  );
}

function openDayCategory(dayKey, categoryId) {
  openCategoryByDay.set(dayKey, categoryId);
  render();
}

// Exposed for the tests: a fresh page should not inherit which tabs were open.
export function resetCalendarState() {
  openCategoryByDay = new Map();
}
