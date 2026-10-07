export interface RarAsset { path: string; blob: Uint8Array }

function friendlyRarError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) return new Error("Encrypted RAR archives are unsupported. Extract it first or use an unencrypted archive.");
  return new Error(`Could not read RAR archive: ${message}`);
}

export async function extractModelRar(file: File, maxBytes: number, maxFiles: number): Promise<RarAsset[]> {
  if (file.size > maxBytes) throw new Error("RAR exceeds 512 MB.");
  if (typeof window === "undefined") throw new Error("RAR import is only available in the browser.");

  let wasmBinary: ArrayBuffer;
  try {
    const response = await fetch("/vendor/unrar.wasm", { credentials: "same-origin", cache: "force-cache" });
    if (!response.ok) throw new Error(`runtime returned HTTP ${response.status}`);
    wasmBinary = await response.arrayBuffer();
  } catch (error) {
    throw new Error(`RAR runtime could not load: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const { createExtractorFromData } = await import("node-unrar-js/esm/index.esm.js");
    const extractor = await createExtractorFromData({ data: await file.arrayBuffer(), wasmBinary });
    const listed = extractor.getFileList();
    const headers = [...listed.fileHeaders];

    if (listed.arcHeader.flags.volume) throw new Error("Multi-volume RAR archives are unsupported. Combine or extract the parts first.");
    if (listed.arcHeader.flags.headerEncrypted || headers.some((header) => header.flags.encrypted)) {
      throw new Error("Encrypted RAR archives are unsupported. Extract it first or use an unencrypted archive.");
    }

    const files = headers.filter((header) => !header.flags.directory);
    if (files.length > maxFiles) throw new Error(`Model package limit: ${maxFiles.toLocaleString()} files.`);
    const declaredBytes = files.reduce((sum, header) => sum + header.unpSize, 0);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) throw new Error("Expanded RAR exceeds 512 MB.");

    const result: RarAsset[] = [];
    let actualBytes = 0;
    const extracted = extractor.extract({ files: (header) => !header.flags.directory && !header.flags.encrypted });
    for (const entry of extracted.files) {
      if (entry.fileHeader.flags.directory) continue;
      if (!(entry.extraction instanceof Uint8Array)) throw new Error(`RAR entry could not be extracted: ${entry.fileHeader.name}`);
      actualBytes += entry.extraction.byteLength;
      if (actualBytes > maxBytes) throw new Error("Expanded RAR exceeds 512 MB.");
      result.push({ path: entry.fileHeader.name, blob: entry.extraction });
    }
    if (result.length !== files.length) throw new Error("RAR extraction was incomplete.");
    return result;
  } catch (error) {
    throw friendlyRarError(error);
  }
}
