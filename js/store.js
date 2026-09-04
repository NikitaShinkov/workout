// Application state: a single object, mutated only through `update`, which
// persists and notifies subscribers.

import { CATEGORIES, DEFAULT_EQUIPMENT, createCategoryState } from './model.js';
import { loadState, saveState } from './db.js';

const listeners = new Set();
let saveTimer = null;

let state = createInitialState();

function createInitialState() {
  const categories = {};
  for (const category of CATEGORIES) categories[category.id] = createCategoryState();

  return {
    version: 1,
    categories,
    // Equipment chosen for the most recently added exercise. The next new
    // exercise starts pre-ticked with this, per the spec.
    lastEquipment: DEFAULT_EQUIPMENT.slice(),
    ui: {
      activeCategory: CATEGORIES[0].id,
      showIndicators: false,
      showFavorites: false,
      onlyEnabledComplexes: false,
      favoritesOnly: false,
    },
  };
}

// Fill in anything a stored record predates, so an old save never crashes a
// newer build.
function migrate(stored) {
  const base = createInitialState();
  if (!stored || typeof stored !== 'object') return base;

  const merged = {
    ...base,
    ...stored,
    ui: { ...base.ui, ...(stored.ui || {}) },
    categories: { ...base.categories },
  };

  for (const category of CATEGORIES) {
    const saved = (stored.categories || {})[category.id];
    if (saved) merged.categories[category.id] = { ...createCategoryState(), ...saved };
  }

  if (!Array.isArray(merged.lastEquipment) || merged.lastEquipment.length === 0) {
    merged.lastEquipment = DEFAULT_EQUIPMENT.slice();
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

export function activeCategory() {
  return state.categories[state.ui.activeCategory];
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

// --- exercise operations ---------------------------------------------------

export function addExercise(exercise) {
  update((draft) => {
    draft.categories[draft.ui.activeCategory].exercises.push(exercise);
    draft.lastEquipment = exercise.equipment.slice();
  });
}

export function updateExercise(id, fields) {
  update((draft) => {
    const list = draft.categories[draft.ui.activeCategory].exercises;
    const index = list.findIndex((e) => e.id === id);
    if (index === -1) return;

    list[index] = { ...list[index], ...fields };
    if (fields.equipment) draft.lastEquipment = fields.equipment.slice();
  });
}

export function deleteExercises(ids) {
  const doomed = new Set(ids);
  update((draft) => {
    const category = draft.categories[draft.ui.activeCategory];
    category.exercises = category.exercises.filter((e) => !doomed.has(e.id));
  });
}

export function toggleFavorite(id) {
  update((draft) => {
    const exercise = draft.categories[draft.ui.activeCategory].exercises.find((e) => e.id === id);
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
  update((draft) => { draft.categories[draft.ui.activeCategory][field] = value; });
}
