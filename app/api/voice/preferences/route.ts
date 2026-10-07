import { requireApiAccess } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { DEFAULT_SPEAKING_SPEED, validSpeakingSpeed } from "@/lib/voice-preferences";

const headers = { "Cache-Control": "private, no-store" };
async function preferences(request: Request, write: boolean): Promise<Response> {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  let speed: number | undefined;
  if (write) {
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !validSpeakingSpeed((body as Record<string, unknown>).speakingSpeed)) {
      return Response.json({ error: "Speaking speed must be between 0.8 and 1.2" }, { status: 400, headers });
    }
    speed = (body as { speakingSpeed: number }).speakingSpeed;
  }
  try {
    const db = getSupabaseAdmin(AbortSignal.timeout(8000));
    // One fixed singleton for all authorized accounts; never accept a user key.
    const result = write
      ? await db.from("vivian_voice_preferences").upsert({ id: "global", speaking_speed: speed, updated_at: new Date().toISOString() }, { onConflict: "id" }).select("speaking_speed").single()
      : await db.from("vivian_voice_preferences").select("speaking_speed").eq("id", "global").maybeSingle();
    if (result.error) throw new Error("Voice preference storage unavailable");
    return Response.json({ speakingSpeed: result.data?.speaking_speed ?? DEFAULT_SPEAKING_SPEED }, { headers });
  } catch {
    return Response.json({ error: "บันทึกค่าความเร็วบนคลาวด์ไม่ได้ กรุณาลองใหม่" }, { status: 503, headers });
  }
}
export const GET = (request: Request) => preferences(request, false);
export const PATCH = (request: Request) => preferences(request, true);
