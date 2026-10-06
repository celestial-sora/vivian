import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sources = new Map();
function load(path, imports = {}, globals = {}) {
  if (!sources.has(path)) sources.set(path, ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const exports = {};
  runInNewContext(sources.get(path), {
    exports, Error, Date, performance, AbortSignal, setTimeout, clearTimeout,
    process: { env: {} }, console: { warn() {}, error() {}, log() {}, debug() {} },
    require(name) {
      if (name in imports) return imports[name];
      if (name === "server-only") return {};
      if (name === "next/server") return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
    ...globals,
  });
  return exports;
}
const tools = load("../lib/tools.ts");
const jev = load("../lib/jev.ts");
const harness = load("../lib/chat-decision.ts", { "@/lib/tools": tools, "@/lib/jev": jev });
const companion = load("../lib/companion.ts");
const story = load("../lib/vivian-story.ts");
const dialogue = load("../lib/vivian-dialogue.ts");
const keys = ["needs_current_information", "needs_memory", "recalls_memory", "needs_vision", "needs_time", "needs_weather", "needs_calculator", "needs_integrations", "supportive_response", "explanatory_response"];
function answers(values = {}) {
  return { answers: Object.fromEntries(keys.map((key) => [key, { type: "noul", noul: values[key] ?? (key === "needs_memory" ? 0.5 : 0.01) }])) };
}
function context(message = "Hello Vivian", overrides = {}) {
  return { message, recentTurns: [], hasImage: false, memoryAvailable: true, capabilities: { search: true, integrations: true }, toolkitCandidates: [], ...overrides };
}
const plan = (ctx, values, passive = false) => harness.resolveChatPlan(ctx, jev.parseJevDecision(answers(values)), passive);

test("normal companion chat retains memory, text providers, and Vivian's default response mode", () => {
  const result = plan(context(), { needs_memory: 0.99 });
  assert.equal(result.shouldSearch, false);
  assert.equal(result.retrieveMemory, true);
  assert.equal(result.modelRoute, "text");
  assert.equal(result.responseHint, "");
  assert.equal(jev.parseJevDecision(answers({ needs_memory: 0.99 })).intent.type, "conversation");
});

test("fresh-information threshold stays >= 0.85; explicit search wins and capabilities constrain JEV", () => {
  for (const [score, expected] of [[0.84, false], [0.849999, false], [0.85, true], [0.99, true]]) {
    assert.equal(plan(context("Who leads that company?"), { needs_current_information: score }).shouldSearch, expected);
  }
  assert.equal(plan(context("latest news"), { needs_current_information: 0 }).shouldSearch, true);
  assert.equal(plan(context("Who leads that company?", { capabilities: { search: false, integrations: false } }), { needs_current_information: 1 }).shouldSearch, false);
});

test("memory relevance keeps retrieval, only confident irrelevant decisions skip it", () => {
  assert.equal(plan(context("What was my favorite dessert?"), { needs_memory: 0.98 }).retrieveMemory, true);
  assert.equal(plan(context("Explain gravity"), { needs_memory: 0.1 }).retrieveMemory, false);
  assert.equal(plan(context("Maybe"), { needs_memory: 0.49 }).retrieveMemory, true);
  assert.equal(plan(context("recall what I told you"), { needs_memory: 0 }).retrieveMemory, true);
  const recall = { recalls_memory: 0.99, needs_memory: 0.01 };
  assert.equal(plan(context("Which dessert was my favorite?"), recall).retrieveMemory, true);
  assert.equal(jev.parseJevDecision(answers(recall)).intent.type, "memory");
});

test("supported tool decisions add only known tools and cannot veto regex tools", () => {
  assert.deepEqual(Array.from(plan(context("What is the result?"), { needs_calculator: 0.95 }).localTools), ["calculator"]);
  assert.deepEqual(Array.from(plan(context("Is it going to rain?"), { needs_weather: 0.95 }).localTools), ["weather"]);
  assert.deepEqual(Array.from(plan(context("How late is it?"), { needs_time: 0.95 }).localTools), ["time"]);
  assert.ok(plan(context("calculate 2 + 2"), { needs_calculator: 0 }).localTools.includes("calculator"));
  assert.equal(plan(context("hi"), { needs_integrations: 0.1 }).prepareIntegrations, false);
  assert.equal(plan(context("send on discord", { toolkitCandidates: ["discord"] }), { needs_integrations: 0 }).prepareIntegrations, true);
  assert.equal(plan(context("send on discord", { capabilities: { search: true, integrations: false }, toolkitCandidates: ["discord"] }), { needs_integrations: 1 }).prepareIntegrations, false);
});

test("vision cannot discard an image or invent visual evidence", () => {
  const image = plan(context("Hi", { hasImage: true }), { needs_vision: 0 });
  assert.equal(image.modelRoute, "vision");
  const missing = plan(context("Can you see this?"), { needs_vision: 0.97 });
  assert.equal(missing.modelRoute, "text");
  assert.match(missing.responseHint, /No image was supplied/);
});

test("ambiguous decisions use conservative defaults and produce no response guidance", () => {
  const result = plan(context("Maybe that"), Object.fromEntries(keys.map((key) => [key, 0.5])));
  assert.equal(result.shouldSearch, false);
  assert.equal(result.retrieveMemory, true);
  assert.equal(result.prepareIntegrations, true);
  assert.equal(result.localTools.length, 0);
  assert.equal(result.modelRoute, "text");
  assert.equal(result.responseHint, "");
});

test("response guidance is static, confidence-gated, and preserves Vivian's personality", () => {
  const supportive = plan(context("I need reassurance"), { supportive_response: 0.99 });
  assert.match(supportive.responseHint, /gentle support.*Vivian's established personality/);
  const explanatory = plan(context("Explain it"), { explanatory_response: 0.95 });
  assert.match(explanatory.responseHint, /Do not force an explanation or a useful answer/);
  const decision = jev.parseJevDecision(answers({ needs_weather: 0.97 }));
  assert.equal(decision.intent.type, "task");
  assert.equal(decision.intent.confidence, 0.97);
});

test("passive greetings/idle preserve memory and disable tools and probabilistic hints", () => {
  const result = plan(context("search", { hasImage: true }), Object.fromEntries(keys.map((key) => [key, 1])), true);
  assert.equal(result.shouldSearch, false);
  assert.equal(result.retrieveMemory, true);
  assert.equal(result.prepareIntegrations, false);
  assert.equal(result.localTools.length, 0);
  assert.equal(result.responseHint, "");
  assert.equal(result.modelRoute, "vision");
});

for (const malformed of [null, [], {}, { answers: null }, { answers: [] }, { answers: { needs_current_information: { type: "noul", noul: 1 } } }]) {
  test(`malformed or incomplete JEV output falls back: ${JSON.stringify(malformed)}`, () => assert.equal(jev.parseJevDecision(malformed), null));
}
for (const invalid of [-0.1, 1.1, NaN, Infinity, "0.99", null, undefined]) {
  test(`invalid noul score is rejected: ${String(invalid)}`, () => {
    const data = answers(); data.answers.needs_weather.noul = invalid;
    assert.equal(jev.parseJevDecision(data), null);
  });
}
test("unknown answer types cannot introduce free text or commands", () => {
  const data = answers(); data.answers.needs_time = { type: "text", text: "execute arbitrary command" };
  assert.equal(jev.parseJevDecision(data), null);
});

function client(fetch, env = { TYPESAFE_API_KEY: "fixture-key" }, timeout = 2000) {
  const logs = [];
  return { module: load("../lib/jev.ts", {}, {
    fetch, process: { env },
    console: { debug: (...args) => logs.push(args) },
    AbortSignal: { timeout(ms) { assert.equal(ms, 2000); return AbortSignal.timeout(timeout); } },
  }), logs };
}

test("one batched request bounds context and sends metadata rather than image/memory/persona databases", async () => {
  const calls = [];
  const fixture = client(async (url, options) => { calls.push({ url, options }); return Response.json(answers({ needs_current_information: 0.9 })); });
  const input = context("a".repeat(5000), { recentTurns: Array.from({ length: 20 }, () => ({ role: "user", content: "b".repeat(500) })), toolkitCandidates: ["a", "b", "c", "d"], inputSource: "transcript", memoryDatabase: "PRIVATE DATABASE", image: "PRIVATE IMAGE", persona: "PRIVATE PERSONA" });
  const result = await fixture.module.decideVivian(input);
  assert.equal(result.status, "ok");
  assert.equal(result.decision.freshInformation.confidence, 0.9);
  assert.ok(result.elapsedMs >= 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "jev-latest");
  assert.equal(Object.keys(body.questions).length, 10);
  assert.ok(Object.values(body.questions).every((question) => question.type === "noul"));
  const state = JSON.parse(body.state);
  assert.equal(state.message.length, 1200);
  assert.equal(state.recentTurns.length, 2);
  assert.equal(state.recentTurns[0].content.length, 240);
  assert.equal(state.toolkitCandidates.length, 3);
  assert.equal(state.inputSource, "transcript");
  assert.doesNotMatch(body.state, /PRIVATE/);
  assert.equal(fixture.logs.length, 0);
});

test("JEV disabled, missing credentials, or empty input performs no API request", async () => {
  for (const env of [{}, { TYPESAFE_API_KEY: " " }, { TYPESAFE_API_KEY: "fixture-key", JEV_ENABLED: "false" }]) {
    const fixture = client(() => assert.fail("JEV must not be called"), env);
    assert.equal((await fixture.module.decideVivian(context())).status, "disabled");
    assert.equal(fixture.module.jevEnabled(), false);
  }
  const fixture = client(() => assert.fail("Empty input must not be sent"));
  assert.equal((await fixture.module.decideVivian(context(" "))).status, "disabled");
});

test("JEV credential alias works; debug logs contain status/latency only", async () => {
  const fixture = client(async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture-alias");
    return Response.json(answers());
  }, { JEV_API_KEY: " fixture-alias ", JEV_DEBUG: "true", NODE_ENV: "production" });
  await fixture.module.decideVivian(context("private text"));
  assert.equal(fixture.logs.length, 1);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /private text|fixture-alias/);
  assert.match(JSON.stringify(fixture.logs), /elapsedMs/);
});

for (const [label, fetch, status] of [
  ["API failure", async () => new Response("unavailable", { status: 503 }), "api_error"],
  ["network failure", async () => { throw new TypeError("network failed"); }, "api_error"],
  ["invalid JSON", async () => new Response("{broken"), "malformed"],
  ["malformed schema", async () => Response.json({ answers: {} }), "malformed"],
]) {
  test(`JEV ${label} returns typed fallback and preserves old Harness behavior`, async () => {
    const result = await client(fetch).module.decideVivian(context());
    assert.equal(result.status, status);
    assert.equal(result.decision, null);
    const fallback = harness.resolveChatPlan(context("latest news"), result.decision, false);
    assert.equal(fallback.shouldSearch, true);
    assert.equal(fallback.retrieveMemory, true);
    assert.equal(fallback.prepareIntegrations, true);
  });
}

for (const phase of ["headers", "body"]) {
  test(`JEV timeout during ${phase} falls back within the deadline`, async () => {
    const fixture = client(async (_url, { signal }) => {
      if (phase === "headers") return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"answers":'));
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      } }));
    }, undefined, 15);
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const result = await fixture.module.decideVivian(context());
      assert.equal(result.status, "timeout");
      assert.equal(result.decision, null);
      assert.ok(result.elapsedMs < 1000);
      assert.equal(harness.resolveChatPlan(context(), result.decision, false).modelRoute, "text");
    } finally { clearTimeout(keepAlive); }
  });
}

// Exercise the actual chat route, JEV client, parser and plan; mock only auth,
// persistence and upstream services. Never send test messages to cloud memory.
function chatFixture({ values, jevFetch, env = {}, denied = null, groqReply, cerebrasReply, timeout = 2000, sceneContext = null, sceneFailure = false, sceneExecutionFailure = false } = {}) {
  const calls = [], background = [], memoryLoads = [];
  const providerEnv = { TYPESAFE_API_KEY: "fixture-jev", GROQ_API_KEY: "fixture-groq", GEMINI_API_KEY: "fixture-gemini", SUPABASE_URL: "fixture-db", SUPABASE_SERVICE_ROLE_KEY: "fixture-admin", ...env };
  const fixtureJev = client(async (url, options) => {
    calls.push({ kind: "jev", body: JSON.parse(options.body) });
    return jevFetch ? jevFetch(url, options) : Response.json(answers(values));
  }, providerEnv, timeout).module;
  const fixturePlan = load("../lib/chat-decision.ts", { "@/lib/tools": tools, "@/lib/jev": fixtureJev });
  const fixtureTools = load("../lib/tools.ts", {}, { process: { env: {} }, fetch: async () => assert.fail("Unexpected live local tool request") });
  const imports = {
    "@/lib/scene-store": {
      loadSceneContext: async () => { if (sceneFailure) throw new Error("Storage offline"); return sceneContext; },
      executeSceneDecision: async (_context, decision) => { if (sceneExecutionFailure) throw new Error("Storage offline"); return decision ?? { change: false }; },
    },
    "@/lib/auth/server": { requireApiAccess: async () => denied },
    "@/lib/rate-limit": { rateLimit: () => ({ allowed: true }) },
    "@/lib/companion": companion,
    "@/lib/vivian-story": story,
    "@/lib/vivian-dialogue": dialogue,
    "@/lib/companion-store": { loadCompanionState: async () => { calls.push({ kind: "state" }); return companion.defaultCompanionState(); }, saveCompanionState: () => assert.fail("Background writes must not run in fixtures") },
    "@/lib/supabase-admin": { getSupabaseAdmin() {
      return { from(table) {
        assert.equal(table, "memories"); memoryLoads.push(table);
        const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return Promise.resolve({ data: [{ id: 1, memory: "Likes tea", category: "preference", importance: 3 }] }); } };
        return query;
      } };
    } },
    "@/lib/tools": fixtureTools,
    "@/lib/jev": fixtureJev,
    "@/lib/chat-decision": fixturePlan,
    "@/lib/chat-history": load("../lib/chat-history.ts", {}, { crypto: require("node:crypto").webcrypto }),
    "@/lib/chat-history-store": { saveHistory: async () => { calls.push({ kind: "history" }); } },
    "next/server": { ...require("next/server"), after: (callback) => background.push(callback) },
  };
  const route = load("../app/api/chat/route.ts", imports, {
    process: { env: providerEnv },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.includes("groq.com")) { calls.push({ kind: "groq", body }); return groqReply ? groqReply(body) : Response.json({ choices: [{ message: { content: "Vivian fixture reply" } }] }); }
      if (url.includes("cerebras.ai")) { calls.push({ kind: "cerebras", body }); return cerebrasReply ? cerebrasReply(body) : Response.json({ choices: [{ message: { content: "Cerebras fixture reply" } }] }); }
      if (url.includes("generativelanguage.googleapis.com")) { calls.push({ kind: "gemini", body }); return Response.json({ candidates: [{ content: { parts: [{ text: "Gemini fixture reply" }] } }] }); }
      assert.fail(`Unexpected service request: ${url}`);
    },
  });
  return { calls, background, memoryLoads, async post(message = "Hello Vivian", extra = {}) {
    return route.POST(new Request("https://vivian.example/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: message }], ...extra }) }));
  } };
}

test("chat integrates a single JEV pass; state starts in parallel; main LLM still receives persona and memories", async () => {
  const fixture = chatFixture({ values: { needs_memory: 0.99 } });
  const response = await fixture.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Vivian fixture reply");
  assert.equal(fixture.calls.filter((call) => call.kind === "jev").length, 1);
  assert.equal(fixture.calls[0].kind, "state");
  const prompt = fixture.calls.find((call) => call.kind === "groq").body.messages[0].content;
  assert.match(prompt, /Vivian/); assert.match(prompt, /Likes tea/);
  assert.ok(prompt.includes(dialogue.vivianDialoguePrompt("Hello Vivian")));
  assert.equal(prompt.includes(dialogue.VIVIAN_DIALOGUE_EXAMPLE), false);
  assert.equal(fixture.background.length, 1);
});

test("chat fresh request uses Gemini search; explicit search survives low JEV confidence", async () => {
  for (const [message, score] of [["Who leads that company?", 0.9], ["latest news", 0.01]]) {
    const fixture = chatFixture({ values: { needs_current_information: score } });
    const response = await fixture.post(message);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).searchedWeb, true);
    assert.equal(fixture.calls.filter((call) => call.kind === "groq").length, 0);
    assert.ok(fixture.calls.find((call) => call.kind === "gemini").body.tools[0].google_search);
  }
});

test("casual Thai today mentions use text chat without Gemini, while explicit search reports unavailable", async () => {
  for (const message of ["วันนี้อากาศร้อนจังเลย", "วันนี้ชุดน่ารักจัง", "วันนี้เป็นยังไงบ้าง"]) {
    const fixture = chatFixture({ env: { GEMINI_API_KEY: "" }, values: { needs_current_information: 0.01 } });
    const response = await fixture.post(message);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).searchedWeb, false);
    assert.ok(fixture.calls.some((call) => call.kind === "groq"));
    assert.equal(fixture.calls.some((call) => call.kind === "gemini" || call.kind === "tavily"), false);
  }
  const explicit = chatFixture({ env: { GEMINI_API_KEY: "" } });
  const response = await explicit.post("ค้นหาข่าวล่าสุดให้หน่อย");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "SEARCH_UNAVAILABLE");
  assert.equal(explicit.calls.some((call) => ["groq", "cerebras", "gemini"].includes(call.kind)), false);
});

test("chat skips irrelevant durable memory, executes approved local tools and adds bounded response guidance", async () => {
  const fixture = chatFixture({ values: { needs_memory: 0.01, needs_calculator: 0.99, explanatory_response: 0.95 } });
  const response = await fixture.post("2 + 2");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.tools, ["calculator"]);
  assert.equal(fixture.memoryLoads.length, 0);
  const prompt = fixture.calls.find((call) => call.kind === "groq").body.messages[0].content;
  assert.match(prompt, /= 4/); assert.match(prompt, /Do not force an explanation or a useful answer/); assert.match(prompt, /ฉันจะไม่บอกเธอหรอก/); assert.doesNotMatch(prompt, /ตอบเนื้อหาให้ครบตามที่ขอ|Explain the answer clearly/);
});

test("chat executes a semantic time decision even without an existing time regex match", async () => {
  const fixture = chatFixture({ values: { needs_time: 0.95 } });
  const response = await fixture.post("How late is it?");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).tools, ["time"]);
  assert.match(fixture.calls.find((call) => call.kind === "groq").body.messages[0].content, /Asia\/Bangkok/);
});

test("chat image input forces Gemini even when JEV says vision is irrelevant", async () => {
  const fixture = chatFixture({ values: { needs_vision: 0 } });
  const image = `data:image/jpeg;base64,${"a".repeat(80)}`;
  const response = await fixture.post("What is this?", { image });
  assert.equal(response.status, 200);
  const request = fixture.calls.find((call) => call.kind === "gemini").body;
  assert.equal(request.contents[0].parts[0].inlineData.data, "a".repeat(80));
  assert.equal(JSON.parse(fixture.calls.find((call) => call.kind === "jev").body.state).hasImage, true);
  assert.doesNotMatch(fixture.calls.find((call) => call.kind === "jev").body.state, /data:image/);
});

for (const [label, options] of [
  ["disabled", { env: { JEV_ENABLED: "false" } }],
  ["API failure", { jevFetch: async () => new Response("fail", { status: 500 }) }],
  ["malformed", { jevFetch: async () => Response.json({ answers: {} }) }],
  ["ambiguous", { values: Object.fromEntries(keys.map((key) => [key, 0.5])) }],
  ["timeout", { timeout: 15, jevFetch: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) }],
]) {
  test(`chat remains usable on JEV ${label} and retains legacy memory/provider preparation`, async () => {
    const fixture = chatFixture(options);
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const response = await fixture.post();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).text, "Vivian fixture reply");
      assert.equal(fixture.memoryLoads.length, 1);
      assert.equal(fixture.calls.find((call) => call.kind === "groq").body.tools, undefined);
    } finally { clearTimeout(keepAlive); }
  });
}

test("JEV works without Gemini and normal text retains Groq → Cerebras → Gemini fallback", async () => {
  const noGemini = chatFixture({ env: { GEMINI_API_KEY: "" }, values: { needs_current_information: 0.99 } });
  assert.equal((await noGemini.post()).status, 200);
  assert.equal(noGemini.calls.filter((call) => call.kind === "jev").length, 1);
  assert.equal(noGemini.calls.find((call) => call.kind === "groq").kind, "groq");
  const fallback = chatFixture({ env: { CEREBRAS_API_KEY: "fixture-cerebras", JEV_ENABLED: "false" }, groqReply: () => new Response("fail", { status: 503 }), cerebrasReply: () => new Response("fail", { status: 503 }) });
  assert.equal((await fallback.post()).status, 200);
  assert.deepEqual(fallback.calls.filter((call) => ["groq", "cerebras", "gemini"].includes(call.kind)).map((call) => call.kind), ["groq", "cerebras", "gemini"]);
});

test("Groq quota or missing model goes directly to Cerebras without probing other Groq models", async () => {
  for (const status of [429, 404]) {
    const fixture = chatFixture({ env: { CEREBRAS_API_KEY: "fixture-cerebras" }, groqReply: () => new Response("unavailable", { status }) });
    const response = await fixture.post();
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.calls.filter((call) => ["groq", "cerebras", "gemini"].includes(call.kind)).map((call) => call.kind), ["groq", "cerebras"]);
    assert.equal(fixture.calls.find((call) => call.kind === "groq").body.model, "openai/gpt-oss-120b");
  }
});

test("fresh greetings request only 120 output tokens across text providers", async () => {
  for (const provider of ["groq", "cerebras"]) {
    const fixture = chatFixture({ env: { CEREBRAS_API_KEY: "fixture-cerebras" }, groqReply: provider === "cerebras" ? () => new Response("limited", { status: 429 }) : undefined });
    assert.equal((await fixture.post("Hello", { mode: "greeting" })).status, 200);
    assert.equal(fixture.calls.find((call) => call.kind === provider).body.max_tokens, 120);
    assert.equal(fixture.background.length, 0);
  }
});

test("Vivian keeps all voice references in source but only sends the relevant scene", async () => {
  for (const [message, scene, quote] of [
    ["2+2 เท่าไหร่", 0, "ฉันจะไม่บอกเธอหรอก"],
    ["วันนี้อากาศร้อนจังเลย", 1, "ไปดื่มน้ำสิ"],
    ["อรุณสวัสดิ์", 2, "ฉันไม่ได้รอเธอสักหน่อย"],
    ["วันนี้ชุดน่ารักจัง", 3, "ไปชมคนอื่นไป"],
    ["ปวดหัว", 4, "ไปพักก่อน"],
    ["เมื่อกี้มีคนมาจีบเรา", 5, "โซระจังของฉัน"],
    ["อธิบาย recursion ให้หน่อย", 6, "ไปงงเองก่อนสิ"],
  ]) {
    const fixture = chatFixture({ values: { needs_current_information: 0.01 } });
    assert.equal((await fixture.post(message)).status, 200);
    const prompt = fixture.calls.find((call) => call.kind === "groq").body.messages[0].content;
    const reference = dialogue.vivianDialoguePrompt(message);
    assert.ok(prompt.includes(reference));
    assert.ok(reference.includes(`แบบที่ ${scene}:`));
    assert.ok(reference.includes(quote));
    assert.equal((reference.match(/แบบที่ \d:/g) ?? []).length, 1);
    assert.ok(reference.length < dialogue.VIVIAN_DIALOGUE_EXAMPLE.length * 0.65);
    assert.ok(reference.includes("เรียนรู้พฤติกรรม ไม่ใช่ท่องประโยค"));
  }
});

test("passive greeting bypasses JEV and background persistence; access denial stops all preflight", async () => {
  const greeting = chatFixture();
  assert.equal((await greeting.post("", { mode: "greeting", messages: [] })).status, 200);
  assert.equal(greeting.calls.filter((call) => call.kind === "jev").length, 0);
  assert.equal(greeting.background.length, 0);
  assert.equal(greeting.memoryLoads.length, 1);
  const denied = Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const locked = chatFixture({ denied });
  assert.equal(await locked.post(), denied);
  assert.equal(locked.calls.length, 0);
});

for (const provider of ["groq", "cerebras"]) {
  test(`${provider} external app requests cannot advertise or execute function tools`, async () => {
    const reply = (body) => {
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
      return Response.json({ choices: [{ message: {
        content: "External apps are unavailable",
        tool_calls: [{ id: "call-1", function: { name: "DISCORD_SEND", arguments: '{"text":"hello"}' } }],
      } }] });
    };
    const fixture = chatFixture({ values: { needs_integrations: 1 }, env: provider === "cerebras" ? { GROQ_API_KEY: "", CEREBRAS_API_KEY: "fixture-cerebras" } : {}, [provider === "groq" ? "groqReply" : "cerebrasReply"]: reply });
    const response = await fixture.post("send on discord");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "External apps are unavailable");
    const state = JSON.parse(fixture.calls.find((call) => call.kind === "jev").body.state);
    assert.equal(state.capabilities.integrations, false);
    assert.deepEqual(state.toolkitCandidates, []);
    assert.equal(fixture.calls.filter((call) => call.kind === provider).length, 1);
    const prompt = fixture.calls.find((call) => call.kind === provider).body.messages[0].content;
    assert.match(prompt, /ยังไม่ได้เชื่อมต่อแอปภายนอก/);
  });
}

const sceneCatalog = [{ id: "00000000-0000-4000-8000-000000000001", label: "ห้องนอนตอนกลางคืน" }, { id: "00000000-0000-4000-8000-000000000002", label: "คาเฟ่" }];
const autoSceneContext = { userId: "fixture-user", autoScene: true, activeSceneId: null, revision: "fixture-revision", scenes: sceneCatalog };
function sceneAnswers(scores) {
  const data = answers();
  scores.forEach((noul, index) => { data.answers[`scene_${index}`] = { type: "noul", noul }; });
  return data;
}
test("scene selection joins one batch and projects only IDs and manual labels", async () => {
  const calls = [];
  const fixture = client(async (_url, options) => { calls.push(JSON.parse(options.body)); return Response.json(sceneAnswers([0.99, 0.01])); });
  const result = await fixture.module.decideVivian(context("ง่วงแล้ว กลับไปนอนกัน", { scenes: { autoScene: true, activeSceneId: null, available: sceneCatalog.map((scene) => ({ ...scene, image: "PRIVATE_IMAGE", imageUrl: "PRIVATE_URL", imageKey: "PRIVATE_KEY" })) } }));
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0].questions).length, 12);
  assert.deepEqual(JSON.parse(calls[0].state).availableScenes, sceneCatalog);
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE/);
  assert.equal(result.decision.scene.id, sceneCatalog[0].id);
});
test("no scene change, ties, missing/malformed scene answers keep the scene without discarding chat decisions", () => {
  for (const scores of [[0.01, 0.01], [0.5, 0.5], [0.99, 0.98], [1.1, 0], [NaN, 0], []]) {
    const decision = jev.parseJevDecision(sceneAnswers(scores), sceneCatalog);
    assert.equal(decision.scene.change, false);
    assert.ok(decision.memory);
  }
});
test("Harness rejects unknown scene IDs, disabled auto scenes, passive changes and same-scene changes", () => {
  const decision = jev.parseJevDecision(sceneAnswers([0.99, 0]), sceneCatalog);
  const ctx = context("sleep", { scenes: { autoScene: true, activeSceneId: null, available: sceneCatalog } });
  assert.equal(harness.resolveChatPlan(ctx, decision, false).scene.id, sceneCatalog[0].id);
  for (const [input, proposal, passive] of [
    [{ ...ctx, scenes: { ...ctx.scenes, autoScene: false } }, decision, false],
    [ctx, { ...decision, scene: { change: true, id: "another-users-scene" } }, false],
    [ctx, decision, true],
    [{ ...ctx, scenes: { ...ctx.scenes, activeSceneId: sceneCatalog[0].id } }, decision, false],
    [ctx, { ...decision, scene: { change: "true", id: sceneCatalog[0].id } }, false],
  ]) assert.equal(harness.resolveChatPlan(input, proposal, passive).scene.change, false);
});
test("Auto Scene OFF adds no catalog or scene questions to the JEV request", async () => {
  const fixture = client(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(Object.keys(body.questions).length, 10);
    assert.equal(JSON.parse(body.state).availableScenes, undefined);
    return Response.json(answers());
  });
  const result = await fixture.module.decideVivian(context("sleep", { scenes: { autoScene: false, available: sceneCatalog, activeSceneId: null } }));
  assert.equal(result.decision.scene.change, false);
});
test("valid scene decision returns through normal chat JSON without image data in any model request", async () => {
  const fixture = chatFixture({ sceneContext: autoSceneContext, jevFetch: async () => Response.json(sceneAnswers([0.99, 0.01])) });
  const response = await fixture.post("ง่วงแล้ว กลับไปนอนกัน");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.scene.id, sceneCatalog[0].id);
  assert.equal(body.text, "Vivian fixture reply");
  assert.equal(fixture.calls.filter((call) => call.kind === "jev").length, 1);
  assert.doesNotMatch(JSON.stringify(fixture.calls), /imageKey|imageUrl|thumbnailUrl|vivian-scenes/);
});
test("scene context or execution/storage failure cannot prevent normal chat from completing", async () => {
  for (const options of [{ sceneFailure: true }, { sceneContext: autoSceneContext, jevFetch: async () => new Response("unavailable", { status: 503 }) }, { sceneExecutionFailure: true, sceneContext: autoSceneContext }, { sceneContext: autoSceneContext, jevFetch: async () => Response.json(sceneAnswers([])) }]) {
    const fixture = chatFixture(options);
    const response = await fixture.post();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.text, "Vivian fixture reply");
    assert.equal(body.scene.change, false);
  }
});
