import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { startAuthFixture } from "./auth-fixture.mjs";
export async function startHistoryFixture() {
  const auth = await startAuthFixture();
  const rows = { conversations: [], messages: [], memories: [], companion_state: [] };
  const state = { failure: false, writes: 0 };
  let sequence = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const send = (status, data, headers = {}) => { response.writeHead(status, { "Content-Type": "application/json", ...headers }); response.end(JSON.stringify(data)); };
    if (url.pathname.startsWith("/auth/")) {
      const upstream = await fetch(`${auth.url}${url.pathname}${url.search}`, { method: request.method, headers: { "Content-Type": "application/json", authorization: request.headers.authorization ?? "" }, body: bytes.length ? bytes : undefined, redirect: "manual" });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    if (url.pathname.startsWith("/test/")) {
      if (url.pathname === "/test/groq") return send(200, { choices: [{ message: { content: "Vivian cloud reply" } }] });
      return send(503, {});
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (request.headers.authorization !== "Bearer fixture-admin") return send(403, {});
      if (state.failure) return send(503, { message: "History offline" });
      const body = bytes.length ? JSON.parse(bytes) : {};
      if (url.pathname === "/rest/v1/rpc/vivian_save_conversation") {
        let conversation = rows.conversations.find((item) => item.id === body.p_id);
        if (!conversation && !body.p_create) return send(404, { code: "P0002", message: "Missing conversation" });
        if (!conversation) { conversation = { id: body.p_id, user_key: "default", title: body.p_title, updated_at: new Date().toISOString() }; rows.conversations.push(conversation); }
        for (const message of body.p_messages) if (!rows.messages.some((item) => item.conversation_id === body.p_id && item.client_message_id === message.id)) rows.messages.push({ id: ++sequence, conversation_id: body.p_id, client_message_id: message.id, role: message.role, content: message.content, created_at: message.created_at });
        if (["Daily Talk", "Vivian conversation"].includes(conversation.title)) conversation.title = body.p_title;
        state.writes += 1; return send(200, null);
      }
      const table = url.pathname.slice("/rest/v1/".length);
      const list = rows[table]; if (!list) return send(404, {});
      let data = list.filter((item) => [...url.searchParams].every(([key, value]) => value.startsWith("eq.") ? String(item[key]) === value.slice(3) : value.startsWith("gt.") ? BigInt(item[key]) > BigInt(value.slice(3)) : value.startsWith("in.(") ? value.slice(4, -1).split(",").includes(String(item[key])) : true));
      if (request.method === "DELETE") for (const item of data) { list.splice(list.indexOf(item), 1); if (table === "conversations") rows.messages = rows.messages.filter((message) => message.conversation_id !== item.id); }
      if (request.method === "POST") { const values = Array.isArray(body) ? body : [body]; data = values.map((item) => ({ id: randomUUID(), ...item })); list.push(...data); }
      for (const order of (url.searchParams.get("order") ?? "").split(",").reverse()) { const [key, direction] = order.split("."); if (key) data.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === "desc" ? -1 : 1)); }
      const total = data.length;
      const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? Infinity);
      data = data.slice(offset, offset + limit);
      const columns = url.searchParams.get("select") ?? "*";
      data = data.map((item) => columns === "*" ? item : Object.fromEntries(columns.split(",").map((key) => [key, item[key]])));
      if (request.method === "HEAD") { response.writeHead(200, { "Content-Range": `*/${total}` }); response.end(); return; }
      if (request.headers.accept?.includes("vnd.pgrst.object+json")) return data.length === 1 ? send(200, data[0]) : send(406, { code: "PGRST116", details: `The result contains ${data.length} rows` });
      return send(200, data, { "Content-Range": `0-${Math.max(0, total - 1)}/${total}` });
    }
    send(404, {});
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, rows, state, async close() { server.closeAllConnections(); auth.server.closeAllConnections(); await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => auth.server.close(resolve))]); } };
}
