import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StorageError, storageId, modelSize, modelManifests, STORAGE_LIMITS, type StorageCategory, type StorageUsage, type CloudModel } from "@/lib/cloud-storage";
import { r2Configuration, startModelUpload, signModelParts, completeModelUpload, deleteR2Object, signModelDownload, putR2Image } from "@/lib/r2";

export interface StorageObject { id: string; user_id: string; category: StorageCategory; object_key: string; byte_size: number; state: "pending" | "ready" | "deleting"; upload_id: string | null; metadata: { manifests?: CloudModel["manifests"] }; created_at: string }
function check(error: { code?: string } | null): void {
  if (error?.code === "23514") throw new StorageError("Storage quota exceeded. Delete unused files before uploading.", 409);
  if (error) throw new StorageError("Cloud storage is temporarily unavailable.", 503);
}
export async function storageUsage(db: SupabaseClient): Promise<StorageUsage> {
  const { data, error } = await db.from("vivian_storage_quotas").select("category,used_bytes,limit_bytes"); check(error);
  if (!data || data.length !== 2) throw new StorageError("Cloud storage setup is incomplete.", 503);
  const result: StorageUsage = { live2d: { used: 0, limit: STORAGE_LIMITS.live2d }, other: { used: 0, limit: STORAGE_LIMITS.other } };
  for (const row of data) {
    const category = row.category as StorageCategory;
    if (!(category in STORAGE_LIMITS) || Number(row.limit_bytes) !== STORAGE_LIMITS[category]) throw new StorageError("Cloud storage quotas do not match the configured limits.", 503);
    result[category].used = Number(row.used_bytes);
  }
  return result;
}
export async function ownedObject(db: SupabaseClient, userId: string, id: string): Promise<StorageObject> {
  storageId(id);
  const { data, error } = await db.from("vivian_storage_objects").select("*").eq("user_id", userId).eq("id", id).maybeSingle(); check(error);
  if (!data) throw new StorageError("File not found.", 404);
  return data as StorageObject;
}
function present(row: StorageObject): CloudModel { return { id: row.id, byteSize: Number(row.byte_size), manifests: modelManifests(row.metadata.manifests) }; }
export async function cloudModels(db: SupabaseClient, userId: string) {
  r2Configuration();
  const { data, error } = await db.from("vivian_storage_objects").select("*").eq("user_id", userId).eq("category", "live2d").eq("state", "ready").order("created_at", { ascending: true }); check(error);
  return { userId, models: (data ?? []).map((row) => present(row as StorageObject)), usage: await storageUsage(db) };
}
export async function beginCloudModel(db: SupabaseClient, userId: string, input: unknown) {
  r2Configuration();
  if (!input || typeof input !== "object") throw new StorageError("Invalid model upload.");
  const body = input as Record<string, unknown>;
  const bytes = modelSize(body.byteSize), manifests = modelManifests(body.manifests);
  const id = randomUUID(), key = `live2d/${userId}/${id}.zip`;
  // Reserve before making any remote write. SQL enforces the global budget.
  const { error } = await db.from("vivian_storage_objects").insert({ id, user_id: userId, category: "live2d", object_key: key, byte_size: bytes, metadata: { manifests } }); check(error);
  const uploadId = await startModelUpload(key);
  check((await db.from("vivian_storage_objects").update({ upload_id: uploadId }).eq("id", id).eq("user_id", userId).eq("state", "pending")).error);
  return { id, userId, usage: await storageUsage(db) };
}
export async function cloudModelParts(db: SupabaseClient, userId: string, id: string, first: number) {
  const row = await ownedObject(db, userId, id);
  if (row.category !== "live2d" || row.state !== "pending" || !row.upload_id) throw new StorageError("Upload is not available.", 409);
  if (Date.now() - new Date(row.created_at).getTime() > 3600_000) throw new StorageError("Upload expired. Import the model again.", 409);
  return { parts: await signModelParts(row.object_key, row.upload_id, Number(row.byte_size), first) };
}
export async function finishCloudModel(db: SupabaseClient, userId: string, id: string) {
  const row = await ownedObject(db, userId, id);
  if (row.category !== "live2d" || row.state === "deleting") throw new StorageError("Upload is not available.", 409);
  if (row.state !== "ready") {
    if (!row.upload_id) throw new StorageError("Upload is not available.", 409);
    await completeModelUpload(row.object_key, row.upload_id, Number(row.byte_size));
    const { data, error } = await db.from("vivian_storage_objects").update({ state: "ready", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).eq("state", "pending").select("id"); check(error);
    if (!data?.length) throw new StorageError("Upload changed. Refresh your library.", 409);
  }
  return { model: present(row), usage: await storageUsage(db) };
}
export async function cloudModelDownload(db: SupabaseClient, userId: string, id: string) {
  const row = await ownedObject(db, userId, id);
  if (row.category !== "live2d" || row.state !== "ready") throw new StorageError("Model not found.", 404);
  return { url: await signModelDownload(row.object_key), byteSize: Number(row.byte_size) };
}
export async function removeCloudObject(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const row = await ownedObject(db, userId, id);
  check((await db.from("vivian_storage_objects").update({ state: "deleting" }).eq("id", id).eq("user_id", userId)).error);
  await deleteR2Object(row.object_key, row.upload_id);
  // Only verified remote deletion releases the reservation. Failures keep it.
  check((await db.from("vivian_storage_objects").delete().eq("id", id).eq("user_id", userId).eq("state", "deleting")).error);
}
export async function saveCloudSceneImages(db: SupabaseClient, userId: string, key: string, image: Buffer, thumbnail: Buffer): Promise<void> {
  r2Configuration();
  const values = [{ key, bytes: image }, { key: key.replace(/\.webp$/, ".thumb.webp"), bytes: thumbnail }];
  // Reserve both files in one DB transaction before writing either one.
  check((await db.from("vivian_storage_objects").insert(values.map((value) => ({ id: randomUUID(), user_id: userId, category: "other", object_key: value.key, byte_size: value.bytes.length })))).error);
  for (const value of values) await putR2Image(value.key, value.bytes);
  check((await db.from("vivian_storage_objects").update({ state: "ready" }).eq("user_id", userId).in("object_key", values.map((value) => value.key))).error);
}
export async function removeCloudSceneImages(db: SupabaseClient, userId: string, key: string): Promise<void> {
  const { data, error } = await db.from("vivian_storage_objects").select("id").eq("user_id", userId).eq("category", "other").in("object_key", [key, key.replace(/\.webp$/, ".thumb.webp")]); check(error);
  for (const row of data ?? []) await removeCloudObject(db, userId, row.id);
}
export async function cleanupCloudModels(db: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await db.from("vivian_storage_objects").select("id,state,created_at").eq("user_id", userId).eq("category", "live2d").in("state", ["pending", "deleting"]).limit(20); check(error);
  for (const row of data ?? []) if (row.state === "deleting" || Date.now() - new Date(row.created_at).getTime() > 3600_000) {
    try { await removeCloudObject(db, userId, row.id); } catch { /* Keep reservation; next library refresh retries. */ }
  }
}
