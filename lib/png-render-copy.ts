import { Unzlib } from "fflate";

/** Downsample scanlines without allocating a decoded source-sized bitmap.
 * Large interlaced/16-bit images are rejected before native image decoding. */
export async function downsamplePng(blob: Blob, width: number, height: number, signal?: AbortSignal): Promise<Uint8ClampedArray<ArrayBuffer>> {
  signal?.throwIfAborted();
  const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  if (header.length !== 33 || header.slice(0, 8).join() !== "137,80,78,71,13,10,26,10" || String.fromCharCode(...header.slice(12, 16)) !== "IHDR") throw new Error("Invalid PNG texture.");
  const view = new DataView(header.buffer);
  const sourceWidth = view.getUint32(16), sourceHeight = view.getUint32(20), color = header[25];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!sourceWidth || !sourceHeight || sourceWidth > 32768 || sourceHeight > 32768 || header[24] !== 8 || !channels || header[26] || header[27] || header[28]) throw new Error("Large textures need non-interlaced 8-bit PNG. Export a smaller PNG texture to load this model safely.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > sourceWidth || height > sourceHeight || width * height > 16_777_216) throw new Error("Invalid render texture size.");
  const output = new Uint8ClampedArray(width * height * 4);
  const stride = sourceWidth * channels;
  let row = new Uint8Array(stride), previous = new Uint8Array(stride);
  let column = -1, filter = 0, sourceY = 0, targetY = 0;
  let palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  const scaleX = sourceWidth / width, scaleY = sourceHeight / height;
  const horizontal = new Float64Array(width * 4);
  const accumulated = new Float64Array(width * 4);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let finished = false;
  const inflater = new Unzlib((data, final) => {
    for (const byte of data) {
      if (sourceY >= sourceHeight) throw new Error("PNG has excess image data.");
      if (column === -1) { filter = byte; if (filter > 4) throw new Error("Invalid PNG filter."); column = 0; continue; }
      const left = column >= channels ? row[column - channels] : 0;
      const up = previous[column], corner = column >= channels ? previous[column - channels] : 0;
      row[column] = byte + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0);
      if (++column !== stride) continue;
      // Area filtering integrates every covered source pixel. Accumulate colors
      // with premultiplied alpha so transparent atlas margins do not make halos.
      horizontal.fill(0);
      for (let x = 0; x < width; x++) {
        const begin = x * scaleX, end = (x + 1) * scaleX, to = x * 4;
        for (let sx = Math.floor(begin); sx < Math.ceil(end); sx++) {
          const from = sx * channels;
          const weight = Math.min(sx + 1, end) - Math.max(sx, begin);
          let r: number, g: number, b: number, alpha: number;
          if (color === 3) {
            const index = row[from];
            if (!palette || index * 3 + 2 >= palette.length) throw new Error("Invalid PNG palette.");
            r = palette[index * 3]; g = palette[index * 3 + 1]; b = palette[index * 3 + 2]; alpha = transparency?.[index] ?? 255;
          } else {
            const gray = color === 0 || color === 4;
            r = row[from]; g = row[from + (gray ? 0 : 1)]; b = row[from + (gray ? 0 : 2)];
            alpha = color === 6 ? row[from + 3] : color === 4 ? row[from + 1] : 255;
            if (transparency && color === 0 && r === transparency[0] * 256 + transparency[1]) alpha = 0;
            if (transparency && color === 2 && r === transparency[0] * 256 + transparency[1] && g === transparency[2] * 256 + transparency[3] && b === transparency[4] * 256 + transparency[5]) alpha = 0;
          }
          horizontal[to] += r * alpha * weight; horizontal[to + 1] += g * alpha * weight;
          horizontal[to + 2] += b * alpha * weight; horizontal[to + 3] += alpha * weight;
        }
      }
      let coveredY = sourceY;
      while (targetY < height && coveredY < sourceY + 1) {
        const end = Math.min(sourceY + 1, (targetY + 1) * scaleY);
        const weight = end - coveredY;
        for (let i = 0; i < horizontal.length; i++) accumulated[i] += horizontal[i] * weight;
        coveredY = end;
        if (end < (targetY + 1) * scaleY) break;
        for (let x = 0; x < width; x++) {
          const from = x * 4, to = (targetY * width + x) * 4, alpha = accumulated[from + 3];
          output[to] = alpha ? accumulated[from] / alpha : 0;
          output[to + 1] = alpha ? accumulated[from + 1] / alpha : 0;
          output[to + 2] = alpha ? accumulated[from + 2] / alpha : 0;
          output[to + 3] = alpha / (scaleX * scaleY);
        }
        targetY++; accumulated.fill(0);
      }
      const swap = previous; previous = row; row = swap; sourceY++; column = -1;
    }
    if (final) finished = true;
  });
  let offset = 33, sawData = false, sawEnd = false, lastYield = Date.now();
  while (offset + 12 <= blob.size) {
    signal?.throwIfAborted();
    const chunk = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(chunk.buffer).getUint32(0), type = String.fromCharCode(...chunk.slice(4));
    if (offset + length + 12 > blob.size) throw new Error("Truncated PNG texture.");
    if (type === "PLTE" || type === "tRNS") {
      if (sawData || length > 768) throw new Error("Invalid PNG color metadata.");
      const bytes = new Uint8Array(await blob.slice(offset + 8, offset + 8 + length).arrayBuffer());
      if (type === "PLTE") palette = bytes; else transparency = bytes;
    } else if (type === "IDAT") {
      sawData = true;
      // Bound each inflation burst, including highly compressed transparent atlases.
      for (let start = 0; start < length; start += 2048) {
        signal?.throwIfAborted();
        inflater.push(new Uint8Array(await blob.slice(offset + 8 + start, offset + 8 + Math.min(length, start + 2048)).arrayBuffer()), false);
        if (Date.now() - lastYield > 16) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); lastYield = Date.now(); }
      }
    } else if (type === "IEND") { inflater.push(new Uint8Array(), true); sawEnd = true; break; }
    offset += length + 12;
  }
  if (!sawData || !sawEnd || !finished || sourceY !== sourceHeight || column !== -1 || targetY !== height) throw new Error("Incomplete PNG texture.");
  signal?.throwIfAborted();
  return output;
}
