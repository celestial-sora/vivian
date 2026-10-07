import { requireApiAccess } from "@/lib/auth/server";
import { NextResponse } from "next/server";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

export async function POST(request: Request) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  const quota = rateLimit(request, "stt", 12);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfter);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured", status: 500 }, { status: 500 });
  const incoming = await request.formData(); const file = incoming.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
  if (!file.size) return NextResponse.json({ error: "Audio file is empty" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Audio file is too large", status: 413 }, { status: 413 });
  const form = new FormData();
  form.append("file", file, file.name || "vivian-recording");
  form.append("model_id", "scribe_v2");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("timestamps_granularity", "none");
  const requestedLanguage = incoming.get("language");
  const language = requestedLanguage === "en" || requestedLanguage === "ja" || requestedLanguage === "ko" || requestedLanguage === "zh" || requestedLanguage === "th" ? requestedLanguage : null;
  // Anchor transcription to the language selected in the companion UI; this
  // prevents the recognizer from guessing a different script from room noise.
  if (language) form.append("language_code", language);
  let response: Response;
  let data: unknown;
  const providerStarted = Date.now();
  try {
    response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form, signal: AbortSignal.timeout(25000) });
    if (response.ok) data = await response.json();
  } catch (error) {
    console.warn("ElevenLabs STT timed out or failed", error);
    return NextResponse.json({ error: "ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้งนะคะ" }, { status: 504 });
  }
  if (!response.ok) {
    console.warn("ElevenLabs STT rejected", { status: response.status, mimeType: file.type, size: file.size });
    return NextResponse.json({ error: "ElevenLabs STT request failed", status: response.status }, { status: response.status });
  }
  const text = typeof data === "object" && data !== null && "text" in data && typeof data.text === "string" ? data.text : "";
  console.info("ElevenLabs STT complete", { mimeType: file.type, size: file.size, language });
  return NextResponse.json({ text }, { headers: { "Cache-Control": "no-store", "Server-Timing": `scribe;dur=${Date.now() - providerStarted}` } });
}
