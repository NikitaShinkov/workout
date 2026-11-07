// Date_pointer: the rule across a complex list marking today - and, since it
// can be picked up, another way to set the schedule's start date. Dropped on a
// boundary between two blocks, it makes the block after that boundary today's,
// and the page recomputes the schedule to match.
//
// Shared by the schedule page and the calendar page. Each passes `onDrop`,
// which receives the boundary as an index among the list's `.complex` blocks:
// 0 is above the first, `length` is below the last.
//
// Pointer events, not HTML5 drag and drop. The lists already carry a DnD
// protocol for rows and complexes (dragover/drop on .complex-list), and this
// gesture has nothing to deliver to it; a pointer capture also keeps :hover off
// the rows the pointer is dragged across. The node is never re-rendered while
// it moves (gotcha 6): it is translated by hand, and the store only hears about
// it on release.

import { el } from './dom.js';

// Movement under this is a click on the handle, not a drag.
const DRAG_THRESHOLD = 4;

// Same feel as the schedule page's own drags (gotcha 13).
const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_STEP = 10;
const AUTO_SCROLL_TICK = 30;

let active = null;

// The handle is a 20px band across the list, so during a row or complex drag
// (HTML5 DnD) it would be the dragover target over that band and hide the row
// beneath it. `body.dnd-active` takes it out of hit-testing for the duration.
// Document-level and installed once: it outlives any one render or page.
let dndWatched = false;
function watchHtmlDrag() {
  if (dndWatched || typeof document === 'undefined') return;
  dndWatched = true;
  const off = () => document.body && document.body.classList.remove('dnd-active');
  document.addEventListener('dragstart', () => document.body.classList.add('dnd-active'), true);
  document.addEventListener('dragend', off, true);
  document.addEventListener('drop', off, true);
}

export function renderDatePointer({ onDrop } = {}) {
  // The rule stays `pointer-events: none`; the handle - a 20px band across the
  // list, centred on the rule and stacked above the complexes - is the only
  // part that is hit-testable. See .date-pointer__handle in css/app.css.
  const handle = el('span', {
    class: 'date-pointer__handle',
    title: 'Перетащите, чтобы сдвинуть расписание',
  });
  const pointer = el(
    'div',
    { class: 'date-pointer' },
    el('span', { class: 'date-pointer__icon' }),
    handle
  );

  if (onDrop) {
    watchHtmlDrag();
    pointer.classList.add('date-pointer--movable');
    handle.addEventListener('pointerdown', (event) => begin(event, pointer, handle, onDrop));
  }
  return pointer;
}

// For a page teardown: a gesture must not outlive the page it started on.
export function cancelDatePointerDrag() {
  if (active) finish(false);
}

function begin(event, pointer, handle, onDrop) {
  if (event.button !== undefined && event.button !== 0) return;
  const list = pointer.parentElement;
  if (!list) return;

  // No text selection, and no click-through to whatever handles the list.
  event.preventDefault();
  event.stopPropagation();
  if (active) finish(false);

  active = {
    pointer, handle, list, onDrop,
    pointerId: event.pointerId,
    startY: event.clientY,
    lastY: event.clientY,
    moved: false,
    boundary: null,
    translate: 0,
    timer: null,
    step: 0,
  };

  if (handle.setPointerCapture && event.pointerId !== undefined) {
    try { handle.setPointerCapture(event.pointerId); } catch { /* jsdom, or already released */ }
  }
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onCancel);
  handle.addEventListener('lostpointercapture', onLost);
  document.addEventListener('keydown', onKey, true);
}

function onMove(event) {
  if (!active) return;
  active.lastY = event.clientY;

  if (!active.moved) {
    if (Math.abs(event.clientY - active.startY) < DRAG_THRESHOLD) return;
    active.moved = true;
    active.pointer.classList.add('date-pointer--dragging');
    document.body.classList.add('date-pointer-drag');
  }

  track();
  if (active) updateAutoScroll(); // track() abandons a pointer a render replaced
}

// Follow the cursor and work out which boundary it is nearest. Re-run on every
// auto-scroll tick too, since scrolling moves the blocks under a still cursor.
function track() {
  const { pointer, list, lastY } = active;
  if (!pointer.isConnected) { finish(false); return; }

  // Where the rule would sit untranslated, so the offset stays right while the
  // list scrolls under it and while the rule is parked by `sticky`.
  const base = pointer.getBoundingClientRect().top - active.translate;
  const box = list.getBoundingClientRect();
  const y = Math.max(box.top, Math.min(lastY, box.bottom - 2));
  active.translate = y - base - 1;
  pointer.style.transform = 'translateY(' + active.translate + 'px)';

  active.boundary = boundaryAt(list, lastY);
  paintMarker(list, active.boundary);
}

// The first block whose midpoint is below the cursor, or the end of the list -
// the same rule the schedule page uses to place a complex between complexes.
function boundaryAt(list, clientY) {
  const blocks = Array.from(list.querySelectorAll('.complex'));
  for (let i = 0; i < blocks.length; i += 1) {
    const box = blocks[i].getBoundingClientRect();
    if (clientY < box.top + box.height / 2) return i;
  }
  return blocks.length;
}

function paintMarker(list, boundary) {
  clearMarker(list);
  const blocks = list.querySelectorAll('.complex');
  if (!blocks.length) return;
  if (boundary < blocks.length) blocks[boundary].classList.add('complex--drop-before');
  else blocks[blocks.length - 1].classList.add('complex--drop-after');
}

function clearMarker(list) {
  for (const node of list.querySelectorAll('.complex--drop-before, .complex--drop-after')) {
    node.classList.remove('complex--drop-before', 'complex--drop-after');
  }
}

function updateAutoScroll() {
  const box = active.list.getBoundingClientRect();
  if (active.lastY < box.top + AUTO_SCROLL_EDGE) active.step = -AUTO_SCROLL_STEP;
  else if (active.lastY > box.bottom - AUTO_SCROLL_EDGE) active.step = AUTO_SCROLL_STEP;
  else { stopAutoScroll(); return; }

  if (active.timer !== null) return;
  active.timer = setInterval(() => {
    if (!active || !active.list.isConnected) { stopAutoScroll(); return; }
    active.list.scrollTop += active.step;
    track();
  }, AUTO_SCROLL_TICK);
}

function stopAutoScroll() {
  if (!active || active.timer === null) return;
  clearInterval(active.timer);
  active.timer = null;
  active.step = 0;
}

function onUp(event) {
  if (!active) return;
  active.lastY = event.clientY;
  if (active.moved && active.pointer.isConnected) track();
  finish(active && active.moved);
}

function onCancel() { finish(false); }

// A capture lost to anything but our own release - the node replaced by a
// render, the window losing focus - abandons the gesture.
function onLost() { if (active) finish(false); }

function onKey(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  finish(false);
}

function finish(commit) {
  const gesture = active;
  if (!gesture) return;
  active = null;

  if (gesture.timer !== null) clearInterval(gesture.timer);
  const { handle, pointer, list } = gesture;
  handle.removeEventListener('pointermove', onMove);
  handle.removeEventListener('pointerup', onUp);
  handle.removeEventListener('pointercancel', onCancel);
  handle.removeEventListener('lostpointercapture', onLost);
  document.removeEventListener('keydown', onKey, true);
  if (handle.releasePointerCapture && gesture.pointerId !== undefined) {
    try { handle.releasePointerCapture(gesture.pointerId); } catch { /* not held */ }
  }

  clearMarker(list);
  pointer.classList.remove('date-pointer--dragging');
  pointer.style.transform = '';
  document.body.classList.remove('date-pointer-drag');

  // The commit re-renders, which replaces this pointer with one at the new
  // position - so it goes last, after every reference above is done with.
  if (commit && gesture.boundary !== null) gesture.onDrop(gesture.boundary);
}
