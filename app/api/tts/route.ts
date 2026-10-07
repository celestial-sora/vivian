import { requireApiAccess } from "@/lib/auth/server";
import { NextResponse } from "next/server";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { fishSpeechText, speechSpeed, speechStyle, speechText } from "@/lib/speech";

export const maxDuration = 30;

// Fish's free endpoint can queue. Keep the request small and bounded so a slow
// provider can never leave the companion UI in its "thinking" state indefinitely.
const upstreamTimeoutMs = 14_000;

export async function POST(request: Request): Promise<Response> {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  const quota = rateLimit(request, "tts", 30);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfter);
  const startedAt = Date.now();
  const apiKey = process.env.FISH_AUDIO_API_KEY;
  const voiceId = process.env.FISH_AUDIO_VOICE_ID;
  if (!apiKey) return NextResponse.json({ error: "FISH_AUDIO_API_KEY is not configured" }, { status: 500 });
  if (!voiceId) return NextResponse.json({ error: "FISH_AUDIO_VOICE_ID is not configured" }, { status: 500 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body", status: 400 }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Text is required", status: 400 }, { status: 400 });
  const { text, speed, language } = body as Record<string, unknown>;
  if (typeof text !== "string" || text.length > 5000) return NextResponse.json({ error: "Text is required and must be under 5000 characters", status: 400 }, { status: 400 });
  const speechLanguage = language === "global" || language === "en" || language === "ja" || language === "ko" || language === "zh" || language === "th" ? language : "global";
  const cleanText = speechText(text, speechLanguage);
  if (!cleanText) return NextResponse.json({ error: "Text must contain spoken words", status: 400 }, { status: 400 });
  const style = speechStyle(cleanText);
  const model = process.env.FISH_AUDIO_MODEL ?? "s2.1-pro-free";

  let phase = "request";
  try {
    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model,
      },
      signal: AbortSignal.timeout(upstreamTimeoutMs),
      body: JSON.stringify({
        // The cloned voice stays the same; S2 gets a subtle delivery cue.
        text: fishSpeechText(cleanText, style, model, speechLanguage),
        reference_id: voiceId,
        prosody: { speed: speechSpeed(speed, style), volume: 0, normalize_loudness: true },
        temperature: style.temperature,
        top_p: style.topP,
        repetition_penalty: style.repetitionPenalty,
        format: "mp3",
        sample_rate: 44100,
        mp3_bitrate: 192,
        latency: "normal",
        // Fish text normalization targets English and Chinese. Leaving it off
        // preserves Thai spelling and avoids an unnatural Thai pronunciation.
        normalize: false,
        // Keep continuity between generated chunks: disabling this can make
        // longer Thai replies end after only their first phrase.
        chunk_length: 280,
        min_chunk_length: 70,
        condition_on_previous_chunks: true,
      }),
    });

    if (!response.ok) {
      console.warn("Fish Audio TTS rejected", { status: response.status, elapsedMs: Date.now() - startedAt, textLength: cleanText.length });
      return NextResponse.json({ error: "Fish Audio TTS request failed", code: "TTS_UPSTREAM", status: response.status }, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    // fetch resolves at headers; the same timeout also covers the entire body.
    // A stalled/truncated audio stream must use the text-chat fallback too.
    phase = "audio";
    const audio = await response.arrayBuffer();
    if (audio.byteLength === 0) {
      console.warn("Fish Audio TTS empty", { elapsedMs: Date.now() - startedAt, textLength: cleanText.length });
      return NextResponse.json({ error: "Fish Audio returned no audio", code: "TTS_UPSTREAM", status: 502 }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const elapsedMs = Date.now() - startedAt;
    console.info("Fish Audio TTS ready", { elapsedMs, textLength: cleanText.length, language: speechLanguage, delivery: style.delivery, bytes: audio.byteLength });
    return new NextResponse(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "Server-Timing": `fish;dur=${elapsedMs}` } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    const status = timedOut ? 504 : 502;
    console.warn("Fish Audio TTS unavailable", { phase, elapsedMs: Date.now() - startedAt, textLength: cleanText.length, error: name });
    return NextResponse.json({
      error: timedOut ? "ผู้ให้บริการเสียงตอบช้าเกินไป ลองใหม่อีกครั้งนะคะ" : "ผู้ให้บริการเสียงขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ",
      code: timedOut ? "TTS_TIMEOUT" : "TTS_UPSTREAM",
      status,
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
