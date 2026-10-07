export interface TokenTiming { preparationMs: number; providerMs: number }

/** Consume provider SSE without exposing unsanitized dialogue to the UI. */
export async function readProviderStream(response: Response, format: "openai" | "gemini", firstToken: () => void): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  if (!response.body) throw new Error("Chat stream is empty.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", text = "", observed = false, complete = false;
  let grounding: unknown;
  const annotations: unknown[] = [];
  const event = (value: string) => {
    if (value.length > 128_000) throw new Error("Chat stream event exceeds limit.");
    const data = value.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { complete = true; return; }
    const parsed = JSON.parse(data);
    if (parsed.error) throw new Error("Chat stream provider error.");
    const candidate = parsed.candidates?.[0], choice = parsed.choices?.[0];
    const delta = format === "openai" ? choice?.delta?.content : candidate?.content?.parts?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text ?? "").join("");
    if (typeof delta === "string" && delta) {
      if (!observed) { observed = true; firstToken(); }
      text += delta;
      if (text.length > 100_000) throw new Error("Chat stream exceeds reply limit.");
    }
    if (Array.isArray(choice?.delta?.annotations)) annotations.push(...choice.delta.annotations);
    if (candidate?.groundingMetadata) grounding = candidate.groundingMetadata;
    if (choice?.finish_reason || candidate?.finishReason) complete = true;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      // Normalize line endings only at complete event boundaries (a CRLF may
      // straddle two network chunks).
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, boundary.index).replaceAll("\r\n", "\n"));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 128_000) throw new Error("Chat stream event exceeds limit.");
      if (chunk.done) break;
    }
    if (buffer.trim()) event(buffer.replaceAll("\r\n", "\n"));
    if (!complete || !text.trim()) throw new Error("Chat stream ended before a complete reply.");
    return Response.json(format === "openai" ? { choices: [{ message: { content: text, annotations } }] } : { candidates: [{ content: { parts: [{ text }] }, groundingMetadata: grounding }] });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

/** Timing-only NDJSON contains no partial dialogue. The final reply retains the
 * existing sanitized JSON contract and authenticated error status. */
export function timedChatResponse(reply: (firstToken: (provider: string, timing?: TokenTiming) => void) => Promise<Response>): Response {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (value: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
      try {
        const response = await reply((provider, timing) => emit({ event: "first_token", provider, timing }));
        emit({ event: "reply", status: response.status, data: await response.json() });
      } catch { emit({ event: "reply", status: 500, data: { error: "Chat request failed" } }); }
      finally { if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

export async function readChatResponse<T>(response: Response, firstToken: (provider: string, timing?: TokenTiming) => void): Promise<{ data: T; ok: boolean }> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return { data: await response.json() as T, ok: response.ok };
  if (!response.body) throw new Error("Chat response is empty.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", result: { data: T; ok: boolean } | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.length > 256_000) throw new Error("Chat response exceeds limit.");
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.event === "first_token") {
          const timing = event.timing;
          firstToken(String(event.provider), timing && Number.isFinite(timing.preparationMs) && Number.isFinite(timing.providerMs) ? timing : undefined);
        }
        if (event.event === "reply") result = { data: event.data as T, ok: event.status >= 200 && event.status < 300 };
      }
      if (buffer.length > 256_000) throw new Error("Chat response exceeds limit.");
      if (chunk.done) break;
    }
    if (!result) throw new Error("Chat response ended before its reply.");
    return result;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
