// The application shell: which page is mounted, and swapping between them.
//
// A page owns its own header, its own document-level listeners and its own
// store subscription, so switching means tearing the old one down completely -
// otherwise two pages render into the same container and both react to every
// mutation. Every mount returns the function that undoes it.

import { mountSchedulePage } from './schedule-page.js';
import { mountCalendarPage } from './calendar-page.js';
import { mountWorkoutPage } from './workout-page.js';
import { mountExercisePage, hasExerciseSession } from './exercise-page.js';

const PAGES = {
  schedule: mountSchedulePage,
  calendar: mountCalendarPage,
  workout: mountWorkoutPage,
  exercise: mountExercisePage,
};

// The exercise page is the one page that cannot be opened by naming it. It is
// half of a session - which complex, which exercise, and the moment the clock
// started - and none of that is persisted, deliberately: a workout resumed
// tomorrow from a bookmark is not the same workout. So the hash may only reach
// it while a complex is actually being performed.
const NEEDS_SESSION = { exercise: hasExerciseSession };

// Not persisted: the schedule page is where the app opens, every time.
const HOME = 'schedule';

let root = null;
let current = null;
let destroyCurrent = null;

export function mountApp(container) {
  root = container;
  // The workout page is meant to be opened straight from a link on a phone, so
  // the hash - and only the hash - can name the page to start on. Nothing is
  // stored: without one the app opens on the schedule as it always has.
  goToPage(pageFromHash() || HOME);
  window.addEventListener('hashchange', onHashChange);
}

export function goToPage(page) {
  if (!PAGES[page] || page === current) return;

  if (destroyCurrent) destroyCurrent();
  current = page;
  destroyCurrent = PAGES[page](root, goToPage);

  // So the address bar always names the page on screen, and the phone's back
  // button walks back through the pages that were visited.
  if (pageFromHash() !== page) window.location.hash = page;
}

export function currentPage() {
  return current;
}

function pageFromHash() {
  const name = String(window.location.hash || '').replace(/^#/, '');
  if (!PAGES[name]) return null;
  if (NEEDS_SESSION[name] && !NEEDS_SESSION[name]()) return null;
  return name;
}

function onHashChange() {
  const page = pageFromHash();
  if (page) goToPage(page);
}
