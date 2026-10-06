import { Inflate } from "fflate";
import { bufferedBlobReader } from "./blob-reader.ts";
import { readZipDirectory, updateZipCrc } from "./zip-paths.ts";

/** Stream each exact compressed range from the central directory. Never scan
 * compressed bytes for ZIP signatures: those bytes can occur in valid assets. */
export async function extractModelZip(blob: Blob, maxBytes: number, maxFiles: number) {
  const directory = await readZipDirectory(blob);
  const entries = directory.entries.filter((entry) => !entry.name.endsWith("/") && !entry.name.startsWith("__MACOSX/"));
  if (entries.length > maxFiles || entries.reduce((size, entry) => size + entry.originalSize, 0) > maxBytes) throw new Error("Expanded ZIP exceeds 512 MB or 3,000 files.");
  const assets: Array<{ path: string; blob: Blob }> = [];
  const read = bufferedBlobReader(blob);
  let expanded = 0;
  for (const entry of entries) {
    if (entry.flags & 1) throw new Error("Encrypted model ZIPs are unsupported. Choose an unencrypted ZIP or folder.");
    if (entry.compression !== 0 && entry.compression !== 8) throw new Error(`Unsupported ZIP compression for ${entry.name}. Use a stored or deflated ZIP.`);
    const header = await read(entry.offset, 30);
    if (header.length !== 30) throw new Error(`ZIP header is incomplete: ${entry.name}`);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== entry.compression || view.getUint16(6, true) & 1) throw new Error(`Invalid ZIP header: ${entry.name}`);
    const start = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    if (start + entry.size > directory.start) throw new Error(`ZIP data is incomplete: ${entry.name}`);
    const chunks: Blob[] = [];
    let size = 0, crc = -1, finished = false;
    const accept = (data: Uint8Array, final: boolean) => {
      size += data.length; expanded += data.length;
      if (size > entry.originalSize || expanded > maxBytes) throw new Error("Expanded ZIP exceeds its recorded size or 512 MB limit.");
      crc = updateZipCrc(data, crc);
      chunks.push(new Blob([new Uint8Array(data)]));
      finished = final;
    };
    const inflater = entry.compression === 8 ? new Inflate(accept) : undefined;
    let lastYield = Date.now();
    try {
      for (let offset = 0; offset < entry.size; offset += 2048) {
        const length = Math.min(2048, entry.size - offset);
        const data = await read(start + offset, length);
        if (data.length !== length) throw new Error("Compressed data is incomplete.");
        const final = offset + length === entry.size;
        if (inflater) inflater.push(data, final); else accept(data, final);
        if (Date.now() - lastYield > 16) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); lastYield = Date.now(); }
      }
      if (!entry.size) { if (inflater) inflater.push(new Uint8Array(), true); else accept(new Uint8Array(), true); }
      if (!finished || size !== entry.originalSize || ((crc ^ -1) >>> 0) !== entry.crc) throw new Error("ZIP entry size or checksum does not match.");
    } catch (error) {
      throw new Error(`Could not extract ZIP asset ${entry.name}: ${error instanceof Error ? error.message : "invalid compressed data"}`, { cause: error });
    }
    assets.push({ path: entry.name, blob: new Blob(chunks) });
  }
  return { assets, paths: directory.paths };
}
