// Application state: a single object, mutated only through `update`, which
// persists and notifies subscribers.

import {
  DEFAULT_CATEGORIES,
  NEW_CATEGORY_NAME,
  DEFAULT_EQUIPMENT,
  createCategoryState,
  uid,
} from './model.js';
import { loadState, saveState } from './db.js';

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
    ui: {
      activeCategory: categoryOrder[0],
      showIndicators: false,
      showFavorites: false,
      onlyEnabledComplexes: false,
      favoritesOnly: false,
    },
  };
}

// Fill in anything a stored record predates, so an old save never crashes a
// newer build. Version 1 had no category order and no category names.
function migrate(stored) {
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

export function updateExercise(id, fields) {
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
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

export function toggleFavorite(id) {
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    if (!category) return;
    const exercise = category.exercises.find((e) => e.id === id);
    if (exercise) exercise.favorite = !exercise.favorite;
  });
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
