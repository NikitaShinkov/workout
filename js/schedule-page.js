// Schedule page rendering and interaction.

import { createExercise } from './model.js';
import { el, clear } from './dom.js';
import { filesToImageBlobs } from './images.js';
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
import { createDateInput, createIntervalInput } from './toolbar-inputs.js';
import { renderPageSelector } from './page-selector.js';
import {
  renderExerciseRow as renderRow,
  startRowAnimation,
  stopRowAnimation,
  stopAllRowAnimations,
} from './exercise-row.js';

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

let root = null;
let pagePicker = null;
let onNavigate = null;

// Set by the calendar's Add_category_button, which adds the category and then
// navigates here. A new category opens straight into name editing wherever it
// was created from, so the intent has to survive the page swap.
let pendingCategoryEdit = null;

export function editCategoryOnOpen(categoryId) {
  pendingCategoryEdit = categoryId;
}

export function mountSchedulePage(container, navigate) {
  root = container;
  onNavigate = navigate;

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

  const unsubscribe = subscribe(render);
  render();

  if (pendingCategoryEdit) {
    const id = pendingCategoryEdit;
    pendingCategoryEdit = null;
    // It may have been deleted between the two pages; startEditingCategory
    // would then leave an input on a button that is not there.
    if (getState().categories[id]) {
      activeHoverArmed = false;
      startEditingCategory(id);
    }
  }

  // Leaving the page has to take everything with it: the subscription, the
  // document-level shortcuts and the file input all outlive the container
  // otherwise, and a second page would render on top of this one's handlers.
  return function destroy() {
    unsubscribe();
    document.removeEventListener('keydown', onDocumentKeydown);
    document.removeEventListener('click', onDocumentClick);
    pagePicker.remove();
    pagePicker = null;

    stopAllRowAnimations();
    stopAutoScroll();
    endDrag();
    // Leaving commits the pending deletions: there is no undo button to press
    // on the page being navigated to.
    for (const entry of pendingDeletions) clearTimeout(entry.timer);
    pendingDeletions = [];
    if (undoTicker !== null) { clearInterval(undoTicker); undoTicker = null; }

    clearSelection();
    editingCategoryId = null;
    clear(root);
    root = null;
    onNavigate = null;
  };
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

  const state = getState();
  if (scope === 'library') return visibleExercises(state, category).map((e) => e.id);

  const visible = visibleComplexes(state, category);
  if (scope === 'complex') return visible.map((complex) => complex.id);
  // 'item': flattened across complexes, so a shift-range can span them.
  return visible.flatMap((complex) =>
    visibleItems(state, category, complex).map((item) => item.id)
  );
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
  // Deliberately NOT a re-render. This runs on the click that focuses the date
  // or interval field, and rebuilding the page there tears that field out from
  // under the focus it just received - the caret lands nowhere and the typing
  // is lost. The selection only ever shows as two classes, so dropping them by
  // hand is exactly equivalent and touches nothing else.
  dropSelectionClasses();
}

function dropSelectionClasses() {
  if (!root) return;
  for (const node of root.querySelectorAll('.exercise-row--selected')) {
    node.classList.remove('exercise-row--selected');
  }
  for (const node of root.querySelectorAll('.complex--selected')) {
    node.classList.remove('complex--selected');
  }
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

  // The position is one among the rows on screen; "только избранные" may have
  // thinned those out, and the store works on the whole list.
  if (target !== null) reorderExercises(ids, fullExerciseIndex(target));
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

  // Indices come from what is on screen, which either view_options checkbox may
  // have thinned out; the store works on the full lists.
  const at =
    target.type === 'complex'
      ? fullComplexIndex(target.index)
      : fullItemIndex(target.complexId, target.index);

  if (kind === 'complex') reorderComplexes(ids, at);
  else if (kind === 'library') {
    if (target.type === 'item') addExercisesToComplex(ids, target.complexId, at);
    else createComplexFromExercises(ids, at);
  } else if (target.type === 'item') moveComplexItems(ids, target.complexId, at);
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
      renderPageSelector('schedule', (page) => onNavigate(page)),
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
        (isActive && activeHoverArmed ? ' menu-button--hover-armed' : '') +
        // Out of the workout schedule: the name fades, so which categories are
        // switched off is readable straight from the menu.
        (category.scheduleEnabled ? '' : ' menu-button--off'),
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

// --- what the two view_options checkboxes leave on screen -------------------
//
// Both checkboxes only ever HIDE. Nothing is deleted, positions do not move,
// and the schedule is still worked out over every complex in the category - so
// filtering can never renumber a date. Everything downstream of these three
// helpers works in "visible" positions, which fullExerciseIndex / fullItemIndex
// / fullComplexIndex map back to real ones before the store sees them.

function visibleExercises(state, category) {
  if (!state.ui.favoritesOnly) return category.exercises;
  return category.exercises.filter((exercise) => exercise.favorite);
}

function visibleItems(state, category, complex) {
  if (!state.ui.favoritesOnly) return complex.items;
  const favorites = new Set(
    category.exercises.filter((exercise) => exercise.favorite).map((exercise) => exercise.id)
  );
  return complex.items.filter((item) => favorites.has(item.exerciseId));
}

function visibleComplexes(state, category) {
  let complexes = category.complexes || [];
  if (state.ui.onlyEnabledComplexes) {
    complexes = complexes.filter((complex) => complex.enabled);
  }
  if (state.ui.favoritesOnly) {
    // A complex with nothing left to show would render as a bare date.
    complexes = complexes.filter((complex) => visibleItems(state, category, complex).length > 0);
  }
  return complexes;
}

// A position among the exercises on screen -> the same position in the whole
// list. Identical when no filter is on.
function fullExerciseIndex(visibleIndex) {
  const category = activeCategory();
  if (!category) return 0;

  const visible = visibleExercises(getState(), category);
  if (visibleIndex >= visible.length) return category.exercises.length;
  return category.exercises.indexOf(visible[visibleIndex]);
}

function fullItemIndex(complexId, visibleIndex) {
  const category = activeCategory();
  if (!category) return 0;

  const complex = category.complexes.find((c) => c.id === complexId);
  if (!complex) return 0;

  const visible = visibleItems(getState(), category, complex);
  if (visibleIndex >= visible.length) return complex.items.length;
  return complex.items.indexOf(visible[visibleIndex]);
}

function renderScheduleColumn(state, category) {
  const schedule = buildSchedule(category);

  const toggle = el('input', {
    class: 'switch__input',
    type: 'checkbox',
    checked: category.scheduleEnabled,
  });
  toggle.addEventListener('change', () => setCategoryField('scheduleEnabled', toggle.checked));

  // Both fields commit on blur and refuse anything the schedule cannot use -
  // see js/toolbar-inputs.js.
  const dateInput = createDateInput(category.scheduleStartDate, (value) =>
    setCategoryField('scheduleStartDate', value)
  );
  const intervalInput = createIntervalInput(category.intervalDays, (value) =>
    setCategoryField('intervalDays', value)
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
    flatItem += visibleItems(state, category, complex).length;
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

  const rows = visibleItems(state, category, complex).map((item, itemIndex) => {
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
    visibleExercises(state, category).map((exercise, index) =>
      renderExerciseRow(state, exercise, { scope: 'library', key: exercise.id, index })
    )
  );

  // Dropping below the last row appends.
  list.addEventListener('dragover', (event) => {
    if (event.target === list && drag && drag.kind === 'library') {
      event.preventDefault();
      // Must agree with effectAllowed, or the drop is silently refused.
      event.dataTransfer.dropEffect = 'move';
      rowDropTarget = visibleExercises(state, category).length;
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
// The block itself is shared with the calendar (js/exercise-row.js); this adds
// what only the schedule page does with it - selection and dragging.
function renderExerciseRow(state, exercise, context) {
  return renderRow(exercise, {
    selected: isSelected(context.scope, context.key),
    showIndicators: state.ui.showIndicators,
    showFavorites: state.ui.showFavorites,
    onToggleFavorite: (target) => toggleFavorite(target.id),
    dataset:
      context.scope === 'library'
        ? { id: context.key }
        // The complex list's drop handler reads both of these off the row it is
        // over, to work out which complex and which slot in it.
        : { id: context.key, complexId: context.complexId, itemIndex: String(context.itemIndex) },
    onClick: (event) => selectAt(event, context.scope, context.index),
    onDblclick: () => startEditExercise(exercise),
    onDragstart: (event, row) => onRowDragStart(event, context, row),
    onDragend: endDrag,
    // Rows inside a complex leave dragover and drop to the list, which needs
    // the whole geometry to tell "into this complex" from "between two of them".
    onDragover:
      context.scope === 'library'
        ? (event, row) => onLibraryRowDragOver(event, context.index, row)
        : null,
    onDrop: context.scope === 'library' ? onLibraryDrop : null,
  });
}
