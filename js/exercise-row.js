// Exercise_block: the row, its indicators, its star, and the hover animation.
//
// Shared, because the same block appears in three places that agree on how it
// LOOKS and disagree about what it DOES - Exercise_list and the complexes on
// the schedule page, where it is selectable and draggable, and the calendar,
// where the order is the schedule's and nothing may be moved. Everything
// behavioural arrives through `options`; nothing here reads the store.

import { INDICATORS } from './model.js';
import { el, svg } from './dom.js';
import { blobUrl } from './images.js';
import { createSequenceAnimation } from './animation.js';

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

// --- hover animation --------------------------------------------------------
//
// Keyed by the image box so each can be torn down again. A re-render throws the
// rows away, and a running animation would keep ticking against detached
// images - hence stopAllRowAnimations, which every render calls first.
const rowAnimations = new Map();

export function startRowAnimation(box, exercise) {
  // A single image has nothing to animate.
  if (exercise.images.length < 2 || rowAnimations.has(box)) return;

  const still = box.querySelector('.exercise-row__image');
  if (still) still.hidden = true;

  const animation = createSequenceAnimation(box);
  animation.setFrames(exercise.images.map(blobUrl));
  rowAnimations.set(box, animation);
}

export function stopRowAnimation(box) {
  const animation = rowAnimations.get(box);
  if (!animation) return;

  animation.destroy();
  rowAnimations.delete(box);

  const still = box.querySelector('.exercise-row__image');
  if (still) still.hidden = false;
}

export function stopAllRowAnimations() {
  for (const animation of rowAnimations.values()) animation.destroy();
  rowAnimations.clear();
}

// --- the row ----------------------------------------------------------------

// options:
//   selected      draws the selected fill
//   draggable     false on the calendar, where the order is the schedule's
//   dataset       whatever the owning list needs to read back off the node
//   showIndicators / showFavorites
//   onClick, onDblclick, onDragstart, onDragover, onDrop, onDragend
//   onToggleFavorite  omit to render the star as a plain, inert mark
export function renderExerciseRow(exercise, options = {}) {
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
      class: 'exercise-row' + (options.selected ? ' exercise-row--selected' : ''),
      draggable: options.draggable === false ? 'false' : 'true',
      dataset: options.dataset || null,
      onClick: options.onClick || null,
      onDblclick: options.onDblclick || null,
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
      options.showIndicators ? renderIndicators(exercise) : null
    ),
    options.showFavorites ? renderFavoriteStar(exercise, options.onToggleFavorite) : null
  );

  for (const [type, handler] of [
    ['dragstart', options.onDragstart],
    ['dragover', options.onDragover],
    ['drop', options.onDrop],
    ['dragend', options.onDragend],
  ]) {
    if (handler) row.addEventListener(type, (event) => handler(event, row));
  }

  return row;
}

export function renderIndicators(exercise) {
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

export function renderFavoriteStar(exercise, onToggle) {
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
        if (onToggle) onToggle(exercise);
      },
    },
    star
  );
}
