import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { zipSync, strToU8, deflateSync } from 'fflate';
import { bufferedBlobReader } from '../lib/blob-reader.ts';
import { loadRenderCopies, saveRenderCopies, clearRenderCopies } from '../lib/model-render-cache.ts';
import { inspectPackage, importModelFiles, createModelResources, normalizePath, resolveAsset, loadModelPackages, loadModelCatalog, loadModelPackage, hydrateModelPackage, modelCatalogEntry, saveModelPackage, removeModelPackage } from '../lib/local-models.ts';

const manifest = () => ({ Version: 3, FileReferences: { Moc: 'avatar.moc3', Textures: ['textures/tex.png'], Physics: 'physics.json', Pose: 'pose.json', Expressions: [{ Name: 'Happy', File: 'expressions/happy.exp3.json' }, { Name: 'เศร้า #', File: 'expressions/เศร้า #.exp3.json' }], Motions: { Idle: [{ File: 'motions/idle.motion3.json' }], Wave: [{ File: 'motions/wave.motion3.json', Sound: 'hello.wav' }] } } });
const asset = (path, content = 'test') => ({ path, blob: new Blob([content]) });
const assets = () => [asset('pack/avatar.model3.json', JSON.stringify(manifest())), ...['avatar.moc3','textures/tex.png','physics.json','pose.json','expressions/happy.exp3.json','expressions/เศร้า #.exp3.json','motions/idle.motion3.json','motions/wave.motion3.json','hello.wav','preview.png'].map((path) => asset(`pack/${path}`))];

test('small inflation bursts use bounded batched Blob reads across block boundaries', async () => {
  const bytes = Uint8Array.from({ length: 700_001 }, (_, index) => index % 251);
  let reads = 0;
  class CountingBlob extends Blob {
    slice(start, end) { reads++; assert.ok(end - start <= 256 * 1024); return super.slice(start, end); }
  }
  const read = bufferedBlobReader(new CountingBlob([bytes]));
  for (let offset = 0; offset < bytes.length; offset += 2048) {
    assert.deepEqual(await read(offset, 2048), bytes.subarray(offset, offset + 2048));
  }
  assert.equal(reads, 3);
  assert.deepEqual(await read(262_140, 12), bytes.subarray(262_140, 262_152));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(bufferedBlobReader(new Blob([bytes]), controller.signal)(0, 1), { name: 'AbortError' });
});

test('disposable render cache reuses copies only for matching model and texture plans', async () => {
  await clearRenderCopies();
  const copies = new Map([['texture.png', new Blob(['render copy'])]]);
  await saveRenderCopies('model-a:4096:area-v1', copies);
  assert.equal(await (await loadRenderCopies('model-a:4096:area-v1')).get('texture.png').text(), 'render copy');
  assert.equal(await loadRenderCopies('model-a:2048:area-v1'), undefined);
  await saveRenderCopies('model-b:4096:area-v1', copies);
  assert.equal(await loadRenderCopies('model-a:4096:area-v1'), undefined);
  await clearRenderCopies();
  assert.equal(await loadRenderCopies('model-b:4096:area-v1'), undefined);
});

test('rendering reuses a saved resized atlas without decoding the original again', async () => {
  const header = new Uint8Array(24);
  header.set([137,80,78,71,13,10,26,10]);
  new DataView(header.buffer).setUint32(16, 8);
  new DataView(header.buffer).setUint32(20, 8);
  const files = assets();
  files.find((entry) => entry.path === 'pack/textures/tex.png').blob = new Blob([header], { type: 'image/png' });
  const pack = await inspectPackage(files, 'cached-render');
  const key = JSON.stringify(['area-v1', pack.id, [['pack/textures/tex.png', 24, { source: { width: 8, height: 8 }, render: { width: 4, height: 4 } }]]]);
  await saveRenderCopies(key, new Map([['pack/textures/tex.png', new Blob(['cached resized image'], { type: 'image/png' })]]));
  // Node has no canvas: a cache miss would try resizing and fail this check.
  const resources = await createModelResources(pack, pack.models[0], { maxDimension: 4, budgetBytes: 64 });
  assert.equal(await (await fetch(resources.resolve('textures/tex.png'))).text(), 'cached resized image');
  assert.equal(pack.assets.find((entry) => entry.path === 'pack/textures/tex.png').blob.size, 24);
  resources.dispose();
  await clearRenderCopies();
});

test('nested model package discovers actual expressions, motion groups/indices, and preview without using a texture atlas', async () => {
  const pack = await inspectPackage(assets(), 'fixture');
  assert.deepEqual(pack.models[0].expressions, ['Happy', 'เศร้า #']);
  assert.deepEqual(pack.models[0].motions, [{ group: 'Idle', index: 0, name: 'idle' }, { group: 'Wave', index: 0, name: 'wave' }]);
  assert.equal(pack.models[0].previewPath, 'pack/preview.png');
  const withoutPreview = await inspectPackage(assets().filter((file) => file.path !== 'pack/preview.png'));
  assert.equal(withoutPreview.models[0].previewPath, undefined);
});
test('ZIP extraction and folder input preserve paths and multiple outfits', async () => {
  const files = assets();
  files.push(asset('pack/alternate.model3.json', JSON.stringify(manifest())));
  const entries = Object.fromEntries(await Promise.all(files.map(async (file) => [file.path, strToU8(await file.blob.text())])));
  const zip = new File([zipSync(entries)], 'outfits.zip');
  const pack = await importModelFiles([zip]);
  assert.equal(pack.models.length, 2);
  const folder = files.map((asset) => { const file = new File([asset.blob], asset.path.split('/').at(-1)); Object.defineProperty(file, 'webkitRelativePath', { value: asset.path }); return file; });
  assert.deepEqual((await importModelFiles(folder)).models.map((model) => model.name), ['avatar', 'alternate']);
});

function zipCrc(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function filenameZip(entries, encode, { tagged = false, unicode = false, badUnicodeCrc = false, compressed = false } = {}) {
  const locals = [], directory = []; let offset = 0;
  for (const [path, text] of entries) {
    const name = encode(path), data = new TextEncoder().encode(text);
    const payload = compressed ? deflateSync(data) : data;
    const extra = unicode ? new Uint8Array(9 + new TextEncoder().encode(path).length) : new Uint8Array();
    if (unicode) {
      const view = new DataView(extra.buffer); view.setUint16(0, 0x7075, true); view.setUint16(2, extra.length - 4, true);
      extra[4] = 1; view.setUint32(5, zipCrc(name) ^ (badUnicodeCrc ? 1 : 0), true); extra.set(new TextEncoder().encode(path), 9);
    }
    const local = new Uint8Array(30 + name.length + payload.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, tagged ? 2048 : 0, true);
    lv.setUint16(8, compressed ? 8 : 0, true);
    lv.setUint32(14, zipCrc(data), true); lv.setUint32(18, payload.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30); local.set(payload, 30 + name.length);
    const central = new Uint8Array(46 + name.length + extra.length); const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, tagged ? 2048 : 0, true);
    cv.setUint16(10, compressed ? 8 : 0, true);
    cv.setUint32(16, zipCrc(data), true); cv.setUint32(20, payload.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, extra.length, true); cv.setUint32(42, offset, true);
    central.set(name, 46); central.set(extra, 46 + name.length);
    locals.push(local); directory.push(central); offset += local.length;
  }
  const end = new Uint8Array(22); const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
  view.setUint32(12, directory.reduce((size, entry) => size + entry.length, 0), true); view.setUint32(16, offset, true);
  return new File([...locals, ...directory, end], 'unicode-model.zip');
}
const chineseZipEntries = () => {
  const name = '八千代辉夜姬', folder = '雪熊企划';
  return [
    [`${folder}/${name}.model3.json`, JSON.stringify({ Version: 3, FileReferences: { Moc: `${name}.moc3`, Textures: [`${name}.8192/texture_00.png`, `${name}.8192/texture_01.png`] } })],
    [`${folder}/${name}.moc3`, 'moc'],
    [`${folder}/${name}.8192/texture_00.png`, 'texture0'],
    [`${folder}/${name}.8192/texture_01.png`, 'texture1'],
  ];
};

test('Chinese ZIP paths preserve exact manifest references with tagged and untagged UTF-8', async () => {
  const entries = chineseZipEntries();
  for (const [tagged, compressed] of [[true, false], [false, false], [true, true], [false, true]]) {
    const pack = await importModelFiles([filenameZip(entries, (path) => new TextEncoder().encode(path), { tagged, compressed })]);
    assert.deepEqual(pack.assets.map((asset) => asset.path), entries.map(([path]) => path));
    assert.equal(pack.models[0].name, '八千代辉夜姬');
    const resources = await createModelResources(pack, pack.models[0]);
    assert.equal(await (await fetch(resources.resolve('八千代辉夜姬.moc3'))).text(), 'moc');
    resources.dispose();
  }
});

test('Windows GBK Chinese ZIP filenames match UTF-8 JSON references', async () => {
  const encode = (path) => {
    const bytes = [];
    const values = new Map([... '雪熊企划八千代辉夜姬'].map((character, index) => [character, Buffer.from('d1a9d0dcc6f3bbaeb0cbc7a7b4fabbd4d2b9bca7', 'hex').subarray(index * 2, index * 2 + 2)]));
    for (const character of path) bytes.push(...(values.get(character) ?? new TextEncoder().encode(character)));
    return new Uint8Array(bytes);
  };
  const entries = chineseZipEntries();
  const pack = await importModelFiles([filenameZip(entries, encode, { compressed: true })]);
  assert.deepEqual(pack.assets.map((asset) => asset.path), entries.map(([path]) => path));
});

test('DOS CP437 paths use exact manifest references to disambiguate legacy decoding', async () => {
  const entries = [
    ['éé/avatar.model3.json', JSON.stringify({ Version: 3, FileReferences: { Moc: 'éé.moc3', Textures: ['texture.png'] } })],
    ['éé/éé.moc3', 'moc'], ['éé/texture.png', 'texture'],
  ];
  const encode = (path) => Uint8Array.from(path, (character) => character === 'é' ? 0x82 : character.charCodeAt(0));
  const pack = await importModelFiles([filenameZip(entries, encode)]);
  assert.deepEqual(pack.assets.map((asset) => asset.path), entries.map(([path]) => path));
});

test('ZIP64 central metadata preserves untagged Chinese UTF-8 paths', async () => {
  const entries = chineseZipEntries();
  const original = new Uint8Array(await filenameZip(entries, (path) => new TextEncoder().encode(path)).arrayBuffer());
  const eocd = original.slice(-22), view = new DataView(eocd.buffer);
  const zip64 = new Uint8Array(56), zv = new DataView(zip64.buffer);
  zv.setUint32(0, 0x06064b50, true); zv.setBigUint64(4, 44n, true);
  zv.setUint16(12, 45, true); zv.setUint16(14, 45, true);
  zv.setBigUint64(24, BigInt(entries.length), true); zv.setBigUint64(32, BigInt(entries.length), true);
  zv.setBigUint64(40, BigInt(view.getUint32(12, true)), true); zv.setBigUint64(48, BigInt(view.getUint32(16, true)), true);
  const locator = new Uint8Array(20), lv = new DataView(locator.buffer);
  lv.setUint32(0, 0x07064b50, true); lv.setBigUint64(8, BigInt(original.length - 22), true); lv.setUint32(16, 1, true);
  view.setUint16(8, 65535, true); view.setUint16(10, 65535, true); view.setUint32(12, 0xffffffff, true); view.setUint32(16, 0xffffffff, true);
  const pack = await importModelFiles([new File([original.subarray(0, -22), zip64, locator, eocd], 'zip64.zip')]);
  assert.deepEqual(pack.assets.map((asset) => asset.path), entries.map(([path]) => path));
});

test('valid Unicode Path metadata overrides legacy names and invalid CRC is ignored', async () => {
  const entries = chineseZipEntries();
  const encode = (path) => new TextEncoder().encode(path.replace('雪熊企划', 'legacy-folder').replaceAll('八千代辉夜姬', 'legacy-name'));
  const pack = await importModelFiles([filenameZip(entries, encode, { unicode: true })]);
  assert.deepEqual(pack.assets.map((asset) => asset.path), entries.map(([path]) => path));
  await assert.rejects(importModelFiles([filenameZip(entries, encode, { unicode: true, badUnicodeCrc: true })]), /Missing asset/);
  const unsafe = entries.map(([path, text]) => [`../${path}`, text]);
  await assert.rejects(importModelFiles([filenameZip(unsafe, encode, { unicode: true })]), /leaves the model package/);
});
test('missing resources, external URLs, invalid manifests, duplicate paths, and empty inputs are rejected', async () => {
  await assert.rejects(inspectPackage(assets().filter((file) => !file.path.endsWith('hello.wav'))), /Missing asset/);
  for (const path of ['https://evil.example/model.moc3', '//evil/model.moc3', '../../escape.moc3']) {
    const bad = assets(); const json = manifest(); json.FileReferences.Moc = path; bad[0] = asset(bad[0].path, JSON.stringify(json));
    await assert.rejects(inspectPackage(bad));
  }
  await assert.rejects(inspectPackage([asset('x.model3.json', '{}')]), /model3/);
  await assert.rejects(inspectPackage([...assets(), assets()[0]]), /Duplicate/);
  await assert.rejects(importModelFiles([]));
  await assert.rejects(importModelFiles([new File(['corrupt'], 'broken.zip')]));
  assert.equal(resolveAsset('pack/models/a.model3.json', '../shared/a.png'), 'pack/shared/a.png');
  assert.equal(normalizePath('pack\\textures\\a.png'), 'pack/textures/a.png');
});
test('model resources resolve to private blob URLs including Unicode paths and are revoked on disposal', async () => {
  const pack = await inspectPackage(assets());
  const resources = await createModelResources(pack, pack.models[0]);
  const url = resources.resolve('expressions/เศร้า #.exp3.json');
  assert.match(url, /^blob:/);
  assert.equal(await (await fetch(url)).text(), 'test');
  assert.equal(resources.resolve('expressions/เศร้า #.exp3.json'), url);
  assert.throws(() => resources.resolve('https://evil.example/a.json'));
  resources.dispose();
  assert.throws(() => resources.resolve('avatar.moc3'), /released/);
  await assert.rejects(fetch(url));
});
test('browser storage saves blobs, restores package metadata, and removes imported packages', async () => {
  const pack = await inspectPackage(assets());
  await saveModelPackage(pack);
  const catalog = await loadModelCatalog();
  assert.deepEqual(catalog[0].assets, []);
  assert.deepEqual(catalog[0].models, pack.models);
  assert.equal(await (await loadModelPackage(pack.id)).assets[0].blob.text(), await pack.assets[0].blob.text());
  const stored = await loadModelPackages();
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].models, pack.models);
  assert.equal(await stored[0].assets[0].blob.text(), await pack.assets[0].blob.text());
  await removeModelPackage(pack.id);
  assert.deepEqual(await loadModelPackages(), []);
  assert.deepEqual(await loadModelCatalog(), []);
});

test('artist packages with undeclared expressions/motions are discovered without mixing nested models', async () => {
  const files = [asset('Miss/Miss.model3.json', JSON.stringify({ Version: 3, FileReferences: { Moc: 'Miss.moc3', Textures: ['texture.png'] } })), asset('Miss/Miss.moc3'), asset('Miss/texture.png'), asset('Miss/expressions/#.exp3.json', '{}'), asset('Miss/expressions/M wenhao .exp3.json', '{}'), asset('Miss/motions/wave.motion3.json', '{}'), asset('Miss/nested/other.model3.json', JSON.stringify({ Version: 3, FileReferences: { Moc: 'other.moc3', Textures: ['texture.png'] } })), asset('Miss/nested/other.moc3'), asset('Miss/nested/texture.png'), asset('Miss/nested/other.exp3.json', '{}')];
  const pack = await inspectPackage(files);
  assert.deepEqual(pack.models[0].expressions, ['#', 'M wenhao ']);
  assert.deepEqual(pack.models[1].expressions, ['other']);
  assert.deepEqual(pack.models[0].motions, [{ group: 'Imported', index: 0, name: 'wave' }]);
  const resources = await createModelResources(pack, pack.models[0]);
  assert.equal(resources.manifest.FileReferences.Expressions.length, 2);
  assert.equal(resources.manifest.FileReferences.Motions.Imported.length, 1);
  assert.match(resources.resolve(resources.manifest.FileReferences.Expressions[0].File), /^blob:/);
  resources.dispose();
});

test('pose expressions remain available in Expression and also appear in Pose', async () => {
  const files = assets(); const json = manifest();
  json.FileReferences.Expressions = [{Name:'坐姿',File:'expressions/happy.exp3.json'},{Name:'Happy',File:'expressions/เศร้า #.exp3.json'}];
  files[0] = asset('pack/avatar.model3.json',JSON.stringify(json));
  const pack = await inspectPackage(files);
  assert.deepEqual(pack.models[0].poses,['坐姿']);
  assert.deepEqual(pack.models[0].expressions,['坐姿','Happy']);
});

test('version-one caches migrate to a metadata catalog while preserving originals', async () => {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    const pack = await inspectPackage(assets(), 'legacy');
    const db = await new Promise((resolve,reject)=>{
      const request=indexedDB.open('vivian-local-models',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('packages',{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('packages','readwrite');tx.objectStore('packages').put(pack);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    db.close();
    assert.deepEqual(await loadModelCatalog(),[{id:pack.id,models:pack.models,assets:[]}]);
    const hydrated=await loadModelPackage(pack.id);
    assert.equal(await hydrated.assets[0].blob.text(),await pack.assets[0].blob.text());
  } finally { globalThis.indexedDB=original; }
});

test('rendering a catalog selection hydrates its manifest and never overwrites originals with metadata', async () => {
  const pack = await inspectPackage(assets(), 'selection');
  await saveModelPackage(pack);
  const entry = modelCatalogEntry(pack);
  assert.equal(entry.assets.length,0);
  await assert.rejects(createModelResources(entry,entry.models[0]),/manifest is missing/);
  const hydrated = await hydrateModelPackage(entry);
  const resources = await createModelResources(hydrated,hydrated.models[0]);
  assert.equal(await (await fetch(resources.resolve('avatar.moc3'))).text(),'test');
  resources.dispose();
  await assert.rejects(saveModelPackage(entry),/without its original/);
  assert.ok((await loadModelPackage(pack.id)).assets.length>0);
  await removeModelPackage(pack.id);
  assert.equal(await hydrateModelPackage(entry),undefined);
});

test('lost Safari Blob backing objects recover once from the cloud without changing model quality', async () => {
  const valid = await inspectPackage(assets(), 'blob-recovery');
  for (const [name, message] of [
    ['NotFoundError', 'Blob object was not found.'],
    ['NotFoundError', 'The requested object could not be found.'],
    ['NotReadableError', 'The I/O read operation failed.'],
    ['NotReadableError', 'The file could not be read.'],
    ['Error', 'The I/O read operation failed.'],
  ]) {
    class LostBlob extends Blob {
      slice() { throw new DOMException(message,name); }
    }
    const broken = { ...valid, assets: valid.assets.map((asset,index)=>index===1?{...asset,blob:new LostBlob(['lost'])}:asset) };
    let downloads=0;
    const restored=await hydrateModelPackage(broken,{recover:async()=>{downloads++;return valid;}});
    assert.equal(restored,valid); assert.equal(downloads,1);
    assert.deepEqual(restored.models,valid.models);
    assert.equal(await restored.assets[1].blob.text(),'test');
    await assert.rejects(hydrateModelPackage(broken),/Saved model files could not be read/);
    const controller=new AbortController();controller.abort();
    await assert.rejects(hydrateModelPackage(broken,{signal:controller.signal,recover:async()=>{downloads++;return valid;}}),{name:'AbortError'});
    assert.equal(downloads,1);
    await assert.rejects(hydrateModelPackage(broken,{recover:async()=>{throw new Error('Cloud unavailable');}}),/Cloud unavailable/);
  }
});

test('missing package recovers but unrelated cache failures do not trigger cloud retries', async () => {
  const valid=await inspectPackage(assets(),'missing-recovery');
  let downloads=0;
  assert.equal(await hydrateModelPackage(modelCatalogEntry(valid),{recover:async()=>{downloads++;return valid;}}),valid);
  assert.equal(downloads,1);
  class BadBlob extends Blob { slice() { throw new DOMException('Denied','SecurityError'); } }
  const broken={...valid,assets:[{path:valid.assets[0].path,blob:new BadBlob(['denied'])}]};
  await assert.rejects(hydrateModelPackage(broken,{recover:async()=>{downloads++;return valid;}}),{name:'SecurityError'});
  assert.equal(downloads,1);
});

test('Safari asynchronous I/O read failures recover once and a broken cloud copy stops retrying', async () => {
  const valid = await inspectPackage(assets(), 'io-recovery');
  class UnreadableBlob extends Blob {
    slice() {
      return { arrayBuffer: async () => { throw new DOMException('The I/O read operation failed.', 'NotReadableError'); } };
    }
  }
  const broken = { ...valid, assets: valid.assets.map((asset, index) => index === 1 ? { ...asset, blob: new UnreadableBlob(['lost']) } : asset) };
  let downloads = 0;
  assert.equal(await hydrateModelPackage(broken, { recover: async () => { downloads++; return valid; } }), valid);
  assert.equal(downloads, 1);
  downloads = 0;
  await assert.rejects(hydrateModelPackage(broken, { recover: async () => { downloads++; return broken; } }), { name: 'NotReadableError' });
  assert.equal(downloads, 1);
});
