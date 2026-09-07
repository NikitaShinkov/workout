// The numbers behind every horizontal swipe in the app.
//
// Two pages read them: the workout page, where a swipe walks along a complex's
// exercises, and the exercise page, where it turns the animation into the sheet
// of every image and back. The gestures themselves are different - one walks an
// index, the other flips between two views - but they have to FEEL the same, so
// the travel, the resistance and the settle live in one place rather than being
// tuned twice.
//
// None of it came from a design file; it was chosen to read as "short, smooth
// and unobtrusive".

// How far a pointer has to travel before it counts as a swipe and not a tap.
export const SWIPE_MIN_PX = 40;

// At the ends there is nothing to bring in, so the track gives a little and no
// more: this fraction of the finger, up to this many pixels. The end is felt
// rather than hit.
export const EDGE_RESISTANCE = 0.28;
export const EDGE_MAX_PX = 56;

// The settle once the finger lifts. Sharper than the 1:1 tracking it takes
// over from - it starts fast and decelerates into place, so the gesture reads
// as completed rather than merely continued.
export const SETTLE_MS = 200;
export const SETTLE_EASING = 'cubic-bezier(0.2, 0.85, 0.3, 1)';

// The spring back from an end has nothing to complete, so it is a touch longer
// and gentler.
export const SPRING_MS = 260;
export const SPRING_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

// How far the track actually moves for a given travel of the finger: all of it
// while there is something to bring in, a damped fraction of it when there is
// not.
export function followed(travelled, hasNeighbour) {
  if (hasNeighbour) return travelled;
  return Math.sign(travelled) * Math.min(Math.abs(travelled) * EDGE_RESISTANCE, EDGE_MAX_PX);
}

// Which way a finished gesture went: -1 forward (swipe left, bring in what is
// to the right), 1 back, 0 not far enough to count.
export function swipeStep(travelled) {
  if (travelled <= -SWIPE_MIN_PX) return 1;
  if (travelled >= SWIPE_MIN_PX) return -1;
  return 0;
}

// Start the CSS transition that carries the track to `x`.
//
// The timer that follows it matters as much as the transition: jsdom runs no
// transitions, so `transitionend` never fires there and a gesture that waited
// for it would never commit at all. Every caller pairs glide() with a timeout
// of the same length, and it is the timeout that moves the state.
export function glide(track, x, ms, easing) {
  track.style.transition = 'transform ' + ms + 'ms ' + easing;
  track.style.transform = 'translateX(' + x + 'px)';
}
