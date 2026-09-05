// Page_selector: the three application pages, in the header of every one.

import { el } from './dom.js';

// The schedule page has no button of its own: it is reached by picking a
// category, on either page. So on the schedule nothing here is active, and the
// selector reads as "somewhere else you can go".
export const PAGES = [
  { id: 'calendar', label: 'Календарь' },
  // Not built. The button is there because the design has it, but it stays
  // inert: clicking it must not switch anywhere.
  { id: 'workout', label: 'Тренировка', disabled: true },
];

export function renderPageSelector(current, onSelect) {
  return el(
    'div',
    { class: 'page-selector', role: 'tablist' },
    PAGES.map((page) => {
      const isCurrent = page.id === current;
      return el(
        'button',
        {
          class:
            'page-button' +
            (isCurrent ? ' page-button--active' : '') +
            (page.disabled ? ' page-button--disabled' : ''),
          type: 'button',
          role: 'tab',
          // The label is the icon's accessible name, and data-page is how
          // everything else addresses a button now that it carries no text.
          dataset: { page: page.id },
          'aria-label': page.label,
          'aria-selected': isCurrent ? 'true' : 'false',
          // aria-disabled rather than the disabled attribute: the button stays
          // focusable and readable, it simply goes nowhere.
          'aria-disabled': page.disabled ? 'true' : null,
          title: page.disabled ? page.label + ' — страница ещё не готова' : page.label,
          onClick: () => {
            if (page.disabled || isCurrent) return;
            onSelect(page.id);
          },
        },
        // The exported icons are solid white, so they are drawn as a mask over
        // currentColor rather than as an <img>: that is the only way the same
        // file can go black on the white ground of the active button.
        el('span', { class: 'page-button__icon page-button__icon--' + page.id })
      );
    })
  );
}
