import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startSceneFixture } from "./scene-fixture.mjs";
import { sessionCookie } from "./auth-fixture.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
let fixture, child, base, scene;
before(async () => {
  fixture = await startSceneFixture();
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: fixture.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_only", SUPABASE_URL: fixture.url, SUPABASE_SERVICE_ROLE_KEY: "fixture-admin", GROQ_API_KEY: "fixture-groq", TYPESAFE_API_KEY: "fixture-jev", JEV_ENABLED: "true", GEMINI_API_KEY: "", CEREBRAS_API_KEY: "", OPENROUTER_API_KEY: "", FISH_AUDIO_API_KEY: "", VIVIAN_TEST_SCENE_UPSTREAM: fixture.url, NODE_OPTIONS: `--import ${new URL("./scene-upstream-fixture.mjs", import.meta.url).href}` };
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "0", "-H", "127.0.0.1"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  for (let i = 0; i < 150; i++) {
    base = output.match(/Local:\s+(http:\/\/[^\s]+)/)?.[1];
    if (base) { try { if ((await fetch(`${base}/login`)).ok) return; } catch { /* starting */ } }
    if (child.exitCode !== null) throw new Error(output);
    await delay(200);
  }
  throw new Error(`Scene test app failed: ${output}`);
}, { timeout: 60000 });
after(async () => { child?.kill("SIGTERM"); await fixture?.close(); });
const call = (path, options = {}, kind = "first") => fetch(`${base}${path}`, { ...options, headers: { cookie: sessionCookie(kind), ...options.headers } });
const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
test("real scene routes accept actual image upload, persist private objects, and import a URL", async () => {
  const form = new FormData(); form.set("label", "ห้องนอนตอนกลางคืน"); form.set("image", new File([fixture.png], "../../wallpaper.png", { type: "image/png" }));
  const result = await call("/api/scenes", { method: "POST", body: form });
  const data = await result.json(); assert.equal(result.status, 201, JSON.stringify(data)); scene = data.scene;
  assert.equal(scene.label, "ห้องนอนตอนกลางคืน"); assert.equal(fixture.objects.size, 2);
  const imported = await call("/api/scenes", json({ label: "บ้านของ Vivian", url: "http://images.example.com/wallpaper.png" }));
  assert.equal(imported.status, 201, await imported.clone().text()); assert.equal((await imported.json()).scene.sourceType, "url"); assert.equal(fixture.objects.size, 4);
  const image = await call(scene.imageUrl); assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/png"); assert.match(image.headers.get("cache-control"), /private/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), fixture.png);
  const thumbnail = await call(`${scene.imageUrl}&thumbnail=1`); assert.equal(thumbnail.status, 200); assert.equal(thumbnail.headers.get("content-type"), "image/webp");
});
test("URL preview creates no records; invalid labels/images/private URLs/import failures create no scenes", async () => {
  const count = fixture.rows.vivian_scenes.length;
  const preview = await call("/api/scenes/preview", json({ label: "คาเฟ่", url: "http://images.example.com/a.png" })); assert.equal(preview.status, 200); assert.equal(fixture.rows.vivian_scenes.length, count);
  for (const body of [{ label: "", url: "http://images.example.com/a.png" }, { label: "a".repeat(51), url: "http://images.example.com/a.png" }, { label: "test", url: "http://169.254.169.254/a" }]) assert.equal((await call("/api/scenes", json(body))).status, 400);
  const form = new FormData(); form.set("label", "not image"); form.set("image", new File(["<html>no</html>"], "fake.png", { type: "image/png" })); assert.equal((await call("/api/scenes", { method: "POST", body: form })).status, 400);
  fixture.state.imageFailure = true; assert.equal((await call("/api/scenes", json({ label: "bad source", url: "http://images.example.com/a.png" }))).status, 400); fixture.state.imageFailure = false;
  fixture.state.storageFailure = true;
  const failed = await call("/api/scenes", json({ label: "storage down", url: "http://images.example.com/a.png" })); assert.equal(failed.status, 503); fixture.state.storageFailure = false;
  assert.equal(fixture.rows.vivian_scenes.length, count);
});
test("edit label and replace image preserve ID; access is independently authenticated", async () => {
  const changed = await call(`/api/scenes/${scene.id}`, json({ label: "ห้องนอน" }, "PATCH")); assert.equal(changed.status, 200); assert.equal((await changed.json()).scene.id, scene.id);
  const key = fixture.rows.vivian_scenes.find((row) => row.id === scene.id).image_key;
  const replaced = await call(`/api/scenes/${scene.id}`, json({ label: "ห้องนอน", url: "http://images.example.com/new.png" }, "PATCH")); assert.equal(replaced.status, 200); assert.equal(fixture.objects.has(key), false);
  const signedOut = await fetch(`${base}${scene.imageUrl}`, { redirect: "manual" }); assert.equal(signedOut.status, 401);
  const denied = await call(`/api/scenes/${scene.id}`, { method: "DELETE" }, "denied"); assert.equal(denied.status, 403);
  const foreignId = "00000000-0000-4000-8000-000000000099";
  fixture.rows.vivian_scenes.push({ id: foreignId, user_id: "00000000-0000-0000-0000-000000000002", label: "private", image_key: "other/private.webp" });
  for (const [path, options] of [[`/api/scenes/${foreignId}/image`, {}], [`/api/scenes/${foreignId}`, json({ label: "stolen" }, "PATCH")], [`/api/scenes/${foreignId}`, { method: "DELETE" }], ["/api/scenes/preferences", json({ activeSceneId: foreignId }, "PATCH")]]) assert.equal((await call(path, options)).status, 404);
});
test("manual selection persists; OFF keeps it, ON applies a validated batched JEV decision without image data", async () => {
  const otherScene = fixture.rows.vivian_scenes.find((row) => row.source_type === "url" && row.id !== scene.id);
  let selected = await call("/api/scenes/preferences", json({ activeSceneId: otherScene.id, autoScene: false }, "PATCH")); assert.equal(selected.status, 200);
  const chat = () => call("/api/chat", json({ messages: [{ role: "user", content: "ง่วงแล้ว กลับไปนอนกัน" }] }));
  const off = await chat(); assert.equal(off.status, 200); assert.equal((await off.json()).scene.change, false);
  assert.equal((await (await call("/api/scenes")).json()).preferences.activeSceneId, otherScene.id);
  await call("/api/scenes/preferences", json({ autoScene: true }, "PATCH"));
  const on = await chat(); const reply = await on.json(); assert.equal(on.status, 200, JSON.stringify(reply)); assert.equal(reply.scene.id, scene.id);
  const requests = fixture.modelRequests.filter((request) => request.kind === "jev"); assert.equal(requests.length, 2); assert.equal(Object.keys(requests[1].body.questions).length, 11);
  assert.doesNotMatch(JSON.stringify(fixture.modelRequests), /image_key|imageUrl|imageKey|thumbnailUrl|\/api\/scenes|\/storage\/|data:image/);
  fixture.state.dbFailure = true;
  const failedSceneChat = await chat(); assert.equal(failedSceneChat.status, 200); const failure = await failedSceneChat.json(); assert.equal(failure.scene.change, false); assert.ok(failure.text); fixture.state.dbFailure = false;
});
test("deleting active scene clears preference and removes objects", async () => {
  const key = fixture.rows.vivian_scenes.find((row) => row.id === scene.id).image_key;
  // The per-user API rate limit is intentional; use an independent test IP.
  const response = await call(`/api/scenes/${scene.id}`, { method: "DELETE", headers: { "x-forwarded-for": "127.0.0.2" } }); assert.equal(response.status, 200);
  const library = await (await call("/api/scenes")).json(); assert.equal(library.preferences.activeSceneId, null); assert.equal(fixture.objects.has(key), false);
});
