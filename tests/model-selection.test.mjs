import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the actual selection handler with controlled React setters and I/O.
const source = readFileSync(new URL('../app/companion.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function chooseModel(');
const end = source.indexOf('  async function removeActiveModel(', start);
const handler = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ paused = true, assets = [], fail = false, same = false } = {}) {
  const selected = { id: 'cloud-b', assets, models: [{ id: 'cloud-b:model.model3.json' }] };
  const old = { id: 'cloud-a', assets: [new Blob(['old'])], models: [{ id: 'old' }] };
  const hydrated = same ? selected : { ...selected, assets: [new Blob(['model'])] };
  const state = { paused, packages: [old, selected], active: 'old', importing: false, calls: [] };
  const bindings = {
    modelImporting: false, modelPaused: paused, modelPackages: state.packages,
    modelCloudRequestRef: { current: null },
    cloudLibrary: { userId: 'account', models: [{ id: selected.id }] },
    setModelImporting: (value) => { state.importing = value; },
    setModelPaused: (value) => { state.paused = value; },
    setModelNotice: (value) => { state.notice = value; },
    setModelPackages: (update) => { state.packages = update(state.packages); },
    setActiveModelId: (id) => { state.active = id; },
    requestAnimationFrame: (callback) => { state.calls.push('frame'); callback(); },
    availableModelPackage: async (pack, cloud) => {
      assert.equal(state.paused, true);
      assert.equal(pack, selected);
      assert.equal(cloud.userId, 'account');
      state.calls.push('hydrate');
      if (fail) throw new Error('Cloud download failed');
      return hydrated;
    },
    saveModelPackage: async () => { state.calls.push('save'); },
    modelCatalogEntry: (pack) => ({ ...pack, assets: [] }),
  };
  const choose = new Function(...Object.keys(bindings), `${handler}\nreturn chooseModel;`)(...Object.values(bindings));
  return { state, choose, id: selected.models[0].id };
}

test('explicit cloud selection resumes rendering after a crash pause and releases old assets', async () => {
  const { state, choose, id } = fixture();
  await choose(id);
  assert.equal(state.active, id);
  assert.equal(state.paused, false);
  assert.equal(state.importing, false);
  assert.equal(state.notice, null);
  assert.deepEqual(state.calls, ['frame', 'hydrate']);
  assert.equal(state.packages[0].assets.length, 0);
  assert.equal(state.packages[1].assets.length, 1);
});

test('in-memory selection validates Blob handles and also resumes rendering', async () => {
  const { state, choose, id } = fixture({ assets: [new Blob(['cached'])], same: true });
  await choose(id);
  assert.equal(state.paused, false);
  assert.equal(state.active, id);
  assert.deepEqual(state.calls, ['frame', 'hydrate']);
});

test('failed cloud selection preserves the prior model and pause state', async () => {
  for (const paused of [true, false]) {
    const { state, choose, id } = fixture({ paused, fail: true });
    await choose(id);
    assert.equal(state.active, 'old');
    assert.equal(state.paused, paused);
    assert.equal(state.importing, false);
    assert.equal(state.notice, 'Cloud download failed');
    assert.equal(state.packages[0].assets.length, 1);
  }
});
