/** Validated Cubism packages; originals stay in IndexedDB and may sync to private R2. */
import type { TextureBudget, TexturePlan } from "./model-textures";
import { bufferedBlobReader } from "./blob-reader.ts";
export interface ModelAsset { path: string; blob: Blob }
export interface ModelMotion { group: string; index: number; name: string }
export interface LocalModel {
  id: string;
  name: string;
  manifestPath: string;
  expressions: string[];
  poses: string[];
  motions: ModelMotion[];
  previewPath?: string;
}
export interface ModelPackage { id: string; assets: ModelAsset[]; models: LocalModel[]; cloudOwner?: string }
export interface CubismManifest {
  Version: number;
  FileReferences: {
    Moc: string; Textures: string[]; Physics?: string; Pose?: string;
    DisplayInfo?: string; UserData?: string;
    Expressions?: Array<{ Name: string; File: string }>;
    Motions?: Record<string, Array<{ File: string; Sound?: string }>>;
  };
  [key: string]: unknown;
}
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 3000;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

export function normalizePath(path: string): string {
  if (/^(?:[a-z][\w+.-]*:|\/|\\)/i.test(path) || /[\0]/.test(path)) throw new Error(`Invalid local asset path: ${path}`);
  const result: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!result.length) throw new Error("Asset path leaves the model package.");
      result.pop();
    } else result.push(part);
  }
  return result.join("/");
}
export function resolveAsset(manifestPath: string, reference: string): string {
  // Validate the reference itself before joining: external URLs are never fetched.
  if (/^(?:[a-z][\w+.-]*:|\/|\\)/i.test(reference)) throw new Error("Models must reference local assets only.");
  return normalizePath(manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1) + reference);
}

export function parseManifest(value: unknown): CubismManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid model3.json.");
  const manifest = value as CubismManifest;
  const refs = manifest.FileReferences;
  if (manifest.Version !== 3 || !refs || typeof refs.Moc !== "string" || !refs.Moc.endsWith(".moc3") || !Array.isArray(refs.Textures) || !refs.Textures.length || refs.Textures.some((item) => typeof item !== "string")) throw new Error("Import a Cubism model3.json with a .moc3 and textures.");
  for (const key of ["Physics", "Pose", "DisplayInfo", "UserData"] as const) if (refs[key] !== undefined && typeof refs[key] !== "string") throw new Error(`Invalid ${key} reference.`);
  if (refs.Expressions !== undefined && (!Array.isArray(refs.Expressions) || refs.Expressions.some((item) => !item || typeof item.Name !== "string" || !item.Name.trim() || typeof item.File !== "string"))) throw new Error("Invalid expression definitions.");
  if (refs.Motions !== undefined && (!refs.Motions || typeof refs.Motions !== "object" || Array.isArray(refs.Motions) || Object.values(refs.Motions).some((items) => !Array.isArray(items) || items.some((item) => !item || typeof item.File !== "string" || (item.Sound !== undefined && typeof item.Sound !== "string"))))) throw new Error("Invalid motion definitions.");
  return manifest;
}
/** Some artist packages omit animations from FileReferences entirely. */
export function discoverManifest(assets: ModelAsset[], manifestPath: string, value: unknown): CubismManifest {
  const manifest = parseManifest(value);
  const refs = manifest.FileReferences;
  const directory = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
  const otherDirectories = assets.filter((asset) => /\.model3\.json$/i.test(asset.path) && asset.path !== manifestPath)
    .map((asset) => asset.path.slice(0, asset.path.lastIndexOf("/") + 1)).filter((path) => path !== directory && path.startsWith(directory));
  const nearby = assets.filter((asset) => asset.path.startsWith(directory) && !otherDirectories.some((other) => asset.path.startsWith(other)));
  const expressionPaths = new Set((refs.Expressions ?? []).map((item) => resolveAsset(manifestPath, item.File)));
  const expressions = [...(refs.Expressions ?? [])];
  for (const asset of nearby) {
    if (!/\.exp3\.json$/i.test(asset.path) || expressionPaths.has(asset.path)) continue;
    expressions.push({ Name: asset.path.split("/").at(-1)!.replace(/\.exp3\.json$/i, ""), File: asset.path.slice(directory.length) });
  }
  if (expressions.length) refs.Expressions = expressions;
  const motionPaths = new Set(Object.values(refs.Motions ?? {}).flatMap((items) => items.map((item) => resolveAsset(manifestPath, item.File))));
  const motions = { ...(refs.Motions ?? {}) };
  for (const asset of nearby) {
    if (!/\.motion3\.json$/i.test(asset.path) || motionPaths.has(asset.path)) continue;
    const file = asset.path.slice(directory.length);
    const parent = file.split("/").at(-2);
    const group = parent && !/^(?:motions?|animations?)$/i.test(parent) ? parent : /(?:idle|待机|待機|アイドル)/i.test(fileLabel(file)) ? "Idle" : "Imported";
    motions[group] = [...(motions[group] ?? []), { File: file }];
  }
  if (Object.keys(motions).length) refs.Motions = motions;
  return manifest;
}

export function referencedFiles(manifest: CubismManifest): string[] {
  const refs = manifest.FileReferences;
  return [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData,
    ...(refs.Expressions ?? []).map((item) => item.File),
    ...Object.values(refs.Motions ?? {}).flatMap((items) => items.flatMap((item) => [item.File, item.Sound])),
  ].filter((item): item is string => typeof item === "string");
}
function fileLabel(path: string): string { return path.split("/").at(-1)!.replace(/\.(?:model3|motion3)?\.?json$/i, ""); }

export async function inspectPackage(assets: ModelAsset[], id = crypto.randomUUID()): Promise<ModelPackage> {
  if (assets.length > MAX_FILES || assets.reduce((sum, asset) => sum + asset.blob.size, 0) > MAX_BYTES) throw new Error("Model package limit: 512 MB and 3,000 files.");
  const paths = new Set<string>();
  for (const asset of assets) {
    asset.path = normalizePath(asset.path);
    if (paths.has(asset.path)) throw new Error(`Duplicate asset: ${asset.path}`);
    paths.add(asset.path);
  }
  const manifests = assets.filter((asset) => /\.model3\.json$/i.test(asset.path));
  if (!manifests.length) throw new Error("No .model3.json found. Include the complete model folder.");
  const models: LocalModel[] = [];
  for (const asset of manifests) {
    const manifest = discoverManifest(assets, asset.path, JSON.parse(await asset.blob.text()));
    for (const ref of referencedFiles(manifest)) {
      const path = resolveAsset(asset.path, ref);
      if (!paths.has(path)) throw new Error(`Missing asset: ${path}`);
    }
    const directory = asset.path.slice(0, asset.path.lastIndexOf("/") + 1);
    const textures = new Set(manifest.FileReferences.Textures.map((ref) => resolveAsset(asset.path, ref)));
    const candidates = assets.filter((file) => IMAGE.test(file.path) && !textures.has(file.path) && file.path.startsWith(directory));
    const modelName = fileLabel(asset.path);
    const score = (path: string) => previewScore(path, directory) + (path.slice(directory.length).replace(IMAGE, "").toLowerCase() === modelName.toLowerCase() ? 5 : 0);
    const preview = candidates.sort((a, b) => score(b.path) - score(a.path))[0];
    models.push({
      id: `${id}:${asset.path}`, name: fileLabel(asset.path), manifestPath: asset.path,
      expressions: (manifest.FileReferences.Expressions ?? []).map((item) => item.Name),
      poses: (manifest.FileReferences.Expressions ?? []).map((item) => item.Name).filter((name) => /(?:pose|sitting|standing|kneel|坐姿|站姿|姿势|提裙|捧花|ポーズ|座り|ท่านั่ง|ท่ายืน)/i.test(name)),
      motions: Object.entries(manifest.FileReferences.Motions ?? {}).flatMap(([group, items]) => items.map((item, index) => ({ group, index, name: fileLabel(item.File) || `${group} ${index + 1}` }))),
      previewPath: preview && (score(preview.path) > 0 || candidates.length === 1) ? preview.path : undefined,
    });
  }
  return { id, assets, models };
}
function previewScore(path: string, directory: string): number {
  const filename = path.slice(directory.length);
  if (/(?:preview|thumbnail|thumb|icon|portrait|cover|预览|封面|立绘|サムネ|アイコン)/i.test(filename)) return 10 + (filename.includes("/") ? 0 : 1);
  return 0;
}
function mime(path: string): string {
  if (/\.wav$/i.test(path)) return "audio/wav";
  if (/\.mp3$/i.test(path)) return "audio/mpeg";
  if (/\.ogg$/i.test(path)) return "audio/ogg";
  return /\.png$/i.test(path) ? "image/png" : /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : /\.gif$/i.test(path) ? "image/gif" : /\.json$/i.test(path) ? "application/json" : "application/octet-stream";
}
export async function importModelFiles(files: File[]): Promise<ModelPackage> {
  if (!files.length) throw new Error("Select a model ZIP or folder.");
  let assets: ModelAsset[];
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    if (files[0].size > MAX_BYTES) throw new Error("ZIP exceeds 512 MB.");
    const { Unzip, UnzipInflate } = await import("fflate");
    assets = [];
    let bytes = 0, declaredBytes = 0, count = 0, pending = 0;
    const unzip = new Unzip((file) => {
      if (file.name.endsWith("/") || file.name.startsWith("__MACOSX/")) { file.ondata = () => {}; file.start(); return; }
      declaredBytes += file.originalSize ?? 0; count++; pending++;
      if (declaredBytes > MAX_BYTES || count > MAX_FILES) throw new Error("Expanded ZIP exceeds 512 MB or 3,000 files.");
      const chunks: Blob[] = [];
      file.ondata = (error, data, final) => {
        if (error) throw error;
        bytes += data.byteLength;
        if (bytes > MAX_BYTES) throw new Error("Expanded ZIP exceeds 512 MB or 3,000 files.");
        chunks.push(new Blob([new Uint8Array(data)]));
        if (final) {
          assets.push({ path: file.name, blob: new Blob(chunks, { type: mime(file.name) }) });
          chunks.length = 0; pending--;
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    // Read bounded compressed blocks and convert output into Blob pieces;
    // never hold both full ZIP and full expanded typed-array maps in memory.
    const read = bufferedBlobReader(files[0]);
    for (let offset = 0; offset < files[0].size; offset += 2048) {
      unzip.push(await read(offset, 2048), offset + 2048 >= files[0].size);
      if (offset % (256 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (pending) throw new Error("Model ZIP is incomplete.");
  } else assets = files.map((file) => ({ path: file.webkitRelativePath || file.name, blob: file }));
  return inspectPackage(assets);
}

export async function createModelResources(pack: ModelPackage, model: LocalModel, budget?: TextureBudget) {
  const asset = pack.assets.find((item) => item.path === model.manifestPath);
  if (!asset) throw new Error("Model manifest is missing.");
  const manifest = discoverManifest(pack.assets, model.manifestPath, JSON.parse(await asset.blob.text()));
  const renderCopies = new Map<string, Blob>();
  let texturePlan: TexturePlan[] = [];
  if (budget) {
    const { readTextureSize, planTextures, resizeTexture } = await import("./model-textures.ts");
    const { loadRenderCopies, saveRenderCopies } = await import("./model-render-cache.ts");
    const textures = manifest.FileReferences.Textures.map((ref) => {
      const path = resolveAsset(model.manifestPath, ref);
      const file = pack.assets.find((item) => item.path === path);
      if (!file) throw new Error(`Missing texture: ${path}`);
      return file;
    });
    const sizes = [];
    for (const texture of textures) { budget.signal?.throwIfAborted(); sizes.push(await readTextureSize(texture.blob)); }
    texturePlan = planTextures(sizes, budget);
    const cacheKey = JSON.stringify(["area-v1", pack.id, textures.map((texture, index) => [texture.path, texture.blob.size, texturePlan[index]])]);
    const cached = texturePlan.some((plan) => plan.source.width !== plan.render.width || plan.source.height !== plan.render.height)
      ? await loadRenderCopies(cacheKey) : undefined;
    for (let index = 0; index < textures.length; index++) {
      budget.signal?.throwIfAborted();
      const plan = texturePlan[index];
      if (plan.source.width !== plan.render.width || plan.source.height !== plan.render.height) {
        renderCopies.set(textures[index].path, cached?.get(textures[index].path) ?? await resizeTexture(textures[index].blob, plan.render, budget.signal));
      }
    }
    budget.signal?.throwIfAborted();
    if (!cached) await saveRenderCopies(cacheKey, renderCopies);
    budget.signal?.throwIfAborted();
  }
  const urls = new Map<string, string>();
  let disposed = false;
  const resolve = (reference: string): string => {
    if (disposed) throw new Error("Model resources have been released.");
    const path = resolveAsset(model.manifestPath, reference);
    if (!urls.has(path)) {
      const file = pack.assets.find((item) => item.path === path);
      if (!file) throw new Error(`Missing asset: ${path}`);
      const renderCopy = renderCopies.get(path);
      urls.set(path, URL.createObjectURL(new Blob([renderCopy ?? file.blob], { type: renderCopy?.type ?? mime(path) })));
    }
    return urls.get(path)!;
  };
  return { manifest: { ...manifest, url: model.manifestPath }, resolve, texturePlan,
    dispose: () => { disposed = true; for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); renderCopies.clear(); } };
}

async function openStorage(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("vivian-local-models", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const packages = db.objectStoreNames.contains("packages") ? request.transaction!.objectStore("packages") : db.createObjectStore("packages", { keyPath: "id" });
      const catalog = db.createObjectStore("catalog", { keyPath: "id" });
      // Upgrade one record at a time rather than materializing the entire library.
      const cursor = packages.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        catalog.put(modelCatalogEntry(entry.value)); entry.continue();
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function modelCatalogEntry(pack: ModelPackage): ModelPackage {
  return { id: pack.id, models: pack.models, assets: [], ...(pack.cloudOwner ? { cloudOwner: pack.cloudOwner } : {}) };
}
async function storage<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, storeName = "packages"): Promise<T> {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(mode === "readwrite" ? ["packages", "catalog"] : storeName, mode);
    const request = operation(tx.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Model storage unavailable.")); };
  });
}
export async function loadModelPackages(): Promise<ModelPackage[]> {
  const packages = await storage<ModelPackage[]>("readonly", (store) => store.getAll());
  return Promise.all(packages.map(async (pack) => ({ ...await inspectPackage(pack.assets, pack.id), ...(pack.cloudOwner ? { cloudOwner: pack.cloudOwner } : {}) })));
}
export const loadModelCatalog = (): Promise<ModelPackage[]> => storage("readonly", (store) => store.getAll(), "catalog");
export async function loadModelPackage(id: string): Promise<ModelPackage | undefined> {
  const pack = await storage<ModelPackage | undefined>("readonly", (store) => store.get(id));
  if (!pack?.assets.length) return undefined;
  // Older caches were re-inspected by loadModelPackages. Retain that normalization
  // when hydrating one package rather than trusting stale cached model metadata.
  return { ...await inspectPackage(pack.assets, pack.id), ...(pack.cloudOwner ? { cloudOwner: pack.cloudOwner } : {}) };
}
export function isModelBlobReadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: string; message?: string };
  return name === "NotFoundError" || name === "NotReadableError" || /(?:blob object.*not.*found|requested object.*could not be found|I\/O read operation failed)/i.test(message ?? "");
}
async function checkModelBlobs(pack: ModelPackage, signal?: AbortSignal): Promise<void> {
  // Safari can restore Blob handles whose backing objects were evicted or lost
  // in a WebContent crash. Probe bounded slices before creating runtime URLs.
  for (const asset of pack.assets) {
    signal?.throwIfAborted();
    if (asset.blob.size) await asset.blob.slice(0, 1).arrayBuffer();
  }
  signal?.throwIfAborted();
}
export async function hydrateModelPackage(pack: ModelPackage, options?: { recover?: () => Promise<ModelPackage>; signal?: AbortSignal }): Promise<ModelPackage | undefined> {
  let source: ModelPackage | undefined;
  let cacheError: unknown;
  try {
    options?.signal?.throwIfAborted();
    source = pack.assets.length ? pack : await loadModelPackage(pack.id);
    if (source) await checkModelBlobs(source, options?.signal);
  } catch (error) {
    if (!isModelBlobReadError(error)) throw error;
    cacheError = error;
    source = undefined;
  }
  if (source) return source;
  if (options?.recover) {
    options.signal?.throwIfAborted();
    // Exactly one authorized cloud recovery; don't repeatedly read a broken cache.
    const recovered = await options.recover();
    await checkModelBlobs(recovered, options.signal);
    return recovered;
  }
  if (cacheError) throw new Error("Saved model files could not be read on this device. Import the original model again or reconnect to its cloud copy.", { cause: cacheError });
  return undefined;
}
export const saveModelPackage = (pack: ModelPackage): Promise<IDBValidKey> => {
  if (!pack.assets.length || pack.models.some((model) => !pack.assets.some((asset) => asset.path === model.manifestPath))) return Promise.reject(new Error("Cannot save a model catalog entry without its original model files."));
  return storage("readwrite", (store) => {
    store.transaction.objectStore("catalog").put(modelCatalogEntry(pack));
    return store.put(pack);
  });
};
export const removeModelPackage = async (id: string): Promise<undefined> => {
  const { clearRenderCopies } = await import("./model-render-cache.ts");
  await clearRenderCopies();
  return storage("readwrite", (store) => {
    store.transaction.objectStore("catalog").delete(id);
    return store.delete(id);
  });
};
