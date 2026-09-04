// Persistence: one IndexedDB record holding the whole app state.
//
// Why not localStorage: images are kept as Blobs. localStorage only stores
// strings, so images would have to be base64 (+33% size) against a ~5MB quota -
// that overflows after a handful of exercises and throws QuotaExceededError.
// IndexedDB stores Blobs natively and has a far larger quota.

const DB_NAME = 'fitness_app';
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'current';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function loadState() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    // A blocked or unavailable IndexedDB must not stop the page from rendering.
    console.warn('Could not load saved data:', error);
    return null;
  }
}

export async function saveState(state) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
