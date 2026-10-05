/** Billing GB is decimal; individual model limits remain binary MiB. */
export const STORAGE_CAPACITY_BYTES = 10_000_000_000;
export const STORAGE_BUFFER_BYTES = 2_000_000_000;
export const STORAGE_BUDGET_BYTES = STORAGE_CAPACITY_BYTES - STORAGE_BUFFER_BYTES;
// Categories are a breakdown of the same shared budget, never additive quotas.
export const STORAGE_LIMITS = { live2d: STORAGE_BUDGET_BYTES, other: STORAGE_BUDGET_BYTES } as const;
export const MODEL_MAX_BYTES = 512 * 1024 * 1024;
export const MODEL_PART_BYTES = 16 * 1024 * 1024;
export type StorageCategory = keyof typeof STORAGE_LIMITS;
export interface StorageUsage { live2d: { used: number; limit: number }; other: { used: number; limit: number } }
export interface CloudModel { id: string; byteSize: number; manifests: Array<{ path: string; name: string }> }
export class StorageError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function storageId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new StorageError("Invalid storage ID.");
  return value;
}
export function modelSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MODEL_MAX_BYTES) throw new StorageError("Each model must be at most 512 MiB.");
  return value;
}
export function partSize(bytes: number, part: number): number {
  if (!Number.isInteger(part) || part < 1 || part > Math.ceil(bytes / MODEL_PART_BYTES)) throw new StorageError("Invalid upload part.");
  return Math.min(MODEL_PART_BYTES, bytes - (part - 1) * MODEL_PART_BYTES);
}
export function modelManifests(value: unknown): CloudModel["manifests"] {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw new StorageError("Invalid model manifests.");
  const paths = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new StorageError("Invalid model manifest.");
    const { path, name } = entry as Record<string, unknown>;
    if (typeof path !== "string" || path.length > 1024 || !/\.model3\.json$/i.test(path) || /[\x00-\x1f\\]/.test(path) || /^(?:[a-z][\w+.-]*:|\/)/i.test(path) || path.split("/").some((part) => !part || part === "." || part === "..") || paths.has(path) || typeof name !== "string" || !name.trim() || name.length > 200) throw new StorageError("Invalid model manifest.");
    paths.add(path); return { path, name: name.trim() };
  });
}
export async function storageJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new StorageError("Missing request body.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 32 * 1024) { await reader.cancel(); throw new StorageError("Request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(buffer));
}
export function r2ObjectCategory(key: string): StorageCategory {
  return key.startsWith("live2d/") ? "live2d" : "other";
}
export function inventoryUsage(objects: Map<string, number>): StorageUsage {
  const usage: StorageUsage = { live2d: { used: 0, limit: STORAGE_LIMITS.live2d }, other: { used: 0, limit: STORAGE_LIMITS.other } };
  for (const [key, size] of objects) {
    const meter = usage[r2ObjectCategory(key)];
    meter.used += size;
    if (!Number.isSafeInteger(meter.used)) throw new StorageError("R2 usage could not be verified.", 503);
  }
  return usage;
}
