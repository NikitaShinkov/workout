// Schedule page rendering and interaction.

import { INDICATORS, createExercise } from './model.js';
import { el, svg, clear } from './dom.js';
import { blobUrl, filesToImageBlobs } from './images.js';
import { createSequenceAnimation } from './animation.js';
import { openExerciseModal, isModalOpen } from './exercise-modal.js';
import {
  getState,
  activeCategory,
  categoryList,
  subscribe,
  addExercise,
  updateExercise,
  deleteExercises,
  reorderExercises,
  toggleFavorite,
  setActiveCategory,
  setUiFlag,
  setCategoryField,
  addCategory,
  renameCategory,
  deleteCategory,
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

const NOT_SELECTED = 'var(--not-selected)';

// Feedback level -> colour. A slot with no rating yet shows the "not selected"
// grey rather than nothing at all.
const LEVEL_COLORS = {
  easy: 'var(--easy)',
  medium: 'var(--avr)',
  hard: 'var(--hard)',
  none: NOT_SELECTED,
};

const INDICATOR_SLOTS = 5;

// Transient UI state - not worth persisting across reloads.
let selectedIds = new Set();
let anchorIndex = null;

// Id of the category whose name is being edited inline, if any.
let editingCategoryId = null;

// Row drag state.
let draggingIds = null;
let rowDropTarget = null;

// Hover animations, keyed by their image box so each can be torn down again.
const rowAnimations = new Map();

let root = null;
let pagePicker = null;

export function mountSchedulePage(container) {
  root = container;

  // One file input reused by every Add_exercise_button placement and by Ctrl+D.
  pagePicker = el('input', {
    class: 'visually-hidden',
    type: 'file',
    accept: 'image/*',
    multiple: true,
  });
  pagePicker.addEventListener('change', onImagesPicked);
  document.body.appendChild(pagePicker);

  document.addEventListener('keydown', onDocumentKeydown);
  document.addEventListener('click', onDocumentClick);

  subscribe(render);
  render();
}

// --- add / edit flow -------------------------------------------------------

function startAddExercise() {
  // Nothing to add an exercise to if every category has been deleted.
  if (!activeCategory()) return;
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
    onSubmit: (fields) => addExercise(createExercise(fields)),
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
  const category = activeCategory();
  if (!category) return;
  const exercises = category.exercises;

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

function clearSelection() {
  selectedIds = new Set();
  anchorIndex = null;
}

// A left click on anything that is not an exercise row drops the selection -
// including empty space inside the list itself.
function onDocumentClick(event) {
  if (isModalOpen()) return;
  // Re-rendering here would tear the name input out from under the caret.
  if (editingCategoryId !== null) return;
  if (selectedIds.size === 0) return;

  const target = event.target;
  if (target && target.closest && target.closest('.exercise-row')) return;

  clearSelection();
  render();
}

function onDocumentKeydown(event) {
  if (isModalOpen()) return;

  // Ctrl+D starts a new exercise. Works from anywhere on the page, so it is
  // handled before the "ignore keys while typing" guard below.
  //
  // Matched on event.code (the physical key) rather than event.key: on a
  // Russian layout the D key reports event.key === 'в', so a key-based check
  // silently misses and Chrome's bookmark dialog wins instead.
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
    event.preventDefault();  // suppress "bookmark this page"
    event.stopPropagation();
    startAddExercise();
    return;
  }

  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // do not eat edits in fields

  if (event.key === 'Delete' && selectedIds.size > 0) {
    event.preventDefault();
    deleteExercises(Array.from(selectedIds));
    clearSelection();
  }
}

// --- hover animation -------------------------------------------------------

function startRowAnimation(box, exercise) {
  // A single image has nothing to animate.
  if (exercise.images.length < 2 || rowAnimations.has(box)) return;

  const still = box.querySelector('.exercise-row__image');
  if (still) still.hidden = true;

  const animation = createSequenceAnimation(box);
  animation.setFrames(exercise.images.map(blobUrl));
  rowAnimations.set(box, animation);
}

function stopRowAnimation(box) {
  const animation = rowAnimations.get(box);
  if (!animation) return;

  animation.destroy();
  rowAnimations.delete(box);

  const still = box.querySelector('.exercise-row__image');
  if (still) still.hidden = false;
}

// A re-render throws the rows away; their timers must go with them or they keep
// ticking against detached images.
function stopAllRowAnimations() {
  for (const animation of rowAnimations.values()) animation.destroy();
  rowAnimations.clear();
}

// --- row drag and drop -----------------------------------------------------

function clearRowDropMarkers() {
  const list = root.querySelector('.exercise-list');
  if (!list) return;
  for (const node of list.querySelectorAll('.exercise-row')) {
    node.classList.remove('exercise-row--drop-before', 'exercise-row--drop-after');
  }
}

function onRowDragStart(event, exercise, rowEl) {
  // Dragging a selected row moves the whole selection; dragging an unselected
  // one moves just that row and leaves the selection alone.
  draggingIds = selectedIds.has(exercise.id) ? Array.from(selectedIds) : [exercise.id];

  event.dataTransfer.setData('text/plain', draggingIds.join(','));
  event.dataTransfer.effectAllowed = 'move';

  // Re-rendering here would destroy the node being dragged and abort the drag,
  // so the visual state is applied directly.
  const list = root.querySelector('.exercise-list');
  const ids = new Set(draggingIds);
  for (const node of list.querySelectorAll('.exercise-row')) {
    if (ids.has(node.dataset.id)) node.classList.add('exercise-row--dragging');
  }
  stopRowAnimation(rowEl.querySelector('.exercise-row__image-box'));
}

function onRowDragOver(event, index, rowEl) {
  if (!draggingIds) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const box = rowEl.getBoundingClientRect();
  const after = event.clientY > box.top + box.height / 2;
  rowDropTarget = after ? index + 1 : index;

  clearRowDropMarkers();
  rowEl.classList.add(after ? 'exercise-row--drop-after' : 'exercise-row--drop-before');
}

function onRowDrop(event) {
  event.preventDefault();

  const ids = draggingIds;
  const target = rowDropTarget;

  clearRowDropMarkers();
  draggingIds = null;
  rowDropTarget = null;

  if (ids && target !== null) reorderExercises(ids, target);
}

function onRowDragEnd() {
  clearRowDropMarkers();
  const list = root.querySelector('.exercise-list');
  if (list) {
    for (const node of list.querySelectorAll('.exercise-row--dragging')) {
      node.classList.remove('exercise-row--dragging');
    }
  }
  draggingIds = null;
  rowDropTarget = null;
}

// --- render ----------------------------------------------------------------

function render() {
  const state = getState();
  const category = activeCategory();

  // Drop selections that no longer exist (after a delete or category switch).
  const liveIds = new Set(category ? category.exercises.map((e) => e.id) : []);
  for (const id of Array.from(selectedIds)) if (!liveIds.has(id)) selectedIds.delete(id);

  stopAllRowAnimations();
  clear(root);

  // Every category can be deleted, in which case there is nothing below the
  // header but the button to add one.
  let body = null;
  if (category) {
    body = category.exercises.length
      ? renderMain(state, category)
      : el('div', { class: 'empty-state' }, renderAddButton('Добавить упражнение'));
  }

  root.appendChild(el('div', { class: 'page' }, renderHeader(state), body));
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
        categoryList().map((category) => renderMenuButton(state, category))
      ),
      el('button', {
        class: 'add-category-button',
        type: 'button',
        title: 'Добавить категорию',
        'aria-label': 'Добавить категорию',
        onClick: () => {
          clearSelection();
          // A new category opens straight into name editing, per the prototype.
          startEditingCategory(addCategory());
        },
      })
    ),
    renderViewOptions(state)
  );
}

// --- category buttons ------------------------------------------------------

function startEditingCategory(id) {
  editingCategoryId = id;
  render();

  const input = root.querySelector('.menu-button__input');
  if (!input) return;
  // select() highlights the whole name and leaves the caret at the end.
  input.focus();
  input.select();
}

function renderMenuButton(state, category) {
  const isActive = category.id === state.ui.activeCategory;
  const isEditing = category.id === editingCategoryId;

  // In flow but invisible, so it - and only it - sets the button's width. That
  // is what keeps the width fixed when the close button appears on hover and
  // while a longer or shorter name is being typed. It always carries the saved
  // name, so after saving the width follows the new name.
  const sizer = el('span', { class: 'menu-button__sizer', text: category.name });

  if (isEditing) {
    return el(
      'div',
      { class: 'menu-button menu-button--active menu-button--editing' },
      sizer,
      renderCategoryNameInput(category)
    );
  }

  const children = [
    sizer,
    el('span', { class: 'menu-button__label', text: category.name }),
  ];

  if (isActive) {
    children.push(
      el(
        'button',
        {
          class: 'menu-button__close',
          type: 'button',
          title: 'Удалить категорию',
          'aria-label': 'Удалить категорию',
          onClick: (event) => {
            event.stopPropagation(); // do not also re-select the category
            clearSelection();
            deleteCategory(category.id);
          },
        },
        el('img', { class: 'menu-button__close-icon', src: 'assets/icons/close.svg', alt: '' })
      )
    );
  }

  // A div rather than a <button>: this element hosts a nested button (close)
  // and, while editing, an <input> - neither is valid inside a button.
  return el(
    'div',
    {
      class: 'menu-button' + (isActive ? ' menu-button--active' : ''),
      role: 'button',
      tabindex: '0',
      onClick: () => {
        clearSelection();
        setActiveCategory(category.id);
      },
      onDblclick: () => startEditingCategory(category.id),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          clearSelection();
          setActiveCategory(category.id);
        }
      },
    },
    children
  );
}

function renderCategoryNameInput(category) {
  const input = el('input', {
    class: 'menu-button__input',
    type: 'text',
    value: category.name,
    spellcheck: 'false',
  });

  let settled = false;

  function finish(save) {
    if (settled) return;
    settled = true;
    editingCategoryId = null;

    // renameCategory re-renders on success; otherwise render to leave the
    // editing state behind.
    const renamed = save && renameCategory(category.id, input.value);
    if (!renamed) render();
  }

  input.addEventListener('keydown', (event) => {
    // Keep Enter, Esc, Delete and Ctrl+D from reaching the page shortcuts.
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false); // cancel: the old name stays
    }
  });

  // Clicking anywhere outside the button commits, same as Enter.
  input.addEventListener('blur', () => finish(true));

  return input;
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
  const list = el(
    'div',
    { class: 'exercise-list' },
    category.exercises.map((exercise, index) => renderExerciseRow(state, exercise, index))
  );

  // Dropping below the last row appends.
  list.addEventListener('dragover', (event) => {
    if (event.target === list && draggingIds) {
      event.preventDefault();
      rowDropTarget = category.exercises.length;
      clearRowDropMarkers();
    }
  });
  list.addEventListener('drop', (event) => {
    if (event.target === list) onRowDrop(event);
  });

  return el(
    'div',
    { class: 'column column--exercise' },
    el(
      'div',
      { class: 'exercise-toolbar' },
      el('span', { class: 'toolbar-label', text: 'Упражнения' }),
      renderAddButton('Добавить')
    ),
    list
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
  const imageBox = el(
    'div',
    { class: 'exercise-row__image-box' },
    exercise.images.length
      ? el('img', { class: 'exercise-row__image', src: blobUrl(exercise.images[0]), alt: '' })
      : null
  );

  const row = el(
    'div',
    {
      class: 'exercise-row' + (selectedIds.has(exercise.id) ? ' exercise-row--selected' : ''),
      draggable: 'true',
      dataset: { id: exercise.id },
      onClick: (event) => onExerciseClick(event, index),
      onDblclick: () => startEditExercise(exercise),
      onMouseenter: () => startRowAnimation(imageBox, exercise),
      onMouseleave: () => stopRowAnimation(imageBox),
    },
    el(
      'div',
      { class: 'exercise-row__description' },
      el(
        'div',
        { class: 'exercise-row__text-image' },
        imageBox,
        el(
          'div',
          { class: 'exercise-row__titles' },
          el('p', { class: 'exercise-row__title', text: exercise.name }),
          // The paragraph is wrapped so it is not itself a flex item - see the
          // note on .exercise-row__subtitle-box in the stylesheet.
          el(
            'div',
            { class: 'exercise-row__subtitle-box' },
            el('p', { class: 'exercise-row__subtitle', text: exercise.description })
          )
        )
      ),
      state.ui.showIndicators ? renderIndicators(exercise) : null
    ),
    state.ui.showFavorites ? renderFavoriteStar(exercise) : null
  );

  row.addEventListener('dragstart', (event) => onRowDragStart(event, exercise, row));
  row.addEventListener('dragover', (event) => onRowDragOver(event, index, row));
  row.addEventListener('drop', onRowDrop);
  row.addEventListener('dragend', onRowDragEnd);

  return row;
}

function renderIndicators(exercise) {
  return el(
    'div',
    { class: 'indicators' },
    INDICATORS.map((indicator) => {
      const history = (exercise.feedback && exercise.feedback[indicator.id]) || [];
      // The five most recent ratings, oldest first. Slots with no rating yet
      // show the "not selected" grey.
      const recent = history.slice(-INDICATOR_SLOTS);
      const offset = INDICATOR_SLOTS - recent.length;
      const cells = [];

      for (let i = 0; i < INDICATOR_SLOTS; i += 1) {
        const entry = recent[i - offset];
        cells.push(
          el('span', {
            class: 'color-line__cell',
            style: { background: entry ? LEVEL_COLORS[entry.level] || NOT_SELECTED : NOT_SELECTED },
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

  return el(
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
}
