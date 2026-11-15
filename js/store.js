// Tiny IndexedDB key/value store so datasets survive page reloads.
// Everything stays on the user's device — nothing is uploaded anywhere.

const DB_NAME = 'map-data-overlay';
const STORE = 'kv';
let dbPromise = null;
let db = null; // the open database, once ready, so writes can start without waiting

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function get(key) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/**
 * Save a value. Resolves to true if it was written, false if not (for example
 * when storage is full or unavailable).
 *
 * When the database is already open the write starts immediately, in the same
 * task, and is committed straight away. That matters when the page is being
 * closed or reloaded: a write that only starts later would be abandoned.
 */
export function set(key, value) {
  if (db) return write(db, key, value);
  return open().then((d) => write(d, key, value), () => false);
}

function write(database, key, value) {
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false); // e.g. storage full
      tx.commit?.();
    } catch {
      resolve(false);
    }
  });
}

/** Ask the browser not to clear our data when space runs low. Returns true if it agreed. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * How much this site is using and is allowed to use, as reported by the browser.
 * Returns { usage, quota, tiles, data } in bytes (tiles/data are null when the
 * browser doesn't break the total down), or null if the browser can't say.
 */
export async function usage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const d = e.usageDetails || null; // Chrome / Edge only
    return {
      usage: e.usage || 0,
      quota: e.quota || 0,
      tiles: d ? d.caches || 0 : null,
      data: d ? d.indexedDB || 0 : null,
    };
  } catch {
    return null;
  }
}

export async function isPersisted() {
  try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
}
