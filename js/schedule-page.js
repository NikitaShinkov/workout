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
  restoreCategory,
  reorderCategories,
  createComplexFromExercises,
  addExercisesToComplex,
  moveComplexItems,
  moveItemsToNewComplex,
  deleteComplexItems,
  deleteComplexes,
  reorderComplexes,
  setComplexEnabled,
} from './store.js';
import { buildSchedule, formatDate, pointerIndex, startOfDay } from './schedule.js';

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
//
// One selection, and it belongs to exactly one of three scopes at a time:
//
//   'library'  exercise rows in Exercise_list, addressed by exercise id
//   'item'     exercise rows inside complexes,  addressed by complex-item id
//   'complex'  whole complexes,                 addressed by complex id
//
// A single scoped set is what makes the spec's exclusion rules fall out for
// free: selecting anywhere drops whatever was selected somewhere else, so Del
// never has to guess which of the three lists it is aimed at.
const EMPTY_SELECTION = { scope: null, ids: new Set(), anchor: null };
let selection = EMPTY_SELECTION;

// Id of the category whose name is being edited inline, if any.
let editingCategoryId = null;

// The close button appears only on the SECOND hover after a category is opened.
// Switching category disarms it; leaving the button arms it again, so the X
// never appears under a cursor that is only still there because it just clicked.
let activeHoverArmed = true;

// Categories awaiting permanent deletion, oldest first. Each keeps its own
// timer, and the newest is the one the undo button offers.
const UNDO_SECONDS = 5;
let pendingDeletions = [];
let undoTicker = null;

// Category drag-reorder state.
let draggingCategoryId = null;
let categoryDropTarget = null;

// Row and complex drag state. `drag.kind` matches the selection scopes above
// and decides what a drop means; `rowDropTarget` is an index in Exercise_list,
// `complexDropTarget` is either {type:'item', complexId, index} for a drop
// inside a complex or {type:'complex', index} for a drop between them.
let drag = null;
let rowDropTarget = null;
let complexDropTarget = null;

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

// The keys of a scope, in the order they are displayed - the order shift-range
// selection walks and the order a dragged group keeps. Read from the state
// rather than captured at render time, so a handler bound to an old node still
// works out the right answer.
function scopeKeys(scope) {
  const category = activeCategory();
  if (!category) return [];

  if (scope === 'library') return category.exercises.map((e) => e.id);

  const visible = visibleComplexes(getState(), category);
  if (scope === 'complex') return visible.map((complex) => complex.id);
  // 'item': flattened across complexes, so a shift-range can span them.
  return visible.flatMap((complex) => complex.items.map((item) => item.id));
}

function isSelected(scope, key) {
  return selection.scope === scope && selection.ids.has(key);
}

// The selection in display order. A group drag has to keep the relative order
// of what it moves, and a Set does not carry it.
function orderedSelection() {
  if (!selection.scope) return [];
  return scopeKeys(selection.scope).filter((key) => selection.ids.has(key));
}

// Shared by all three scopes: plain click replaces, Ctrl toggles, Shift takes
// the range from the anchor. Clicking in a new scope starts a fresh selection,
// which is what clears the other two lists.
function selectAt(event, scope, index) {
  const keys = scopeKeys(scope);
  const key = keys[index];
  if (key === undefined) return;

  const sameScope = selection.scope === scope;
  const ids = sameScope ? new Set(selection.ids) : new Set();
  const anchor = sameScope ? selection.anchor : null;

  if (event.shiftKey && anchor !== null) {
    const from = Math.min(anchor, index);
    const to = Math.max(anchor, index);
    selection = { scope, ids: new Set(keys.slice(from, to + 1)), anchor };
  } else if (event.ctrlKey || event.metaKey) {
    if (ids.has(key)) ids.delete(key);
    else ids.add(key);
    selection = { scope, ids, anchor: index };
  } else {
    selection = { scope, ids: new Set([key]), anchor: index };
  }

  render();
}

function clearSelection() {
  selection = EMPTY_SELECTION;
}

// A left click on anything that is not a selectable block drops the selection -
// including empty space inside either list.
function onDocumentClick(event) {
  if (isModalOpen()) return;
  // Re-rendering here would tear the name input out from under the caret.
  if (editingCategoryId !== null) return;
  if (selection.ids.size === 0) return;

  const target = event.target;
  // Complex_side_block is the complex's own click target, so it counts too.
  if (target && target.closest && target.closest('.exercise-row, .complex__side')) return;

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

  // Ctrl+Z restores the most recently deleted category. Checked after the field
  // guard above so it never steals undo from a text field.
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && pendingDeletions.length > 0) {
    event.preventDefault();
    undoLastDeletion();
    return;
  }

  // Ctrl+G groups the exercises selected in Exercise_list into a new complex.
  // event.code again: on a Russian layout the G key reports event.key === 'п'.
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyG') {
    if (selection.scope !== 'library' || selection.ids.size === 0) return;
    event.preventDefault();

    const category = activeCategory();
    createComplexFromExercises(orderedSelection(), category.complexes.length);
    return;
  }

  if (event.key === 'Delete' && selection.ids.size > 0) {
    event.preventDefault();

    const doomed = orderedSelection();
    if (selection.scope === 'library') deleteExercises(doomed);
    else if (selection.scope === 'item') deleteComplexItems(doomed);
    else if (selection.scope === 'complex') deleteComplexes(doomed);

    clearSelection();
    render();
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

function clearDropMarkers() {
  if (!root) return;
  for (const node of root.querySelectorAll('.exercise-row')) {
    node.classList.remove('exercise-row--drop-before', 'exercise-row--drop-after');
  }
  for (const node of root.querySelectorAll('.complex')) {
    node.classList.remove('complex--drop-before', 'complex--drop-after');
  }
  const list = root.querySelector('.complex-list');
  if (list) list.classList.remove('complex-list--drop');
}

// Dragging a selected block moves the whole selection; dragging an unselected
// one moves just that block and leaves the selection alone.
function draggedKeys(scope, key) {
  return isSelected(scope, key) ? orderedSelection() : [key];
}

function onRowDragStart(event, context, rowEl) {
  drag = { kind: context.scope, ids: draggedKeys(context.scope, context.key) };

  event.dataTransfer.setData('text/plain', drag.ids.join(','));
  // A library row does BOTH: it is copied into the schedule, and moved when it
  // is reordered within Exercise_list. Declaring only one of them makes Chrome
  // reject the other outright - a no-drop cursor and no drop event at all, with
  // nothing logged to say why.
  event.dataTransfer.effectAllowed = context.scope === 'library' ? 'copyMove' : 'move';

  // Re-rendering here would destroy the node being dragged and abort the drag,
  // so the visual state is applied directly.
  markDragging('.exercise-row', 'exercise-row--dragging', drag.ids);
  stopRowAnimation(rowEl.querySelector('.exercise-row__image-box'));
}

// Library rows carry exercise ids and complex rows carry item ids, so matching
// on data-id alone never marks a row in the other list.
function markDragging(selector, className, ids) {
  const keys = new Set(ids);
  for (const node of root.querySelectorAll(selector)) {
    if (keys.has(node.dataset.id)) node.classList.add(className);
  }
}

function clearDragClasses() {
  if (!root) return;
  for (const node of root.querySelectorAll('.exercise-row--dragging, .complex--dragging')) {
    node.classList.remove('exercise-row--dragging', 'complex--dragging');
  }
}

function endDrag() {
  clearDropMarkers();
  clearDragClasses();
  stopAutoScroll();
  drag = null;
  rowDropTarget = null;
  complexDropTarget = null;
}

// --- edge auto-scroll while dragging ---------------------------------------
//
// A drag holds the pointer captured, so the wheel and the scrollbar are out of
// reach: without this there is no way to reach a complex that is off-screen.
// Only a drag scrolls a list on its own - a click or a reorder must never move
// it under the user.

const AUTO_SCROLL_EDGE = 56;   // px from the edge of the list that triggers it
const AUTO_SCROLL_STEP = 10;   // px per tick
const AUTO_SCROLL_TICK = 30;   // ms

let autoScrollTimer = null;
let autoScrollSelector = null;
let autoScrollStep = 0;

// Addressed by selector, not by node: a re-render mid-drag replaces the list,
// and a timer holding the old node would scroll a detached element.
function updateAutoScroll(selector, clientY) {
  const list = root && root.querySelector(selector);
  if (!list) return;

  const box = list.getBoundingClientRect();
  if (clientY < box.top + AUTO_SCROLL_EDGE) autoScrollStep = -AUTO_SCROLL_STEP;
  else if (clientY > box.bottom - AUTO_SCROLL_EDGE) autoScrollStep = AUTO_SCROLL_STEP;
  else { stopAutoScroll(); return; }

  autoScrollSelector = selector;
  if (autoScrollTimer !== null) return;
  autoScrollTimer = setInterval(() => {
    const node = root && root.querySelector(autoScrollSelector);
    if (node) node.scrollTop += autoScrollStep;
  }, AUTO_SCROLL_TICK);
}

function stopAutoScroll() {
  if (autoScrollTimer === null) return;
  clearInterval(autoScrollTimer);
  autoScrollTimer = null;
  autoScrollSelector = null;
  autoScrollStep = 0;
}

// --- Exercise_list: reorder within the library ------------------------------

function onLibraryRowDragOver(event, index, rowEl) {
  // Scheduled blocks and complexes have no meaning back in the library, so the
  // drop is simply not accepted.
  if (!drag || drag.kind !== 'library') return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const box = rowEl.getBoundingClientRect();
  const after = event.clientY > box.top + box.height / 2;
  rowDropTarget = after ? index + 1 : index;

  clearDropMarkers();
  rowEl.classList.add(after ? 'exercise-row--drop-after' : 'exercise-row--drop-before');

  updateAutoScroll('.exercise-list', event.clientY);
}

function onLibraryDrop(event) {
  if (!drag || drag.kind !== 'library') return;
  event.preventDefault();

  const ids = drag.ids;
  const target = rowDropTarget;
  endDrag();

  if (target !== null) reorderExercises(ids, target);
}

// --- Complex_list: three sources, two kinds of target -----------------------

// Where a complex-level insertion would land: the first complex whose midpoint
// is below the cursor, or the end of the list. Works over the gaps between
// complexes and the empty space below them, which is exactly where the spec
// says a drop creates a new complex.
function complexBoundaryAt(list, clientY) {
  const nodes = Array.from(list.querySelectorAll('.complex'));
  for (let i = 0; i < nodes.length; i += 1) {
    const box = nodes[i].getBoundingClientRect();
    if (clientY < box.top + box.height / 2) return i;
  }
  return nodes.length;
}

// How much of a complex's outer edge means "beside this complex" rather than
// "inside it". Complexes are stacked flush, so without this band there would be
// no way to aim at the boundary above the first complex, or at any boundary
// between two of them - both would resolve to "the first slot in this complex".
const BOUNDARY_BAND = 12;

function onComplexListDragOver(event) {
  if (!drag) return;

  const list = event.currentTarget;
  // A whole complex can only ever land between complexes, so it ignores the row
  // under the cursor.
  const row = drag.kind === 'complex'
    ? null
    : event.target.closest && event.target.closest('.exercise-row');

  complexDropTarget = row
    ? itemTargetFor(list, row, event.clientY)
    : { type: 'complex', index: complexBoundaryAt(list, event.clientY) };

  event.preventDefault();
  event.dataTransfer.dropEffect = drag.kind === 'library' ? 'copy' : 'move';
  paintComplexDropMarker(list);
  updateAutoScroll('.complex-list', event.clientY);
}

// An exercise over a row lands inside that complex - except along the top edge
// of its first row and the bottom edge of its last, which are the complex's own
// outer edges and mean "a new complex here".
function itemTargetFor(list, row, clientY) {
  const box = row.getBoundingClientRect();
  const complexes = Array.from(list.querySelectorAll('.complex'));
  const index = complexes.indexOf(row.closest('.complex'));

  if (!row.previousElementSibling && clientY < box.top + BOUNDARY_BAND) {
    return { type: 'complex', index };
  }
  if (!row.nextElementSibling && clientY > box.bottom - BOUNDARY_BAND) {
    return { type: 'complex', index: index + 1 };
  }

  const after = clientY > box.top + box.height / 2;
  return {
    type: 'item',
    complexId: row.dataset.complexId,
    index: Number(row.dataset.itemIndex) + (after ? 1 : 0),
  };
}

function paintComplexDropMarker(list) {
  clearDropMarkers();
  const target = complexDropTarget;
  if (!target) return;

  if (target.type === 'item') {
    const complex = list.querySelector('.complex[data-id="' + target.complexId + '"]');
    const rows = complex ? complex.querySelectorAll('.exercise-row') : [];
    // Past the last row the marker goes under it instead of over a row that
    // does not exist.
    if (target.index < rows.length) rows[target.index].classList.add('exercise-row--drop-before');
    else if (rows.length) rows[rows.length - 1].classList.add('exercise-row--drop-after');
    return;
  }

  const complexes = list.querySelectorAll('.complex');
  if (complexes.length === 0) list.classList.add('complex-list--drop');
  else if (target.index < complexes.length) {
    complexes[target.index].classList.add('complex--drop-before');
  } else complexes[complexes.length - 1].classList.add('complex--drop-after');
}

function onComplexListDrop(event) {
  if (!drag) return;
  event.preventDefault();

  const kind = drag.kind;
  const ids = drag.ids;
  const target = complexDropTarget;
  endDrag();
  if (!target) return;

  // Indices come from what is on screen, which the view_options filter may have
  // thinned out; the store works on the full list.
  const at = target.type === 'complex' ? fullComplexIndex(target.index) : 0;

  if (kind === 'complex') reorderComplexes(ids, at);
  else if (kind === 'library') {
    if (target.type === 'item') addExercisesToComplex(ids, target.complexId, target.index);
    else createComplexFromExercises(ids, at);
  } else if (target.type === 'item') moveComplexItems(ids, target.complexId, target.index);
  else moveItemsToNewComplex(ids, at);
}

// A position among the complexes on screen -> the same position in the whole
// list. With "только включённые комплексы" off the two are identical.
function fullComplexIndex(visibleIndex) {
  const category = activeCategory();
  if (!category) return 0;

  const visible = visibleComplexes(getState(), category);
  if (visibleIndex >= visible.length) return category.complexes.length;
  return category.complexes.indexOf(visible[visibleIndex]);
}

// --- render ----------------------------------------------------------------

function render() {
  const state = getState();
  const category = activeCategory();

  // Drop selections that no longer exist (after a delete or category switch).
  if (selection.scope) {
    const live = new Set(scopeKeys(selection.scope));
    const ids = new Set(Array.from(selection.ids).filter((key) => live.has(key)));
    selection = ids.size ? { ...selection, ids } : EMPTY_SELECTION;
  }

  // Every render rebuilds both lists from scratch, which would otherwise send
  // them back to the top - so selecting a row, flipping a switch or reordering
  // a complex would yank the list out from under the user.
  const scroll = captureScroll();

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

  restoreScroll(scroll);

  // The header was rebuilt, so the undo slot came back empty.
  refreshUndoSlot();
}

const SCROLLERS = ['.complex-list', '.exercise-list'];

function captureScroll() {
  const tops = {};
  for (const selector of SCROLLERS) {
    const node = root.querySelector(selector);
    if (node) tops[selector] = node.scrollTop;
  }
  return tops;
}

function restoreScroll(tops) {
  for (const selector of SCROLLERS) {
    const node = root.querySelector(selector);
    // A shorter list clamps this itself, which is the right answer: deleting
    // the last complexes should not leave the view stranded past the end.
    if (node && tops[selector]) node.scrollTop = tops[selector];
  }
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
        categoryList().map((category, index) => renderMenuButton(state, category, index))
      ),
      el('button', {
        class: 'add-category-button',
        type: 'button',
        title: 'Добавить категорию',
        'aria-label': 'Добавить категорию',
        onClick: () => {
          clearSelection();
          activeHoverArmed = false;
          // A new category opens straight into name editing, per the prototype.
          startEditingCategory(addCategory());
        },
      }),
      // Filled in by refreshUndoSlot, which ticks once a second on its own so
      // the countdown does not re-render the whole page.
      el('div', { class: 'undo-slot' })
    ),
    renderViewOptions(state)
  );
}

// --- deleting a category, with an undo window ------------------------------

function requestDeleteCategory(id) {
  // Deleting switches to the next category, and its close button would other-
  // wise appear straight under the cursor that just clicked this one - one more
  // click and the next category would go too. Same rule as a click: disarm.
  activeHoverArmed = false;

  const removed = deleteCategory(id); // hides the button and re-renders
  if (!removed) return;

  const entry = { removed, expiresAt: Date.now() + UNDO_SECONDS * 1000, timer: null };
  entry.timer = setTimeout(() => finalizeDeletion(entry), UNDO_SECONDS * 1000);
  pendingDeletions.push(entry);

  startUndoTicker();
  refreshUndoSlot();
}

// The category is already out of the state; letting the record go is all that
// makes the deletion permanent.
function finalizeDeletion(entry) {
  clearTimeout(entry.timer);
  pendingDeletions = pendingDeletions.filter((pending) => pending !== entry);
  stopUndoTickerIfIdle();
  refreshUndoSlot();
}

function undoLastDeletion() {
  const entry = pendingDeletions.pop();
  if (!entry) return;

  clearTimeout(entry.timer);
  restoreCategory(entry.removed); // re-renders, which rebuilds the undo slot
  activeHoverArmed = false;

  stopUndoTickerIfIdle();
  refreshUndoSlot();
}

function startUndoTicker() {
  if (undoTicker !== null) return;
  // Four times a second, so the displayed number never lags behind.
  undoTicker = setInterval(refreshUndoSlot, 250);
}

function stopUndoTickerIfIdle() {
  if (pendingDeletions.length > 0 || undoTicker === null) return;
  clearInterval(undoTicker);
  undoTicker = null;
}

function refreshUndoSlot() {
  if (!root) return;
  const slot = root.querySelector('.undo-slot');
  if (!slot) return;

  clear(slot);

  // Only the most recent deletion is offered; undoing it reveals the one before.
  const entry = pendingDeletions[pendingDeletions.length - 1];
  if (!entry) return;

  const secondsLeft = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));

  slot.appendChild(
    el(
      'button',
      { class: 'undo-button', type: 'button', onClick: undoLastDeletion },
      el('img', { class: 'undo-button__icon', src: 'assets/icons/undo.svg', alt: '' }),
      el('span', {
        text: 'Восстановить ' + entry.removed.data.name + ' (Ctrl+Z) ' + secondsLeft,
      })
    )
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

function renderMenuButton(state, category, index) {
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
          draggable: 'false', // dragging must start from the button, not the X
          title: 'Удалить категорию',
          'aria-label': 'Удалить категорию',
          onClick: (event) => {
            event.stopPropagation(); // do not also re-select the category
            clearSelection();
            requestDeleteCategory(category.id);
          },
        },
        el('img', { class: 'menu-button__close-icon', src: 'assets/icons/close.svg', alt: '' })
      )
    );
  }

  // A div rather than a <button>: this element hosts a nested button (close)
  // and, while editing, an <input> - neither is valid inside a button.
  const node = el(
    'div',
    {
      class:
        'menu-button' +
        (isActive ? ' menu-button--active' : '') +
        (isActive && activeHoverArmed ? ' menu-button--hover-armed' : ''),
      role: 'button',
      tabindex: '0',
      draggable: 'true',
      onClick: () => activateCategory(category.id),
      onDblclick: () => startEditingCategory(category.id),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activateCategory(category.id);
        }
      },
    },
    children
  );

  // Leaving the button arms the hover state for next time. The class is set
  // directly rather than through a re-render, which would replace the node the
  // pointer is interacting with.
  node.addEventListener('mouseleave', () => {
    if (!isActive || activeHoverArmed) return;
    activeHoverArmed = true;
    node.classList.add('menu-button--hover-armed');
  });

  node.addEventListener('dragstart', (event) => {
    draggingCategoryId = category.id;
    event.dataTransfer.setData('text/plain', category.id);
    event.dataTransfer.effectAllowed = 'move';

    // The browser snapshots the drag image from this element synchronously,
    // right now - so the active look has to be on for that snapshot: the button
    // travels with the cursor in the active state, close button gone and full
    // name showing. Classes are set by hand because a re-render here would
    // replace the node being dragged; the selection is committed on drop.
    activeHoverArmed = false;
    for (const other of root.querySelectorAll('.menu-button--active')) {
      other.classList.remove('menu-button--active', 'menu-button--hover-armed');
    }
    node.classList.remove('menu-button--hover-armed');
    node.classList.add('menu-button--active');

    // By the time this runs the snapshot has been taken, so the button left
    // behind in its old position can drop the active look without changing what
    // is being dragged. No button in the list shows as active mid-drag.
    setTimeout(() => {
      node.classList.remove('menu-button--active');
      node.classList.add('menu-button--dragging');
    }, 0);
  });

  node.addEventListener('dragover', (event) => {
    if (!draggingCategoryId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    // Horizontal list, so the midpoint that matters is the left/right one.
    const box = node.getBoundingClientRect();
    const after = event.clientX > box.left + box.width / 2;
    categoryDropTarget = index + (after ? 1 : 0);

    clearCategoryDropMarkers();
    node.classList.add(after ? 'menu-button--drop-after' : 'menu-button--drop-before');
  });

  // Fires on the drop target, so the dragged category is the tracked one, not
  // this handler's own.
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    const id = draggingCategoryId;
    const target = categoryDropTarget;

    clearCategoryDropMarkers();
    draggingCategoryId = null;
    categoryDropTarget = null;
    if (!id) return;

    if (target !== null) reorderCategories(id, target);
    commitDragSelection(id);
  });

  // Fires on the source. Reordering on drop re-renders and may take this node
  // with it, so the selection is committed in both places - whichever runs
  // first wins and the other is a no-op.
  node.addEventListener('dragend', () => {
    clearCategoryDropMarkers();
    node.classList.remove('menu-button--dragging');
    draggingCategoryId = null;
    categoryDropTarget = null;
    commitDragSelection(category.id);
  });

  return node;
}

// A drag selects the category it moved. Kept separate from activateCategory
// because the hover state was already disarmed at dragstart and must stay so:
// the close button should not reappear under the cursor that just dropped.
function commitDragSelection(id) {
  const state = getState();
  if (!state.categories[id] || state.ui.activeCategory === id) return;

  clearSelection();
  setActiveCategory(id);
}

function activateCategory(id) {
  // Only a real switch disarms the hover state.
  if (id !== getState().ui.activeCategory) activeHoverArmed = false;
  clearSelection();
  setActiveCategory(id);
}

function clearCategoryDropMarkers() {
  if (!root) return;
  for (const node of root.querySelectorAll('.menu-button')) {
    node.classList.remove('menu-button--drop-before', 'menu-button--drop-after');
  }
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
    renderScheduleColumn(state, category),
    renderExerciseColumn(state, category)
  );
}

// The complexes on screen. Disabled ones keep their place in the data and their
// slot in the schedule either way - the checkbox only hides them.
function visibleComplexes(state, category) {
  const complexes = category.complexes || [];
  if (!state.ui.onlyEnabledComplexes) return complexes;
  return complexes.filter((complex) => complex.enabled);
}

function renderScheduleColumn(state, category) {
  const schedule = buildSchedule(category);

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
    placeholder: '3 сен',
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
      // The end date falls out of the schedule: the last complex still in it.
      el('span', {
        class: 'toolbar-label',
        text: 'день по ' + (schedule.end ? formatDate(schedule.end) : '—'),
      })
    ),
    renderComplexList(state, category, schedule)
  );
}

function renderComplexList(state, category, schedule) {
  const visible = visibleComplexes(state, category);
  // With nothing scheduled there is nothing for the pointer to point at, and a
  // lone blue rule under the toolbar reads as a glitch rather than as today.
  const pointerAt = visible.length
    ? pointerIndex(visible, schedule.dates, startOfDay())
    : -1;

  const children = [];
  // Item ids are numbered across the whole list, not per complex, so a
  // shift-range can run from one complex into the next.
  let flatItem = 0;

  visible.forEach((complex, index) => {
    if (index === pointerAt) children.push(renderDatePointer());
    children.push(renderComplex(state, category, complex, index, schedule.dates.get(complex.id), flatItem));
    flatItem += complex.items.length;
  });
  if (pointerAt >= visible.length && visible.length) children.push(renderDatePointer());

  const list = el('div', { class: 'complex-list' }, children);
  list.addEventListener('dragover', onComplexListDragOver);
  list.addEventListener('drop', onComplexListDrop);
  return list;
}

// A rule across the list marking today. Sticky at both edges, so scrolling past
// it in either direction parks it against the near edge of the list instead of
// letting it disappear.
function renderDatePointer() {
  return el('div', { class: 'date-pointer' }, el('span', { class: 'date-pointer__icon' }));
}

function renderComplex(state, category, complex, index, date, firstItemIndex) {
  const byId = new Map(category.exercises.map((exercise) => [exercise.id, exercise]));

  const rows = complex.items.map((item, itemIndex) => {
    const exercise = byId.get(item.exerciseId);
    if (!exercise) return null; // the store prunes these; belt and braces
    return renderExerciseRow(state, exercise, {
      scope: 'item',
      key: item.id,
      index: firstItemIndex + itemIndex,
      complexId: complex.id,
      itemIndex,
    });
  });

  const node = el(
    'div',
    {
      class:
        'complex' +
        (isSelected('complex', complex.id) ? ' complex--selected' : '') +
        (complex.enabled ? '' : ' complex--off'),
      dataset: { id: complex.id },
    },
    renderComplexSide(complex, index, date),
    el('div', { class: 'complex__items' }, rows)
  );

  // Set up here rather than in renderComplexSide, which has no handle on the
  // block the drag image is snapshotted from.
  const side = node.querySelector('.complex__side');
  side.addEventListener('dragstart', (event) => {
    drag = { kind: 'complex', ids: draggedKeys('complex', complex.id) };
    event.dataTransfer.setData('text/plain', drag.ids.join(','));
    event.dataTransfer.effectAllowed = 'move';

    // Only the side block is draggable - the exercise rows to its right have to
    // stay draggable in their own right - but what travels with the cursor
    // should still be the whole complex.
    if (event.dataTransfer.setDragImage) {
      const box = node.getBoundingClientRect();
      event.dataTransfer.setDragImage(node, event.clientX - box.left, event.clientY - box.top);
    }
    markDragging('.complex', 'complex--dragging', drag.ids);
  });
  side.addEventListener('dragend', endDrag);

  return node;
}

function renderComplexSide(complex, index, date) {
  const toggle = el('input', {
    class: 'switch__input',
    type: 'checkbox',
    checked: complex.enabled,
  });
  toggle.addEventListener('change', () => setComplexEnabled(complex.id, toggle.checked));

  const switchLabel = el(
    'label',
    {
      class: 'switch switch--complex',
      title: 'Включить комплекс в расписание',
      // Flipping the switch must not also select the complex behind it.
      onClick: (event) => event.stopPropagation(),
      onDragstart: (event) => event.preventDefault(),
    },
    toggle,
    el('span', { class: 'switch__track' })
  );

  return el(
    'div',
    {
      class: 'complex__side',
      draggable: 'true',
      onClick: (event) => selectAt(event, 'complex', index),
    },
    // A complex out of the schedule has no date to show.
    el('span', { class: 'complex__date', text: date ? formatDate(date) : '—' }),
    switchLabel
  );
}

function renderExerciseColumn(state, category) {
  const list = el(
    'div',
    { class: 'exercise-list' },
    category.exercises.map((exercise, index) =>
      renderExerciseRow(state, exercise, { scope: 'library', key: exercise.id, index })
    )
  );

  // Dropping below the last row appends.
  list.addEventListener('dragover', (event) => {
    if (event.target === list && drag && drag.kind === 'library') {
      event.preventDefault();
      // Must agree with effectAllowed, or the drop is silently refused.
      event.dataTransfer.dropEffect = 'move';
      rowDropTarget = category.exercises.length;
      clearDropMarkers();
      updateAutoScroll('.exercise-list', event.clientY);
    }
  });
  list.addEventListener('drop', (event) => {
    if (event.target === list) onLibraryDrop(event);
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

// The same row in both lists, per the spec - only what a click selects and what
// a drag carries differ, and both come out of `context.scope`.
function renderExerciseRow(state, exercise, context) {
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
      class:
        'exercise-row' +
        (isSelected(context.scope, context.key) ? ' exercise-row--selected' : ''),
      draggable: 'true',
      dataset:
        context.scope === 'library'
          ? { id: context.key }
          // The complex list's drop handler reads both of these off the row it
          // is over, to work out which complex and which slot in it.
          : { id: context.key, complexId: context.complexId, itemIndex: String(context.itemIndex) },
      onClick: (event) => selectAt(event, context.scope, context.index),
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

  row.addEventListener('dragstart', (event) => onRowDragStart(event, context, row));
  row.addEventListener('dragend', endDrag);

  // Rows inside a complex leave dragover and drop to the list, which needs the
  // whole geometry to tell "into this complex" from "between two of them".
  if (context.scope === 'library') {
    row.addEventListener('dragover', (event) => onLibraryRowDragOver(event, context.index, row));
    row.addEventListener('drop', onLibraryDrop);
  }

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
