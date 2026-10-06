/** Render-only adaptation. Imported textures remain unchanged in IndexedDB. */
export interface TextureSize { width: number; height: number }
export interface TextureBudget { maxDimension: number; budgetBytes: number; original?: boolean; signal?: AbortSignal }
export interface TexturePlan { source: TextureSize; render: TextureSize }

export function planTextures(sizes: TextureSize[], budget: TextureBudget): TexturePlan[] {
  if (!Number.isFinite(budget.maxDimension) || budget.maxDimension < 1 || !Number.isFinite(budget.budgetBytes) || budget.budgetBytes < 4) throw new Error("Invalid texture budget.");
  if (sizes.some((size) => !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1)) throw new Error("Invalid texture dimensions.");
  const max = Math.max(1, ...sizes.flatMap((size) => [size.width, size.height]));
  if (budget.original && max > budget.maxDimension) throw new Error(`Original textures exceed this device's ${budget.maxDimension}px limit. Choose Auto quality.`);
  const bytes = sizes.reduce((total, size) => total + size.width * size.height * 4, 0);
  if (budget.original && bytes > budget.budgetBytes) throw new Error("Original textures exceed this device's graphics memory budget. Choose Auto quality.");
  const scale = budget.original ? 1 : Math.min(1, budget.maxDimension / max, Math.sqrt(budget.budgetBytes / Math.max(4, bytes)));
  return sizes.map((source) => ({ source, render: { width: Math.max(1, Math.floor(source.width * scale)), height: Math.max(1, Math.floor(source.height * scale)) } }));
}

export async function readTextureSize(blob: Blob): Promise<TextureSize> {
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  if (header.length >= 24 && header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71 && header[4] === 13 && header[5] === 10 && header[6] === 26 && header[7] === 10) {
    const data = new DataView(header.buffer);
    return { width: data.getUint32(16), height: data.getUint32(20) };
  }
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot inspect this texture format. Use PNG textures or a browser with image decoding support.");
  const image = await createImageBitmap(blob);
  try { return { width: image.width, height: image.height }; } finally { image.close(); }
}

export async function resizeTexture(blob: Blob, size: TextureSize, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const source = await readTextureSize(blob);
  if (source.width * source.height > 4096 * 4096) {
    const { downsamplePng } = await import("./png-render-copy");
    const pixels = await downsamplePng(blob, size.width, size.height, signal);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the texture.");
      context.putImageData(new ImageData(pixels, size.width, size.height), 0, 0);
      const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Texture conversion failed.")), "image/png"));
      signal?.throwIfAborted();
      return output;
    } finally { canvas.width = canvas.height = 1; }
  }
  if (typeof createImageBitmap !== "function") throw new Error("Auto quality needs image resizing support. Try a current browser.");
  // Decode straight to the target size, one atlas at a time, and release
  // ImageBitmap/canvas memory immediately after encoding the render copy.
  const bitmap = await createImageBitmap(blob, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" });
  const canvas = document.createElement("canvas");
  try {
    signal?.throwIfAborted();
    if (bitmap.width !== size.width || bitmap.height !== size.height) throw new Error("The browser did not resize the large texture.");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the texture.");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Texture conversion failed.")), "image/png"));
    signal?.throwIfAborted();
    return output;
  } finally { bitmap.close(); canvas.width = canvas.height = 1; }
}
