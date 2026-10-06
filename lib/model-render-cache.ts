/** Disposable render copies only. Keep at most the latest model, below 64 MiB.
 * Licensed originals remain in the separate model package database. */
interface RenderCache { key: string; copies: Array<[string, Blob]> }
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

async function cache<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("vivian-model-render-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("copies");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("copies", mode);
    const request = operation(tx.objectStore("copies"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Render cache unavailable.")); };
  });
}

export async function loadRenderCopies(key: string): Promise<Map<string, Blob> | undefined> {
  try {
    const saved = await cache<RenderCache | undefined>("readonly", (store) => store.get("latest"));
    if (saved?.key !== key) return undefined;
    for (const [, blob] of saved.copies) {
      // A lost Safari backing object must fall back to regenerating originals.
      if (!blob.size) return undefined;
      await blob.slice(0, 1).arrayBuffer();
    }
    return new Map(saved.copies);
  } catch { return undefined; }
}

export async function saveRenderCopies(key: string, copies: Map<string, Blob>): Promise<void> {
  if (!copies.size || [...copies.values()].reduce((bytes, blob) => bytes + blob.size, 0) > MAX_CACHE_BYTES) return;
  try { await cache("readwrite", (store) => store.put({ key, copies: [...copies] } satisfies RenderCache, "latest")); }
  catch { /* Quota or private browsing must never block rendering. */ }
}

export async function clearRenderCopies(): Promise<void> {
  try { await cache("readwrite", (store) => store.clear()); }
  catch { /* Optional disposable cache. */ }
}
