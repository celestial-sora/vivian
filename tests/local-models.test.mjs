import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { zipSync, strToU8 } from 'fflate';
import { inspectPackage, importModelFiles, createModelResources, normalizePath, resolveAsset, loadModelPackages, loadModelCatalog, loadModelPackage, hydrateModelPackage, modelCatalogEntry, saveModelPackage, removeModelPackage } from '../lib/local-models.ts';

const manifest = () => ({ Version: 3, FileReferences: { Moc: 'avatar.moc3', Textures: ['textures/tex.png'], Physics: 'physics.json', Pose: 'pose.json', Expressions: [{ Name: 'Happy', File: 'expressions/happy.exp3.json' }, { Name: 'เศร้า #', File: 'expressions/เศร้า #.exp3.json' }], Motions: { Idle: [{ File: 'motions/idle.motion3.json' }], Wave: [{ File: 'motions/wave.motion3.json', Sound: 'hello.wav' }] } } });
const asset = (path, content = 'test') => ({ path, blob: new Blob([content]) });
const assets = () => [asset('pack/avatar.model3.json', JSON.stringify(manifest())), ...['avatar.moc3','textures/tex.png','physics.json','pose.json','expressions/happy.exp3.json','expressions/เศร้า #.exp3.json','motions/idle.motion3.json','motions/wave.motion3.json','hello.wav','preview.png'].map((path) => asset(`pack/${path}`))];

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
  for (const message of ['Blob object was not found.', 'The requested object could not be found.']) {
    class LostBlob extends Blob {
      slice() { throw new DOMException(message,'NotFoundError'); }
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
