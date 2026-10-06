import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startAuthFixture, session, sessionCookie, verifierCookie } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const apps = [];
let fixture, base, lockedBase;

async function startApp(key) {
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: fixture.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_URL: fixture.url, SUPABASE_SERVICE_ROLE_KEY: "", GROQ_API_KEY: "", CEREBRAS_API_KEY: "", GEMINI_API_KEY: "", FISH_AUDIO_API_KEY: "", TYPESAFE_API_KEY: "", JEV_API_KEY: "", OPENROUTER_API_KEY: "" };
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "0", "-H", "127.0.0.1"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  apps.push(child);
  let output = "";
  const collect = (chunk) => { output += chunk; };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  for (let attempt = 0; attempt < 150; attempt++) {
    const address = output.match(/Local:\s+(http:\/\/[^\s]+)/)?.[1];
    if (address) {
      try { const response = await fetch(`${address}/login`); if (response.ok) return address; } catch { /* wait for readiness */ }
    }
    if (child.exitCode !== null) throw new Error(`Next start failed: ${output}`);
    await delay(200);
  }
  throw new Error("Local Auth test app did not start");
}

before(async () => {
  fixture = await startAuthFixture();
  base = await startApp("sb_publishable_local_test_only");
  lockedBase = await startApp("");
}, { timeout: 60000 });

after(async () => {
  for (const child of apps) child.kill("SIGTERM");
  if (fixture) await new Promise((resolve) => fixture.server.close(resolve));
});

const call = (path, options = {}) => fetch(`${base}${path}`, { redirect: "manual", ...options });
const modelRoutes = [["/api/storage/status", "GET"], ["/api/models", "GET"], ["/api/models", "POST"], ["/api/models/00000000-0000-4000-8000-000000000001", "GET"], ["/api/models/00000000-0000-4000-8000-000000000001", "POST"], ["/api/models/00000000-0000-4000-8000-000000000001", "DELETE"], ["/api/models/00000000-0000-4000-8000-000000000001/parts?first=1", "POST"]];
const routes = [["/api/conversations", "GET"], ["/api/conversations", "PUT"], ["/api/chat", "POST"], ["/api/stt", "POST"], ["/api/tts", "POST"], ["/api/memory", "GET"], ["/api/memory", "POST"], ["/api/memory", "PATCH"], ["/api/memory", "DELETE"], ["/api/jev/status", "GET"], ["/api/scenes", "GET"], ["/api/scenes", "POST"], ["/api/scenes/preview", "POST"], ["/api/scenes/preferences", "PATCH"], ["/api/scenes/00000000-0000-4000-8000-000000000001", "PATCH"], ["/api/scenes/00000000-0000-4000-8000-000000000001", "DELETE"], ["/api/scenes/00000000-0000-4000-8000-000000000001/image", "GET"]];

test("signed-out users cannot access the companion or any protected API", async () => {
  assert.equal((await call("/")).headers.get("location"), "/login");
  for (const [path, method] of [...routes, ...modelRoutes]) {
    const response = await call(path, { method, headers: { "x-user-email": "suphloeksangko@gmail.com", cookie: "email=suphloeksangko@gmail.com" } });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("both verified accounts are allowed and cached/forged identity claims are ignored", async () => {
  for (const kind of ["first", "second"]) {
    const response = await call("/api/jev/status", { headers: { cookie: sessionCookie(kind) } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { configured: false });
    const home = await call("/", { headers: { cookie: sessionCookie(kind) } });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /companion-shell/);
  }
  for (const kind of ["denied", "unverified"]) {
    for (const [path, method] of [...routes, ...modelRoutes]) {
      const response = await call(path, { method, headers: { cookie: sessionCookie(kind, { forgedEmail: "suphloeksangko@gmail.com" }) } });
      assert.equal(response.status, 403, `${kind}: ${method} ${path}`);
    }
  }
  const forged = sessionCookie("first").replace(/.$/, "X");
  assert.equal((await call("/api/jev/status", { headers: { cookie: forged } })).status, 401);
});

test("missing configuration fails closed and callbacks cannot redirect externally", async () => {
  const locked = await fetch(`${lockedBase}/api/jev/status`);
  assert.equal(locked.status, 503);
  assert.equal((await locked.json()).code, "AUTH_UNAVAILABLE");
  const response = await call("/auth/callback?next=https://evil.example");
  assert.equal(response.headers.get("location"), "/login?error=oauth_failed");
  assert.equal((await call("/auth/callback?code=invalid", { headers: { cookie: verifierCookie() } })).headers.get("location"), "/login?error=oauth_failed");
  // A callback for a missing flow must not borrow another in-flight verifier.
  assert.equal((await call("/auth/callback?code=allowed-code&sb_flow_id=missing-flow-123", { headers: { cookie: verifierCookie() } })).headers.get("location"), "/login?error=oauth_failed");
});

test("other Vivian clients can use verified Supabase bearer tokens under the same allowlist", async () => {
  for (const kind of ["first", "second"]) assert.equal((await call("/api/jev/status", { headers: { authorization: `Bearer ${session(kind).access_token}` } })).status, 200);
  assert.equal((await call("/api/jev/status", { headers: { authorization: `Bearer ${session("denied").access_token}` } })).status, 403);
  assert.equal((await call("/api/jev/status", { headers: { authorization: `Bearer ${session("first", 1).access_token}` } })).status, 401);
  assert.equal((await call("/api/jev/status", { headers: { authorization: "Bearer fake-token", cookie: sessionCookie("first") } })).status, 401);
});

test("OAuth checks the confirmed identity and clears denied sessions", async () => {
  const allowed = await call("/auth/callback?code=allowed-code&next=https://evil.example", { headers: { cookie: verifierCookie() } });
  assert.equal(allowed.headers.get("location"), "/");
  assert.match(allowed.headers.get("set-cookie"), /sb-127-auth-token/);
  assert.match(allowed.headers.get("cache-control"), /no-store/);
  const flow = await call("/auth/callback?code=allowed-code&sb_flow_id=invited-flow-123", { headers: { cookie: verifierCookie("invited-flow-123") } });
  assert.equal(flow.headers.get("location"), "/");
  const denied = await call("/auth/callback?code=denied-code", { headers: { cookie: verifierCookie() } });
  assert.equal(denied.headers.get("location"), "/login?error=access_denied");
  assert.ok(denied.headers.getSetCookie().some((cookie) => cookie.startsWith("sb-127-auth-token=") && cookie.includes("Max-Age=0")));
});

test("expired sessions refresh cookies; logout and mutations reject cross-site requests", async () => {
  const refreshed = await call("/api/jev/status", { headers: { cookie: sessionCookie("first", { expiresAt: 1 }) } });
  assert.equal(refreshed.status, 200);
  assert.match(refreshed.headers.get("set-cookie"), /sb-127-auth-token/);
  for (const path of ["/api/memory", "/auth/signout"]) assert.equal((await call(path, { method: "POST", headers: { cookie: sessionCookie("first"), origin: "https://evil.example" } })).status, 403);
  const logout = await call("/auth/signout", { method: "POST", headers: { cookie: sessionCookie("first"), origin: base } });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get("location"), "/login");
  assert.ok(logout.headers.getSetCookie().some((cookie) => cookie.startsWith("sb-127-auth-token=") && cookie.includes("Max-Age=0")));
});
