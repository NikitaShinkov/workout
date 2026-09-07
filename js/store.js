// Application state: a single object, mutated only through `update`, which
// persists and notifies subscribers.

import {
  DEFAULT_CATEGORIES,
  NEW_CATEGORY_NAME,
  DEFAULT_EQUIPMENT,
  createCategoryState,
  createComplex,
  createComplexItem,
  uid,
} from './model.js';
import { defaultStartDate, dayKey } from './schedule.js';
import { loadState, saveState } from './db.js';
import { recordOp, upsertRating } from './sync.js';

const STATE_VERSION = 2;

const listeners = new Set();
let saveTimer = null;

let state = createInitialState();

function createInitialState() {
  const categories = {};
  const categoryOrder = [];

  for (const seed of DEFAULT_CATEGORIES) {
    categories[seed.id] = createCategoryState(seed.name);
    categoryOrder.push(seed.id);
  }

  return {
    version: STATE_VERSION,
    // Order is held separately so categories can be reordered and deleted
    // without depending on object key order.
    categoryOrder,
    categories,
    // Equipment chosen for the most recently added exercise. The next new
    // exercise starts pre-ticked with this, per the spec.
    lastEquipment: DEFAULT_EQUIPMENT.slice(),
    // Which complex items were got through, by day: doneLog[itemId][date].
    // The log owns it, like favourites and durations - it is a workout result,
    // not structure - so it is never written into state.json.
    doneLog: {},
    complexLog: {},
    ui: {
      activeCategory: categoryOrder[0],
      showIndicators: false,
      showFavorites: false,
      onlyEnabledComplexes: false,
      favoritesOnly: false,
    },
  };
}

// Give a saved complex list a shape this build can render: every complex needs
// an id, an enabled flag and items, and an item pointing at an exercise that no
// longer exists has to go - as does a complex left with nothing in it.
function normalizeComplexes(saved, exercises) {
  if (!Array.isArray(saved)) return [];
  const live = new Set(exercises.map((exercise) => exercise.id));

  return saved
    .map((complex) => ({
      id: complex && complex.id ? complex.id : uid('cx'),
      enabled: !complex || complex.enabled !== false,
      items: (Array.isArray(complex && complex.items) ? complex.items : [])
        .filter((item) => item && live.has(item.exerciseId))
        .map((item) => ({ id: item.id || uid('ci'), exerciseId: item.exerciseId })),
    }))
    .filter((complex) => complex.items.length > 0);
}

// Fill in anything a stored record predates, so an old save never crashes a
// newer build. Version 1 had no category order and no category names.
//
// Exported so the tests can drive it as the pure function it is, rather than
// round-tripping a fixture through a fake database.
export function migrate(stored) {
  const base = createInitialState();
  if (!stored || typeof stored !== 'object') return base;

  const merged = {
    ...base,
    ...stored,
    version: STATE_VERSION,
    ui: { ...base.ui, ...(stored.ui || {}) },
  };

  const savedCategories = stored.categories || {};
  const savedIds = Object.keys(savedCategories);

  if (savedIds.length === 0) {
    merged.categories = base.categories;
    merged.categoryOrder = base.categoryOrder;
  } else {
    // Prefer the stored order; fall back to the seed order for known ids, then
    // append anything else that was saved.
    const order = Array.isArray(stored.categoryOrder)
      ? stored.categoryOrder.filter((id) => savedIds.includes(id))
      : DEFAULT_CATEGORIES.map((c) => c.id).filter((id) => savedIds.includes(id));

    for (const id of savedIds) if (!order.includes(id)) order.push(id);

    const categories = {};
    for (const id of order) {
      const saved = savedCategories[id] || {};
      const seed = DEFAULT_CATEGORIES.find((c) => c.id === id);
      categories[id] = { ...createCategoryState(), ...saved };
      // Version 1 stored no name; recover it from the seed list.
      categories[id].name = saved.name || (seed && seed.name) || NEW_CATEGORY_NAME;
      // Version 1 and 2 saves have an empty complex list and a blank start date
      // (the schedule was not built yet), so both need a shape and a default.
      categories[id].complexes = normalizeComplexes(saved.complexes, categories[id].exercises);
      if (!categories[id].scheduleStartDate) {
        categories[id].scheduleStartDate = defaultStartDate();
      }
    }

    merged.categories = categories;
    merged.categoryOrder = order;
  }

  if (!Array.isArray(merged.lastEquipment) || merged.lastEquipment.length === 0) {
    merged.lastEquipment = DEFAULT_EQUIPMENT.slice();
  }

  if (!merged.categories[merged.ui.activeCategory]) {
    merged.ui.activeCategory = merged.categoryOrder[0] || null;
  }

  return merged;
}

export async function initStore() {
  state = migrate(await loadState());
  return state;
}

// Put the store into a known state without touching storage. This is how the
// tests reset between runs now that clearing a database no longer means
// anything - a `deleteDatabase` call would be a silent no-op, which is the
// worst kind of broken test.
export function resetStore(seed) {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  state = migrate(seed || null);
  for (const listener of listeners) listener(state);
  return state;
}

export function getState() {
  return state;
}

// May be null: the user can delete every category.
export function activeCategory() {
  return state.categories[state.ui.activeCategory] || null;
}

export function categoryList() {
  return state.categoryOrder.map((id) => ({ id, ...state.categories[id] }));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Every mutation goes through here: mutate, notify, then persist.
// Persisting is debounced so typing in a field does not hit the database on
// every keystroke.
export function update(mutator) {
  mutator(state);
  for (const listener of listeners) listener(state);

  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState(state).catch((error) => console.error('Save failed:', error));
  }, 150);
}

// --- category operations ---------------------------------------------------

export function addCategory(name = NEW_CATEGORY_NAME) {
  const id = uid('cat');
  update((draft) => {
    draft.categories[id] = createCategoryState(name);
    draft.categoryOrder.push(id);
    draft.ui.activeCategory = id;
  });
  return id;
}

export function renameCategory(id, name) {
  const clean = String(name).trim();
  // An empty name would leave an unclickable button, so it keeps the old one.
  if (!clean) return false;

  update((draft) => {
    if (draft.categories[id]) draft.categories[id].name = clean;
  });
  return true;
}

// Returns what was removed, so the caller can offer an undo, or null if the id
// was unknown.
export function deleteCategory(id) {
  let removed = null;

  update((draft) => {
    const index = draft.categoryOrder.indexOf(id);
    if (index === -1) return;

    removed = { id, index, data: draft.categories[id] };

    draft.categoryOrder.splice(index, 1);
    delete draft.categories[id];

    if (draft.ui.activeCategory === id) {
      // The next category takes over; deleting the last one falls back to the
      // previous, and deleting the only one leaves nothing selected.
      draft.ui.activeCategory =
        draft.categoryOrder[index] || draft.categoryOrder[index - 1] || null;
    }
  });

  return removed;
}

// Put back a record from deleteCategory, at the position it came from.
export function restoreCategory(removed) {
  if (!removed || !removed.data) return;

  update((draft) => {
    if (draft.categories[removed.id]) return; // already back

    draft.categories[removed.id] = removed.data;
    draft.categoryOrder.splice(Math.min(removed.index, draft.categoryOrder.length), 0, removed.id);
    draft.ui.activeCategory = removed.id;
  });
}

// Move one category so it lands at `insertIndex`, a position in the CURRENT order.
export function reorderCategories(id, insertIndex) {
  update((draft) => {
    const from = draft.categoryOrder.indexOf(id);
    if (from === -1) return;

    draft.categoryOrder.splice(from, 1);
    // Removing it first shifts every later position down by one.
    draft.categoryOrder.splice(insertIndex > from ? insertIndex - 1 : insertIndex, 0, id);
  });
}

// --- exercise operations ---------------------------------------------------

export function addExercise(exercise) {
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    if (!category) return;
    category.exercises.push(exercise);
    draft.lastEquipment = exercise.equipment.slice();
  });
}

// `categoryId` is for the calendar, which shows exercises from every category
// at once; everywhere else the active one is meant.
export function updateExercise(id, fields, categoryId) {
  update((draft) => {
    const category = draft.categories[categoryId || draft.ui.activeCategory];
    if (!category) return;

    const index = category.exercises.findIndex((e) => e.id === id);
    if (index === -1) return;

    category.exercises[index] = { ...category.exercises[index], ...fields };
    if (fields.equipment) draft.lastEquipment = fields.equipment.slice();
  });
}

export function deleteExercises(ids) {
  const doomed = new Set(ids);
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    if (!category) return;
    category.exercises = category.exercises.filter((e) => !doomed.has(e.id));
    // Scheduled copies point at the exercise, so they go with it.
    dropItems(category, (item) => doomed.has(item.exerciseId));
  });
}

// Move `ids` (keeping their relative order) so they land at `insertIndex`,
// where insertIndex is a position in the CURRENT list.
export function reorderExercises(ids, insertIndex) {
  const moving = new Set(ids);

  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    if (!category) return;

    const list = category.exercises;
    const picked = list.filter((e) => moving.has(e.id));
    if (picked.length === 0) return;

    // Removing the picked rows shifts the target left by however many of them
    // sat above it.
    const removedAbove = list.slice(0, insertIndex).filter((e) => moving.has(e.id)).length;
    const rest = list.filter((e) => !moving.has(e.id));

    rest.splice(insertIndex - removedAbove, 0, ...picked);
    category.exercises = rest;
  });
}

// `favorite` is the log's field, not state.json's - the workout page toggles it
// on the phone and the schedule page toggles it on the computer, so it has to
// come from the file both of them can write. The op is what actually persists;
// the mutation below is only so the star flips at once.
export function toggleFavorite(id, categoryId) {
  let on = null;

  update((draft) => {
    const category = draft.categories[categoryId || draft.ui.activeCategory];
    if (!category) return;
    const exercise = category.exercises.find((e) => e.id === id);
    if (!exercise) return;

    exercise.favorite = !exercise.favorite;
    on = exercise.favorite;
  });

  if (on !== null) recordOp({ kind: 'favorite', exerciseId: id, on });
}

// --- what a workout produced ------------------------------------------------
//
// These four are the log's fields rather than state.json's, so each does the
// same two things toggleFavorite does: mutate the live state so the screen
// answers at once, and record the op that actually persists. The op is written
// synchronously into localStorage before anything else, so a phone killed from
// the app manager a moment later still has it.
//
// None of them changes structure, so serializeText() sees no difference and
// none of them provokes a commit to state.json.

// One rating, for one axis, on one day. Tapping the same indicator again on the
// same day replaces it rather than adding a second entry; a different day
// appends, which is the history the indicator column draws.
export function recordRating(exerciseId, axis, level, date = today(), categoryId = null) {
  let hit = false;

  update((draft) => {
    const exercise = findExercise(draft, exerciseId, categoryId);
    if (!exercise) return;
    upsertRating(exercise, { axis, date, level });
    hit = true;
  });

  if (hit) recordOp({ kind: 'rate', exerciseId, axis, date, level });
  return hit;
}

// What the exercise actually took, which is what every later estimate is built
// from. Only the latest value is kept - there is no history of durations.
export function recordDuration(exerciseId, seconds, categoryId = null) {
  const sec = Math.max(1, Math.round(Number(seconds)));
  if (!Number.isFinite(sec)) return false;

  let hit = false;
  update((draft) => {
    const exercise = findExercise(draft, exerciseId, categoryId);
    if (!exercise) return;
    exercise.lastDurationSec = sec;
    hit = true;
  });

  if (hit) recordOp({ kind: 'duration', exerciseId, sec });
  return hit;
}

// One exercise of one complex, got through on one day. Keyed by the complex
// ITEM, so a complex that schedules the same exercise twice has two things to
// get through rather than one.
export function setItemDone(complexId, itemId, done = true, date = today()) {
  update((draft) => {
    if (!draft.doneLog) draft.doneLog = {};
    if (!draft.doneLog[itemId]) draft.doneLog[itemId] = {};
    draft.doneLog[itemId][date] = Boolean(done);
  });

  recordOp({ kind: 'done', complexId, itemId, date, done: Boolean(done) });
}

// The whole complex was got through. Derivable from the items, and recorded
// anyway: it is the one durable statement that survives the complex being
// re-dragged into different items afterwards.
export function setComplexDone(complexId, done = true, date = today()) {
  update((draft) => {
    if (!draft.complexLog) draft.complexLog = {};
    if (!draft.complexLog[complexId]) draft.complexLog[complexId] = {};
    draft.complexLog[complexId][date] = Boolean(done);
  });

  recordOp({ kind: 'complex', complexId, date, done: Boolean(done) });
}

// Whether an item was got through on a day. The single reader of doneLog, so
// nothing else has to know its shape.
export function isItemDone(state, itemId, date = today()) {
  const byDate = (state.doneLog || {})[itemId];
  return Boolean(byDate && byDate[date]);
}

// Today, in the log's own date form. Local parts, not toISOString - a UTC date
// moves the day for anyone east or west of Greenwich.
export function today(now = new Date()) {
  return dayKey(now);
}

function findExercise(draft, exerciseId, categoryId) {
  // A named category for the calendar and the workout pages, which show
  // exercises from every category at once; the active one everywhere else.
  const ids = categoryId ? [categoryId] : [draft.ui.activeCategory, ...draft.categoryOrder];

  for (const id of ids) {
    const category = draft.categories[id];
    const exercise = category && (category.exercises || []).find((e) => e.id === exerciseId);
    if (exercise) return exercise;
  }
  return null;
}

// --- complex operations ----------------------------------------------------
//
// All of these work on the active category. Positions arrive as indices into
// the CURRENT list, the same convention reorderExercises uses.

// Remove every item the predicate matches and drop any complex left empty - an
// empty complex has no date to show and nothing to perform, so it is not a
// thing the list can hold.
function dropItems(category, matches) {
  for (const complex of category.complexes) {
    complex.items = complex.items.filter((item) => !matches(item));
  }
  category.complexes = category.complexes.filter((complex) => complex.items.length > 0);
}

// The moved items, in list order, so a group keeps its relative order however
// it was selected.
function pickItems(category, moving) {
  const picked = [];
  for (const complex of category.complexes) {
    for (const item of complex.items) if (moving.has(item.id)) picked.push(item);
  }
  return picked;
}

function withCategory(mutator) {
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    if (category) mutator(category);
  });
}

// Drag from Exercise_list into empty space or between complexes: a brand new
// complex of copies, at `insertIndex` in the complex list.
export function createComplexFromExercises(exerciseIds, insertIndex) {
  withCategory((category) => {
    const live = new Set(category.exercises.map((e) => e.id));
    const wanted = exerciseIds.filter((id) => live.has(id));
    if (wanted.length === 0) return;

    const at = clampIndex(insertIndex, category.complexes.length);
    category.complexes.splice(at, 0, createComplex(wanted));
  });
}

// Drag from Exercise_list onto an existing complex: copies land inside it, at
// the position the block was dropped.
export function addExercisesToComplex(exerciseIds, complexId, itemIndex) {
  withCategory((category) => {
    const complex = category.complexes.find((c) => c.id === complexId);
    if (!complex) return;

    const live = new Set(category.exercises.map((e) => e.id));
    const added = exerciseIds.filter((id) => live.has(id)).map(createComplexItem);
    if (added.length === 0) return;

    complex.items.splice(clampIndex(itemIndex, complex.items.length), 0, ...added);
  });
}

// Move items that are already scheduled - within one complex or across two.
export function moveComplexItems(itemIds, complexId, itemIndex) {
  const moving = new Set(itemIds);

  withCategory((category) => {
    const target = category.complexes.find((c) => c.id === complexId);
    if (!target) return;

    const picked = pickItems(category, moving);
    if (picked.length === 0) return;

    const targetIndex = category.complexes.indexOf(target);
    // Complexes above the target that the move empties out disappear, and each
    // one shifts the target up a place.
    const emptiedAbove = category.complexes
      .slice(0, targetIndex)
      .filter((complex) => complex.items.every((item) => moving.has(item.id))).length;
    // Pulling the moved items out shifts the drop position left by however many
    // of them sat above it in this complex.
    const above = target.items.slice(0, itemIndex).filter((item) => moving.has(item.id)).length;

    dropItems(category, (item) => moving.has(item.id));

    // Moving every item of a complex into itself empties it out of the list for
    // a moment; put it back where it was rather than losing the drop.
    if (!category.complexes.includes(target)) {
      category.complexes.splice(
        clampIndex(targetIndex - emptiedAbove, category.complexes.length), 0, target);
    }

    target.items.splice(clampIndex(itemIndex - above, target.items.length), 0, ...picked);
  });
}

// Drag scheduled items into the space between complexes: they leave their old
// complex and become one of their own.
export function moveItemsToNewComplex(itemIds, insertIndex) {
  const moving = new Set(itemIds);

  withCategory((category) => {
    const picked = pickItems(category, moving);
    if (picked.length === 0) return;

    // How many complexes above the insertion point disappear once the items
    // leave - each one shifts the insertion point up by one.
    const emptied = category.complexes
      .slice(0, insertIndex)
      .filter((complex) => complex.items.every((item) => moving.has(item.id))).length;

    dropItems(category, (item) => moving.has(item.id));

    const at = clampIndex(insertIndex - emptied, category.complexes.length);
    category.complexes.splice(at, 0, { ...createComplex(), items: picked });
  });
}

export function deleteComplexItems(itemIds) {
  const doomed = new Set(itemIds);
  withCategory((category) => dropItems(category, (item) => doomed.has(item.id)));
}

export function deleteComplexes(complexIds) {
  const doomed = new Set(complexIds);
  withCategory((category) => {
    category.complexes = category.complexes.filter((complex) => !doomed.has(complex.id));
  });
}

// Move `ids` (keeping their relative order) so they land at `insertIndex` in
// the CURRENT list - the same contract as reorderExercises.
export function reorderComplexes(ids, insertIndex) {
  const moving = new Set(ids);

  withCategory((category) => {
    const list = category.complexes;
    const picked = list.filter((complex) => moving.has(complex.id));
    if (picked.length === 0) return;

    const above = list.slice(0, insertIndex).filter((complex) => moving.has(complex.id)).length;
    const rest = list.filter((complex) => !moving.has(complex.id));

    rest.splice(clampIndex(insertIndex - above, rest.length), 0, ...picked);
    category.complexes = rest;
  });
}

export function setComplexEnabled(complexId, enabled) {
  withCategory((category) => {
    const complex = category.complexes.find((c) => c.id === complexId);
    if (complex) complex.enabled = enabled;
  });
}

function clampIndex(index, max) {
  if (!Number.isFinite(index)) return max;
  return Math.max(0, Math.min(Math.floor(index), max));
}

export function setActiveCategory(categoryId) {
  update((draft) => { draft.ui.activeCategory = categoryId; });
}

export function setUiFlag(flag, value) {
  update((draft) => { draft.ui[flag] = value; });
}

export function setCategoryField(field, value) {
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    if (category) category[field] = value;
  });
}
