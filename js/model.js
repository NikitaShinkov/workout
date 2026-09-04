// Fixed domain data and factories. No DOM, no storage.

export const CATEGORIES = [
  { id: 'ankle',      name: 'Голеностоп' },
  { id: 'knee',       name: 'Колено' },
  { id: 'hip',        name: 'ТБС' },
  { id: 'glutes',     name: 'Ягодицы' },
  { id: 'lower_back', name: 'Поясница' },
  { id: 'back',       name: 'Спина' },
  { id: 'neck',       name: 'Шея' },
];

// Fixed equipment list. `mat` is the default selection for a brand new exercise.
export const EQUIPMENT = [
  { id: 'mat',        name: 'коврик' },
  { id: 'short_band', name: 'короткая лента' },
  { id: 'long_band',  name: 'длинная лента' },
  { id: 'roller',     name: 'рол' },
  { id: 'weight',     name: 'вес' },
  { id: 'chair',      name: 'стул' },
  { id: 'wall',       name: 'стена' },
  { id: 'block',      name: 'блок' },
];

export const DEFAULT_EQUIPMENT = ['mat'];

// The three feedback axes shown on the right of an exercise row.
export const INDICATORS = [
  { id: 'technique',     label: 'Техн.' },
  { id: 'rangeOfMotion', label: 'Ампл.' },
  { id: 'strength',      label: 'Сила' },
];

// Feedback levels are stored as {date, level}; `none` means rated but no level.
export const RATING_LEVELS = ['none', 'easy', 'medium', 'hard'];

// Default duration until the exercise has been performed once: 2 minutes.
export const DEFAULT_DURATION_SEC = 120;

// How many thumbnails fit on one images_preview_line in the popup.
export const IMAGES_PER_LINE = 4;

export function uid(prefix = 'ex') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

export function createExercise(fields = {}) {
  const {
    name = '',
    description = '',
    equipment = DEFAULT_EQUIPMENT,
    images = [],
  } = fields;

  return {
    id: uid('ex'),
    name,
    description,
    equipment: equipment.slice(),
    images: images.slice(),        // ordered - the order IS the action sequence
    favorite: false,
    lastDurationSec: DEFAULT_DURATION_SEC,
    feedback: { technique: [], rangeOfMotion: [], strength: [] },
  };
}

export function createCategoryState() {
  return {
    exercises: [],
    complexes: [],                 // reserved for the next iteration
    scheduleEnabled: true,
    scheduleStartDate: '',
    intervalDays: 1,
  };
}
