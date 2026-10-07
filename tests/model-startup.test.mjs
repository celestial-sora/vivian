import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { shouldPauseModelStartup, clearModelLoadState } from '../lib/model-startup.ts';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
const source = readFileSync(new URL('../app/companion.tsx', import.meta.url), 'utf8');
const start = source.lastIndexOf('  useEffect(() => {', source.indexOf('    const cloudRequest ='));
const end = source.indexOf('\n  useEffect(() => {\n    if (!modelsReady)', start);
const effect = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const pack = (id, owner) => ({ id, cloudOwner: owner, assets: [], models: [{ id: `${id}:model` }] });
function startup({ local = [pack('local')], saved = 'local:model', interrupted = {} } = {}) {
  let finishCloud, cleanup, release;
  const state = { packages: [], active: null, ready: false, paused: false, writes: 0 };
  const bindings = {
    scheduleBackgroundWork: (work) => { release = work; return () => { release = undefined; }; },
    useEffect: (callback) => { cleanup = callback(); },
    getCloudModels: () => new Promise((resolve) => { finishCloud = resolve; }),
    loadModelCatalog: async () => local,
    modelCloudRequestRef: { current: null }, accountId: 'account',
    localStorage: storage({ 'vivian-local-model': saved }), sessionStorage: storage(interrupted),
    shouldPauseModelStartup,
    setModelPackages: (value) => { state.packages = typeof value === 'function' ? value(state.packages) : value; state.writes++; },
    setActiveModelId: (value) => { state.active = typeof value === 'function' ? value(state.active) : value; },
    setModelsReady: (value) => { state.ready = value; },
    setCloudLibrary: (value) => { state.cloud = value; },
    setModelPaused: (value) => { state.paused = value; },
    setModelStatus: (value) => { state.status = value; },
    setModelNotice: (value) => { state.notice = typeof value === 'function' ? value(state.notice) : value; },
    cloudModelPlaceholder: (model) => pack(model.id),
  };
  new Function(...Object.keys(bindings), effect)(...Object.values(bindings));
  return { state, finishCloud: (value) => { release?.(); finishCloud?.(value); }, cleanup: () => cleanup() };
}

test('cached model starts before a stalled cloud catalog and sync preserves hydrated identity', async () => {
  const f = startup({ local: [pack('local'), pack('other-account', 'someone-else')] });
  await tick();
  assert.equal(f.state.ready, true);
  assert.equal(f.state.active, 'local:model');
  assert.equal(f.state.packages.length, 1);
  const hydrated = { ...f.state.packages[0], assets: [new Blob(['cached'])] };
  f.state.packages[0] = hydrated;
  f.finishCloud({ userId: 'account', models: [{ id: 'remote' }] });
  await tick();
  assert.equal(f.state.packages[0], hydrated);
  assert.equal(f.state.active, 'local:model');
  assert.equal(f.state.packages.length, 2);
});

test('cloud-only startup restores the saved outfit instead of the first model', async () => {
  const f = startup({ local: [], saved: 'second:model' });
  await tick();
  assert.equal(f.state.ready, false);
  f.finishCloud({ userId: 'account', models: [{ id: 'first' }, { id: 'second' }] });
  await tick();
  assert.equal(f.state.active, 'second:model');
  assert.equal(f.state.ready, true);
});

test('cloud failure retains the readable device cache; cancelled startup does not update state', async () => {
  const f = startup(); await tick(); f.finishCloud(null); await tick();
  assert.equal(f.state.active, 'local:model'); assert.equal(f.state.ready, true);
  const cancelled = startup(); cancelled.cleanup(); cancelled.finishCloud(null); await tick();
  assert.equal(cancelled.state.writes, 0); assert.equal(cancelled.state.ready, false);
});

test('legacy interrupted loads automatically retry once, while repeated crashes pause', () => {
  const s = storage({ 'vivian-model-loading': 'local:model' });
  assert.equal(shouldPauseModelStartup(s, 'local:model'), false);
  assert.equal(shouldPauseModelStartup(s, 'local:model'), true);
  // Hydration effect cleanup must not erase the crash-loop guard.
  clearModelLoadState(s, 'local:model');
  s.setItem('vivian-model-loading', 'local:model');
  assert.equal(shouldPauseModelStartup(s, 'local:model'), true);
  assert.equal(shouldPauseModelStartup(s, 'different:model'), false);
});

test('normal page exit or successful rendering clears interruption and retry state', () => {
  for (const retry of [false, true]) {
    const s = storage({ 'vivian-model-loading': 'local:model', ...(retry ? { 'vivian-model-retry': 'local:model' } : {}) });
    clearModelLoadState(s, 'local:model', true);
    assert.equal(shouldPauseModelStartup(s, 'local:model'), false);
    assert.equal(s.getItem('vivian-model-retry'), null);
  }
});

test('old model cleanup cannot clear the current model guard', () => {
  const s = storage({ 'vivian-model-loading': 'new:model', 'vivian-model-retry': 'new:model' });
  clearModelLoadState(s, 'old:model', true);
  assert.equal(s.getItem('vivian-model-loading'), 'new:model');
  assert.equal(s.getItem('vivian-model-retry'), 'new:model');
});

test('the actual render effect clears crash breadcrumbs on pagehide during loading', () => {
  const from = source.indexOf('    const loadId = ++modelLoadIdRef.current;');
  const to = source.indexOf('    void (async () => {', from);
  const guard = ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const session = storage({ 'vivian-model-retry': 'local:model' });
  const window = new EventTarget();
  new Function('modelLoadIdRef', 'activeModel', 'sessionStorage', 'window', 'clearModelLoadState', guard)({ current: 0 }, { id: 'local:model' }, session, window, clearModelLoadState);
  assert.equal(session.getItem('vivian-model-loading'), 'local:model');
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(session.getItem('vivian-model-loading'), null);
  assert.equal(session.getItem('vivian-model-retry'), null);
  assert.equal(shouldPauseModelStartup(session, 'local:model'), false);
});

test('the actual hydration wrapper waits for cloud only when local files need recovery and saves once', async () => {
  const from = source.indexOf('async function availableModelPackage(');
  const to = source.indexOf('\ntype IconName', from);
  const helper = ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let finishCloud, downloads = 0, saves = 0;
  const cloud = new Promise((resolve) => { finishCloud = resolve; });
  const local = { ...pack('cached'), assets: [new Blob(['original'])] };
  const bindings = {
    hydrateModelPackage: async (pack, options) => pack.assets.length ? pack : options.recover(),
    downloadCloudModel: async () => { downloads++; return { ...pack('missing'), assets: [new Blob(['recovered'])] }; },
    saveModelPackage: async () => { saves++; },
  };
  const hydrate = new Function(...Object.keys(bindings), `${helper}\nreturn availableModelPackage;`)(...Object.values(bindings));
  assert.equal(await hydrate(local, cloud), local);
  assert.equal(downloads, 0);
  let restored = false;
  const pending = hydrate(pack('missing'), cloud).then((value) => { restored = true; return value; });
  await tick(); assert.equal(restored, false);
  finishCloud({ userId: 'account', models: [{ id: 'missing' }] });
  await pending;
  assert.equal(downloads, 1); assert.equal(saves, 1);
});

test('cloud-only restoration also guards repeated interrupted loads', async () => {
  const f = startup({ local: [], saved: 'second:model', interrupted: { 'vivian-model-loading': 'second:model', 'vivian-model-retry': 'second:model' } });
  await tick(); f.finishCloud({ userId: 'account', models: [{ id: 'second' }] }); await tick();
  assert.equal(f.state.active, 'second:model'); assert.equal(f.state.paused, true);
});
