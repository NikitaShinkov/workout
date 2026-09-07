// Reusable image-sequence animation.
//
// Kept standalone and DOM-agnostic beyond the container it is handed, because
// the workout page will reuse it to play an exercise's images back.
//
//   const anim = createSequenceAnimation(node, { intervalMs: 400 });
//   anim.setFrames([url1, url2, url3]);   // applies immediately, from frame 1
//   anim.stop(); anim.start(); anim.destroy();

export const DEFAULT_FRAME_MS = 400;

export function createSequenceAnimation(container, options) {
  const { intervalMs = DEFAULT_FRAME_MS } = options || {};

  const img = document.createElement('img');
  img.alt = '';
  img.className = 'seq-anim__img';
  // An <img> is natively draggable, and starting that drag CANCELS the pointer
  // that began it - which killed the workout page's swipe outright, and on an
  // exercise row hijacked the row's own drag. Nothing ever drags the frame
  // itself, so it opts out.
  img.draggable = false;
  container.appendChild(img);

  let frames = [];
  let index = 0;
  let timer = null;
  let period = intervalMs;

  function show() {
    if (frames.length) img.src = frames[index % frames.length];
    else img.removeAttribute('src');
  }

  function start() {
    stop();
    // A single frame is a still image - no timer needed.
    if (frames.length > 1) {
      timer = setInterval(() => {
        index = (index + 1) % frames.length;
        show();
      }, period);
    }
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    // Replacing frames takes effect at once: reordering thumbnails must show up
    // in the animation without waiting for the next tick.
    //
    // `startAt` is how a sequence survives a re-render. The workout page throws
    // its rows away and builds them again on every render, and restarting every
    // exercise from frame one made the whole page flinch; it hands back the
    // frame each exercise had reached instead.
    setFrames(next, startAt = 0) {
      frames = Array.from(next || []);
      index = frames.length ? ((startAt % frames.length) + frames.length) % frames.length : 0;
      show();
      start();
    },
    setFrameInterval(ms) {
      period = ms;
      if (timer !== null) start();
    },
    // stop() and start() are also pause and resume: stop clears the timer and
    // leaves the frame where it is, and start picks up from that frame rather
    // than rewinding. The workout page's swipe holds the picture still that way.
    start,
    stop,
    destroy() {
      stop();
      img.remove();
    },
    // Which frame is on screen, so a caller can put it back after a re-render.
    get index() { return index; },
    get element() { return img; },
  };
}
