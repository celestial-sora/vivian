"use client";
import { authFetch } from "@/lib/auth/fetch";
import { importModelFiles, inspectPackage, type ModelPackage } from "@/lib/local-models";
import { MODEL_MAX_BYTES, MODEL_PART_BYTES, type CloudModel, type StorageUsage } from "@/lib/cloud-storage";
import { notifyStorageChanged } from "@/lib/storage-status";

export interface CloudLibrary { userId: string; models: CloudModel[]; usage: StorageUsage }
async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(path, { ...options, cache: "no-store", signal: options?.signal ?? AbortSignal.timeout(35_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Cloud storage is unavailable.");
  return body as T;
}
export const getCloudModels = (signal?: AbortSignal): Promise<CloudLibrary> => json("/api/models", { signal });
export function cloudModelPlaceholder(model: CloudModel): ModelPackage {
  return { id: model.id, assets: [], models: model.manifests.map((entry) => ({ id: `${model.id}:${entry.path}`, name: entry.name, manifestPath: entry.path, expressions: [], poses: [], motions: [] })) };
}
export async function modelArchive(pack: ModelPackage, originalZip?: File): Promise<Blob> {
  if (originalZip) {
    if (originalZip.size > MODEL_MAX_BYTES) throw new Error("Model ZIP exceeds 512 MiB.");
    return originalZip;
  }
  // Store each file incrementally; avoid collecting a second full-package map.
  const { Zip, ZipPassThrough } = await import("fflate");
  const chunks: BlobPart[] = []; let bytes = 0; let archiveError: Error | undefined;
  let finished!: () => void, failed!: (error: Error) => void;
  const complete = new Promise<void>((resolve, reject) => { finished = resolve; failed = reject; });
  const zip = new Zip((error, data, final) => {
    if (error) { archiveError = error; return; }
    bytes += data.byteLength;
    if (bytes > MODEL_MAX_BYTES) { archiveError = new Error("Model ZIP exceeds 512 MiB including archive headers."); return; }
    chunks.push(new Uint8Array(data));
    if (final) finished();
  });
  try {
    for (const asset of pack.assets) {
      const file = new ZipPassThrough(asset.path); zip.add(file);
      if (!asset.blob.size) file.push(new Uint8Array(), true);
      for (let offset = 0; offset < asset.blob.size; offset += 4 * 1024 * 1024) {
        file.push(new Uint8Array(await asset.blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()), offset + 4 * 1024 * 1024 >= asset.blob.size);
        if (archiveError) throw archiveError;
      }
    }
    zip.end();
    if (archiveError) throw archiveError;
  } catch (error) { zip.terminate(); failed(error instanceof Error ? error : new Error("Could not prepare model ZIP.")); }
  await complete;
  return new Blob(chunks, { type: "application/zip" });
}
export async function uploadCloudModel(pack: ModelPackage, progress: (message: string) => void, originalZip?: File, signal?: AbortSignal): Promise<{ pack: ModelPackage; usage: StorageUsage }> {
  progress("Preparing model for private cloud storage…");
  const archive = await modelArchive(pack, originalZip);
  signal?.throwIfAborted();
  const started = await json<{ id: string; userId: string }>("/api/models", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ byteSize: archive.size, manifests: pack.models.map((model) => ({ path: model.manifestPath, name: model.name })) }) });
  notifyStorageChanged();
  let completing = false;
  try {
    const total = Math.ceil(archive.size / MODEL_PART_BYTES);
    for (let first = 1; first <= total; first += 8) {
      const { parts } = await json<{ parts: Array<{ part: number; size: number; url: string }> }>(`/api/models/${started.id}/parts?first=${first}`, { method: "POST", signal });
      for (const part of parts) {
        const response = await fetch(part.url, { method: "PUT", body: archive.slice((part.part - 1) * MODEL_PART_BYTES, (part.part - 1) * MODEL_PART_BYTES + part.size), credentials: "omit", referrerPolicy: "no-referrer", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error("Model upload failed. Please try again.");
        progress(`Saving model to cloud… ${Math.round(part.part / total * 100)}%`);
      }
    }
    completing = true;
    const finished = await json<{ usage: StorageUsage }>(`/api/models/${started.id}`, { method: "POST", signal });
    notifyStorageChanged();
    const stored = await inspectPackage(pack.assets, started.id);
    return { pack: { ...stored, cloudOwner: started.userId }, usage: finished.usage };
  } catch (error) {
    // Completion may have committed despite a lost response: never delete a
    // possibly successful model. Pending sessions are cleaned on refresh.
    if (!completing) await json(`/api/models/${started.id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}
export async function downloadCloudModel(model: CloudModel, userId: string, signal?: AbortSignal): Promise<ModelPackage> {
  const { url, byteSize } = await json<{ url: string; byteSize: number }>(`/api/models/${model.id}`, { signal });
  if (byteSize < 1 || byteSize > MODEL_MAX_BYTES) throw new Error("Invalid model size.");
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000), cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Could not download this model.");
  const reader = response.body.getReader(); const chunks: BlobPart[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > byteSize) { await reader.cancel(); throw new Error("Downloaded model exceeds its recorded size."); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  if (bytes !== byteSize) throw new Error("Model download is incomplete.");
  const pack = await importModelFiles([new File(chunks, "model.zip", { type: "application/zip" })]);
  return { ...await inspectPackage(pack.assets, model.id), cloudOwner: userId };
}
export async function deleteCloudModel(id: string): Promise<unknown> {
  const result = await json(`/api/models/${id}`, { method: "DELETE" }); notifyStorageChanged(); return result;
}
