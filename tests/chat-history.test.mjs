import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { loadSceneModule as load } from "./scene-module-loader.mjs";
const history = load("../lib/chat-history.ts", {}, { crypto: webcrypto });
const store = load("../lib/chat-history-store.ts", { "@/lib/chat-history": history });
const id = "00000000-0000-4000-8000-000000000001";
const msg = history.historyMessage("me", "hello");
test("legacy device conversations receive stable UUIDs before migration and remain recoverable", () => {
  const migrated = history.normalizeHistory([{ id: "daily-talk", title: "Old", updatedAt: 1000, messages: [{ from: "me", text: "remembered" }] }]);
  assert.ok(history.historyUuid(migrated[0].id)); assert.ok(history.historyUuid(migrated[0].messages[0].id));
  assert.deepEqual(JSON.parse(JSON.stringify(history.normalizeHistory(JSON.parse(JSON.stringify(migrated))))), JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(Array.from(history.normalizeHistory(null)), []);
});
test("cloud merge keeps independent device additions and server text wins for an existing ID", () => {
  const local = { id, title: "Local", updatedAt: 1000, messages: [msg, history.historyMessage("vivian", "unsynced")] };
  const remote = { id, title: "Cloud", updatedAt: 2000, messages: [{ ...msg, text: "server", synced: true }, history.historyMessage("vivian", "another device")] };
  const merged = history.mergeHistory([remote], [local])[0];
  assert.equal(merged.messages.length, 3); assert.equal(merged.messages.find((item) => item.id === msg.id).text, "server");
  assert.equal(merged.title, "Cloud");
});
test("write validation rejects forged roles, unstable IDs, duplicate IDs and excessive content", () => {
  const valid = { id, title: "Title", messages: [msg], create: true };
  assert.equal(store.validateHistoryWrite(valid).id, id);
  for (const body of [null, { ...valid, id: "daily-talk" }, { ...valid, create: undefined }, { ...valid, messages: [{ ...msg, from: "system" }] }, { ...valid, messages: [msg, msg] }, { ...valid, messages: [{ ...msg, text: "a".repeat(16001) }] }, { ...valid, messages: [{ ...msg, timestamp: "invalid" }] }]) assert.throws(() => store.validateHistoryWrite(body));
});
test("cloud loader follows conversation and message cursors past the first page", async () => {
  const calls = [];
  const client = load("../lib/chat-history-client.ts", { "@/lib/auth/fetch": { authFetch: async (url) => {
    calls.push(url);
    if (url.includes("offset=0")) return Response.json({ conversations: [{ id, title: "Title", updatedAt: 1000, messages: [] }], nextOffset: 50 });
    if (url.includes("offset=50")) return Response.json({ conversations: [], nextOffset: null });
    if (url.includes("after=0")) return Response.json({ messages: Array.from({ length: 100 }, (_, index) => ({ ...msg, id: `${index}` })), nextCursor: "100" });
    return Response.json({ messages: [{ ...msg, timestamp: "2000-01-01T00:00:00.000Z" }], nextCursor: null });
  } } });
  const result = await client.fetchHistory(); assert.equal(result[0].messages.length, 101);
  assert.equal(result[0].messages[0].timestamp, "2000-01-01T00:00:00.000Z");
  assert.equal(result[0].cloud, true); assert.equal(result[0].messages[0].synced, true); assert.equal(calls.length, 4);
});
test("unavailable cloud data and failed writes throw instead of claiming successful sync", async () => {
  const client = load("../lib/chat-history-client.ts", { "@/lib/auth/fetch": { authFetch: async () => Response.json({ error: "Unavailable" }, { status: 503 }) } });
  await assert.rejects(client.fetchHistory(), /Unavailable/);
  await assert.rejects(client.appendHistory({ id, title: "Title" }, [msg], true), /Unavailable/);
});
test("history route rejects signed-out requests before body parsing or database access", async () => {
  const denied = Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const route = load("../app/api/conversations/route.ts", {
    "@/lib/auth/server": { requireApiAccess: async () => denied },
    "@/lib/supabase-admin": { getSupabaseAdmin: () => assert.fail("No DB access") },
    "@/lib/chat-history-store": store,
    "@/lib/scenes": load("../lib/scenes.ts"),
    "@/lib/scene-images": { readBoundedSceneBody: () => assert.fail("No body read") },
    "@/lib/rate-limit": { rateLimit: () => assert.fail("No work before auth") },
  });
  assert.equal(await route.GET(new Request("https://vivian.example/api/conversations")), denied);
  assert.equal(await route.PUT(new Request("https://vivian.example/api/conversations", { method: "PUT", body: "invalid" })), denied);
});
