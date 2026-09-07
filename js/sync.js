// Keeping the app and the data repository in step.
//
// The repo is the single source of truth. Every launch reads it; the local copy
// is only a cache, so the two devices can never drift apart. Nothing is written
// on a timer tied to the tab closing - browsers do not reliably run code then,
// least of all mobile Safari, and an unload handler cannot await a network call
// anyway. Instead:
//
//   - every mutation appends to a buffer in localStorage, synchronously
//   - the buffer is flushed after a few seconds of quiet
//   - it is flushed again when the page is hidden, as an early bird
//   - anything still buffered at the next launch is flushed before loading
//
// So the close event stops mattering: the worst case is that the write happens
// a moment later than it might have, not that it is lost.
//
// Two files, because they have different authors and different shapes:
//
//   state.json  structure - categories, exercises, complexes, the schedule.
//               Written from the schedule page. A whole-file snapshot, because
//               reorders and drags do not commute and there is one author.
//   log.json    what a workout produced - times, ratings, favourites, whether
//               a complex was finished. An append-only list of idempotent ops,
//               because the phone writes these and a snapshot would discard
//               whatever the computer had written in the meantime.

import { STATE_PATH, LOG_PATH, IMAGE_DIR } from './config.js';
import { readJson, commitFiles, setToken, hasToken } from './github.js';
import { hashImage, blobBytes } from './images.js';
import { uid } from './model.js';

const TOKEN_KEY = 'workout.token';
const CACHE_KEY = 'workout.cache';
const BUFFER_KEY = 'workout.ops';

// Short, because a write here does NOT rebuild the Pages site - the data lives
// in its own repo precisely so that saving can be cheap and frequent.
const FLUSH_IDLE_MS = 4000;

const EMPTY_LOG = { version: 1, ops: [] };

// --- the token ---------------------------------------------------------------

// It arrives in the bookmark's fragment (`#workout&k=…`), which is never sent
// to any server, and is then taken straight out of the address bar so a
// screenshot or a shared link cannot leak it. The home-screen bookmark still
// carries it, so this heals itself if the browser ever clears storage.
//
// MUST run before mountApp: pageFromHash() reads the whole fragment as a page
// name, so `#workout&k=…` matches nothing and goToPage would overwrite it.
export function initToken() {
  const raw = String(window.location.hash || '').replace(/^#/, '');
  const parts = raw.split('&');
  const page = parts.shift();

  let token = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === 'k') token = decodeURIComponent(part.slice(eq + 1));
  }

  if (token) {
    local(() => localStorage.setItem(TOKEN_KEY, token));
    const clean = window.location.pathname + window.location.search + (page ? '#' + page : '');
    window.history.replaceState(null, '', clean);
  } else {
    token = local(() => localStorage.getItem(TOKEN_KEY)) || null;
  }

  setToken(token);
  return Boolean(token);
}

export function forgetToken() {
  local(() => localStorage.removeItem(TOKEN_KEY));
  setToken(null);
}

export { hasToken };

// Safari in private mode throws on localStorage rather than returning null, and
// a storage failure must never stop the app rendering.
function local(run) {
  try {
    return run();
  } catch {
    return null;
  }
}

// --- reading -----------------------------------------------------------------

// Paths already in the repo, so an image is never uploaded twice.
const committedImages = new Set();
// Blob -> content hash. Hashing is the only slow part, so it is remembered.
const hashes = new WeakMap();

// The serialization of the state as it was loaded. A write only happens when
// the state genuinely differs from this - which is also what stops a device
// writing back the pruning that migrate() does on every load.
let baseline = null;

// `?offline=1` skips the network entirely, which is how the browser suites
// drive the real index.html for layout and routing without depending on a
// repository, a token, or a connection.
function offline() {
  return new URLSearchParams(window.location.search).has('offline');
}

export async function loadFromRepo() {
  let fetched = null;
  if (offline()) return null;

  try {
    const [state, log] = await Promise.all([
      readJson(STATE_PATH, null),
      readJson(LOG_PATH, EMPTY_LOG),
    ]);
    // No state.json at all is not a failure - it is a data repo nobody has
    // written to yet, which means a fresh install.
    if (state) fetched = { state, log: log || EMPTY_LOG };
    else return null;

    local(() => localStorage.setItem(CACHE_KEY, JSON.stringify(fetched)));
  } catch (error) {
    // Offline, or the repo is unreachable. The cache exists for exactly this:
    // a gym with no signal is the moment the workout page matters most.
    console.warn('Could not read the data repo; using the local copy:', error);
    const cached = local(() => localStorage.getItem(CACHE_KEY));
    if (!cached) return null;
    try {
      fetched = JSON.parse(cached);
    } catch {
      return null;
    }
  }

  for (const path of imagePaths(fetched.state)) committedImages.add(path);

  const merged = applyOps(fetched.state, fetched.log);
  // Ops still waiting to go up belong on screen too, or the user would watch
  // their own ratings disappear until the next flush landed.
  applyOps(merged, { ops: bufferRead() });

  baseline = serializeText(merged);
  return merged;
}

function imagePaths(state) {
  const paths = [];
  for (const id of state.categoryOrder || []) {
    for (const exercise of (state.categories[id] || {}).exercises || []) {
      for (const image of exercise.images || []) {
        if (typeof image === 'string') paths.push(image);
      }
    }
  }
  return paths;
}

// --- merging the log over the structure --------------------------------------

const AXES = ['technique', 'rangeOfMotion', 'strength'];

function indexExercises(state) {
  const byId = new Map();
  for (const id of state.categoryOrder || []) {
    for (const exercise of (state.categories[id] || {}).exercises || []) {
      // state.json carries no feedback - the log owns it - so the shape the
      // rest of the app expects has to be put back.
      if (!exercise.feedback) exercise.feedback = {};
      for (const axis of AXES) {
        if (!Array.isArray(exercise.feedback[axis])) exercise.feedback[axis] = [];
      }
      byId.set(exercise.id, exercise);
    }
  }
  return byId;
}

// Applied oldest first, so a later op simply overwrites an earlier one and
// "last write wins" needs no bookkeeping. Ids are deduplicated because a write
// whose response was never seen may have landed anyway.
export function applyOps(state, log) {
  const ops = ((log && log.ops) || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const byId = indexExercises(state);
  const seen = new Set();

  if (!state.complexLog) state.complexLog = {};

  for (const op of ops) {
    if (!op || !op.id || seen.has(op.id)) continue;
    seen.add(op.id);

    if (op.kind === 'complex') {
      if (!state.complexLog[op.complexId]) state.complexLog[op.complexId] = {};
      state.complexLog[op.complexId][op.date] = Boolean(op.done);
      continue;
    }

    const exercise = byId.get(op.exerciseId);
    // The exercise has been deleted since; the op has nothing to say now.
    if (!exercise) continue;

    if (op.kind === 'favorite') exercise.favorite = Boolean(op.on);
    else if (op.kind === 'duration') exercise.lastDurationSec = op.sec;
    else if (op.kind === 'rate') upsertRating(exercise, op);
  }

  return state;
}

// One rating per exercise, per axis, per day - so replaying an op is a no-op
// rather than a second entry. That is what makes the whole log idempotent.
function upsertRating(exercise, op) {
  const history = exercise.feedback[op.axis];
  if (!Array.isArray(history)) return;

  const at = history.findIndex((entry) => entry.date === op.date);
  const entry = { date: op.date, level: op.level };
  if (at === -1) history.push(entry);
  else history[at] = entry;

  // Chronological, because exercise-row.js shows the last five.
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// --- writing the structure ---------------------------------------------------

// state.json holds structure only. `favorite`, `lastDurationSec` and `feedback`
// are the log's, or the two files would both claim them and fight; `ui` is a
// per-device view preference and syncing activeCategory across devices would be
// actively wrong.
export async function serializeForRepo(state) {
  const files = [];
  const out = {
    version: state.version,
    categoryOrder: (state.categoryOrder || []).slice(),
    categories: {},
    lastEquipment: (state.lastEquipment || []).slice(),
  };

  for (const id of out.categoryOrder) {
    const category = state.categories[id];
    if (!category) continue;

    const exercises = [];
    for (const exercise of category.exercises || []) {
      const images = [];
      for (const image of exercise.images || []) {
        if (typeof image === 'string') {
          images.push(image);
          continue;
        }
        // Just picked and not in the repo yet: name it by its own bytes, so it
        // is immutable, cacheable for ever, and identical images collapse.
        let hash = hashes.get(image);
        if (!hash) {
          hash = await hashImage(image);
          hashes.set(image, hash);
        }
        const path = IMAGE_DIR + '/' + hash + '.jpg';
        if (!committedImages.has(path) && !files.some((f) => f.path === path)) {
          files.push({ path, bytes: await blobBytes(image) });
        }
        images.push(path);
      }

      exercises.push({
        id: exercise.id,
        name: exercise.name,
        description: exercise.description,
        equipment: (exercise.equipment || []).slice(),
        images,
      });
    }

    out.categories[id] = {
      name: category.name,
      exercises,
      complexes: category.complexes || [],
      scheduleEnabled: category.scheduleEnabled !== false,
      scheduleStartDate: category.scheduleStartDate,
      intervalDays: category.intervalDays,
    };
  }

  return { out, files };
}

// The comparison baseline, which must not depend on images that are still
// Blobs - so it is taken from paths only and never hashes anything.
function serializeText(state) {
  const out = {
    version: state.version,
    categoryOrder: (state.categoryOrder || []).slice(),
    categories: {},
    lastEquipment: (state.lastEquipment || []).slice(),
  };

  for (const id of out.categoryOrder) {
    const category = state.categories[id];
    if (!category) continue;
    out.categories[id] = {
      name: category.name,
      exercises: (category.exercises || []).map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        description: exercise.description,
        equipment: (exercise.equipment || []).slice(),
        images: (exercise.images || []).map((image) => (typeof image === 'string' ? image : '?')),
      })),
      complexes: category.complexes || [],
      scheduleEnabled: category.scheduleEnabled !== false,
      scheduleStartDate: category.scheduleStartDate,
      intervalDays: category.intervalDays,
    };
  }

  return JSON.stringify(out);
}

// --- the op buffer -----------------------------------------------------------

function bufferRead() {
  const raw = local(() => localStorage.getItem(BUFFER_KEY));
  if (!raw) return [];
  try {
    const ops = JSON.parse(raw);
    return Array.isArray(ops) ? ops : [];
  } catch {
    return [];
  }
}

function bufferWrite(ops) {
  local(() => localStorage.setItem(BUFFER_KEY, JSON.stringify(ops)));
}

// Synchronous, and before any network work: a hard kill a millisecond later
// must not lose the entry.
export function recordOp(op) {
  const full = { id: uid('op'), ts: Date.now(), ...op };
  bufferWrite([...bufferRead(), full]);
  schedule();
  return full;
}

// --- flushing ----------------------------------------------------------------

let idleTimer = null;
let running = false;
let latestState = null;

export function noteState(state) {
  latestState = state;
  schedule();
}

function schedule() {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idleTimer = null; flush(); }, FLUSH_IDLE_MS);
}

export async function flush() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  // Without a token this is a read-only session; the buffer simply waits.
  if (!hasToken() || running) return;

  running = true;
  try {
    await flushOps();
    await flushStructure();
  } catch (error) {
    // Left buffered on purpose: the next idle, the next hide, or the next
    // launch will try again.
    console.warn('Could not sync to the data repo; will retry:', error);
  } finally {
    running = false;
  }
}

async function flushOps() {
  const pending = bufferRead();
  if (!pending.length) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const log = (await readJson(LOG_PATH, EMPTY_LOG)) || EMPTY_LOG;
    const existing = Array.isArray(log.ops) ? log.ops : [];
    const have = new Set(existing.map((op) => op.id));
    const merged = {
      version: 1,
      ops: compact([...existing, ...pending.filter((op) => !have.has(op.id))]),
    };

    try {
      await commitFiles(
        [{ path: LOG_PATH, text: JSON.stringify(merged, null, 2) }],
        'Record workout results'
      );
      // Only what was actually sent is dropped - anything recorded while this
      // was in flight stays for the next round.
      const sent = new Set(pending.map((op) => op.id));
      bufferWrite(bufferRead().filter((op) => !sent.has(op.id)));
      return;
    } catch (error) {
      // The branch moved under us. Re-read and merge again rather than
      // overwriting whatever the other device just wrote.
      if (!error.conflict) throw error;
    }
  }

  throw new Error('The log could not be written after three attempts.');
}

// A favourite or a duration only has a current value, so older ops for the same
// exercise say nothing and are dropped. Ratings are keyed by day and kept.
function compact(ops) {
  const sorted = ops.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const supersedes = new Map();
  const keep = [];

  for (const op of sorted) {
    if (op.kind === 'favorite' || op.kind === 'duration') {
      supersedes.set(op.kind + ':' + op.exerciseId, op);
    } else {
      keep.push(op);
    }
  }

  return [...keep, ...supersedes.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

async function flushStructure() {
  if (!latestState) return;

  // Nothing structural has changed - a view toggle, or the pruning migrate()
  // does on load. Neither is worth a commit, and the second must never be
  // written back from a device that only came here to read.
  if (serializeText(latestState) === baseline) return;

  const { out, files } = await serializeForRepo(latestState);
  const text = JSON.stringify(out, null, 2);

  files.push({ path: STATE_PATH, text });
  await commitFiles(files, 'Update schedule');

  for (const file of files) {
    if (file.bytes) committedImages.add(file.path);
  }
  baseline = serializeText(latestState);
}

// --- lifecycle ---------------------------------------------------------------

// visibilitychange is the last moment a browser reliably gives us; pagehide is
// a bonus that mobile Safari often skips entirely.
export function watchForHide() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', () => { flush(); });
}

// Exposed so the tests can start from a known place.
export function resetSync() {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  running = false;
  latestState = null;
  baseline = null;
  committedImages.clear();
  bufferWrite([]);
}
