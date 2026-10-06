import { strFromU8 } from "fflate";
import { bufferedBlobReader } from "./blob-reader.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const cp437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const dosName = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte < 128 ? String.fromCharCode(byte) : cp437[byte - 128]).join("");
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function updateZipCrc(bytes: Uint8Array, crc = -1): number {
  for (let index = 0; index < bytes.length; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
  return crc;
}
const crc32 = (bytes: Uint8Array) => (updateZipCrc(bytes) ^ -1) >>> 0;

export interface ZipEntry {
  name: string; flags: number; compression: number; crc: number;
  size: number; originalSize: number; offset: number;
}

/** Central-directory Unicode Path fields are authoritative only with a valid
 * filename CRC. Untagged archives may use UTF-8, Windows Chinese, or DOS names.
 * Return coherent alternatives; the manifest's exact references validate them. */
export async function readZipDirectory(blob: Blob): Promise<{ paths: Array<Map<string, string>>; entries: ZipEntry[]; start: number }> {
  const tailStart = Math.max(0, blob.size - 65_557);
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  const tailView = new DataView(tail.buffer);
  let end = tail.length - 22;
  for (; end >= 0; end--) {
    if (tailView.getUint32(end, true) === 0x06054b50 && end + 22 + tailView.getUint16(end + 20, true) === tail.length) break;
  }
  if (end < 0) throw new Error("Model ZIP directory is missing or incomplete.");
  let count = tailView.getUint16(end + 10, true);
  let size = tailView.getUint32(end + 12, true), start = tailView.getUint32(end + 16, true);
  if (tailView.getUint16(end + 4, true) || tailView.getUint16(end + 6, true) || tailView.getUint16(end + 8, true) !== count) throw new Error("Use a single-volume model ZIP.");
  if (count === 65535 || start === 0xffffffff || size === 0xffffffff) {
    if (end < 20 || tailView.getUint32(end - 20, true) !== 0x07064b50 || tailView.getUint32(end - 16, true) !== 0 || tailView.getUint32(end - 4, true) !== 1) throw new Error("Invalid ZIP64 model directory.");
    const zip64Offset = Number(tailView.getBigUint64(end - 12, true));
    if (!Number.isSafeInteger(zip64Offset) || zip64Offset < 0 || zip64Offset + 56 > tailStart + end - 20) throw new Error("Invalid ZIP64 model directory.");
    const header = await blob.slice(zip64Offset, zip64Offset + 56).arrayBuffer();
    const view = new DataView(header);
    if (view.getUint32(0, true) !== 0x06064b50 || view.getUint32(16, true) || view.getUint32(20, true) || view.getBigUint64(24, true) !== view.getBigUint64(32, true)) throw new Error("Use a single-volume model ZIP.");
    count = Number(view.getBigUint64(32, true)); size = Number(view.getBigUint64(40, true)); start = Number(view.getBigUint64(48, true));
    if (![count, size, start].every(Number.isSafeInteger) || start + size > zip64Offset) throw new Error("Invalid ZIP64 model directory.");
  }
  if (count > 6000 || start + size > tailStart + end) throw new Error("Invalid model ZIP directory.");
  const maps = [new Map<string, string>(), new Map<string, string>()];
  const entries: ZipEntry[] = [];
  const read = bufferedBlobReader(blob);
  let offset = start;
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > start + size) throw new Error("Truncated model ZIP directory.");
    const header = await read(offset, 46);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== 0x02014b50) throw new Error("Invalid model ZIP entry.");
    const flags = view.getUint16(8, true), nameSize = view.getUint16(28, true), extraSize = view.getUint16(30, true), commentSize = view.getUint16(32, true);
    let compressedSize = view.getUint32(20, true), originalSize = view.getUint32(24, true), localOffset = view.getUint32(42, true);
    if (offset + 46 + nameSize + extraSize + commentSize > start + size) throw new Error("Truncated model ZIP entry.");
    const name = (await read(offset + 46, nameSize)).slice();
    const extra = await read(offset + 46 + nameSize, extraSize);
    let unicode: string | undefined;
    for (let position = 0; position + 4 <= extra.length;) {
      const field = new DataView(extra.buffer, extra.byteOffset + position, extra.length - position);
      const type = field.getUint16(0, true), length = field.getUint16(2, true);
      if (position + 4 + length > extra.length) throw new Error("Invalid ZIP filename metadata.");
      if (type === 0x7075 && length >= 5 && extra[position + 4] === 1 && field.getUint32(5, true) === crc32(name)) {
        unicode = utf8.decode(extra.subarray(position + 9, position + 4 + length));
      }
      if (type === 1) {
        let cursor = 4;
        const wide = () => {
          if (cursor + 8 > length + 4) throw new Error("Invalid ZIP64 entry sizes.");
          const value = Number(field.getBigUint64(cursor, true)); cursor += 8;
          if (!Number.isSafeInteger(value)) throw new Error("Invalid ZIP64 entry sizes.");
          return value;
        };
        if (originalSize === 0xffffffff) originalSize = wide();
        if (compressedSize === 0xffffffff) compressedSize = wide();
        if (localOffset === 0xffffffff) localOffset = wide();
      }
      position += 4 + length;
    }
    let utfName: string | undefined;
    try { utfName = utf8.decode(name); } catch { if (flags & 2048) throw new Error("Invalid UTF-8 model ZIP filename."); }
    let chinese: string;
    try { chinese = new TextDecoder("gb18030", { fatal: true }).decode(name); }
    catch { chinese = dosName(name); }
    const decoded = [unicode ?? utfName ?? chinese, unicode ?? (flags & 2048 ? utfName! : dosName(name))];
    // fflate decodes streaming names from local headers. Match either flag
    // spelling, including archives with inconsistent local/central UTF-8 flags.
    const keys = [strFromU8(name, true), ...(utfName === undefined ? [] : [utfName])];
    for (let variant = 0; variant < maps.length; variant++) for (const key of keys) {
      if (maps[variant].has(key) && maps[variant].get(key) !== decoded[variant]) throw new Error("Ambiguous model ZIP filenames.");
      maps[variant].set(key, decoded[variant]);
    }
    if ([compressedSize, originalSize, localOffset].includes(0xffffffff) || localOffset + compressedSize > start || view.getUint16(34, true)) throw new Error("Invalid model ZIP entry bounds.");
    entries.push({ name: strFromU8(name, !(flags & 2048)), flags, compression: view.getUint16(10, true), crc: view.getUint32(16, true), size: compressedSize, originalSize, offset: localOffset });
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return { paths: maps, entries, start };
}
