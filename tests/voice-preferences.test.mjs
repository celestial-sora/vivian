import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as values from "../lib/voice-preferences.ts";
const source = ts.transpileModule(readFileSync(new URL("../app/api/voice/preferences/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let stored;
function handler(denied = null, unavailable = false) {
  const exports = {};
  runInNewContext(source, { exports, Response, Error, Date, AbortSignal, require(name) {
    if (name === "@/lib/auth/server") return { requireApiAccess: async () => denied };
    if (name === "@/lib/voice-preferences") return values;
    if (name === "@/lib/supabase-admin") return { getSupabaseAdmin() {
      if (unavailable) throw new Error();
      return { from(table) {
        assert.equal(table, "vivian_voice_preferences");
        let write;
        const query = {
          upsert(row, options) { assert.equal(row.id, "global"); assert.equal(options.onConflict, "id"); write = row.speaking_speed; return query; },
          select(column) { assert.equal(column, "speaking_speed"); return query; },
          eq(column, key) { assert.equal(column, "id"); assert.equal(key, "global"); return query; },
          async single() { stored = write; return { data: { speaking_speed: stored }, error: null }; },
          async maybeSingle() { return { data: stored === undefined ? null : { speaking_speed: stored }, error: null }; },
        }; return query;
      } };
    } };
    throw new Error(name);
  } });
  return exports;
}
const request = value => new Request("https://vivian.example/api/voice/preferences", { method: "PATCH", body: JSON.stringify(value) });
test("speed survives a new handler/account and uses one shared singleton", async () => {
  stored = undefined;
  assert.equal((await (await handler().GET(new Request("https://vivian.example"))).json()).speakingSpeed, .98);
  const saved = await handler().PATCH(request({ speakingSpeed: 1.06, userId: "ignored-account" }));
  assert.equal(saved.status, 200);
  const loaded = await handler().GET(new Request("https://vivian.example"));
  assert.equal((await loaded.json()).speakingSpeed, 1.06);
  assert.equal(loaded.headers.get("cache-control"), "private, no-store");
});
test("invalid speed cannot overwrite the global value", async () => {
  stored = 1.06;
  for (const speakingSpeed of [0, 1.21, "1.06", null]) assert.equal((await handler().PATCH(request({ speakingSpeed }))).status, 400);
  assert.equal(stored, 1.06);
});
test("unauthorized callers cannot read or write; cloud failure is explicit", async () => {
  const denied = Response.json({}, { status: 403 });
  assert.equal(await handler(denied, true).PATCH(request({ speakingSpeed: 1 })), denied);
  assert.equal(await handler(denied, true).GET(new Request("https://vivian.example")), denied);
  assert.equal((await handler(null, true).PATCH(request({ speakingSpeed: 1 }))).status, 503);
});
