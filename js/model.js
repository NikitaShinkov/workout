// Fixed domain data and factories. No DOM, no storage.

import { defaultStartDate, DEFAULT_INTERVAL_DAYS } from './schedule.js';

// Seed categories. These are only used to build a fresh state - once saved,
// categories are ordinary data the user can rename, add to and delete.
export const DEFAULT_CATEGORIES = [
  { id: 'ankle',      name: 'Голеностоп' },
  { id: 'knee',       name: 'Колено' },
  { id: 'hip',        name: 'ТБС' },
  { id: 'glutes',     name: 'Ягодицы' },
  { id: 'lower_back', name: 'Поясница' },
  { id: 'back',       name: 'Спина' },
  { id: 'neck',       name: 'Шея' },
];

export const NEW_CATEGORY_NAME = 'Новая категория';

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

// The three feedback axes. `label` is the short form the schedule row's
// indicator column has room for; `name` is what the workout toolbar writes
// under the icon, and `icon` is the prefix of the exported SVG - the axis is
// called rangeOfMotion in the data and motion_* in the design's file names.
export const INDICATORS = [
  { id: 'technique',     label: 'Техн.', name: 'Техника',   icon: 'technique' },
  { id: 'rangeOfMotion', label: 'Ампл.', name: 'Амплитуда', icon: 'motion' },
  { id: 'strength',      label: 'Сила',  name: 'Сила',      icon: 'strength' },
];

// Feedback levels are stored as {date, level}; `none` means rated but no level.
export const RATING_LEVELS = ['none', 'easy', 'medium', 'hard'];

// What an indicator does when it is tapped: easy, moderate, hard, off, round
// again. `none` is a rating in its own right - "performed, nothing to report" -
// which is why it sits in the cycle rather than only being the starting point.
export const RATING_CYCLE = ['easy', 'medium', 'hard', 'none'];

// The level an indicator shows when the exercise is opened with nothing already
// recorded for the day. A rating is the common case, so the cycle starts one
// tap from it rather than at the grey.
export const DEFAULT_RATING_LEVEL = 'easy';

// Level -> the suffix of the exported icon for it. The files carry their own
// fill, and each level is a different drawing rather than a recolour of one, so
// they are drawn as images rather than as a mask over currentColor.
export const LEVEL_ICONS = {
  easy: 'easy',
  medium: 'moderate',
  hard: 'hard',
  none: 'not_selected',
};

export function ratingIcon(indicator, level) {
  return 'assets/icons/' + indicator.icon + '_' + (LEVEL_ICONS[level] || LEVEL_ICONS.none) + '.svg';
}

// Level -> what to CALL it. The design names the levels only by their colours
// and their drawings, so these never appear on screen; they are there so that
// an indicator's accessible name says what it is currently set to, the way the
// favourites star's title says which way it will go. A button that reads only
// "Техника" tells a screen reader nothing about the value it is showing.
export const LEVEL_NAMES = {
  easy: 'легко',
  medium: 'средне',
  hard: 'тяжело',
  none: 'не выбрано',
};

export function ratingLabel(indicator, level) {
  return indicator.name + ': ' + (LEVEL_NAMES[level] || LEVEL_NAMES.none);
}

export function nextRatingLevel(level) {
  const at = RATING_CYCLE.indexOf(level);
  // Anything unrecognised - including no rating at all - starts the cycle.
  return at === -1 ? RATING_CYCLE[0] : RATING_CYCLE[(at + 1) % RATING_CYCLE.length];
}

// Default duration until the exercise has been performed once: 2 minutes.
export const DEFAULT_DURATION_SEC = 120;

// What an exercise is expected to take: the time it actually took last time,
// or the default until it has been performed once. Every estimate in the app -
// a Complex_block's "25 мин", Button_next's remaining time - is built from it,
// so it lives here rather than in whichever page happened to need it first.
export function exerciseDuration(exercise) {
  const seconds = Number(exercise && exercise.lastDurationSec);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_DURATION_SEC;
}

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

// A complex is an ordered run of exercises performed on one day. Its items do
// not hold exercises, they POINT at them: the same exercise can be dragged into
// several complexes, and editing it once must change every scheduled copy.
// The item id is what selection and drag address, so two items referencing the
// same exercise stay independently selectable and movable.
export function createComplexItem(exerciseId) {
  return { id: uid('ci'), exerciseId };
}

export function createComplex(exerciseIds = []) {
  return {
    id: uid('cx'),
    // In the schedule by default; the Switch on Complex_side_block turns it off.
    enabled: true,
    items: exerciseIds.map(createComplexItem),
  };
}

export function createCategoryState(name = NEW_CATEGORY_NAME) {
  return {
    name,
    exercises: [],
    complexes: [],
    scheduleEnabled: true,
    scheduleStartDate: defaultStartDate(),
    intervalDays: DEFAULT_INTERVAL_DAYS,
  };
}
