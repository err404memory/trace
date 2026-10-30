// Keeps the last opened file on this device (IndexedDB) so it reopens without picking it again.

export interface SavedFile {
  name: string;
  text: string;
  openedAt: number;
  rows?: number;
}

const DB = 'trace';
const STORE = 'files';
const KEY = 'last';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLast(file: SavedFile): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private browsing or storage disabled: the app still works, it just won't remember.
  }
}

export async function loadLast(): Promise<SavedFile | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as SavedFile) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function forgetLast(): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
  } catch { /* nothing stored */ }
}

/** A file shared to Trace from another app, stashed by the service worker. */
export async function takeSharedFile(): Promise<{ name: string; text: string } | null> {
  if (!('caches' in window)) return null;
  const cache = await caches.open('trace-share');
  const res = await cache.match('shared-file');
  if (!res) return null;
  await cache.delete('shared-file');
  const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'shared-file');
  return { name, text: await res.text() };
}
