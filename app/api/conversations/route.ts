import { requireApiAccess } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HistoryError, listHistory, readHistory, saveHistory, validateHistoryWrite } from "@/lib/chat-history-store";
import { SceneError } from "@/lib/scenes";
import { readBoundedSceneBody } from "@/lib/scene-images";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";

async function historyApi(request: Request, action: () => Promise<Response>): Promise<Response> {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  const quota = rateLimit(request, "history", 180);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfter);
  try {
    const response = await action();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const status = error instanceof HistoryError || error instanceof SceneError ? error.status : error instanceof SyntaxError ? 400 : 503;
    return Response.json({ error: error instanceof HistoryError || error instanceof SceneError ? error.message : status === 400 ? "Invalid conversation data." : "Chat history is temporarily unavailable.", status }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
export async function GET(request: Request): Promise<Response> {
  return historyApi(request, async () => {
    const params = new URL(request.url).searchParams;
    const after = params.get("after") ?? "0", offset = params.get("offset") ?? "0";
    if (!/^\d{1,15}$/.test(after) || !/^\d{1,6}$/.test(offset)) throw new HistoryError("Invalid history cursor.");
    const db = getSupabaseAdmin(AbortSignal.timeout(8000));
    return Response.json(params.has("id") ? await readHistory(db, params.get("id")!, after) : await listHistory(db, Number(offset)));
  });
}
export async function PUT(request: Request): Promise<Response> {
  return historyApi(request, async () => {
    const bytes = await readBoundedSceneBody(request, 2 * 1024 * 1024);
    await saveHistory(getSupabaseAdmin(AbortSignal.timeout(8000)), validateHistoryWrite(JSON.parse(bytes.toString("utf8"))));
    return Response.json({ ok: true });
  });
}
