import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { requireApiAccess } from "@/lib/auth/server";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { sceneClient } from "@/lib/scene-store";
import { StorageError } from "@/lib/cloud-storage";
import { cleanupCloudModels } from "@/lib/cloud-store";
export async function cloudApi(request: Request, action: (db: SupabaseClient, userId: string) => Promise<Response>): Promise<Response> {
  let userId: string | null = null;
  const denied = await requireApiAccess(request, (user) => { userId = user.id; });
  if (denied) return denied;
  if (!userId) return Response.json({ error: "Please sign in", code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const owner = userId;
  const scope = new URL(request.url).pathname.startsWith("/api/storage/") ? "storage-status" : "models";
  const limit = rateLimit(request, `${scope}:${owner}`, 60);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);
  try {
    const db = sceneClient(AbortSignal.timeout(30_000));
    const response = await action(db, owner);
    response.headers.set("Cache-Control", "private, no-store");
    if (request.method === "GET" && new URL(request.url).pathname === "/api/models") after(() => cleanupCloudModels(sceneClient(AbortSignal.timeout(30_000)), owner).catch(() => {}));
    return response;
  } catch (error) {
    const status = error instanceof StorageError ? error.status : error instanceof SyntaxError ? 400 : 503;
    return Response.json({ error: error instanceof StorageError ? error.message : status === 400 ? "Invalid model data." : "Cloud storage is temporarily unavailable.", status }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
