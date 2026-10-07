import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSceneModule } from './scene-module-loader.mjs';
function fixture() {
  const window = new EventTarget(), timers = new Map(), frames = new Map(); let id = 0;
  Object.assign(window, { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } });
  const module = loadSceneModule('../lib/startup-background.ts', {}, { window, requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); } });
  const drain = map => { const pending = [...map.values()]; map.clear(); pending.forEach(fn => fn()); };
  return { ...module, window, timers, frame: () => drain(frames), timeout: () => drain(timers) };
}
test('optional work waits for first model frame and gives paint two frames before starting once', () => {
  const f = fixture(); let runs = 0;
  f.scheduleBackgroundWork(() => runs++); assert.equal(runs, 0);
  f.window.dispatchEvent(new Event('vivian-model-first-frame')); f.frame(); assert.equal(runs, 0);
  f.frame(); assert.equal(runs, 1); f.timeout(); assert.equal(runs, 1);
});
test('empty/unavailable models release work on timeout; cancellation survives queued frames', () => {
  const f = fixture(); let runs = 0;
  f.scheduleBackgroundWork(() => runs++); f.timeout(); assert.equal(runs, 1);
  const cancel = f.scheduleBackgroundWork(() => runs++);
  f.window.dispatchEvent(new Event('vivian-model-first-frame')); f.frame(); cancel(); f.frame(); f.timeout(); assert.equal(runs, 1);
});
