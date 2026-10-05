"use client";

interface LoadedSceneImage {
  image: HTMLImageElement;
  ready: Promise<void>;
  decodedBytes: number;
}
const loadedImages = new Map<string, LoadedSceneImage>();
const DECODED_BUDGET_BYTES = 64 * 1024 * 1024;

function trimLoadedImages(current: string): void {
  let bytes = [...loadedImages.values()].reduce((total, entry) => total + entry.decodedBytes, 0);
  for (const [url, entry] of loadedImages) {
    if (bytes <= DECODED_BUDGET_BYTES && loadedImages.size <= 100) break;
    // Keep the most recently prepared image and any in-flight requests. Eviction
    // releases our decoded-image reference; the browser still owns its HTTP cache.
    if (url === current || !entry.decodedBytes) continue;
    loadedImages.delete(url);
    bytes -= entry.decodedBytes;
  }
}
export function preloadSceneImage(url: string, priority: "auto" | "low" = "auto"): Promise<void> {
  const previous = loadedImages.get(url);
  if (previous) {
    loadedImages.delete(url); loadedImages.set(url, previous);
    return previous.ready;
  }
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { image.src = ""; reject(new Error("Scene image did not load.")); }, 30_000);
    image.onload = () => {
      void image.decode().then(() => {
        window.clearTimeout(timer);
        entry.decodedBytes = image.naturalWidth * image.naturalHeight * 4;
        trimLoadedImages(url);
        resolve();
      }).catch(() => { window.clearTimeout(timer); reject(new Error("Scene image could not be decoded.")); });
    };
    image.onerror = () => { window.clearTimeout(timer); reject(new Error("Scene image is unavailable. Your current background was kept.")); };
    image.src = url;
  }).catch((error: unknown) => { loadedImages.delete(url); throw error; });
  const entry: LoadedSceneImage = { image, ready, decodedBytes: 0 };
  loadedImages.set(url, entry);
  return ready;
}
/** Warm full images in library order (active first), without blocking chat.
 * One background decode at a time avoids loading many large rasters together. */
export async function preloadSceneLibrary(urls: string[], signal: AbortSignal): Promise<void> {
  for (const url of new Set(urls)) {
    if (signal.aborted) return;
    await preloadSceneImage(url, "low").catch(() => { /* Selection can retry a failed image. */ });
  }
}
