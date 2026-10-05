// Local-only Supabase REST/Storage wire fixture. Never contacts live user data.
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { startAuthFixture } from "./auth-fixture.mjs";
export async function startSceneFixture() {
  const auth = await startAuthFixture();
  const rows = { vivian_scenes: [], vivian_scene_preferences: [], vivian_scene_image_gc: [], memories: [], messages: [], conversations: [], companion_state: [] };
  const objects = new Map(), modelRequests = [];
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#563c76" } }).png().toBuffer();
  const state = { storageFailure: false, dbFailure: false, imageFailure: false };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const send = (status, data, headers = {}) => { response.writeHead(status, { "Content-Type": "application/json", ...headers }); response.end(JSON.stringify(data)); };
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      if (url.pathname.startsWith("/auth/")) {
        const result = await fetch(`${auth.url}${url.pathname}${url.search}`, { method: request.method, headers: request.headers, ...(bytes.length ? { body: bytes } : {}) });
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      if (url.pathname === "/__model-request") { modelRequests.push(JSON.parse(bytes)); return send(200, {}); }
      if (url.pathname === "/fixture-image") { response.writeHead(state.imageFailure ? 404 : 200, { "Content-Type": "image/png" }); response.end(png); return; }
      if (url.pathname.startsWith("/storage/v1/")) {
        if (state.storageFailure) return send(503, { message: "fixture storage unavailable" });
        if (url.pathname === "/storage/v1/object/vivian-scenes" && request.method === "DELETE") { JSON.parse(bytes).prefixes.forEach((key) => objects.delete(key)); return send(200, []); }
        const info = url.pathname.startsWith("/storage/v1/object/info/");
        const prefix = info ? "/storage/v1/object/info/vivian-scenes/" : "/storage/v1/object/vivian-scenes/";
        const key = decodeURIComponent(url.pathname.slice(prefix.length));
        if (info) return objects.has(key) ? send(200, { name: key, id: key, metadata: { mimetype: "image/webp" } }) : send(404, { message: "not found" });
        if (request.method === "POST") { objects.set(key, bytes); return send(200, { Key: `vivian-scenes/${key}`, Id: key }); }
        if (!objects.has(key)) return send(404, { message: "not found" });
        response.writeHead(200, { "Content-Type": key.endsWith(".png") ? "image/png" : key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".avif") ? "image/avif" : "image/webp" }); response.end(objects.get(key)); return;
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.slice("/rest/v1/".length);
        if (state.dbFailure) return send(503, { message: "fixture DB unavailable" });
        if (!rows[table]) return send(404, { message: "unknown fixture table" });
        const list = rows[table];
        const filters = [...url.searchParams].filter(([key]) => !["select", "order", "limit", "on_conflict"].includes(key));
        let selected = list.filter((row) => filters.every(([key, expression]) => {
          if (expression.startsWith("eq.")) return String(row[key]) === expression.slice(3);
          if (expression.startsWith("lt.")) return row[key] < expression.slice(3);
          return true;
        }));
        const body = bytes.length ? JSON.parse(bytes) : {};
        if (request.method === "POST") {
          const values = Array.isArray(body) ? body : [body]; selected = [];
          for (const value of values) {
            const exists = request.headers.prefer?.includes("resolution=ignore-duplicates") && list.find((row) => table === "vivian_scene_image_gc" ? row.image_key === value.image_key : row.user_id === value.user_id);
            if (exists) { selected.push(exists); continue; }
            const row = { ...(table === "vivian_scene_preferences" ? { auto_scene: false, active_scene_id: null, preset: null, revision: randomUUID() } : {}), id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...value }; list.push(row); selected.push(row);
          }
        }
        if (request.method === "PATCH") for (const row of selected) {
          if (table === "vivian_scenes" && body.image_key && body.image_key !== row.image_key) rows.vivian_scene_image_gc.push({ image_key: row.image_key, user_id: row.user_id, created_at: new Date().toISOString() });
          Object.assign(row, body);
        }
        if (request.method === "DELETE") for (const row of selected) {
          list.splice(list.indexOf(row), 1);
          if (table === "vivian_scenes") {
            rows.vivian_scene_image_gc.push({ image_key: row.image_key, user_id: row.user_id, created_at: new Date().toISOString() });
            for (const preference of rows.vivian_scene_preferences) if (preference.active_scene_id === row.id) preference.active_scene_id = null;
          }
        }
        const total = selected.length;
        selected = selected.slice(0, Number(url.searchParams.get("limit") ?? Infinity));
        const columns = url.searchParams.get("select") ?? "*";
        const data = selected.map((row) => columns === "*" ? row : Object.fromEntries(columns.split(",").map((key) => [key, row[key]])));
        if (request.method === "HEAD") { response.writeHead(200, { "Content-Range": `0-${Math.max(0, total - 1)}/${total}` }); response.end(); return; }
        if (request.headers.accept?.includes("vnd.pgrst.object+json")) return data.length === 1 ? send(200, data[0]) : send(406, { code: "PGRST116", details: `The result contains ${data.length} rows`, message: "No rows" });
        return send(200, data, { "Content-Range": `0-${Math.max(0, total - 1)}/${total}` });
      }
      return send(404, { message: "unknown fixture route" });
    } catch (error) { send(500, { message: error.message }); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, rows, objects, modelRequests, png, state, url: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); auth.server.closeAllConnections(); await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => auth.server.close(resolve))]); } };
}
