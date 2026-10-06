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
