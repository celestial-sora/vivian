import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForCubismCore } from '../lib/model-runtime.ts';

test('Cubism readiness gates module loading, times out and respects cancellation', async () => {
  const previous = globalThis.Live2DCubismCore;
  try {
    delete globalThis.Live2DCubismCore;
    await assert.rejects(waitForCubismCore(new AbortController().signal, 0), /runtime did not load/);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(waitForCubismCore(cancelled.signal), { name: 'AbortError' });
    let ready = false;
    const pending = waitForCubismCore(new AbortController().signal).then(() => { ready = true; });
    assert.equal(ready, false);
    globalThis.Live2DCubismCore = {};
    await pending;
    assert.equal(ready, true);
    await assert.rejects(waitForCubismCore(cancelled.signal), { name: 'AbortError' });
  } finally {
    if (previous === undefined) delete globalThis.Live2DCubismCore;
    else globalThis.Live2DCubismCore = previous;
  }
});
