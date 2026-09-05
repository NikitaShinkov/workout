// The two typed fields in Schedule_toolbar.
//
// Both are guarded rather than free text: what the user types has to be a value
// the schedule can actually step through, and the cheapest way to guarantee
// that is to refuse the keystroke rather than to validate afterwards.

import { el } from './dom.js';
import {
  DEFAULT_START_DATE,
  formatDate,
  parseNumericDate,
  parseStartDate,
  toNumericDate,
} from './schedule.js';

// --- start date -------------------------------------------------------------
//
// The field reads "19 сен" and edits as "19.09": a fixed five-character mask
// where the dot is furniture, not content. Typing overwrites one slot at a time
// and steps over the dot, so "21.10" is typed as "2110" - which is the whole
// point of the mask, and why insertion is never used.

// Both fields commit on blur, and committing re-renders the page - which
// replaces the very input the browser is in the middle of blurring. Doing that
// inside the blur dispatch throws "The node to be removed is no longer a child
// of this node", so the store update waits for the event to finish. The field
// already shows the committed text by then, so nothing flickers.
function deferCommit(run) {
  setTimeout(run, 0);
}

// Positions of the four digits in "DD.MM"; index 2 is the dot.
const DIGIT_SLOTS = [0, 1, 3, 4];

// The largest digit each slot will accept. Days run 0-3 then 0-9, months 0-1
// then 0-9 - enough to keep nonsense out one key at a time. It still admits
// impossible dates (39.19), which the commit below rejects wholesale.
const SLOT_MAX = { 0: 3, 1: 9, 3: 1, 4: 9 };

export function createDateInput(value, onCommit) {
  const input = el('input', {
    class: 'input input--date',
    type: 'text',
    inputmode: 'numeric',
    spellcheck: 'false',
    'aria-label': 'Дата начала расписания',
  });

  // What the field shows when it is not being edited.
  let display = normalizeDisplay(value);
  // The five-character mask while it is, or null when it is not.
  let mask = null;
  // Which of DIGIT_SLOTS the next digit overwrites. Equal to its length once
  // all four are filled, which parks the caret at the end.
  let cursor = 0;
  // A click that focuses the field selects all of it; the next one places the
  // caret instead.
  let selectingAll = false;

  input.value = display;

  function slotAt(index) {
    return DIGIT_SLOTS[index];
  }

  function place() {
    if (mask === null) return;
    if (cursor < DIGIT_SLOTS.length) {
      // Highlighting the slot rather than sitting between characters is what
      // makes overwriting look deliberate instead of broken.
      const pos = slotAt(cursor);
      input.setSelectionRange(pos, pos + 1);
    } else {
      input.setSelectionRange(mask.length, mask.length);
    }
  }

  function typeDigit(digit) {
    if (cursor >= DIGIT_SLOTS.length) return;
    const pos = slotAt(cursor);
    if (digit > SLOT_MAX[pos]) return; // out of range for this position

    mask = mask.slice(0, pos) + digit + mask.slice(pos + 1);
    input.value = mask;
    cursor += 1;
    place();
  }

  // Nearest editable slot to a caret position, so clicking on the dot does not
  // strand the cursor on it.
  function slotNear(caret) {
    let best = 0;
    for (let i = 1; i < DIGIT_SLOTS.length; i += 1) {
      if (Math.abs(DIGIT_SLOTS[i] - caret) < Math.abs(DIGIT_SLOTS[best] - caret)) best = i;
    }
    return best;
  }

  function beginEditing() {
    const date = parseStartDate(display) || parseStartDate(DEFAULT_START_DATE);
    mask = toNumericDate(date);
    cursor = 0;
    input.value = mask;
    input.setSelectionRange(0, mask.length);
  }

  function commit() {
    if (mask === null) return;

    const date = parseNumericDate(mask);
    mask = null;

    // An impossible date leaves the last good one in place, rather than
    // silently rewriting what the user meant.
    if (date) display = formatDate(date);
    input.value = display;

    if (date) deferCommit(() => onCommit(display));
  }

  function cancel() {
    mask = null;
    input.value = display;
    input.blur();
  }

  input.addEventListener('focus', () => {
    selectingAll = true;
    beginEditing();
  });

  // The click that focuses would otherwise collapse the selection made above.
  input.addEventListener('mouseup', (event) => {
    if (selectingAll) {
      event.preventDefault();
      selectingAll = false;
      return;
    }
    if (mask === null) return;
    cursor = slotNear(input.selectionStart);
    place();
  });

  input.addEventListener('blur', commit);

  input.addEventListener('keydown', (event) => {
    // Enter, Escape and Delete all mean something else on the page.
    event.stopPropagation();

    if (event.key === 'Enter') { event.preventDefault(); input.blur(); return; }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (event.key === 'Tab') return; // let focus move; blur commits

    // Leave the clipboard and the browser's own shortcuts alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      event.preventDefault();
      cursor = Math.max(0, cursor - 1);
      place();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      cursor = Math.min(DIGIT_SLOTS.length - 1, cursor + 1);
      place();
      return;
    }
    if (event.key === 'Home') { event.preventDefault(); cursor = 0; place(); return; }
    if (event.key === 'End') {
      event.preventDefault();
      cursor = DIGIT_SLOTS.length - 1;
      place();
      return;
    }

    // Modifiers, function keys and the like report multi-character names and
    // change nothing, so they are left to the browser.
    if (event.key.length !== 1) return;

    // Everything that would change the text goes through typeDigit or nowhere:
    // the mask must stay exactly five characters long.
    event.preventDefault();
    if (/[0-9]/.test(event.key)) typeDigit(Number(event.key));
  });

  input.addEventListener('paste', (event) => {
    event.preventDefault();
    if (mask === null) return;
    const digits = ((event.clipboardData && event.clipboardData.getData('text')) || '')
      .replace(/\D/g, '');
    for (const digit of digits) typeDigit(Number(digit));
  });

  return input;
}

// A stored value from an older save may be blank or unparseable; the field
// still has to show something a user can read.
function normalizeDisplay(value) {
  const date = parseStartDate(value);
  return date ? formatDate(date) : DEFAULT_START_DATE;
}

// --- interval ---------------------------------------------------------------

// One or two digits, no leading zero: 1-99 days. The field is 29px in the
// design, which is two digits' worth, and an interval the schedule cannot step
// by - empty, 0, or a mistyped "0542" - puts the last good value back.
const VALID_INTERVAL = /^[1-9][0-9]?$/;
const INTERVAL_MAX_CHARS = 2;

export function createIntervalInput(value, onCommit) {
  const input = el('input', {
    class: 'input input--interval',
    type: 'text',
    inputmode: 'numeric',
    maxlength: String(INTERVAL_MAX_CHARS),
    spellcheck: 'false',
    'aria-label': 'Интервал в днях',
  });

  let committed = VALID_INTERVAL.test(String(value)) ? String(value) : '1';
  input.value = committed;

  input.addEventListener('focus', () => input.select());

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();

    if (event.key === 'Enter') { event.preventDefault(); input.blur(); return; }
    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = committed;
      input.blur();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;

    if (!/[0-9]/.test(event.key)) event.preventDefault();
  });

  // Paste, drop and autofill all bypass keydown, so whatever lands is scrubbed.
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, INTERVAL_MAX_CHARS);
    if (digits !== input.value) input.value = digits;
  });

  input.addEventListener('blur', () => {
    if (VALID_INTERVAL.test(input.value)) {
      committed = input.value;
      deferCommit(() => onCommit(Number(committed)));
    } else {
      input.value = committed;
    }
  });

  return input;
}
