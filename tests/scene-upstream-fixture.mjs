// Loaded ONLY by the local integration test subprocess. Public source DNS and
// upstream models are simulated; the real SSRF validator/decoder still run.
import http from "node:http";
import dns from "node:dns/promises";
if (process.env.VIVIAN_TEST_SCENE_UPSTREAM) {
  const fixtureUrl = process.env.VIVIAN_TEST_SCENE_UPSTREAM;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureUrl)) throw new Error("Fixture must be local");
  const realLookup = dns.lookup.bind(dns), realGet = http.get.bind(http), realFetch = globalThis.fetch;
  dns.lookup = async (host, options) => host === "images.example.com" ? [{ address: "93.184.216.34", family: 4 }] : realLookup(host, options);
  http.get = (url, options, callback) => {
    if (url.hostname !== "images.example.com") return realGet(url, options, callback);
    options.lookup(url.hostname, {}, (_error, address) => { if (address !== "93.184.216.34") throw new Error("Source address was not pinned"); });
    return realGet(`${fixtureUrl}/fixture-image`, { ...options, lookup: undefined }, callback);
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("api.typesafe.ai/v1/systemone")) {
      const body = JSON.parse(init.body);
      await realFetch(`${fixtureUrl}/__model-request`, { method: "POST", body: JSON.stringify({ kind: "jev", body }) });
      const state = JSON.parse(body.state);
      const answers = Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "noul", noul: key === "needs_memory" ? 0.99 : key.startsWith("scene_") && /ห้องนอน/.test(state.availableScenes?.[Number(key.slice(6))]?.label ?? "") && /นอน/.test(state.message) ? 0.99 : 0.01 }]));
      return Response.json({ answers });
    }
    if (url.includes("api.groq.com/openai/v1/chat/completions")) {
      const body = JSON.parse(init.body);
      await realFetch(`${fixtureUrl}/__model-request`, { method: "POST", body: JSON.stringify({ kind: "groq", body }) });
      if (body.stream) {
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ได้เลยค่ะ ไปพักผ่อนกันนะคะ" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json({ choices: [{ message: { content: "ได้เลยค่ะ ไปพักผ่อนกันนะคะ" } }] });
    }
    return realFetch(input, init);
  };
}
