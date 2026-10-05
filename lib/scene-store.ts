import "server-only";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SceneError, SCENE_MAX_COUNT, sceneThumbnailKey, sceneImageExtension, validateSceneId, validateSceneLabel, type VivianScene, type ScenePreferences, type SceneDecision } from "@/lib/scenes";
import { saveCloudSceneImages, removeCloudSceneImages } from "@/lib/cloud-store";
import { getR2Image, modelObjectSize } from "@/lib/r2";

const BUCKET = "vivian-scenes";
const COLUMNS = "id,user_id,label,image_key,source_type,storage_provider,created_at,updated_at";
interface SceneRow { id: string; user_id: string; label: string; image_key: string; source_type: "upload" | "url"; storage_provider?: "supabase" | "r2"; created_at: string; updated_at: string }
interface PreferenceRow { user_id: string; auto_scene: boolean; active_scene_id: string | null; preset: "day" | "night" | null; revision: string }
export interface SceneContext { userId: string; autoScene: boolean; activeSceneId: string | null; revision: string; scenes: Array<{ id: string; label: string }> }

export function sceneClient(signal = AbortSignal.timeout(15_000)): SupabaseClient {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SceneError("Scene storage is temporarily unavailable.", 503);
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) },
  });
}
function check(error: unknown): void { if (error) throw new SceneError("Scene storage is temporarily unavailable. Please try again.", 503); }
function present(row: SceneRow): VivianScene {
  // Only an opaque revision appears in the private app URL, never storage keys.
  const imageUrl = `/api/scenes/${row.id}/image?v=${encodeURIComponent(row.updated_at)}`;
  return { id: row.id, label: row.label, imageUrl, thumbnailUrl: `${imageUrl}&thumbnail=1`, sourceType: row.source_type, createdAt: row.created_at, updatedAt: row.updated_at };
}
function preferences(row: PreferenceRow | null): ScenePreferences {
  return { autoScene: row?.auto_scene ?? false, activeSceneId: row?.active_scene_id ?? null, preset: row?.preset ?? null, revision: row?.revision ?? "" };
}
export async function getScene(db: SupabaseClient, userId: string, id: string): Promise<SceneRow> {
  validateSceneId(id);
  const { data, error } = await db.from("vivian_scenes").select(COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle();
  check(error);
  if (!data) throw new SceneError("Scene not found.", 404);
  return data as SceneRow;
}
export async function getSceneLibrary(db: SupabaseClient, userId: string): Promise<{ scenes: VivianScene[]; preferences: ScenePreferences }> {
  const [scenes, settings] = await Promise.all([
    db.from("vivian_scenes").select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: true }).limit(SCENE_MAX_COUNT),
    db.from("vivian_scene_preferences").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  check(scenes.error); check(settings.error);
  return { scenes: (scenes.data ?? []).map((row) => present(row as SceneRow)), preferences: preferences(settings.data) };
}
const objectKeys = (key: string) => [key, sceneThumbnailKey(key)];
async function queueObject(db: SupabaseClient, userId: string, key: string, provider: "supabase" | "r2" = "supabase"): Promise<void> {
  const { error } = await db.from("vivian_scene_image_gc").upsert({ image_key: key, user_id: userId, storage_provider: provider }, { onConflict: "image_key", ignoreDuplicates: true }); check(error);
}
async function removeObject(db: SupabaseClient, userId: string, key: string, provider: "supabase" | "r2" = "supabase"): Promise<void> {
  // Queue entries survive outages; cleanup is safe even if the upload failed.
  try {
    const { error } = provider === "r2" ? (await removeCloudSceneImages(db, userId, key), { error: null }) : await db.storage.from(BUCKET).remove(objectKeys(key));
    if (!error) await db.from("vivian_scene_image_gc").delete().eq("image_key", key).eq("user_id", userId);
  } catch { /* Retried by cleanupSceneImages. */ }
}
export async function saveScene(db: SupabaseClient, userId: string, input: { label: string; sourceType?: "upload" | "url"; image?: Buffer; thumbnail?: Buffer; mime?: string }, id?: string): Promise<VivianScene> {
  input.label = validateSceneLabel(input.label);
  if (input.image && (!input.thumbnail || !input.sourceType)) throw new SceneError("Invalid scene image.");
  const previous = id ? await getScene(db, userId, id) : null;
  if (!previous && !input.image) throw new SceneError("Choose an image or enter an image URL.");
  if (!previous) {
    const { count, error } = await db.from("vivian_scenes").select("id", { count: "exact", head: true }).eq("user_id", userId);
    check(error);
    if ((count ?? 0) >= SCENE_MAX_COUNT) throw new SceneError("Your scene library is full (50 scenes). Delete a scene first.");
  }
  const sceneId = previous?.id ?? randomUUID();
  const newKey = input.image ? `${userId}/${randomUUID()}.${sceneImageExtension(input.mime ?? "image/webp")}` : null;
  const provider = process.env.SCENE_STORAGE_PROVIDER === "r2" ? "r2" : "supabase";
  if (newKey) await queueObject(db, userId, newKey, provider);
  let committed = false;
  try {
    if (newKey && input.image && input.thumbnail) {
      const options = { contentType: input.mime ?? "image/webp", cacheControl: "3600", upsert: false };
      // Serialize so failures cannot leave a second upload finishing after cleanup.
      if (provider === "r2") await saveCloudSceneImages(db, userId, newKey, input.image, input.thumbnail, input.mime);
      else {
        check((await db.storage.from(BUCKET).upload(newKey, input.image, options)).error);
        check((await db.storage.from(BUCKET).upload(objectKeys(newKey)[1], input.thumbnail, { ...options, contentType: "image/webp" })).error);
      }
    }
    const values = { label: input.label, ...(newKey ? { image_key: newKey, source_type: input.sourceType, storage_provider: provider } : {}), updated_at: new Date().toISOString() };
    const query = previous
      ? db.from("vivian_scenes").update(values).eq("id", sceneId).eq("user_id", userId).eq("image_key", previous.image_key)
      : db.from("vivian_scenes").insert({ ...values, id: sceneId, user_id: userId });
    const { data, error } = await query.select(COLUMNS).single();
    check(error);
    if (!data) throw new SceneError("Scene changed. Please reload and try again.", 409);
    committed = true;
    if (newKey) {
      await db.from("vivian_scene_image_gc").delete().eq("image_key", newKey).eq("user_id", userId);
      if (previous) await removeObject(db, userId, previous.image_key, previous.storage_provider);
    }
    return present(data as SceneRow);
  } catch (error) {
    if (newKey && !committed) {
      // A network failure can leave commit status unknown. Do not delete an
      // object that might now be referenced; the durable queue checks later.
      try {
        const result = await db.from("vivian_scenes").select("id").eq("user_id", userId).eq("image_key", newKey).maybeSingle();
        if (!result.error && !result.data) await removeObject(db, userId, newKey, provider);
      } catch { /* Cleanup queue remains. */ }
    }
    throw error;
  }
}
export async function deleteScene(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const scene = await getScene(db, userId, id);
  // FK atomically clears the active scene; trigger atomically queues the image.
  const { error } = await db.from("vivian_scenes").delete().eq("user_id", userId).eq("id", id); check(error);
  await removeObject(db, userId, scene.image_key, scene.storage_provider);
}
export async function setScenePreferences(db: SupabaseClient, userId: string, value: unknown): Promise<ScenePreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SceneError("Invalid scene settings.");
  const body = value as Record<string, unknown>;
  const changes: Record<string, unknown> = { user_id: userId, revision: randomUUID(), updated_at: new Date().toISOString() };
  if ("autoScene" in body) {
    if (typeof body.autoScene !== "boolean") throw new SceneError("Invalid AI Auto Scene setting.");
    changes.auto_scene = body.autoScene;
  }
  if ("activeSceneId" in body) {
    if (body.activeSceneId !== null) await getScene(db, userId, validateSceneId(body.activeSceneId));
    changes.active_scene_id = body.activeSceneId;
    changes.preset = null;
  }
  if ("preset" in body) {
    if (!["day", "night"].includes(body.preset as string)) throw new SceneError("Invalid default scene.");
    changes.preset = body.preset; changes.active_scene_id = null;
  }
  if (Object.keys(changes).length === 3) throw new SceneError("No scene settings supplied.");
  // Ensure row exists, then update only supplied fields; upsert partial rows
  // would reset existing preferences to defaults on conflict.
  check((await db.from("vivian_scene_preferences").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })).error);
  const { data, error } = await db.from("vivian_scene_preferences").update(changes).eq("user_id", userId).select("*").single(); check(error);
  return preferences(data);
}
export async function getSceneImage(db: SupabaseClient, userId: string, id: string, thumbnail: boolean): Promise<Blob> {
  const scene = await getScene(db, userId, id);
  if (scene.storage_provider === "r2") return getR2Image(objectKeys(scene.image_key)[thumbnail ? 1 : 0]);
  const { data, error } = await db.storage.from(BUCKET).download(objectKeys(scene.image_key)[thumbnail ? 1 : 0]); check(error);
  if (!data) throw new SceneError("Scene image unavailable.", 404);
  return data;
}
export async function cleanupSceneImages(userId: string): Promise<void> {
  try {
    const db = sceneClient(AbortSignal.timeout(5000));
    const { data, error } = await db.from("vivian_scene_image_gc").select("image_key,storage_provider").eq("user_id", userId).lt("created_at", new Date(Date.now() - 3600_000).toISOString()).limit(20);
    if (error) return;
    for (const item of data ?? []) {
      const references = await db.from("vivian_scenes").select("id").eq("user_id", userId).eq("image_key", item.image_key).maybeSingle();
      if (!references.error && !references.data) await removeObject(db, userId, item.image_key, item.storage_provider);
    }
  } catch { /* Non-critical deferred work. */ }
}
export async function loadSceneContext(userId: string | null): Promise<SceneContext | null> {
  try {
    if (!userId) return null;
    const db = sceneClient(AbortSignal.timeout(600));
    const result = await db.from("vivian_scene_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (result.error || !result.data?.auto_scene) return null;
    // Select ONLY semantic data for this account. No storage reads on the JEV path.
    const library = await db.from("vivian_scenes").select("id,label").eq("user_id", userId).order("created_at").limit(SCENE_MAX_COUNT);
    if (library.error) return null;
    return { userId: userId, autoScene: true, activeSceneId: result.data.active_scene_id, revision: result.data.revision, scenes: (library.data ?? []).map((scene) => ({ id: scene.id, label: scene.label })) };
  } catch { return null; }
}
export async function executeSceneDecision(context: SceneContext | null, decision: SceneDecision | undefined): Promise<SceneDecision> {
  const unchanged: SceneDecision = { change: false };
  try {
    if (!context?.autoScene || decision?.change !== true || !context.scenes.some((scene) => scene.id === decision.id) || context.activeSceneId === decision.id) return unchanged;
    const db = sceneClient(AbortSignal.timeout(600));
    const scene = await getScene(db, context.userId, decision.id);
    // Check storage availability without downloading the background during chat.
    if (scene.storage_provider === "r2") { if (await modelObjectSize(scene.image_key) === null) return unchanged; }
    else if ((await db.storage.from(BUCKET).info(scene.image_key)).error) return unchanged;
    // Atomic preference check protects manual selections/toggle changes while
    // JEV or the main provider was running, and handles concurrent replies.
    const { data, error } = await db.from("vivian_scene_preferences").update({ active_scene_id: scene.id, preset: null, revision: randomUUID(), updated_at: new Date().toISOString() }).eq("user_id", context.userId).eq("auto_scene", true).eq("revision", context.revision).select("active_scene_id").maybeSingle();
    return error || !data ? unchanged : { change: true, id: scene.id };
  } catch { return unchanged; }
}
