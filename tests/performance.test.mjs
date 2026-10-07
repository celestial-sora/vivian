import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { loadSceneModule } from './scene-module-loader.mjs';
import { startTiming, finishTiming, cancelTiming } from '../lib/performance.ts';
test('local timing has unique spans, cancellation, metadata and bounded completed entries', () => {
  globalThis.window = {};
  try {
    const first = startTiming('first'), other = startTiming('first');
    assert.notEqual(first.mark, other.mark);
    finishTiming(first, { cacheHit: true }); finishTiming(first);
    cancelTiming(other);
    const measured = performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('vivian:'));
    assert.equal(measured.length, 1); assert.deepEqual(measured[0].detail, { cacheHit: true });
    for (let index = 0; index < 205; index++) finishTiming(startTiming('bounded'));
    assert.equal(performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('vivian:')).length, 200);
    assert.equal(performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('vivian:')).length, 0);
  } finally { delete globalThis.window; performance.clearMeasures(); }
});

test('restricted User Timing APIs cannot interrupt presentation', () => {
  const api = loadSceneModule('../lib/performance.ts', {}, { window: {}, performance: { now: () => 1, mark() { throw Error('unsupported'); }, measure() { throw Error('unsupported'); }, clearMarks() { throw Error('unsupported'); } } });
  assert.equal(api.startTiming('optional'), undefined);
  assert.doesNotThrow(() => api.finishTiming({ name: 'optional', mark: 'optional', start: 0, done: false }));
  assert.doesNotThrow(() => api.cancelTiming({ name: 'optional', mark: 'optional', start: 0, done: false }));
});
