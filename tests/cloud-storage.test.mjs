import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadSceneModule as load } from "./scene-module-loader.mjs";
const require = createRequire(import.meta.url);
const limits = load("../lib/cloud-storage.ts", {}, { TextDecoder });
const { StorageError } = limits;
const statusFormat = load("../lib/storage-status.ts");
test("storage percentages use decimal capacities, retaining over-cap values and readable units", () => {
  assert.equal(statusFormat.storagePercentage(250000000, 1000000000), 25);
  assert.equal(statusFormat.storagePercentage(8000000000, 10000000000), 80);
  assert.equal(statusFormat.storagePercentage(120, 100), 120);
  assert.equal(statusFormat.formatStorageBytes(8000000000), "8.00 GB");
  assert.equal(statusFormat.formatStorageBytes(250000000), "250.0 MB");
});
test("Status reports provider failures as unknown rather than an empty zero-byte storage", async () => {
  const statusStore = load("../lib/storage-status-store.ts", { "@/lib/cloud-storage": limits, "@/lib/cloud-store": { observedR2Accounting: async () => { throw new Error("Database unavailable"); } }, "@/lib/r2": { r2Inventory: async () => { throw new Error("Not configured"); } } });
  const result = await statusStore.getStorageStatus({ rpc: async () => ({ data: null, error: { message: "unavailable" } }) });
  assert.equal(result.supabase.usedBytes, null); assert.equal(result.r2.usedBytes, null);
  assert.equal(result.r2.connected, false); assert.equal(result.r2.limitBytes, 10e9);
});
test("Status reads actual R2 bytes separately from larger reserved upload quotas", async () => {
  const statusStore = load("../lib/storage-status-store.ts", { "@/lib/cloud-storage": limits, "@/lib/cloud-store": { observedR2Accounting: async () => ({usage:{live2d:{used:2e9,limit:8e9},other:{used:1e9,limit:2e9}}}) }, "@/lib/r2": { r2Inventory: async () => new Map([["live2d/model.zip",100],["external-file",250]]) } });
  const result = await statusStore.getStorageStatus({ rpc: async () => ({data:"250000000",error:null}) });
  assert.equal(result.supabase.usedBytes,250000000); assert.equal(result.r2.usedBytes,350);
  assert.equal(result.r2.categories.live2d.limit,8e9);
  assert.equal(result.r2.quotaUsage.live2d.used,2e9);
});
test("R2 Status cannot report success from database reservations when provider is unavailable", async () => {
  const statusStore=load("../lib/storage-status-store.ts",{"@/lib/cloud-storage":limits,"@/lib/cloud-store":{observedR2Accounting:async()=>({usage:{live2d:{used:100,limit:8e9},other:{used:0,limit:2e9}}})},"@/lib/r2":{r2Inventory:async()=>{throw new Error("R2 access denied");}}});
  const result=await statusStore.getStorageStatus({rpc:async()=>({data:50,error:null})});
  assert.equal(result.supabase.usedBytes,50); assert.equal(result.r2.usedBytes,null); assert.equal(result.r2.connected,false);
});
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
test("billing quotas total exactly 10 decimal GB; 512 MiB model and part boundaries are inclusive", () => {
  assert.equal(limits.STORAGE_LIMITS.live2d + limits.STORAGE_LIMITS.other, 10_000_000_000);
  assert.equal(limits.modelSize(536870912), 536870912);
  for (const bytes of [0, -1, 536870913, 1.5, "100", Infinity]) assert.throws(() => limits.modelSize(bytes));
  assert.equal(limits.partSize(536870912, 32), 16777216);
  assert.equal(limits.partSize(16777217, 2), 1);
  for (const part of [0, 33, 1.5, NaN]) assert.throws(() => limits.partSize(536870912, part));
});
test("remote metadata blocks external references, traversal, duplicate manifests and invalid IDs", () => {
  assert.equal(limits.modelManifests([{ path: "โมเดล/test.model3.json", name: "Test" }])[0].name, "Test");
  for (const path of ["../x.model3.json", "/x.model3.json", "https://host/x.model3.json", "folder/../x.model3.json", "folder\\x.model3.json", "folder//x.model3.json"]) assert.throws(() => limits.modelManifests([{ path, name: "Test" }]));
  assert.throws(() => limits.modelManifests([{ path: "x.model3.json", name: "Test" }, { path: "x.model3.json", name: "Again" }]));
  assert.throws(() => limits.storageId("../../other")); assert.equal(limits.storageId(id), id);
});
test("JSON body limits actual streamed bytes even without Content-Length", async () => {
  const data = await limits.storageJson(new Request("https://app.example/api/models", { method: "POST", body: '{"byteSize":1}' }));
  assert.equal(data.byteSize, 1);
  await assert.rejects(limits.storageJson(new Request("https://app.example/api/models", { method: "POST", body: "a".repeat(32769) })), (error) => error.status === 413);
});

function fixture({ failDelete = false, failReserve = false, failInventory = false, inventory = new Map() } = {}) {
  const rows = new Map(); const calls = [];
  let observed = { live2d_bytes: 0, other_bytes: 0 };
  const db = { rpc: async (name, args) => { assert.equal(name, "vivian_storage_observe"); observed = args; return {error:null}; }, from(table) {
    const filters = []; let action = "select", payload;
    const q = {
      select() { return q; }, insert(value) { action = "insert"; payload = value; return q; }, update(value) { action = "update"; payload = value; return q; }, delete() { action = "delete"; return q; },
      eq(key, value) { filters.push((row) => row[key] === value); return q; }, in(key, values) { filters.push((row) => values.includes(row[key])); return q; }, order() { return q; }, range() { return q; }, limit() { return q; }, maybeSingle() { q.single = true; return q; },
      then(resolve, reject) {
        let result;
        if (table === "vivian_storage_quotas") result = { data: [{ category: "live2d", used_bytes: [...rows.values()].filter((row) => row.category === "live2d").reduce((sum, row) => sum + row.byte_size, 0), limit_bytes: 8e9 }, { category: "other", used_bytes: 0, limit_bytes: 2e9 }], error: null };
        else if (action === "insert") {
          if (failReserve || (Array.isArray(payload) ? payload : [payload]).some(row => observed[`${row.category}_bytes`] + [...rows.values()].filter(r=>r.category===row.category).reduce((n,r)=>n+r.byte_size,0) + row.byte_size > limits.STORAGE_LIMITS[row.category])) result = { error: { code: "23514" } };
          else { for (const row of Array.isArray(payload) ? payload : [payload]) rows.set(row.id, { state: "pending", created_at: new Date().toISOString(), ...row }); result = { error: null }; }
        } else {
          const found = [...rows.values()].filter((row) => filters.every((filter) => filter(row)));
          if (action === "delete") for (const row of found) rows.delete(row.id);
          if (action === "update") for (const row of found) Object.assign(row, payload);
          result = { data: q.single ? found[0] ?? null : found, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    }; return q;
  } };
  const r2 = {
    r2Inventory: async () => { if(failInventory) throw new Error("R2 unavailable"); return inventory; },
    r2Configuration() {}, startModelUpload: async (key) => { calls.push(["start", key]); return "multipart-session"; }, signModelParts: async (...args) => { calls.push(["sign", ...args]); return []; },
    completeModelUpload: async (...args) => { calls.push(["complete", ...args]); }, deleteR2Object: async (...args) => { calls.push(["delete", ...args]); if (failDelete) throw new Error("R2 outage"); },
    signModelDownload: async (key) => { calls.push(["download", key]); return "https://private-download.example/signed"; }, putR2Image: async (...args) => { calls.push(["image", ...args]); },
  };
  const store = load("../lib/cloud-store.ts", { "@/lib/cloud-storage": limits, "@/lib/r2": r2 });
  return { db, rows, calls, store };
}
const upload = { byteSize: 100, manifests: [{ path: "model.model3.json", name: "Model" }] };
test("folder archives preserve original bytes and Unicode paths; source ZIP is reused", async () => {
  const fflate = require("fflate");
  const browser = load("../lib/cloud-models.ts", { "@/lib/auth/fetch": {}, "@/lib/local-models": {}, "@/lib/cloud-storage": limits, "@/lib/storage-status": statusFormat, fflate });
  const bytes = new Uint8Array(4 * 1024 * 1024 + 10); bytes[0] = 7; bytes[bytes.length - 1] = 42;
  const pack = { assets: [{ path: "โมเดล/texture.png", blob: new Blob([bytes]) }, { path: "empty.txt", blob: new Blob([]) }] };
  const archive = await browser.modelArchive(pack);
  const files = fflate.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(files["โมเดล/texture.png"].length, bytes.length);
  assert.equal(files["โมเดล/texture.png"][0], 7); assert.equal(files["โมเดล/texture.png"][bytes.length - 1], 42);
  assert.equal(files["empty.txt"].length, 0);
  const original = new File([archive], "model.zip");
  assert.equal(await browser.modelArchive(pack, original), original);
});
test("bucket bytes outside ledger block uploads; failed live checks cannot start uploads", async () => {
  const full = fixture({ inventory: new Map([["live2d/manual.zip",8e9]]) });
  await assert.rejects(full.store.beginCloudModel(full.db, user, upload), error => error.status === 409);
  assert.equal(full.calls.length,0); assert.equal(full.rows.size,0);
  const down = fixture({failInventory:true});
  await assert.rejects(down.store.beginCloudModel(down.db,user,upload));
  await assert.rejects(down.store.saveCloudSceneImages(down.db,user,"scene.webp",Buffer.alloc(10),Buffer.alloc(1)));
  assert.equal(down.calls.length,0); assert.equal(down.rows.size,0);
});
test("inventory reconciliation counts external bytes without double-counting reserved model parts", async () => {
  const inventory = new Map(); const f=fixture({inventory});
  const started=await f.store.beginCloudModel(f.db,user,upload);
  inventory.set(`live2d/${user}/${started.id}.zip`,60);
  inventory.set("outside.webp",25);
  let observation;
  f.db.rpc=async(name,args)=>{ observation=args; return {error:null}; };
  await f.store.refreshR2Accounting(f.db);
  assert.equal(observation.live2d_bytes,0); assert.equal(observation.other_bytes,25);
  inventory.set(`live2d/${user}/${started.id}.zip`,120);
  await f.store.refreshR2Accounting(f.db);
  assert.equal(observation.live2d_bytes,20);
});
test("quota denial happens before any R2 write or signed access", async () => {
  const f = fixture({ failReserve: true });
  await assert.rejects(f.store.beginCloudModel(f.db, user, upload), (error) => error instanceof StorageError && error.status === 409);
  assert.equal(f.calls.length, 0);
});
test("all object operations scope ownership; staged models cannot download", async () => {
  const f = fixture(); const started = await f.store.beginCloudModel(f.db, user, upload);
  for (const action of [() => f.store.cloudModelDownload(f.db, other, started.id), () => f.store.cloudModelParts(f.db, other, started.id, 1), () => f.store.finishCloudModel(f.db, other, started.id), () => f.store.removeCloudObject(f.db, other, started.id)]) await assert.rejects(action(), (error) => error.status === 404);
  await assert.rejects(f.store.cloudModelDownload(f.db, user, started.id), (error) => error.status === 404);
  assert.equal(f.calls.filter((call) => call[0] !== "start").length, 0);
  await f.store.finishCloudModel(f.db, user, started.id);
  assert.equal((await f.store.cloudModels(f.db, user)).models.length, 1);
  await f.store.cloudModelDownload(f.db, user, started.id);
  await f.store.finishCloudModel(f.db, user, started.id);
  assert.equal(f.calls.filter((call) => call[0] === "complete").length, 1);
});
test("failed remote deletion retains the reservation; successful cleanup releases it", async () => {
  const failed = fixture({ failDelete: true }); const first = await failed.store.beginCloudModel(failed.db, user, upload);
  await assert.rejects(failed.store.removeCloudObject(failed.db, user, first.id));
  assert.equal(failed.rows.get(first.id).state, "deleting");
  assert.equal((await failed.store.storageUsage(failed.db)).live2d.used, 100);
  const ok = fixture(); const second = await ok.store.beginCloudModel(ok.db, user, upload);
  await ok.store.removeCloudObject(ok.db, user, second.id);
  assert.equal((await ok.store.storageUsage(ok.db)).live2d.used, 0);
});
test("scene image and thumbnail share one atomic reservation in the other category", async () => {
  const f = fixture(); await f.store.saveCloudSceneImages(f.db, user, `${user}/scene.webp`, Buffer.alloc(100), Buffer.alloc(10));
  assert.equal(f.rows.size, 2);
  assert.ok([...f.rows.values()].every((row) => row.category === "other" && row.state === "ready"));
  assert.equal([...f.rows.values()].reduce((sum, row) => sum + row.byte_size, 0), 110);
  const full = fixture({ failReserve: true });
  await assert.rejects(full.store.saveCloudSceneImages(full.db, user, "scene.webp", Buffer.alloc(100), Buffer.alloc(10)));
  assert.equal(full.calls.length, 0);
});
test("presigned multipart uploads bind exact Content-Length and cannot sign nonexistent parts", async () => {
  const aws = require("@aws-sdk/client-s3"), signer = require("@aws-sdk/s3-request-presigner");
  const r2 = load("../lib/r2.ts", { "@aws-sdk/client-s3": aws, "@aws-sdk/s3-request-presigner": signer, "@/lib/cloud-storage": limits }, { process: { env: { R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret", R2_BUCKET_NAME: "private-test" } } });
  const parts = await r2.signModelParts("live2d/owner/id.zip", "upload", 16777217, 1);
  assert.equal(parts.length, 2); assert.equal(parts[1].size, 1);
  assert.match(new URL(parts[0].url).searchParams.get("X-Amz-SignedHeaders"), /content-length/);
  assert.equal(new URL(parts[0].url).searchParams.get("X-Amz-Expires"), "300");
  await assert.rejects(r2.signModelParts("key", "upload", 16777217, 3));
});
test("multipart completion validates remote part lengths and ignores client ETags", async () => {
  const aws = require("@aws-sdk/client-s3"); let remote = [{ PartNumber: 1, Size: 100, ETag: '"real"' }], exists = false; const writes = [];
  class S3 {
    async send(command) {
      if (command instanceof aws.HeadObjectCommand) { if (exists) return { ContentLength: 100 }; throw { name: "NotFound" }; }
      if (command instanceof aws.ListPartsCommand) return { Parts: remote };
      if (command instanceof aws.CompleteMultipartUploadCommand) { writes.push(command.input); exists = true; return {}; }
      throw new Error("Unexpected command");
    }
  }
  const r2 = load("../lib/r2.ts", { "@aws-sdk/client-s3": { ...aws, S3Client: S3 }, "@aws-sdk/s3-request-presigner": {}, "@/lib/cloud-storage": limits }, { process: { env: { R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET_NAME: "test" } } });
  remote[0].Size = 101; await assert.rejects(r2.completeModelUpload("key", "session", 100)); assert.equal(writes.length, 0);
  remote[0].Size = 100; await r2.completeModelUpload("key", "session", 100);
  assert.equal(writes[0].MultipartUpload.Parts[0].ETag, '"real"');
  await r2.completeModelUpload("key", "session", 100); assert.equal(writes.length, 1);
});
test("live R2 inventory follows all object, upload and part pages and counts actual bytes", async () => {
  const aws=require("@aws-sdk/client-s3"); const calls=[]; let invalid=false;
  class S3 {
    async send(command) {
      calls.push(command.input);
      if(command instanceof aws.ListObjectsV2Command) return command.input.ContinuationToken ? {Contents:[{Key:"manual.webp",Size:200}]} : {Contents:[{Key:"live2d/model.zip",Size:invalid?undefined:100}],IsTruncated:true,NextContinuationToken:"next"};
      if(command instanceof aws.ListMultipartUploadsCommand) return command.input.KeyMarker ? {Uploads:[{Key:"other/upload.webp",UploadId:"second"}]} : {Uploads:[{Key:"live2d/model.zip",UploadId:"first"}],IsTruncated:true,NextKeyMarker:"marker",NextUploadIdMarker:"upload-marker"};
      if(command instanceof aws.ListPartsCommand) {
        if(command.input.UploadId==='second') return {Parts:[{Size:50}]};
        return command.input.PartNumberMarker ? {Parts:[{Size:60}]} : {Parts:[{Size:40}],IsTruncated:true,NextPartNumberMarker:"1"};
      }
      throw new Error("Unexpected command");
    }
  }
  const r2=load("../lib/r2.ts",{"@aws-sdk/client-s3":{...aws,S3Client:S3},"@aws-sdk/s3-request-presigner":{},"@/lib/cloud-storage":limits},{process:{env:{R2_ACCOUNT_ID:"a".repeat(32),R2_ACCESS_KEY_ID:"test",R2_SECRET_ACCESS_KEY:"test",R2_BUCKET_NAME:"test"}}});
  const actual=await r2.r2Inventory();
  assert.equal(actual.get("live2d/model.zip"),200); assert.equal(actual.get("manual.webp"),200); assert.equal(actual.get("other/upload.webp"),50);
  assert.equal(limits.inventoryUsage(actual).live2d.used,200); assert.equal(limits.inventoryUsage(actual).other.used,250);
  assert.equal(calls.length,7); invalid=true;
  await assert.rejects(r2.r2Inventory(),error=>error.status===503);
});
