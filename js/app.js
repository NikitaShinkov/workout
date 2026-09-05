// The application shell: which page is mounted, and swapping between them.
//
// A page owns its own header, its own document-level listeners and its own
// store subscription, so switching means tearing the old one down completely -
// otherwise two pages render into the same container and both react to every
// mutation. Every mount returns the function that undoes it.

import { mountSchedulePage } from './schedule-page.js';
import { mountCalendarPage } from './calendar-page.js';

const PAGES = {
  schedule: mountSchedulePage,
  calendar: mountCalendarPage,
};

// Not persisted: the schedule page is where the app opens, every time.
const HOME = 'schedule';

let root = null;
let current = null;
let destroyCurrent = null;

export function mountApp(container) {
  root = container;
  goToPage(HOME);
}

export function goToPage(page) {
  if (!PAGES[page] || page === current) return;

  if (destroyCurrent) destroyCurrent();
  current = page;
  destroyCurrent = PAGES[page](root, goToPage);
}

export function currentPage() {
  return current;
}
