// «Обновить»: send everything pending to the data repo now, and say when GitHub
// has confirmed it. Ctrl+S does the same from anywhere in the app.
//
// The idle flush in js/sync.js is untouched and goes on working on its own;
// this is the explicit, confirmed version of it. See forceSync() for what
// "everything" means and why success can be trusted, and js/staging.js for
// why closing the tab mid-upload loses nothing.
//
// The button is rebuilt with every header render, so its status lives here, at
// module level, and a change of status repaints the buttons in place rather
// than re-rendering the page under whatever the user is doing.

import { el } from './dom.js';
import { getState } from './store.js';
import { forceSync } from './sync.js';

// How long «Сохранено» stays before the button reads «Обновить» again.
const DONE_MS = 2500;

const LABELS = {
  idle: 'Обновить',
  busy: 'Сохраняю…',
  done: 'Сохранено',
  error: 'Не сохранено',
};

let status = 'idle';
let detail = '';
let doneTimer = null;
let inFlight = null;

export function renderSaveButton() {
  const button = el(
    'button',
    {
      class: 'main-button save-button',
      type: 'button',
      title: 'Отправить все изменения в репозиторий (Ctrl+S)',
      onClick: () => { saveNow(); },
    },
    el('img', { class: 'main-button__icon save-button__icon', src: 'assets/icons/resetr_icon.svg', alt: '' }),
    // One label, exactly like any main-button. The width follows the text;
    // the button is anchored at the right, so only its left edge moves.
    el('span', { class: 'save-button__label' })
  );
  paint(button);
  return button;
}

function paint(button) {
  button.dataset.status = status;
  button.querySelector('.save-button__label').textContent = LABELS[status];
  button.setAttribute('aria-busy', status === 'busy' ? 'true' : 'false');
  button.title = status === 'error'
    ? detail + ' Нажмите, чтобы попробовать снова.'
    : 'Отправить все изменения в репозиторий (Ctrl+S)';
}

function setStatus(next, why = '') {
  status = next;
  detail = why;
  if (doneTimer !== null) { clearTimeout(doneTimer); doneTimer = null; }
  if (next === 'done') doneTimer = setTimeout(() => setStatus('idle'), DONE_MS);
  for (const button of document.querySelectorAll('.save-button')) paint(button);
}

// While the upload is in flight, closing or reloading the tab asks first. If
// the user leaves anyway nothing is lost - the structure was staged before the
// upload began and the next launch finishes it - but asking is what lets the
// promise "it is done when it says so" hold in the ordinary case.
function holdTheTab(event) {
  event.preventDefault();
  event.returnValue = '';
  return '';
}

// One upload at a time: a second click or Ctrl+S while one is running waits for
// that one rather than starting another.
export function saveNow() {
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

  setStatus('busy');
  window.addEventListener('beforeunload', holdTheTab);
  try {
    await forceSync(getState());
    setStatus('done');
  } catch (error) {
    console.warn('«Обновить» failed:', error);
    setStatus('error', describe(error));
  } finally {
    window.removeEventListener('beforeunload', holdTheTab);
  }
}

function describe(error) {
  if (error && error.reason) return error.message;
  if (error && (error.status === 401 || error.status === 403)) {
    return 'GitHub отклонил токен: он истёк или у него нет прав на запись.';
  }
  if (error instanceof TypeError) return 'Нет связи с GitHub.';
  return 'GitHub ответил ошибкой: ' + String((error && error.message) || error).slice(0, 160);
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
  detail = '';
  inFlight = null;
}
