// The loading screen: the logo, centred, turning on its vertical axis.
//
// The state now arrives over the network, so there is a moment with nothing to
// show. It also has a second job coming: when a change staged locally has to be
// pushed before the app can open, this is what covers the screen so nothing can
// be edited while that is happening.

import { el } from './dom.js';

// Returns the function that takes it away again.
export function showLoading(container) {
  const screen = el(
    'div',
    // A live region rather than visible text: the design has the logo alone,
    // but something has to say what is happening to a screen reader.
    { class: 'loading', role: 'status', 'aria-live': 'polite' },
    // The file itself, not a mask over it: the logo carries its own four-colour
    // gradient and that is what should be on screen. A mask only takes the
    // alpha channel, so it would flatten the whole thing to one colour.
    el('img', { class: 'loading__logo', src: 'assets/icons/app_logo.svg', alt: '' }),
    el('span', { class: 'visually-hidden', text: 'Загрузка…' })
  );

  container.appendChild(screen);

  return function hide() {
    screen.remove();
  };
}
