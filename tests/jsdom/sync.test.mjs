// The data-repo sync: reading, merging the log, buffering, flushing, and what
// happens when two devices write at once.
//
// This is where all the new risk lives, so `fetch` is replaced with a fake
// GitHub that records what was committed. Nothing here touches the network.

import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

import { PROJECT } from '../helpers/env.mjs';
const mod = (p) => import(pathToFileURL(PROJECT + '/js/' + p).href);

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Blob = dom.window.Blob;
// Node's own btoa and TextEncoder are left in place. jsdom's btoa rejects
// perfectly valid input here for reasons of its own, which looks exactly like
// an encoding bug in the app - it is not; a real browser encodes this fine.
global.URL.createObjectURL = (b) => 'blob:fake/' + (b && b.size);

let failures = 0;
const results = [];
function check(name, condition, detail) {
  if (condition) results.push('  PASS  ' + name);
  else {
    failures += 1;
    results.push('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}

const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

// ---------- a fake GitHub ----------

// The repo's files, the commits made against it, and a switch to make the next
// ref update fail the way a concurrent write does.
const repo = {
  files: {},
  commits: [],
  headSha: 'commit0',
  failNextRefUpdate: false,
  offline: false,
  requests: [],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

global.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  repo.requests.push(method + ' ' + String(url).replace(/^https:\/\/api\.github\.com/, ''));

  if (repo.offline) throw new TypeError('Failed to fetch');

  const path = String(url);

  if (method === 'GET' && path.includes('/contents/')) {
    const name = decodeURIComponent(path.split('/contents/')[1]);
    if (!(name in repo.files)) return jsonResponse('Not Found', 404);
    return jsonResponse(repo.files[name]);
  }
  if (method === 'GET' && path.includes('/git/ref/heads/')) {
    // A repository with no commits at all: there is no branch yet. The live
    // API answers 409 'Git Repository is empty' for this, not 404 - verified
    // against api.github.com, and it is what the very first write will meet.
    if (repo.headSha === null) return jsonResponse({ message: 'Git Repository is empty.' }, 409);
    return jsonResponse({ object: { sha: repo.headSha } });
  }
  if (method === 'GET' && path.includes('/git/commits/')) {
    return jsonResponse({ tree: { sha: 'tree-of-' + repo.headSha } });
  }
  // The Contents API is the only thing an empty repository accepts, and it
  // creates the initial commit and the branch.
  if (method === 'PUT' && path.includes('/contents/')) {
    const name = decodeURIComponent(path.split('/contents/')[1]);
    repo.files[name] = '<from contents api>';
    repo.headSha = 'commit-bootstrap';
    repo.bootstrapped = name;
    return jsonResponse({ commit: { sha: repo.headSha } });
  }
  // A repository with no commits refuses BOTH of these, not just the ref
  // lookup - which is what the real API does and what this fake used to get
  // wrong, so the suite passed while the app failed against live GitHub.
  if (method === 'POST' && (path.endsWith('/git/blobs') || path.endsWith('/git/trees'))) {
    if (repo.headSha === null) {
      return jsonResponse({ message: 'Git Repository is empty.' }, 409);
    }
  }
  if (method === 'POST' && path.endsWith('/git/blobs')) {
    const body = JSON.parse(options.body);
    return jsonResponse({ sha: 'blob-' + body.content.length });
  }
  if (method === 'POST' && path.endsWith('/git/trees')) {
    const body = JSON.parse(options.body);
    repo.commits.push({ tree: body.tree });
    return jsonResponse({ sha: 'tree1' });
  }
  if (method === 'POST' && path.endsWith('/git/commits')) {
    const body = JSON.parse(options.body);
    return jsonResponse({ sha: 'commit-' + (repo.commits.length + 1), message: body.message });
  }
  // PATCH moves an existing branch; POST creates one, which is what the very
  // first commit into an empty repository has to do.
  const movesRef = (method === 'PATCH' && path.includes('/git/refs/heads/'))
    || (method === 'POST' && path.endsWith('/git/refs'));
  if (movesRef) {
    if (repo.failNextRefUpdate) {
      repo.failNextRefUpdate = false;
      return jsonResponse({ message: 'not a fast forward' }, 422);
    }
    // Apply the last tree to the fake repo, so a re-read sees it.
    const last = repo.commits[repo.commits.length - 1];
    for (const entry of last.tree) {
      if (entry.content !== undefined) repo.files[entry.path] = entry.content;
      else repo.files[entry.path] = '<binary>';
    }
    repo.headSha = JSON.parse(options.body).sha;
    repo.refCreatedWith = method;
    return jsonResponse({});
  }

  return jsonResponse('unexpected ' + method + ' ' + path, 500);
};

const sync = await mod('sync.js');
const github = await mod('github.js');
const { STATE_PATH, LOG_PATH } = await mod('config.js');

// ---------- 1. applyOps, on its own ----------

const bareState = () => ({
  version: 2,
  categoryOrder: ['a'],
  categories: {
    a: {
      name: 'Голеностоп',
      exercises: [
        { id: 'ex_1', name: 'Первое', description: '', equipment: ['mat'], images: [] },
        { id: 'ex_2', name: 'Второе', description: '', equipment: ['mat'], images: [] },
      ],
      complexes: [{ id: 'cx_1', enabled: true, items: [{ id: 'ci_1', exerciseId: 'ex_1' }] }],
      scheduleEnabled: true,
      scheduleStartDate: '2026-09-03',
      intervalDays: 1,
    },
  },
  lastEquipment: ['mat'],
});

let s = sync.applyOps(bareState(), { ops: [] });
check('1: state.json carries no feedback, so the shape is restored on load',
  s.categories.a.exercises[0].feedback
    && Array.isArray(s.categories.a.exercises[0].feedback.technique),
  JSON.stringify(s.categories.a.exercises[0].feedback));

s = sync.applyOps(bareState(), {
  ops: [
    { id: 'o1', ts: 1, kind: 'favorite', exerciseId: 'ex_1', on: true },
    { id: 'o2', ts: 2, kind: 'duration', exerciseId: 'ex_1', sec: 300 },
    { id: 'o3', ts: 3, kind: 'rate', exerciseId: 'ex_1', axis: 'technique', date: '2026-09-05', level: 'easy' },
    { id: 'o4', ts: 4, kind: 'complex', complexId: 'cx_1', date: '2026-09-05', done: true },
  ],
});
check('1: THE LOG SUPPLIES favorite, duration, ratings AND completion',
  s.categories.a.exercises[0].favorite === true
    && s.categories.a.exercises[0].lastDurationSec === 300
    && s.categories.a.exercises[0].feedback.technique.length === 1
    && s.complexLog.cx_1['2026-09-05'] === true,
  JSON.stringify(s.complexLog));

// Last write wins, because ops are applied oldest first.
s = sync.applyOps(bareState(), {
  ops: [
    { id: 'o1', ts: 2, kind: 'favorite', exerciseId: 'ex_1', on: true },
    { id: 'o2', ts: 1, kind: 'favorite', exerciseId: 'ex_1', on: false },
  ],
});
check('1: LAST WRITE WINS whatever order the ops arrive in',
  s.categories.a.exercises[0].favorite === true, s.categories.a.exercises[0].favorite);

// The same op landing twice must not produce two entries - a write whose
// response was never seen may have succeeded anyway.
s = sync.applyOps(bareState(), {
  ops: [
    { id: 'same', ts: 1, kind: 'rate', exerciseId: 'ex_1', axis: 'strength', date: '2026-09-05', level: 'hard' },
    { id: 'same', ts: 1, kind: 'rate', exerciseId: 'ex_1', axis: 'strength', date: '2026-09-05', level: 'hard' },
  ],
});
check('1: A REPEATED OP IS IDEMPOTENT', s.categories.a.exercises[0].feedback.strength.length === 1,
  s.categories.a.exercises[0].feedback.strength.length);

// One rating per axis per day, so re-rating replaces rather than appends.
s = sync.applyOps(bareState(), {
  ops: [
    { id: 'r1', ts: 1, kind: 'rate', exerciseId: 'ex_1', axis: 'strength', date: '2026-09-05', level: 'hard' },
    { id: 'r2', ts: 2, kind: 'rate', exerciseId: 'ex_1', axis: 'strength', date: '2026-09-05', level: 'easy' },
    { id: 'r3', ts: 3, kind: 'rate', exerciseId: 'ex_1', axis: 'strength', date: '2026-09-06', level: 'none' },
  ],
});
check('1: RE-RATING THE SAME DAY REPLACES, a new day appends',
  s.categories.a.exercises[0].feedback.strength.length === 2
    && s.categories.a.exercises[0].feedback.strength[0].level === 'easy',
  JSON.stringify(s.categories.a.exercises[0].feedback.strength));
check('1: and the history stays chronological, as exercise-row expects',
  s.categories.a.exercises[0].feedback.strength.map((e) => e.date).join(',')
    === '2026-09-05,2026-09-06');

s = sync.applyOps(bareState(), {
  ops: [{ id: 'gone', ts: 1, kind: 'favorite', exerciseId: 'ex_deleted', on: true }],
});
check('1: an op for a deleted exercise is dropped, not a crash', Boolean(s));

// ---------- 2. serializeForRepo ----------

sync.resetSync();
const { out, files } = await sync.serializeForRepo({
  ...bareState(),
  ui: { activeCategory: 'a', showIndicators: true },
  categories: {
    a: {
      ...bareState().categories.a,
      exercises: [{
        id: 'ex_1', name: 'Первое', description: 'd', equipment: ['mat'],
        images: ['data/images/abc123.jpg'],
        favorite: true, lastDurationSec: 300,
        feedback: { technique: [{ date: '2026-09-05', level: 'easy' }], rangeOfMotion: [], strength: [] },
      }],
    },
  },
});

check('2: NO `ui` IN THE REPO - view preferences are per-device',
  out.ui === undefined, JSON.stringify(out.ui));
const written = out.categories.a.exercises[0];
check('2: NO LOG-OWNED FIELDS EITHER, or the two files would fight over them',
  written.favorite === undefined && written.lastDurationSec === undefined
    && written.feedback === undefined,
  JSON.stringify(written));
check('2: structure is kept', written.id === 'ex_1' && written.name === 'Первое'
  && written.equipment.join() === 'mat');
check('2: an image already in the repo stays a path and is not re-uploaded',
  written.images.join() === 'data/images/abc123.jpg' && files.length === 0,
  written.images.join() + ' / ' + files.length);

// A freshly picked image is a Blob, and has to become a content-addressed file.
const blob = new dom.window.Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' });
const picked = await sync.serializeForRepo({
  ...bareState(),
  categories: {
    a: {
      ...bareState().categories.a,
      exercises: [{ id: 'ex_1', name: 'x', description: '', equipment: [], images: [blob] }],
    },
  },
});
const path = picked.out.categories.a.exercises[0].images[0];
check('2: A PICKED BLOB BECOMES A CONTENT-ADDRESSED PATH',
  /^data\/images\/[0-9a-f]{16}\.jpg$/.test(path), path);
check('2: and its bytes are queued for the same commit',
  picked.files.length === 1 && picked.files[0].path === path && picked.files[0].bytes.length === 5,
  JSON.stringify(picked.files.map((f) => f.path)));

// ---------- 3. loading ----------

sync.resetSync();
repo.files = {};
let loaded = await sync.loadFromRepo();
check('3: an empty data repo means a fresh install, not an error', loaded === null, loaded);

repo.files[STATE_PATH] = JSON.stringify(bareState());
repo.files[LOG_PATH] = JSON.stringify({
  version: 1,
  ops: [{ id: 'o1', ts: 1, kind: 'favorite', exerciseId: 'ex_2', on: true }],
});

sync.resetSync();
loaded = await sync.loadFromRepo();
check('3: THE STRUCTURE AND THE LOG ARE MERGED ON LOAD',
  loaded.categories.a.exercises[1].favorite === true,
  loaded && loaded.categories.a.exercises[1].favorite);
check('3: the JSON is read fresh, not from the CDN cache',
  repo.requests.some((r) => r.includes('/contents/' + STATE_PATH)));

// Offline: the cache written by the successful load above is what saves it.
repo.offline = true;
sync.resetSync();
const cached = await sync.loadFromRepo();
repo.offline = false;
check('3: WITH NO SIGNAL IT STILL OPENS, from the local copy',
  cached && cached.categories.a.exercises.length === 2,
  cached && cached.categories.a.exercises.length);
check('3: and it says so rather than failing silently',
  warnings.some((w) => /local copy/.test(w)), warnings.join(' | '));

// ---------- 4. buffering and flushing ----------

sync.resetSync();
github.setToken('test-token');
repo.files[LOG_PATH] = JSON.stringify({ version: 1, ops: [] });

const op = sync.recordOp({ kind: 'favorite', exerciseId: 'ex_1', on: true });
check('4: an op is buffered SYNCHRONOUSLY, before any network work',
  JSON.parse(localStorage.getItem('workout.ops')).length === 1,
  localStorage.getItem('workout.ops'));
check('4: and it is given an id and a timestamp',
  Boolean(op.id) && typeof op.ts === 'number', JSON.stringify(op));

await sync.flush();
check('4: FLUSHING COMMITS THE LOG',
  JSON.parse(repo.files[LOG_PATH]).ops.length === 1,
  repo.files[LOG_PATH]);
check('4: and the buffer is emptied only after that succeeded',
  JSON.parse(localStorage.getItem('workout.ops')).length === 0,
  localStorage.getItem('workout.ops'));

// ---------- 5. a concurrent write ----------

sync.recordOp({ kind: 'duration', exerciseId: 'ex_1', sec: 240 });
// The other device gets there first, so our ref update is refused.
repo.failNextRefUpdate = true;
await sync.flush();

check('5: A REFUSED WRITE IS RETRIED, not dropped',
  JSON.parse(localStorage.getItem('workout.ops')).length === 0,
  localStorage.getItem('workout.ops'));
const logNow = JSON.parse(repo.files[LOG_PATH]);
check('5: and the earlier op is still there - nothing was overwritten',
  logNow.ops.some((o) => o.kind === 'favorite') && logNow.ops.some((o) => o.kind === 'duration'),
  JSON.stringify(logNow.ops.map((o) => o.kind)));

// ---------- 6. no token: the buffer waits ----------

github.setToken(null);
sync.recordOp({ kind: 'favorite', exerciseId: 'ex_2', on: false });
await sync.flush();
check('6: WITHOUT A TOKEN NOTHING IS SENT and the op is kept for later',
  JSON.parse(localStorage.getItem('workout.ops')).length === 1,
  localStorage.getItem('workout.ops'));

github.setToken('test-token');
await sync.flush();
check('6: and it goes up once a token is there',
  JSON.parse(localStorage.getItem('workout.ops')).length === 0);

// ---------- 7. the structural write only happens on a real change ----------

sync.resetSync();
github.setToken('test-token');
repo.files[STATE_PATH] = JSON.stringify(bareState());
repo.files[LOG_PATH] = JSON.stringify({ version: 1, ops: [] });

const live = await sync.loadFromRepo();
const commitsBefore = repo.commits.length;

// A view toggle, and the pruning migrate() does on load, must not commit.
live.ui = { activeCategory: 'a', showIndicators: true };
sync.noteState(live);
await sync.flush();
check('7: A VIEW-ONLY CHANGE COMMITS NOTHING',
  repo.commits.length === commitsBefore, repo.commits.length - commitsBefore);

live.categories.a.exercises.push({
  id: 'ex_3', name: 'Третье', description: '', equipment: ['mat'], images: [],
});
sync.noteState(live);
await sync.flush();
check('7: but a real structural change does',
  repo.commits.length === commitsBefore + 1, repo.commits.length - commitsBefore);
check('7: and what landed is the new exercise',
  JSON.parse(repo.files[STATE_PATH]).categories.a.exercises.length === 3,
  JSON.parse(repo.files[STATE_PATH]).categories.a.exercises.length);

// ---------- 7b. the very first write, into an empty repository ----------
//
// This is the case that failed against live GitHub while this suite was green,
// because the fake used to allow blobs and trees on an empty repo. It does not
// any more: /git/blobs and /git/trees both 409 there, so the Git Data API
// cannot build the first commit at all and the Contents API has to go first.

sync.resetSync();
github.setToken('test-token');
repo.files = {};
repo.headSha = null;
repo.commits = [];
repo.bootstrapped = null;

sync.recordOp({ kind: 'favorite', exerciseId: 'ex_1', on: true });
await sync.flush();

check('7b: AN EMPTY REPO IS BOOTSTRAPPED THROUGH THE CONTENTS API first',
  repo.bootstrapped === 'README.md', repo.bootstrapped);
check('7b: AND THE WRITE THEN SUCCEEDS - this is what failed for real',
  Boolean(repo.files[LOG_PATH]), Object.keys(repo.files).join(','));
check('7b: and the buffer is empty, so nothing was left stranded',
  JSON.parse(localStorage.getItem('workout.ops')).length === 0,
  localStorage.getItem('workout.ops'));
check('7b: the repo now has a branch, so later writes take the normal path',
  repo.headSha !== null, repo.headSha);

// A second write must NOT bootstrap again.
repo.bootstrapped = null;
sync.recordOp({ kind: 'duration', exerciseId: 'ex_1', sec: 180 });
await sync.flush();
check('7b: A LATER WRITE DOES NOT BOOTSTRAP AGAIN',
  repo.bootstrapped === null && JSON.parse(repo.files[LOG_PATH]).ops.length === 2,
  repo.bootstrapped + ' / ' + JSON.parse(repo.files[LOG_PATH]).ops.length);

// ---------- 7c. showing an image that lives in the data repo ----------
//
// The paths in state.json are relative to the DATA repo, and the data repo is
// not the site - so a relative src would resolve against the page and 404.
// This was live and broken for one commit: rawUrl() existed and nothing called
// it, and the bug is invisible until a reload, because a freshly picked image
// is still a Blob and shows from an object URL.

const { blobUrl } = await mod('images.js');
const shown = blobUrl('data/images/3bc785bb263c1542.jpg');

check('7c: A STORED IMAGE PATH RESOLVES TO THE DATA REPO, not the page',
  shown === 'https://raw.githubusercontent.com/NikitaShinkov/workout-data/main/'
    + 'data/images/3bc785bb263c1542.jpg', shown);
check('7c: it is absolute, so it cannot resolve against the site root',
  shown.startsWith('https://'), shown);
check('7c: something already a URL is left alone',
  blobUrl('https://example.com/x.jpg') === 'https://example.com/x.jpg');
check('7c: and a Blob still becomes an object URL',
  blobUrl(new dom.window.Blob(['x'])).startsWith('blob:'),
  blobUrl(new dom.window.Blob(['x'])));

// ---------- 8. the token in the bookmark ----------

localStorage.removeItem('workout.token');
dom.window.history.replaceState(null, '', '/#workout&k=github_pat_SECRET');
const found = sync.initToken();

check('8: THE TOKEN IS READ OUT OF THE BOOKMARK FRAGMENT', found === true, found);
check('8: and kept, so a reload still works',
  localStorage.getItem('workout.token') === 'github_pat_SECRET',
  localStorage.getItem('workout.token'));
check('8: IT IS STRIPPED FROM THE URL so a screenshot cannot leak it',
  !dom.window.location.href.includes('SECRET'), dom.window.location.href);
check('8: AND THE PAGE SURVIVES - the fragment still names the workout page',
  dom.window.location.hash === '#workout', dom.window.location.hash);

dom.window.history.replaceState(null, '', '/#calendar');
check('8: with no token in the URL the stored one is used',
  sync.initToken() === true && dom.window.location.hash === '#calendar',
  dom.window.location.hash);

sync.forgetToken();
check('8: and it can be forgotten', localStorage.getItem('workout.token') === null);

// ---------- report ----------

console.log(results.join('\n'));
console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
