import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import sharp from "sharp";
import { loadSceneModule as load } from "./scene-module-loader.mjs";
const scenes = load("../lib/scenes.ts");
const images = load("../lib/scene-images.ts", { "@/lib/scenes": scenes });
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#94618e" } }).png().toBuffer();
function imageFixture({ address = "93.184.216.34", addresses, status = 200, mime = "image/png", bytes = png, headers = {}, stall = false, resolveStall = false } = {}) {
  const calls = [], resolutions = [];
  const http = { get(url, options, callback) {
    calls.push({ url: url.href, options });
    const request = new EventEmitter(); request.destroy = () => {};
    options.lookup(url.hostname, {}, (_error, ip) => { assert.equal(ip, address); });
    queueMicrotask(() => {
      if (stall) { options.signal.addEventListener("abort", () => request.emit("error", options.signal.reason), { once: true }); return; }
      const response = Readable.from([bytes]); response.statusCode = status; response.headers = { "content-type": mime, ...headers };
      callback(response);
    });
    return request;
  } };
  const sceneModule = load("../lib/scene-images.ts", { "@/lib/scenes": scenes, "node:http": http, "node:https": http, "node:dns/promises": { lookup: async (host) => { resolutions.push(host); if (resolveStall) return new Promise(() => {}); return addresses ?? [{ address, family: 4 }]; } } });
  return { module: sceneModule, calls, resolutions };
}

test("user labels are mandatory, short, Unicode-safe and never derived from images", () => {
  assert.equal(scenes.validateSceneLabel(" ห้องนอนตอนกลางคืน "), "ห้องนอนตอนกลางคืน");
  assert.equal(scenes.validateSceneLabel("บ้านของ Vivian"), "บ้านของ Vivian");
  assert.equal(scenes.validateSceneLabel("😀".repeat(50)).length, 100);
  for (const label of [null, 12, "", "  ", "a".repeat(51), "a\nb", "<script>", "a\u202eb"]) assert.throws(() => scenes.validateSceneLabel(label));
});
test("image decoder validates real content, strips metadata and produces bounded WebP and thumbnail", async () => {
  const original = await sharp({ create: { width: 2500, height: 2000, channels: 3, background: "red" } }).withMetadata().jpeg().toBuffer();
  const result = await images.normalizeSceneImage(original, "image/jpeg");
  const full = await sharp(result.image).metadata(); const thumb = await sharp(result.thumbnail).metadata();
  assert.equal(full.format, "webp"); assert.equal(full.width, 1920); assert.equal(full.exif, undefined); assert.equal(full.icc, undefined);
  assert.ok(thumb.width <= 480 && thumb.height <= 300);
  for (const [bytes, mime] of [[Buffer.from("<html>no</html>"), "image/png"], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/png"], [png, "text/html"], [png, "image/jpeg"], [Buffer.alloc(scenes.SCENE_MAX_BYTES + 1), "image/png"]]) await assert.rejects(images.normalizeSceneImage(bytes, mime));
});
test("upload parsing requires manual label and ignores user filenames", async () => {
  const form = new FormData(); form.set("label", "ห้องนอน"); form.set("image", new File([png], "../../unsafe.png", { type: "image/png" }));
  const result = await images.readSceneInput(new Request("https://vivian.example/api/scenes", { method: "POST", body: form }));
  assert.equal(result.sourceType, "upload"); assert.equal(result.label, "ห้องนอน"); assert.equal(result.bytes.equals(png), true); assert.equal(result.filename, undefined);
  form.delete("label"); await assert.rejects(images.readSceneInput(new Request("https://vivian.example/api/scenes", { method: "POST", body: form })));
});
test("URL import uses a validated pinned address and preserves the exact manual semantic label", async () => {
  const fixture = imageFixture();
  const result = await fixture.module.readSceneInput(new Request("https://vivian.example/api/scenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "บ้านของ Vivian", url: "https://images.example.com/wallpaper.png" }) }));
  assert.equal(result.sourceType, "url"); assert.equal(result.label, "บ้านของ Vivian"); assert.ok(result.bytes.equals(png));
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].options.agent, false); assert.equal(fixture.calls[0].options.family, 4);
  assert.equal(fixture.calls[0].options.headers.Authorization, undefined);
});
test("SSRF URL validation blocks local/private/reserved/metadata addresses, schemes and credentials", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/image", "http://localhost/a", "http://localhost./a", "http://127.1/a", "http://2130706433/a", "http://0x7f000001/a", "http://10.0.0.1/a", "http://172.31.0.1/a", "http://192.168.1.1/a", "http://169.254.169.254/latest/meta-data", "http://168.63.129.16/a", "http://100.100.100.200/a", "http://metadata.google.internal/a", "http://[::1]/a", "http://[::ffff:127.0.0.1]/a", "http://[fc00::1]/a", "http://example.internal/a", "http://example.com:8080/a", "https://user:pass@example.com/a", "not a url"]) assert.throws(() => images.validateSceneUrl(url), url);
  for (const ip of ["0.0.0.0", "168.63.129.16", "127.0.0.1", "192.0.0.1", "192.0.2.1", "198.18.1.1", "224.0.0.1", "255.255.255.255", "::", "fe80::1", "2001:db8::1", "2002:7f00:1::", "::ffff:10.0.0.1"]) assert.equal(images.isPublicSceneAddress(ip), false, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(images.isPublicSceneAddress(ip), true, ip);
});
test("SSRF resolves all answers and blocks private DNS or unsafe redirects before connecting", async () => {
  for (const addresses of [[{ address: "127.0.0.1", family: 4 }], [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
    const fixture = imageFixture({ addresses }); await assert.rejects(fixture.module.fetchSceneImage("https://images.example.com/a")); assert.equal(fixture.calls.length, 0);
  }
  const fixture = imageFixture({ status: 302, headers: { location: "http://169.254.169.254/a" } });
  await assert.rejects(fixture.module.fetchSceneImage("https://images.example.com/a")); assert.equal(fixture.calls.length, 1);
  const loop = imageFixture({ status: 302, headers: { location: "/loop" } });
  await assert.rejects(loop.module.fetchSceneImage("https://images.example.com/a")); assert.equal(loop.calls.length, 4);
});
test("URL download limits actual bytes, declared size, MIME, encoding, status and timeout", async () => {
  for (const options of [{ mime: "text/html" }, { status: 404 }, { headers: { "content-length": String(scenes.SCENE_MAX_BYTES + 1) } }, { bytes: Buffer.alloc(scenes.SCENE_MAX_BYTES + 1) }, { headers: { "content-encoding": "gzip" } }]) await assert.rejects(imageFixture(options).module.fetchSceneImage("https://images.example.com/a"));
  for (const phase of ["stall", "resolveStall"]) {
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(imageFixture({ [phase]: true }).module.fetchSceneImage("https://images.example.com/a", AbortSignal.timeout(15))); } finally { clearTimeout(keepAlive); }
  }
});

// Supabase fluent API fixture exercises real scene service logic without touching
// live memories, users or objects. SQL constraints are separately verified.
function storeFixture() {
  const rows = { vivian_scenes: [], vivian_scene_preferences: [], vivian_scene_image_gc: [] };
  const objects = new Map(); const operations = [];
  let failure = null;
  const db = { from(table) {
    let action = "select", values, filters = [], count = false, head = false, single = false, limit = Infinity, columns = "*";
    const q = {
      select(selectedColumns, options = {}) { columns = selectedColumns; count = options.count; head = options.head; return q; },
      eq(key, value) { filters.push((row) => row[key] === value); return q; },
      lt(key, value) { filters.push((row) => row[key] < value); return q; },
      order() { return q; }, limit(value) { limit = value; return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(value) { action = "insert"; values = value; return q; },
      upsert(value, options) { action = "upsert"; values = value; q.ignoreDuplicates = options?.ignoreDuplicates; return q; },
      update(value) { action = "update"; values = value; return q; }, delete() { action = "delete"; return q; },
      async then(resolve, reject) {
        try {
          operations.push({ table, action });
          if (failure === `${table}:${action}`) return resolve({ data: null, error: new Error("fixture DB failure") });
          let result = rows[table].filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
          const defaults = (value) => ({ auto_scene: false, active_scene_id: null, preset: null, revision: "fixture-revision", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...value });
          if (action === "insert") { result = [defaults(values)]; rows[table].push(...result); }
          if (action === "upsert") { const exists = rows[table].find((row) => table === "vivian_scene_image_gc" ? row.image_key === values.image_key : row.user_id === values.user_id); if (!exists) rows[table].push(defaults(values)); else if (!q.ignoreDuplicates) Object.assign(exists, values); result = [exists ?? rows[table].at(-1)]; }
          if (action === "update") { for (const row of result) { if (table === "vivian_scenes" && values.image_key && values.image_key !== row.image_key) rows.vivian_scene_image_gc.push({ user_id: row.user_id, image_key: row.image_key }); Object.assign(row, values); } }
          if (action === "delete") { for (const row of result) { rows[table].splice(rows[table].indexOf(row), 1); if (table === "vivian_scenes") { rows.vivian_scene_image_gc.push({ user_id: row.user_id, image_key: row.image_key }); for (const preference of rows.vivian_scene_preferences) if (preference.active_scene_id === row.id) preference.active_scene_id = null; } } }
          const projected = result.map((row) => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((key) => [key, row[key]])));
          return resolve({ data: head ? null : single ? projected[0] ?? null : projected, count: count ? result.length : null, error: null });
        } catch (error) { reject(error); }
      },
    }; return q;
  }, storage: { from(bucket) {
    assert.equal(bucket, "vivian-scenes");
    return {
      async upload(key, bytes, options) { operations.push({ upload: key, options }); if (failure === "upload" || failure === "thumbnail" && key.endsWith(".thumb.webp")) return { error: new Error("storage offline") }; objects.set(key, bytes); return { error: null }; },
      async remove(keys) { if (failure === "remove") return { error: new Error("storage offline") }; keys.forEach((key) => objects.delete(key)); return { error: null }; },
      async download(key) { return objects.has(key) ? { data: new Blob([objects.get(key)], { type: "image/webp" }), error: null } : { data: null, error: new Error("missing") }; },
      async info(key) { return { error: !objects.has(key) || failure === "info" ? new Error("missing") : null }; },
    };
  } } };
  const sceneModule = load("../lib/scene-store.ts", { "@/lib/scenes": scenes, "@/lib/cloud-store": {}, "@/lib/r2": {}, "@supabase/supabase-js": { createClient: () => db } }, { process: { env: { SUPABASE_URL: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture" } } });
  return { db, rows, objects, operations, module: sceneModule, fail: (value) => { failure = value; } };
}
const image = await images.normalizeSceneImage(png, "image/png");
async function create(fixture, userId = owner, sourceType = "upload") { return fixture.module.saveScene(fixture.db, userId, { label: "ห้องนอน", sourceType, ...image }); }

test("upload and URL creation persist keys in private storage and only presentation references in API data", async () => {
  for (const source of ["upload", "url"]) {
    const f = storeFixture(); const scene = await create(f, owner, source);
    assert.equal(scene.label, "ห้องนอน"); assert.equal(scene.sourceType, source); assert.equal(f.rows.vivian_scenes[0].user_id, owner); assert.equal(f.objects.size, 2);
    assert.ok(f.rows.vivian_scenes[0].image_key.startsWith(`${owner}/`)); assert.doesNotMatch(JSON.stringify(scene), /image_key|imageKey|data:|https:/);
    const library = await f.module.getSceneLibrary(f.db, owner); assert.equal(library.scenes.length, 1); assert.equal(library.preferences.autoScene, false);
    assert.equal((await f.module.getSceneLibrary(f.db, other)).scenes.length, 0);
  }
});
test("ownership is enforced for image access, updates, selection and deletion", async () => {
  const f = storeFixture(); const scene = await create(f);
  for (const operation of [() => f.module.getScene(f.db, other, scene.id), () => f.module.getSceneImage(f.db, other, scene.id, false), () => f.module.saveScene(f.db, other, { label: "changed" }, scene.id), () => f.module.setScenePreferences(f.db, other, { activeSceneId: scene.id }), () => f.module.deleteScene(f.db, other, scene.id)]) await assert.rejects(operation(), (error) => error.status === 404);
  assert.equal(f.rows.vivian_scenes[0].label, "ห้องนอน"); assert.equal(f.objects.size, 2);
});
test("label editing, image replacement and active deletion clean objects and preserve safe selection", async () => {
  const f = storeFixture(); const scene = await create(f); const oldKey = f.rows.vivian_scenes[0].image_key;
  const edited = await f.module.saveScene(f.db, owner, { label: "บ้านของ Vivian" }, scene.id); assert.equal(edited.label, "บ้านของ Vivian"); assert.equal(f.rows.vivian_scenes[0].image_key, oldKey);
  await f.module.setScenePreferences(f.db, owner, { autoScene: true });
  const selected = await f.module.setScenePreferences(f.db, owner, { activeSceneId: scene.id }); assert.equal(selected.autoScene, true); assert.equal(selected.activeSceneId, scene.id);
  await f.module.saveScene(f.db, owner, { label: "บ้านของ Vivian", sourceType: "url", ...image }, scene.id); assert.equal(f.objects.size, 2); assert.equal(f.objects.has(oldKey), false);
  await f.module.deleteScene(f.db, owner, scene.id); assert.equal(f.objects.size, 0); assert.equal(f.rows.vivian_scenes.length, 0); assert.equal(f.rows.vivian_scene_preferences[0].active_scene_id, null);
});
test("default selection and Auto Scene OFF persist without losing the manual scene", async () => {
  const f = storeFixture(); const scene = await create(f);
  await f.module.setScenePreferences(f.db, owner, { activeSceneId: scene.id });
  const off = await f.module.setScenePreferences(f.db, owner, { autoScene: false }); assert.equal(off.activeSceneId, scene.id);
  const preset = await f.module.setScenePreferences(f.db, owner, { preset: "night" }); assert.equal(preset.activeSceneId, null); assert.equal(preset.preset, "night");
  assert.equal(await f.module.loadSceneContext(owner), null);
});
test("storage, thumbnail and record creation failures cannot leave broken scenes or untracked objects", async () => {
  for (const failure of ["upload", "thumbnail", "vivian_scenes:insert"]) {
    const f = storeFixture(); f.fail(failure); await assert.rejects(create(f)); assert.equal(f.rows.vivian_scenes.length, 0); assert.equal(f.objects.size, 0);
  }
  const f = storeFixture(); const scene = await create(f); f.fail("remove"); await f.module.deleteScene(f.db, owner, scene.id);
  assert.equal(f.rows.vivian_scenes.length, 0); assert.equal(f.rows.vivian_scene_image_gc.length, 1); f.rows.vivian_scene_image_gc[0].created_at = "2020-01-01";
  f.fail(null); await f.module.cleanupSceneImages(owner); assert.equal(f.objects.size, 0); assert.equal(f.rows.vivian_scene_image_gc.length, 0);
});
test("scene context excludes objects and Harness checks ownership, availability, enabled state and stale preference revisions", async () => {
  const f = storeFixture(); const scene = await create(f);
  await f.module.setScenePreferences(f.db, owner, { autoScene: true });
  const context = await f.module.loadSceneContext(owner); assert.deepEqual(Object.keys(context.scenes[0]).sort(), ["id", "label"]);
  const decision = { change: true, id: scene.id };
  const result = await f.module.executeSceneDecision(context, decision); assert.equal(result.change, true); assert.equal(result.id, scene.id);
  assert.equal((await f.module.executeSceneDecision(context, decision)).change, false);
  for (const ctx of [null, { ...context, autoScene: false }, { ...context, userId: other }, { ...context, activeSceneId: scene.id }]) assert.equal((await f.module.executeSceneDecision(ctx, decision)).change, false);
  assert.equal((await f.module.executeSceneDecision(context, { change: true, id })).change, false);
  assert.equal((await f.module.executeSceneDecision(context, { change: false })).change, false);
  assert.equal((await f.module.executeSceneDecision(context, { change: "true", id: scene.id })).change, false);
  const latest = await f.module.loadSceneContext(owner); f.fail("info"); assert.equal((await f.module.executeSceneDecision({ ...latest, activeSceneId: null }, decision)).change, false);
});

test("chunked API bodies cannot exceed upload/JSON/settings limits", async () => {
  const request = new Request("https://vivian.example/api/scenes", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024)); controller.enqueue(new Uint8Array(1025)); controller.close(); } }), duplex: "half" });
  await assert.rejects(images.readBoundedSceneBody(request, 2048), (error) => error.status === 413);
  const huge = new Request("https://vivian.example/api/scenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(64 * 1024 + 1) });
  await assert.rejects(images.readSceneInput(huge), (error) => error.status === 413);
});

test("execution rechecks Auto Scene OFF and newer manual selections even after JEV approved a scene", async () => {
  const f = storeFixture(); const bedroom = await create(f); const cafe = await create(f);
  await f.module.setScenePreferences(f.db, owner, { autoScene: true });
  const turn = await f.module.loadSceneContext(owner);
  await f.module.setScenePreferences(f.db, owner, { activeSceneId: cafe.id });
  assert.equal((await f.module.executeSceneDecision(turn, { change: true, id: bedroom.id })).change, false);
  const nextTurn = await f.module.loadSceneContext(owner);
  await f.module.setScenePreferences(f.db, owner, { autoScene: false });
  assert.equal((await f.module.executeSceneDecision(nextTurn, { change: true, id: bedroom.id })).change, false);
  assert.equal(f.rows.vivian_scene_preferences[0].active_scene_id, cafe.id);
});
