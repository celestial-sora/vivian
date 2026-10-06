/** Batch disk-backed Safari Blob reads while keeping inflation bursts small. */
export function bufferedBlobReader(blob: Blob, signal?: AbortSignal) {
  let start = -1;
  let buffer = new Uint8Array(0);
  return async (offset: number, length: number): Promise<Uint8Array> => {
    signal?.throwIfAborted();
    if (offset < start || Math.min(blob.size, offset + length) > start + buffer.length) {
      start = offset;
      buffer = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + Math.max(length, 256 * 1024))).arrayBuffer());
    }
    signal?.throwIfAborted();
    return buffer.subarray(offset - start, offset - start + length);
  };
}
/** Coalesce small inflation bursts so large archives do not retain hundreds of
 * thousands of Safari Blob backing objects. Copy before callers reuse data. */
export function bufferedBlobWriter(type: string) {
  const blockBytes = 1024 * 1024;
  const chunks: Blob[] = [];
  let buffer: Uint8Array<ArrayBuffer> | undefined;
  let used = 0;
  return {
    push(data: Uint8Array) {
      for (let offset = 0; offset < data.length;) {
        buffer ??= new Uint8Array(blockBytes);
        const length = Math.min(blockBytes - used, data.length - offset);
        buffer.set(data.subarray(offset, offset + length), used);
        used += length; offset += length;
        if (used === blockBytes) {
          chunks.push(new Blob([buffer]));
          used = 0;
        }
      }
    },
    finish(): Blob {
      if (buffer && used) chunks.push(new Blob([buffer.subarray(0, used)]));
      const result = new Blob(chunks, { type });
      chunks.length = 0; buffer = undefined; used = 0;
      return result;
    },
  };
}
