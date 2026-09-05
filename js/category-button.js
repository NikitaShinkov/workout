// The insides of a category button, shared by every list that shows one.
//
// Both page headers and the calendar's Category_block build these, and they
// have to build them the SAME way. Two bugs came from one of them putting the
// name in as bare text instead:
//
//   - the name sat 1-2px lower, because bare text is centred by the flex box's
//     `align-items` while the label below is centred by its own `line-height`;
//   - `.menu-button--off` never faded, because it selects `__label`, which a
//     bare-text button does not have.
//
// The sizer / label split itself is not decoration either: see the notes on
// both classes in the stylesheet.

import { el } from './dom.js';

export function categoryButtonContents(name) {
  return [
    // In flow but invisible, so it - and only it - sets the button's width.
    el('span', { class: 'menu-button__sizer', text: name }),
    // Out of flow, so it can be clipped without affecting that width.
    el('span', { class: 'menu-button__label', text: name }),
  ];
}

// The classes every category button agrees on. `extra` carries whatever the
// caller adds on top - the active state, the hover arming, a drag marker.
export function categoryButtonClass(category, extra = '') {
  return (
    'menu-button' +
    // Switched out of the workout schedule: the name fades, on every page that
    // lists categories, so which are off is readable wherever you are.
    (category.scheduleEnabled === false ? ' menu-button--off' : '') +
    (extra ? ' ' + extra : '')
  );
}
