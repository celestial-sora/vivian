/** Disposable render packages, independently bounded from licensed originals. */
interface RenderCache { key: string; copies: Array<[string, Blob]>; bytes: number; touched: number }
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 4;
let writes: Promise<unknown> = Promise.resolve();

async function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vivian-model-render-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("copies");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readCache(key: string): Promise<RenderCache | undefined> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("copies", "readonly");
    const request = tx.objectStore("copies").get(key);
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function mutateCache(operation: (store: IDBObjectStore) => void): Promise<void> {
  const work = writes.then(async () => {
    const db = await openCache();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("copies", "readwrite");
      operation(tx.objectStore("copies"));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }).catch(() => { /* Quota/private mode must never prevent rendering. */ });
  writes = work;
  return work;
}
export async function loadRenderCopies(key: string): Promise<Map<string, Blob> | undefined> {
  try {
    await writes;
    const saved = await readCache(key);
    if (saved?.key !== key) return;
    for (const [, blob] of saved.copies) {
      if (!blob.size) return;
      await blob.slice(0, 1).arrayBuffer();
    }
    void mutateCache((store) => {
      // Touch only if still present; never resurrect an invalidated entry.
      const request = store.get(key);
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, touched: Date.now() }, key); };
    });
    return new Map(saved.copies);
  } catch { return undefined; }
}
export function saveRenderCopies(key: string, copies: Map<string, Blob>): Promise<void> {
  const bytes = [...copies.values()].reduce((sum, blob) => sum + blob.size, 0);
  if (!copies.size || bytes > MAX_CACHE_BYTES) return Promise.resolve();
  // Snapshot the map now: runtime URL cleanup may clear it before the IDB write.
  const entry: RenderCache = { key, copies: [...copies], bytes, touched: Date.now() };
  return mutateCache((store) => {
    store.put(entry, key);
    store.delete("latest"); // Retire the old single-entry format.
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = (request.result as RenderCache[]).sort((a, b) => a.touched - b.touched);
      let total = entries.reduce((sum, item) => sum + item.bytes, 0), count = entries.length;
      for (const item of entries) {
        if (total <= MAX_CACHE_BYTES && count <= MAX_ENTRIES) break;
        if (item.key === key) continue;
        store.delete(item.key); total -= item.bytes; count--;
      }
    };
  });
}
export function clearRenderCopies(): Promise<void> { return mutateCache((store) => { store.clear(); }); }
