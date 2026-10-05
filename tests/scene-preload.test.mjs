import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSceneModule as load } from "./scene-module-loader.mjs";

function fixture({ width = 100, height = 100 } = {}) {
  const requests = [];
  class Image {
    naturalWidth = width;
    naturalHeight = height;
    constructor() {
      this.decoded = new Promise((resolve, reject) => { this.finishDecode = resolve; this.failDecode = reject; });
    }
    set src(value) { if (value) { this.url = value; requests.push(this); } }
    decode() { return this.decoded; }
  }
  const timers = new Set();
  const preloader = load("../lib/scene-preload.ts", {}, { Image, window: {
    setTimeout(fn, delay) { const timer = setTimeout(fn, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
  } });
  return { ...preloader, requests, async finish(image) { image.onload(); image.finishDecode(); await new Promise(resolve => setImmediate(resolve)); }, clean() { timers.forEach(clearTimeout); } };
}

test("scene readiness waits for full decode and shares a single in-flight image", async () => {
  const f = fixture();
  try {
    const first = f.preloadSceneImage("/full.jpg");
    assert.equal(f.preloadSceneImage("/full.jpg"), first);
    assert.equal(f.requests.length, 1);
    let ready = false; void first.then(() => { ready = true; });
    f.requests[0].onload(); await Promise.resolve(); assert.equal(ready, false);
    f.requests[0].finishDecode(); await first; assert.equal(ready, true);
    await f.preloadSceneImage("/full.jpg"); assert.equal(f.requests.length, 1);
  } finally { f.clean(); }
});

test("library warming respects active-first order, low priority and cancellation", async () => {
  const f = fixture(); const abort = new AbortController();
  try {
    const work = f.preloadSceneLibrary(["/active.jpg", "/next.png", "/active.jpg", "/last.webp"], abort.signal);
    assert.deepEqual(f.requests.map(image => image.url), ["/active.jpg"]);
    assert.equal(f.requests[0].fetchPriority, "low");
    await f.finish(f.requests[0]);
    assert.deepEqual(f.requests.map(image => image.url), ["/active.jpg", "/next.png"]);
    abort.abort(); await f.finish(f.requests[1]); await work;
    assert.equal(f.requests.length, 2);
  } finally { f.clean(); }
});

test("failed preloads do not stop warming and can be retried on selection", async () => {
  const f = fixture();
  try {
    const work = f.preloadSceneLibrary(["/offline.png", "/good.jpg"], new AbortController().signal);
    f.requests[0].onerror(); await new Promise(resolve => setImmediate(resolve));
    await f.finish(f.requests[1]); await work;
    const retry = f.preloadSceneImage("/offline.png"); assert.equal(f.requests.length, 3);
    await f.finish(f.requests[2]); await retry;
  } finally { f.clean(); }
});

test("large decoded images evict old references rather than retaining an unbounded library", async () => {
  const f = fixture({ width: 4096, height: 4096 });
  try {
    const first = f.preloadSceneImage("/first.jpg"); await f.finish(f.requests[0]); await first;
    const second = f.preloadSceneImage("/second.jpg"); await f.finish(f.requests[1]); await second;
    await f.preloadSceneImage("/second.jpg"); assert.equal(f.requests.length, 2);
    const again = f.preloadSceneImage("/first.jpg"); assert.equal(f.requests.length, 3);
    await f.finish(f.requests[2]); await again;
  } finally { f.clean(); }
});
