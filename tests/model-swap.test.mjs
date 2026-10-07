import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../app/companion.tsx', import.meta.url), 'utf8');
const from = source.lastIndexOf('  useEffect(() => {', source.indexOf('    const textureAbort ='));
const to = source.indexOf('\n  useEffect(() => {', from + 20);
const effect = ts.transpileModule(source.slice(from, to), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const requests = [], models = [], frames = [], released = [], notices = [];
  const stage = { children: [], addChild(m) { this.children.push(m); }, removeChild(m) { this.children = this.children.filter(child => child !== m); } };
  const renderer = { gl: { MAX_TEXTURE_SIZE: 1, getParameter: () => 4096, isContextLost: () => false }, resize() {}, render(s) { frames.push(s.children.filter(m => m.visible !== false).map(m => m.id)); }, screen: { width: 800 } };
  const app = { stage, renderer };
  const modelPresentationRef = { current: null }, modelRef = { current: null }, modelLoadIdRef = { current: 0 };
  let cleanup;
  const bindings = {
    preferencesReady: true, modelsReady: true, graphicsLost: false, modelPaused: false,
    activeModelId: 'a', textureQuality: 'auto', modelReload: 0,
    modelPresentationRef, modelRef, modelLoadIdRef, modelRestStateRef: { current: null },
    modelRenderAbortRef: { current: null }, modelSelectionTimingRef: { current: undefined }, startupTimingRef: { current: undefined },
    canvasRef: { current: { dataset: {}, parentElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) } } },
    pixiAppRef: { current: app }, cloudLibraryRef: { current: null }, modelCloudRequestRef: { current: null },
    navigator: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0 },
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1, setTimeout: () => 1, clearTimeout() {} }),
    sessionStorage: { setItem() {} }, clearModelLoadState() {},
    AbortController, DOMException, Error, console: { error() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    useEffect(fn) { cleanup = fn(); },
    setActiveExpression() {}, setActiveMotion() {}, setModelStatus(v) { bindings.status = v; }, setTextureSummary() {}, setModelPreview() {}, setModelPackages() {}, setModelNotice(v) { notices.push(v); },
    startTiming() {}, finishTiming() {}, cancelTiming() {},
    captureModelRestState: () => ({}), attachModelWind: () => () => {}, waitForCubismCore: async () => {},
    availableModelPackage: async pack => pack,
    createModelResources: (pack) => new Promise((resolve, reject) => requests.push({ id: pack.id, resolve: () => resolve({ manifest: { id: pack.id }, resolve() {}, texturePlan: [], dispose: () => released.push(pack.id) }), reject })),
    require(name) {
      if (name === 'pixi.js') return { Ticker: {}, MIPMAP_MODES: { OFF: 0 }, WRAP_MODES: { CLAMP: 0 } };
      if (name === 'pixi-live2d-display/cubism4') return { Cubism4ModelSettings: class { constructor(manifest) { Object.assign(this, manifest); } }, Live2DModel: {
        registerTicker() {}, async from(settings) {
          const m = { id: settings.id, visible: true, internalModel: { coreModel: {} }, textures: [{ valid: true, baseTexture: {} }], once() {}, scale: { set() {} }, anchor: { set() {} }, pivot: { set() {} }, getLocalBounds: () => ({ x: 0, y: 0, width: 100, height: 200 }), destroy() { m.destroyed = true; } };
          models.push(m); return m;
        },
      } };
      throw new Error(name);
    },
  };
  return { requests, models, frames, released, notices, modelRef, bindings,
    start(id) { cleanup?.(); bindings.activePackage = { id, models: [{ id, manifestPath: `${id}.model3.json` }] }; bindings.activeModel = { ...bindings.activePackage.models[0], previewPath: 'supplied' }; runInNewContext(effect, bindings); },
    cleanup: () => cleanup?.(),
  };
}
test('actual render effect retains the old model until replacement first frame and releases it afterwards', async () => {
  const f = fixture(); f.start('a'); await tick(); f.requests[0].resolve(); await tick();
  assert.equal(f.modelRef.current.id, 'a'); f.start('b'); await tick();
  assert.equal(f.models[0].destroyed, undefined); assert.equal(f.modelRef.current.id, 'a');
  f.requests[1].resolve(); await tick();
  assert.equal(f.modelRef.current.id, 'b'); assert.deepEqual(f.frames.at(-1), ['b']);
  assert.equal(f.models[0].destroyed, true); assert.ok(f.released.includes('a'));
  assert.ok(f.frames.every(frame => frame.length === 1));
});
test('failed replacement keeps the old model visible; cancelled work cannot win a later swap', async () => {
  const f = fixture(); f.start('a'); await tick(); f.requests[0].resolve(); await tick();
  f.start('failed'); await tick(); f.requests[1].reject(new Error('bad model')); await tick();
  assert.equal(f.modelRef.current.id, 'a'); assert.equal(f.models[0].destroyed, undefined); assert.match(f.notices.at(-1), /bad model/);
  f.start('stale'); await tick(); f.start('latest'); await tick();
  f.requests[2].resolve(); await tick(); assert.equal(f.modelRef.current.id, 'a'); assert.ok(f.released.includes('stale'));
  f.requests[3].resolve(); await tick(); assert.equal(f.modelRef.current.id, 'latest');
  assert.ok(f.frames.every(frame => frame.length === 1));
});
