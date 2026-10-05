/** Shared presentation contract. No image data belongs in a model context. */
export const SCENE_MAX_BYTES = 8 * 1024 * 1024;
export const SCENE_MAX_COUNT = 50;
export const SCENE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export interface VivianScene {
  id: string;
  label: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceType: "upload" | "url";
  createdAt: string;
  updatedAt: string;
}
export interface ScenePreferences {
  autoScene: boolean;
  activeSceneId: string | null;
  preset: "day" | "night" | null;
  revision: string;
}
export type SceneDecision = { change: false } | { change: true; id: string };
export class SceneError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validateSceneLabel(value: unknown): string {
  if (typeof value !== "string") throw new SceneError("Enter a scene label (1–50 characters).");
  const label = value.trim().normalize("NFC");
  if (!label || [...label].length > 50 || /[\p{Cc}\p{Cf}<>]/u.test(label)) throw new SceneError("Enter a scene label (1–50 characters, without markup or control characters).");
  return label;
}
export function validateSceneId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new SceneError("Scene not found.", 404);
  return value;
}

export function sceneThumbnailKey(key: string): string {
  return key.replace(/\.[^/.]+$/, ".thumb.webp");
}
export function sceneImageExtension(mime: string): string {
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  const extension = extensions[mime];
  if (!extension) throw new SceneError("Unsupported scene image type.");
  return extension;
}
