import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSceneModule } from './scene-module-loader.mjs';

function fixture() {
  const effects = [], calls = [], requests = [], states = [], refs = [];
  const hooks = {
    useState(initial) { const index = states.length; states.push(initial); return [initial, (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useRef(initial) { const ref = { current: initial }; refs.push(ref); return ref; },
    useCallback(fn) { return fn; }, useEffect(fn) { effects.push(fn); },
  };
  const cached = { scenes: [{ id: 'a', imageUrl: '/a', thumbnailUrl: '/a-thumb' }, { id: 'b', imageUrl: '/b' }], preferences: { autoScene: false, activeSceneId: 'a', preset: null, revision: '1' } };
  const module = loadSceneModule('../lib/use-scene-library.ts', {
    react: hooks,
    '@/lib/auth/fetch': { authFetch: (path, options) => { calls.push({ path, options }); return new Promise((resolve) => requests.push(resolve)); } },
    '@/lib/storage-status': { notifyStorageChanged() {} },
    '@/lib/scene-preload': { preloadSceneLibrary: async () => {} },
    '@/lib/performance': { startTiming: () => ({}), cancelTiming() {} },
  }, { queueMicrotask, localStorage: { getItem: () => JSON.stringify(cached), setItem() {} } });
  const library = module.useSceneLibrary();
  const cleanup = effects[0]();
  return { library, states, calls, requests, cleanup };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('scene selection commits before any PATCH or image load, with ordered writes and stale refresh protection', async () => {
  const f = fixture(); await tick();
  const first = f.library.selectScene('b');
  assert.equal(f.states[1].activeSceneId, 'b');
  const second = f.library.updatePreferences({ preset: 'night' });
  assert.equal(f.states[1].preset, 'night'); assert.equal(f.states[1].activeSceneId, null);
  await tick();
  assert.equal(f.calls.length, 2); // startup GET and first PATCH only
  f.requests[0](Response.json({ scenes: [], preferences: { activeSceneId: 'a' } })); await tick();
  assert.equal(f.states[1].preset, 'night');
  f.requests[1](Response.json({ preferences: { activeSceneId: 'b' } })); await first; await tick();
  assert.equal(f.states[1].preset, 'night'); assert.equal(f.calls.length, 3);
  f.requests[2](Response.json({ preferences: { preset: 'night', activeSceneId: null } })); await second;
  assert.equal(f.states[3], false); f.cleanup();
});
test('failed persistence leaves optimistic scene visible with a retry notice', async () => {
  const f = fixture(); await tick(); const selection = f.library.selectScene('b'); await tick();
  f.requests[1](Response.json({ error: 'offline' }, { status: 503 })); await selection;
  assert.equal(f.states[1].activeSceneId, 'b'); assert.match(f.states[4], /retry saving/); f.cleanup();
});
