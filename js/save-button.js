// «Обновить»: send everything pending to the data repo now. Ctrl+S does the
// same from anywhere in the app.
//
// The idle flush in js/sync.js is untouched and goes on working on its own;
// this is the explicit version of it. See forceSync() for what "everything"
// means, and js/staging.js for why closing the tab mid-upload loses nothing.
//
// Three looks, by the user's design: default, hover (CSS alone) and done.
// Done - «Обновлено» on white with a tick - comes up THE MOMENT the button is
// pressed and goes back after DONE_MS, whatever the upload is doing. It is an
// acknowledgement of the press, not a report from GitHub: the upload goes on
// behind it, holds the tab while it runs, and was staged durably before it
// began. A failure is logged to the console and nothing else - the next launch
// or the next idle flush retries it, which is the "recover silently, show no
// error indicators" the user asked for.
//
// The button is rebuilt with every header render, so its status lives here, at
// module level, and a change repaints the buttons in place rather than
// re-rendering the page under whatever the user is doing.

import { el } from './dom.js';
import { getState } from './store.js';
import { forceSync } from './sync.js';

// How long «Обновлено» stays before the button reads «Обновить» again.
export const DONE_MS = 1500;

const LABELS = { idle: 'Обновить', done: 'Обновлено' };
const TITLE = 'Отправить все изменения в репозиторий (Ctrl+S)';

let status = 'idle';
let doneTimer = null;
let inFlight = null;

export function renderSaveButton() {
  const button = el(
    'button',
    {
      class: 'main-button save-button',
      type: 'button',
      title: TITLE,
      onClick: () => { saveNow(); },
    },
    // A mask over currentColor (see the CSS), so the icon follows the text
    // from white to black - and to the tick when done.
    el('span', { class: 'main-button__icon save-button__icon', 'aria-hidden': 'true' }),
    el('span', { class: 'save-button__label' })
  );
  paint(button);
  return button;
}

function paint(button) {
  button.dataset.status = status;
  button.querySelector('.save-button__label').textContent = LABELS[status];
}

function setStatus(next) {
  status = next;
  if (doneTimer !== null) { clearTimeout(doneTimer); doneTimer = null; }
  if (next === 'done') doneTimer = setTimeout(() => setStatus('idle'), DONE_MS);
  for (const button of document.querySelectorAll('.save-button')) paint(button);
}

// While the upload is in flight, closing or reloading the tab asks first. If
// the user leaves anyway nothing is lost - the structure was staged before the
// upload began and the next launch finishes it.
function holdTheTab(event) {
  event.preventDefault();
  event.returnValue = '';
  return '';
}

// Every press shows «Обновлено» for its full two seconds. The upload itself
// is one at a time: a press while one is running waits for that one rather
// than starting another.
export function saveNow() {
  setStatus('done');
  if (inFlight) return inFlight;
  inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run() {
  // A field mid-edit (the start date, the interval, a category name) commits
  // on blur, and defers the commit by a tick (gotcha 15) - so blur it and let
  // that tick pass, or Ctrl+S from inside the field would save the old value.
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === 'function') active.blur();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  window.addEventListener('beforeunload', holdTheTab);
  try {
    await forceSync(getState());
  } catch (error) {
    console.warn('«Обновить» did not finish:', error);
  } finally {
    window.removeEventListener('beforeunload', holdTheTab);
  }
}

// Ctrl+S (Cmd+S on a Mac) from anywhere, matched on the physical key so it
// works on a Russian layout too (gotcha 5). The browser's own "save page" is
// always suppressed, even when there is nothing to send. Installed once.
let shortcutInstalled = false;

export function installSaveShortcut() {
  if (shortcutInstalled) return;
  shortcutInstalled = true;
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyS' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) saveNow();
  }, true);
}

// For the tests: a fresh page starts idle.
export function resetSaveButton() {
  if (doneTimer !== null) clearTimeout(doneTimer);
  doneTimer = null;
  status = 'idle';
  inFlight = null;
}

// For the tests: whether an upload is still running.
export function saveInFlight() {
  return inFlight;
}
