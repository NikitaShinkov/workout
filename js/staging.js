// The «Обновить» button's write-ahead snapshot.
//
// A forced upload is several requests in a row (blobs -> tree -> commit -> ref),
// and no browser lets a chain like that outlive its tab: sendBeacon cannot send
// the Authorization header and `keepalive` covers one request, not a sequence.
// So before the button touches the network it puts the whole structure here,
// photos included - IndexedDB stores Blobs as they are, which localStorage
// cannot. If the tab is closed or reloaded before GitHub confirms, the next
// launch finds the snapshot, shows it, and finishes the upload (js/sync.js,
// loadFromRepo and forceSync). It is cleared only after a confirmed commit.
//
// Never a source of truth: it is read only to finish an upload that was
// interrupted, and it holds nothing the repo does not get.

const DB_NAME = 'workout-staging';
const STORE = 'pending';
const KEY = 'structure';

function idb() {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function open() {
  return new Promise((resolve, reject) => {
    const factory = idb();
    if (!factory) { reject(new Error('IndexedDB is not available')); return; }
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      let result;
      request.onsuccess = () => { result = request.result; };
      // Resolve on COMPLETE, not on the request's success: only then is the
      // write durable, which is the whole point of this file.
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('staging transaction aborted'));
    });
  } finally {
    db.close();
  }
}

const indexedDbBackend = {
  put: (value) => run('readwrite', (store) => store.put(value, KEY)),
  get: async () => (await run('readonly', (store) => store.get(KEY))) || null,
  clear: () => run('readwrite', (store) => store.delete(KEY)),
};

let backend = indexedDbBackend;

// The tests run in jsdom, which has no IndexedDB; they hand in a Map.
export function setStagingBackend(next) {
  backend = next || indexedDbBackend;
}

export function putStaged(snapshot) {
  return backend.put(snapshot);
}

// Reading is best effort: a browser with storage blocked simply has nothing
// staged, and must still open.
export async function getStaged() {
  try {
    return await backend.get();
  } catch {
    return null;
  }
}

export function clearStaged() {
  return backend.clear();
}
