import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readProviderStream, timedChatResponse, readChatResponse } from '../lib/chat-stream.ts';
const encode = text => new TextEncoder().encode(text);
function sse(parts) { return new Response(new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(encode(part))); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }); }

test('fragmented SSE observes actual content once, preserves Unicode and excludes reasoning', async () => {
  let count = 0;
  const response = await readProviderStream(sse(['data: {"choices":[{"delta":{"reasoning":"private"}}]}\r', '\n\r\ndata: {"choices":[{"delta":{"content":"สวั"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"สดี"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']), 'openai', () => count++);
  assert.equal(count, 1); assert.equal((await response.json()).choices[0].message.content, 'สวัสดี');
});
test('Gemini stream preserves grounding and excludes thought parts', async () => {
  let count = 0;
  const response = await readProviderStream(sse(['data: {"candidates":[{"content":{"parts":[{"text":"private","thought":true},{"text":"reply"}]}}]}\n\n', 'data: {"candidates":[{"finishReason":"STOP","groundingMetadata":{"groundingChunks":[{"web":{"uri":"https://example.test","title":"source"}}]}}]}\n\n']), 'gemini', () => count++);
  const body = await response.json(); assert.equal(count, 1); assert.equal(body.candidates[0].content.parts[0].text, 'reply'); assert.equal(body.candidates[0].groundingMetadata.groundingChunks.length, 1);
});
test('interrupted, malformed and empty streams are rejected rather than surfacing partial replies', async () => {
  for (const value of ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', 'data: invalid\n\n', 'data: [DONE]\n\n', 'data: {"error":{"message":"private"}}\n\n']) await assert.rejects(readProviderStream(sse([value]), 'openai', () => {}));
});
test('nonstreaming provider responses and rejection preserve status and body', async () => {
  const response = Response.json({ error: 'provider' }, { status: 429 });
  assert.equal(await readProviderStream(response, 'openai', () => assert.fail()), response);
});
test('timing arrives before the complete sanitized reply, without transmitting partial dialogue', async () => {
  let finish;
  const response = timedChatResponse(async firstToken => { firstToken('groq'); await new Promise(resolve => { finish = resolve; }); return Response.json({ text: 'final only', scene: { change: false } }); });
  let provider;
  const reading = readChatResponse(response, value => { provider = value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(provider, 'groq');
  finish(); const result = await reading; assert.equal(result.ok, true); assert.equal(result.data.text, 'final only');
});
test('streaming error status, transport failure and ordinary JSON remain controlled', async () => {
  const failed = await readChatResponse(timedChatResponse(async () => Response.json({ error: 'unavailable' }, { status: 503 })), () => {});
  assert.equal(failed.ok, false); assert.equal(failed.data.error, 'unavailable');
  const thrown = await readChatResponse(timedChatResponse(async () => { throw Error('private'); }), () => {});
  assert.equal(thrown.ok, false); assert.equal(thrown.data.error, 'Chat request failed');
  assert.equal((await readChatResponse(Response.json({ text: 'legacy' }), () => {})).data.text, 'legacy');
  await assert.rejects(readChatResponse(new Response('{"event":"first_token","provider":"groq"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }), () => {}));
});
