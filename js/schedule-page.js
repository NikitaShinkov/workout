// Schedule page rendering and interaction.

import { CATEGORIES, INDICATORS, createExercise } from './model.js';
import { el, svg, clear } from './dom.js';
import { blobUrl, filesToImageBlobs } from './images.js';
import { openExerciseModal, isModalOpen } from './exercise-modal.js';
import {
  getState,
  activeCategory,
  subscribe,
  addExercise,
  updateExercise,
  deleteExercises,
  toggleFavorite,
  setActiveCategory,
  setUiFlag,
  setCategoryField,
} from './store.js';

// Exact path data from the exported Favorites asset. It is inlined rather than
// loaded as a file because Figma exports Favorites and Favorites_active
// byte-identically - the difference between the two states is the fill, which
// only CSS can drive. Same geometry, one source of truth.
const STAR_PATH =
  'M5.02675 20.8303C4.83131 20.6858 4.71152 20.491 4.66739 20.246C4.62956 20.0009 4.67054 19.7088 ' +
  '4.79033 19.3695L6.76682 13.5071L1.71683 9.88784C1.42052 9.68049 1.21562 9.46686 1.10213 ' +
  '9.24694C0.988652 9.02702 0.969738 8.80082 1.04539 8.56833C1.12105 8.34213 1.26921 8.17562 ' +
  '1.48987 8.0688C1.71053 7.9557 2.00369 7.89915 2.36936 7.89915H8.56363L10.4456 2.04618C10.559 ' +
  '1.7006 10.7009 1.43984 10.8711 1.2639C11.0476 1.08797 11.2557 1 11.4953 1C11.7412 1 11.9492 ' +
  '1.08797 12.1194 1.2639C12.296 1.43984 12.441 1.7006 12.5544 2.04618L14.4364 7.89915H20.6306C20.9963 ' +
  '7.89915 21.2895 7.9557 21.5101 8.0688C21.7308 8.17562 21.879 8.34213 21.9546 8.56833C22.0303 ' +
  '8.80082 22.0113 9.02702 21.8979 9.24694C21.7844 9.46686 21.5795 9.68049 21.2832 ' +
  '9.88784L16.2332 13.5071L18.2097 19.3695C18.3295 19.7088 18.3673 20.0009 18.3232 20.246C18.2853 ' +
  '20.491 18.1687 20.6858 17.9732 20.8303C17.7778 20.9812 17.5571 21.0314 17.3113 20.9812C17.0654 ' +
  '20.9372 16.7974 20.8115 16.5074 20.6041L11.4953 16.9378L6.49257 20.6041C6.20256 20.8115 5.93461 ' +
  '20.9372 5.68873 20.9812C5.44285 21.0314 5.22219 20.9812 5.02675 20.8303Z';

// Feedback level -> colour. Absent feedback renders transparent, which is the
// "no rating yet" state the spec asks for.
const LEVEL_COLORS = {
  easy: 'var(--easy)',
  medium: 'var(--avr)',
  hard: 'var(--hard)',
  none: 'var(--not-selected)',
};

const INDICATOR_SLOTS = 5;

// Transient UI state - selection is not worth persisting across reloads.
let selectedIds = new Set();
let anchorIndex = null;

let root = null;
let pagePicker = null;

export function mountSchedulePage(container) {
  root = container;

  // One file input reused by both Add_exercise_button placements.
  pagePicker = el('input', {
    class: 'visually-hidden',
    type: 'file',
    accept: 'image/*',
    multiple: true,
  });
  pagePicker.addEventListener('change', onImagesPicked);
  document.body.appendChild(pagePicker);

  document.addEventListener('keydown', onDocumentKeydown);

  subscribe(render);
  render();
}

// --- add / edit flow -------------------------------------------------------

function startAddExercise() {
  // Adding always begins with the system file picker, per the spec.
  pagePicker.click();
}

async function onImagesPicked() {
  if (!pagePicker.files || pagePicker.files.length === 0) return;

  const images = await filesToImageBlobs(pagePicker.files);
  pagePicker.value = '';
  if (images.length === 0) return;

  openExerciseModal({
    images,
    defaultEquipment: getState().lastEquipment,
    onSubmit: (fields) => {
      addExercise(createExercise(fields));
    },
  });
}

function startEditExercise(exercise) {
  openExerciseModal({
    images: exercise.images,
    exercise,
    onSubmit: (fields) => updateExercise(exercise.id, fields),
  });
}

// --- selection -------------------------------------------------------------

function onExerciseClick(event, index) {
  const exercises = visibleExercises();

  if (event.shiftKey && anchorIndex !== null) {
    // Shift: select the range between the anchor and this row.
    const from = Math.min(anchorIndex, index);
    const to = Math.max(anchorIndex, index);
    selectedIds = new Set(exercises.slice(from, to + 1).map((e) => e.id));
  } else if (event.ctrlKey || event.metaKey) {
    // Ctrl: add to / remove from the existing selection.
    const id = exercises[index].id;
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    anchorIndex = index;
  } else {
    selectedIds = new Set([exercises[index].id]);
    anchorIndex = index;
  }

  render();
}

function onDocumentKeydown(event) {
  if (isModalOpen()) return;

  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // do not eat edits in fields

  if (event.key === 'Delete' && selectedIds.size > 0) {
    event.preventDefault();
    deleteExercises(Array.from(selectedIds));
    selectedIds = new Set();
    anchorIndex = null;
  }
}

function visibleExercises() {
  return activeCategory().exercises;
}

// --- render ----------------------------------------------------------------

function render() {
  const state = getState();
  const category = activeCategory();

  // Drop selections that no longer exist (e.g. after a delete or a category switch).
  const liveIds = new Set(category.exercises.map((e) => e.id));
  for (const id of Array.from(selectedIds)) if (!liveIds.has(id)) selectedIds.delete(id);

  clear(root);

  const hasExercises = category.exercises.length > 0;

  root.appendChild(
    el(
      'div',
      { class: 'page' },
      renderHeader(state),
      hasExercises
        ? renderMain(state, category)
        : el('div', { class: 'empty-state' }, renderAddButton('Добавить упражнение'))
    )
  );
}

function renderHeader(state) {
  return el(
    'div',
    { class: 'header' },
    el(
      'div',
      { class: 'categories' },
      el(
        'div',
        { class: 'category-list' },
        CATEGORIES.map((category) =>
          el('button', {
            class:
              'menu-button' +
              (category.id === state.ui.activeCategory ? ' menu-button--active' : ''),
            type: 'button',
            text: category.name,
            onClick: () => {
              selectedIds = new Set();
              anchorIndex = null;
              setActiveCategory(category.id);
            },
          })
        )
      ),
      // Adding categories is out of scope for this stage; the control is shown
      // because the layout has it, but it is inert.
      el('img', {
        class: 'add-category-button',
        src: 'assets/icons/add-category.svg',
        alt: 'Добавить категорию',
      })
    ),
    renderViewOptions(state)
  );
}

function renderViewOptions(state) {
  const indicatorButton = el(
    'button',
    {
      class: 'icon-button' + (state.ui.showIndicators ? ' icon-button--active' : ''),
      type: 'button',
      title: 'Показывать индикаторы',
      onClick: () => setUiFlag('showIndicators', !state.ui.showIndicators),
    },
    el(
      'span',
      { class: 'indicator-swatch' },
      el('span', { class: 'indicator-swatch__cell', style: { background: 'var(--hard)' } }),
      el('span', { class: 'indicator-swatch__cell', style: { background: 'var(--avr)' } }),
      el('span', { class: 'indicator-swatch__cell', style: { background: 'var(--easy)' } })
    )
  );

  const favoritesButton = el(
    'button',
    {
      class: 'icon-button' + (state.ui.showFavorites ? ' icon-button--active' : ''),
      type: 'button',
      title: 'Показывать избранное',
      onClick: () => setUiFlag('showFavorites', !state.ui.showFavorites),
    },
    el('img', {
      class: 'icon-button__icon',
      src: state.ui.showFavorites
        ? 'assets/icons/star-btn-active.svg'
        : 'assets/icons/star-btn.svg',
      alt: '',
    })
  );

  return el(
    'div',
    { class: 'view-options' },
    indicatorButton,
    favoritesButton,
    // Both checkboxes are clickable but deliberately do not filter anything yet.
    renderCheckbox('только включённые комплексы', state.ui.onlyEnabledComplexes, (checked) =>
      setUiFlag('onlyEnabledComplexes', checked)
    ),
    renderCheckbox('только избранные', state.ui.favoritesOnly, (checked) =>
      setUiFlag('favoritesOnly', checked)
    )
  );
}

function renderCheckbox(label, checked, onChange) {
  const input = el('input', { class: 'checkbox__input', type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));

  return el(
    'label',
    { class: 'checkbox-line checkbox-line--inline' },
    input,
    el('span', { class: 'checkbox' }),
    el('span', { class: 'checkbox-line__label', text: label })
  );
}

function renderMain(state, category) {
  return el(
    'div',
    { class: 'main' },
    renderScheduleColumn(category),
    renderExerciseColumn(state, category)
  );
}

function renderScheduleColumn(category) {
  const toggle = el('input', {
    class: 'switch__input',
    type: 'checkbox',
    checked: category.scheduleEnabled,
  });
  toggle.addEventListener('change', () => setCategoryField('scheduleEnabled', toggle.checked));

  const dateInput = el('input', {
    class: 'input input--date',
    type: 'text',
    value: category.scheduleStartDate,
    placeholder: '19 сен',
  });
  dateInput.addEventListener('change', () =>
    setCategoryField('scheduleStartDate', dateInput.value)
  );

  const intervalInput = el('input', {
    class: 'input input--interval',
    type: 'text',
    value: String(category.intervalDays),
  });
  intervalInput.addEventListener('change', () =>
    setCategoryField('intervalDays', intervalInput.value)
  );

  return el(
    'div',
    { class: 'column column--schedule' },
    el(
      'div',
      { class: 'schedule-toolbar' },
      el('label', { class: 'switch' }, toggle, el('span', { class: 'switch__track' })),
      el('span', { class: 'toolbar-label', text: 'Расписание с' }),
      dateInput,
      el('span', { class: 'toolbar-label', text: 'с интервалом' }),
      intervalInput,
      // The end date is derived from the complex schedule, which this stage
      // does not build yet, so there is nothing real to show here.
      el('span', { class: 'toolbar-label', text: 'день по —' })
    ),
    el('div', { class: 'complex-list' })
  );
}

function renderExerciseColumn(state, category) {
  const rows = category.exercises.map((exercise, index) =>
    renderExerciseRow(state, exercise, index)
  );

  return el(
    'div',
    { class: 'column column--exercise' },
    el(
      'div',
      { class: 'exercise-toolbar' },
      el('span', { class: 'toolbar-label', text: 'Упражнения' }),
      renderAddButton('Добавить')
    ),
    el('div', { class: 'exercise-list' }, rows)
  );
}

function renderAddButton(label) {
  return el(
    'button',
    { class: 'main-button', type: 'button', onClick: startAddExercise },
    el('img', { class: 'main-button__icon', src: 'assets/icons/plus.svg', alt: '' }),
    el('span', { text: label })
  );
}

function renderExerciseRow(state, exercise, index) {
  const thumb = exercise.images.length
    ? el('img', { class: 'exercise-row__image', src: blobUrl(exercise.images[0]), alt: '' })
    : el('div', { class: 'exercise-row__image exercise-row__image--empty' });

  const row = el(
    'div',
    {
      class: 'exercise-row' + (selectedIds.has(exercise.id) ? ' exercise-row--selected' : ''),
      dataset: { id: exercise.id },
      onClick: (event) => onExerciseClick(event, index),
      onDblclick: () => startEditExercise(exercise),
    },
    el(
      'div',
      { class: 'exercise-row__description' },
      el(
        'div',
        { class: 'exercise-row__text-image' },
        thumb,
        el(
          'div',
          { class: 'exercise-row__titles' },
          el('p', { class: 'exercise-row__title', text: exercise.name }),
          el('p', { class: 'exercise-row__subtitle', text: exercise.description })
        )
      ),
      state.ui.showIndicators ? renderIndicators(exercise) : null
    ),
    state.ui.showFavorites ? renderFavoriteStar(exercise) : null
  );

  return row;
}

function renderIndicators(exercise) {
  return el(
    'div',
    { class: 'indicators' },
    INDICATORS.map((indicator) => {
      const history = (exercise.feedback && exercise.feedback[indicator.id]) || [];
      // Newest five ratings, oldest first, padded with blanks on the left.
      const recent = history.slice(-INDICATOR_SLOTS);
      const cells = [];

      for (let i = 0; i < INDICATOR_SLOTS; i += 1) {
        const entry = recent[i - (INDICATOR_SLOTS - recent.length)];
        cells.push(
          el('span', {
            class: 'color-line__cell',
            style: { background: entry ? LEVEL_COLORS[entry.level] || 'transparent' : 'transparent' },
          })
        );
      }

      return el(
        'div',
        { class: 'indicator' },
        el('span', { class: 'indicator__label', text: indicator.label }),
        el('div', { class: 'color-line' }, cells)
      );
    })
  );
}

function renderFavoriteStar(exercise) {
  const star = svg(
    '<svg class="favorite-star__icon" viewBox="0 0 23 22" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="' + STAR_PATH + '"/>' +
      '</svg>'
  );

  const button = el(
    'button',
    {
      class: 'favorite-star' + (exercise.favorite ? ' favorite-star--active' : ''),
      type: 'button',
      title: exercise.favorite ? 'Убрать из избранного' : 'Добавить в избранное',
      onClick: (event) => {
        event.stopPropagation(); // do not also select the row
        toggleFavorite(exercise.id);
      },
    },
    star
  );

  return button;
}
