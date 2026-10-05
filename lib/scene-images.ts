import "server-only";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import sharp from "sharp";
import { SCENE_MAX_BYTES, SCENE_MIME_TYPES, SceneError, validateSceneLabel } from "@/lib/scenes";

export function isPublicSceneAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    // Azure's platform virtual IP is internal despite its public address range.
    if (parsed.kind() === "ipv4" && parsed.toString() === "168.63.129.16") return false;
    return parsed.range() === "unicast" && (parsed.kind() === "ipv4" || parsed.match(ipaddr.parse("2000::"), 3));
  } catch { return false; }
}
export function validateSceneUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048) throw new SceneError("Enter a valid HTTP or HTTPS image URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw new SceneError("Enter a valid HTTP or HTTPS image URL."); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port)) || !host.includes(".") && !host.includes(":")) throw new SceneError("Only public HTTP/HTTPS image URLs are allowed.");
  if (/^(localhost|metadata|metadata\.google\.internal)$/.test(host) || /\.(localhost|local|internal|test|invalid)$/.test(host) || (ipaddr.isValid(host) && !isPublicSceneAddress(host))) throw new SceneError("Private or internal image URLs are not allowed.");
  url.hash = "";
  return url;
}

/** Resolve all DNS answers, reject any private answer, and pin the connection to
 * a validated address. Each redirect is independently checked. No proxy, ambient
 * credentials, cookies or authorization headers are forwarded to the source. */
export async function fetchSceneImage(value: unknown, signal = AbortSignal.timeout(10_000)): Promise<{ bytes: Buffer; mime: string }> {
  let url = validateSceneUrl(value);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = ipaddr.isValid(host)
      ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 }]
      : await Promise.race([lookup(host, { all: true }), new Promise<never>((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicSceneAddress(address))) throw new SceneError("Private or internal image URLs are not allowed.");
    const address = addresses[0];
    const result = await new Promise<{ redirect: string } | { bytes: Buffer; mime: string }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).get(url, {
        signal,
        agent: false,
        family: address.family,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        headers: { Accept: SCENE_MIME_TYPES.join(", "), "Accept-Encoding": "identity" },
      }, (response) => {
        const fail = (error: Error) => { reject(error); response.destroy(); request.destroy(); };
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
          resolve({ redirect: response.headers.location }); response.destroy(); return;
        }
        const mime = response.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? "";
        if (response.statusCode !== 200 || !SCENE_MIME_TYPES.includes(mime) || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") return fail(new SceneError("The URL did not return a supported image."));
        if (Number(response.headers["content-length"]) > SCENE_MAX_BYTES) return fail(new SceneError("Choose an image under 8 MB.", 413));
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > SCENE_MAX_BYTES) fail(new SceneError("Choose an image under 8 MB.", 413));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ bytes: Buffer.concat(chunks), mime }));
        response.on("error", reject);
        response.on("aborted", () => reject(new SceneError("Image download was interrupted.")));
      });
      request.on("error", reject);
    });
    if ("bytes" in result) return result;
    if (redirect === 3) throw new SceneError("Too many image redirects.");
    url = validateSceneUrl(new URL(result.redirect, url).href);
  }
  throw new SceneError("Image import failed.");
}

export async function normalizeSceneImage(bytes: Buffer, mime: string): Promise<{ image: Buffer; thumbnail: Buffer; mime: string }> {
  if (!bytes.length || bytes.length > SCENE_MAX_BYTES) throw new SceneError("Choose an image under 8 MB.", 413);
  if (!SCENE_MIME_TYPES.includes(mime)) throw new SceneError("Choose a JPG, PNG, WebP or AVIF image.");
  try {
    const input = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await input.metadata();
    const formats: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heif: "image/avif" };
    if (!metadata.format || formats[metadata.format] !== mime || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1 || metadata.width > 12000 || metadata.height > 12000 || metadata.format === "heif" && metadata.compression !== "av1") throw new Error("Unsupported content");
    // Decode the complete raster to reject corrupt/mislabelled payloads. Store
    // the original bytes: no resizing, recompression, or colour/profile changes.
    // Orientation and source metadata remain part of the private original.
    await input.clone().timeout({ seconds: 5 }).stats();
    const thumbnail = await input.rotate().resize({ width: 480, height: 300, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).timeout({ seconds: 5 }).toBuffer();
    return { image: bytes, thumbnail, mime };
  } catch { throw new SceneError("The file is not a valid supported image, is animated, or has excessive dimensions."); }
}

export async function readBoundedSceneBody(request: Request, maxBytes: number): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new SceneError("Missing scene data.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new SceneError("Scene request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readSceneInput(request: Request): Promise<{ label: string; sourceType?: "upload" | "url"; bytes?: Buffer; mime?: string }> {
  // Limit the actual stream, including chunked bodies, before parsing.
  const bytes = await readBoundedSceneBody(request, request.headers.get("content-type")?.startsWith("multipart/form-data") ? SCENE_MAX_BYTES + 64 * 1024 : 64 * 1024);
  const bounded = new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } });
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await bounded.formData();
    const label = validateSceneLabel(form.get("label"));
    const file = form.get("image");
    if (!(file instanceof File)) throw new SceneError("Choose an image.");
    if (file.size > SCENE_MAX_BYTES) throw new SceneError("Choose an image under 8 MB.", 413);
    return { label, sourceType: "upload", bytes: Buffer.from(await file.arrayBuffer()), mime: file.type };
  }
  const body = await bounded.json();
  const label = validateSceneLabel(body?.label);
  if (body?.url !== undefined) {
    const image = await fetchSceneImage(body.url);
    return { label, sourceType: "url", ...image };
  }
  return { label };
}
