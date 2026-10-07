import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startHistoryFixture } from "./history-fixture.mjs";
import { sessionCookie } from "./auth-fixture.mjs";
let fixture, child, base;
before(async () => {
  fixture = await startHistoryFixture();
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: fixture.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_only", SUPABASE_URL: fixture.url, SUPABASE_SERVICE_ROLE_KEY: "fixture-admin", GROQ_API_KEY: "fixture-groq", CEREBRAS_API_KEY: "", GEMINI_API_KEY: "", TYPESAFE_API_KEY: "", JEV_API_KEY: "", FISH_AUDIO_API_KEY: "", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET_NAME: "", VIVIAN_TEST_SCENE_UPSTREAM: fixture.url, NODE_OPTIONS: `--import ${new URL("./scene-upstream-fixture.mjs", import.meta.url).href}` };
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "0", "-H", "127.0.0.1"], { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  for (let index = 0; index < 150; index++) {
    base = output.match(/Local:\s+(http:\/\/[^\s]+)/)?.[1];
    if (base) { try { if ((await fetch(`${base}/login`)).ok) return; } catch { /* starting */ } }
    if (child.exitCode !== null) throw new Error(output);
    await delay(200);
  }
  throw new Error(output);
}, { timeout: 60000 });
after(async () => { child?.kill("SIGTERM"); await fixture?.close(); });
const call = (path, body, account = "first") => fetch(`${base}${path}`, { method: body ? "PUT" : "GET", headers: { cookie: sessionCookie(account), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const id = randomUUID(), userId = randomUUID(), replyId = randomUUID();
const message = { id: userId, from: "me", text: "hello on device A", timestamp: new Date().toISOString() };
test("device A writes a thread; device B loads the same shared thread; repeated writes do not duplicate", async () => {
  const body = { id, title: "Device A", create: true, messages: [message] };
  for (let index = 0; index < 2; index++) assert.equal((await call("/api/conversations", body)).status, 200);
  const list = await (await call("/api/conversations", null, "second")).json(); assert.equal(list.conversations[0].id, id);
  const read = await (await call(`/api/conversations?id=${id}`, null, "second")).json(); assert.equal(read.messages.length, 1); assert.equal(read.messages[0].text, message.text);
});
test("real chat response is saved to its selected thread before the browser receives it", async () => {
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { cookie: sessionCookie("first"), "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, conversationTitle: "Device A", conversationCreate: false, userMessageId: userId, assistantMessageId: replyId, messages: [{ role: "user", content: message.text }] }) });
  assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.historySaved, true);
  const read = await (await call(`/api/conversations?id=${id}`, null, "second")).json(); assert.equal(read.messages.length, 2); assert.equal(read.messages[1].id, replyId); assert.equal(read.messages[1].text, data.text);
});
test("timing-stream chat keeps authentication and saves the final reply before completing its envelope", async () => {
  const denied = await fetch(`${base}/api/chat`, { method: "POST", headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(denied.status, 401);
  const streamedReplyId = randomUUID(), streamedUserId = randomUUID();
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { cookie: sessionCookie("first"), "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ conversationId: id, conversationCreate: false, userMessageId: streamedUserId, assistantMessageId: streamedReplyId, messages: [{ role: "user", content: "stream timing fixture" }] }) });
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events[0].event, "first_token"); assert.equal(events[0].provider, "groq"); assert.equal(events[0].text, undefined);
  const final = events.at(-1); assert.equal(final.status, 200); assert.equal(final.data.historySaved, true);
  const read = await (await call(`/api/conversations?id=${id}`, null, "second")).json();
  assert.equal(read.messages.find(message => message.id === streamedReplyId).text, final.data.text);
});
test("history auth, validation and unavailable storage do not expose data or claim successful saving", async () => {
  for (const account of ["denied", "unverified"]) assert.equal((await call("/api/conversations", null, account)).status, 403);
  assert.equal((await fetch(`${base}/api/conversations`)).status, 401);
  assert.equal((await call("/api/conversations", { id, title: "Title", create: true, messages: [{ ...message, from: "system" }] })).status, 400);
  assert.equal((await call("/api/conversations?id=invalid")).status, 400);
  fixture.state.failure = true;
  assert.equal((await call("/api/conversations")).status, 503);
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { cookie: sessionCookie("first"), "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, conversationCreate: false, userMessageId: randomUUID(), assistantMessageId: randomUUID(), messages: [{ role: "user", content: "keep chatting while storage is offline" }] }) });
  assert.equal(response.status, 200); const reply = await response.json(); assert.equal(reply.historySaved, false); assert.ok(reply.text);
  fixture.state.failure = false;
});
test("message pagination retains more than 100 messages and missing/deleted threads reject stale appends", async () => {
  const paged = randomUUID();
  const messages = Array.from({ length: 105 }, (_, index) => ({ ...message, id: randomUUID(), text: `message ${index}` }));
  for (const batch of [messages.slice(0, 100), messages.slice(100)]) assert.equal((await call("/api/conversations", { id: paged, title: "Paged", create: true, messages: batch })).status, 200);
  const first = await (await call(`/api/conversations?id=${paged}`)).json(); assert.equal(first.messages.length, 100);
  const second = await (await call(`/api/conversations?id=${paged}&after=${first.nextCursor}`)).json(); assert.equal(second.messages.length, 5);
  fixture.rows.conversations = fixture.rows.conversations.filter((item) => item.id !== paged);
  assert.equal((await call("/api/conversations", { id: paged, title: "Paged", create: false, messages: [message] })).status, 409);
});
test("Reset Vivian deletes the grouped cloud history", async () => {
  const response = await fetch(`${base}/api/memory`, { method: "DELETE", headers: { cookie: sessionCookie("first"), "Content-Type": "application/json" }, body: JSON.stringify({ scope: "all" }) });
  assert.equal(response.status, 200, await response.clone().text()); assert.equal((await (await call("/api/conversations")).json()).conversations.length, 0);
});
