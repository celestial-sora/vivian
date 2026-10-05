import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { requireApiAccess } from "@/lib/auth/server";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { cleanupSceneImages, sceneClient } from "@/lib/scene-store";
import { SceneError } from "@/lib/scenes";
import { StorageError } from "@/lib/cloud-storage";

export async function sceneApi(request: Request, action: (db: SupabaseClient, userId: string) => Promise<Response>): Promise<Response> {
  let userId: string | null = null;
  const denied = await requireApiAccess(request, (user) => { userId = user.id; });
  if (denied) return denied;
  if (!userId) return Response.json({ error: "Please sign in", code: "AUTH_REQUIRED" }, { status: 401 });
  const owner = userId;
  if (request.method !== "GET") {
    const quota = rateLimit(request, `scenes:${owner}`, 20);
    if (!quota.allowed) return rateLimitedResponse(quota.retryAfter);
  }
  try {
    const response = await action(sceneClient(), owner);
    if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "private, no-store");
    if (request.method !== "GET" || new URL(request.url).pathname === "/api/scenes") after(() => cleanupSceneImages(owner));
    return response;
  } catch (error) {
    const status = error instanceof SceneError || error instanceof StorageError ? error.status : error instanceof SyntaxError || error instanceof TypeError ? 400 : 503;
    return Response.json({ error: error instanceof SceneError || error instanceof StorageError ? error.message : status === 400 ? "Invalid scene data or image import failed. Check the URL/file and try again." : "Scene storage is temporarily unavailable. Please try again.", status }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
