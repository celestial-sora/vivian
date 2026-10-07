# Performance Sprint — 2026-10-07

The browser commits scene presentation locally before persistence, reuses bounded texture render packages, and retains the displayed Live2D model until its successor renders. Chat and the local conversation are usable before optional cloud work finishes. Timing stays in the browser's User Timing buffer; no analytics service receives it.

## Controlled before/after measurements

Baseline: `879f51d`. Chromium on the development executor, production React bundle, one sample per scenario. The harness runs the actual scene components, history hook and model-resource preparation. HTTP preference saves take 600 ms, the cold full image takes 900 ms after selection, and history takes 600 ms. Synthetic 5000×5000 PNG atlases are resized to 1024×1024. These numbers measure presentation/resource preparation, **not** a licensed model's GPU first frame or real provider latency.

| Scenario | Before | After |
| --- | ---: | ---: |
| Cached scene: click → visible | 621.5 ms | 6.9 ms |
| Cold scene: click → full image/preview | 1525.4 ms (full) | 9.5 ms (preview) |
| Local composer/history readiness | 647.3 ms | 33.4 ms |
| Model A: cold render-package preparation | 2060.8 ms | 2422.0 ms |
| Same A: warm preparation | 1.8 ms | 3.8 ms |
| Return to A after preparing B | 1972.0 ms | 3.7 ms |

The baseline already cached the last resized model. This sprint preserves that benefit across A → B → A, subject to eviction, and removes server latency from scene presentation. Cold preparation has no demonstrated speed improvement; the improvement is reuse. The new cold scene's full image completes later, separately from its immediate preview (913.4 ms in the captured User Timing entry).

Raw results: [2026-10-07-fixture.json](performance/2026-10-07-fixture.json).

```sh
npm ci
# Use an installed Chromium or install Playwright's browser on a machine with access.
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:performance:browser -- --baseline 879f51d --output /tmp/vivian-performance.json
npm run test:performance
```

The browser check requires Git history containing the baseline, creates temporary fixtures, uses loopback HTTP only, and never loads licensed assets or contacts cloud/provider services. It asserts cached/cold presentation below 100 ms, composer readiness before cloud history, and warm render preparation at least 10× faster than cold.

## Behavior and lifetime

- Scene selection immediately commits the full cached image or a thumbnail/opaque placeholder. Full images decode asynchronously and crossfade in. Ordered PATCHes prevent out-of-order persistence; stale refreshes/responses cannot undo the latest click. A failed save leaves the local scene and a retry notice. Selection stays enabled during saving. Metadata is cached per account; background warming covers the active scene, presets and two upcoming scenes, rather than the entire library.
- Licensed originals remain in their own IndexedDB database. Render copies have a separate 64 MiB/four-entry LRU limit. Keys include package revision, manifest, quality, GPU/budget settings and texture plans. Saving replacement originals rotates revision, even for equal-size textures. Deleting packages clears disposable copies. Broken Safari Blob handles and unavailable/quota-limited IndexedDB fall back to regeneration. Cache writes snapshot their map and run outside the render path.
- A selection cancels pending hydration/preparation immediately. The old stage, its rest state, wind and resize listeners remain usable while the candidate loads. A successful renderer frame replaces the stage owner; only then are the old model, textures, listeners and URLs destroyed. Failed/cancelled candidates release their own resources and preserve the predecessor. The actual render-effect tests check successful swaps, failure and superseded work without an empty rendered frame.
- Local model catalog and active assets remain critical. Optional cloud catalog, voice preference refresh, memory load and scene warming begin after the model's first frame/idle opportunity, with a 2.5-second fallback for empty libraries and failed startup. Cloud-only model recovery stays critical. The composer becomes usable from local history before its cloud request; late history preserves user turns/navigation and can restore the latest cloud thread on a pristine device. Renderer thumbnails are deferred until after the synchronous first render. Status/storage requests already run only when their panels open.
- TTS generation/download overlaps Safari audio unlocking; shared-element playback still waits for unlock and keeps its existing timeout/lip-sync behavior. Voice endpointing remains 2.5 seconds of quiet, including the existing soft-speech continuation guard. There is no evidence here to justify shortening it or changing provider settings.

Warm swaps temporarily hold both models' GPU resources. Per-model device limits stay in place, and render failures retain the old model. Full validation on memory-constrained Safari and actual licensed models remains necessary; a WebGL context loss cannot guarantee continuous drawing.

## Local timing contract

Marks have unique `vivian:<flow>:<sequence>:start` names; completed measures are `vivian:<flow>:<sequence>`. Completed entries are bounded to 200. Cancelled marks are cleared, and unavailable User Timing APIs do not block the UI. Development also emits metadata-only console timings.

| Flow | Endpoint / diagnostic detail |
| --- | --- |
| `scene_click_to_visible` | Target DOM layer committed, measured at the next animation frame; `cacheHit` and `presentation` (`full`, `preview`, `placeholder`) |
| `scene_load_to_full_image` | Full image decoded; cache hit/miss or failure |
| `model_render_package` | Header/plan/cache lookup and optional resizing completed; cache hit/miss and resized atlas count |
| `model_select_to_first_frame` | Click includes hydration/import/preparation, ending after a successful synchronous renderer frame |
| `model_load_to_first_frame` | Render-package preparation → successful frame; excludes earlier catalog/hydration work |
| `page_load_to_model_first_frame` | Navigation time origin → successful initial model frame |
| `send_to_first_token` | First provider **content** token signal arrives at the browser, separate from reply completion; provider/preparation/transport-and-client timing metadata |
| `send_to_reply` | Full sanitized reply received, including required history/scene persistence |
| `speech_end_to_stt_request` | Estimated acoustic quiet onset → request dispatch; includes endpoint wait and recorder flush |
| `speech_end_to_transcript` | Quiet onset → nonempty transcript; manual stops without quiet use request time |
| `stt_request_to_transcript` | Client request/response duration; `Server-Timing: scribe` isolates upstream duration |
| `reply_to_audio_start` | Full reply available → `audio.play()` confirms playback |
| `tts_request_to_audio_ready` | Request → complete audio Blob, independent of audio unlock; Fish/route `Server-Timing` |
| `tts_request_to_audio_start` | Request → playback confirmation |
| `audio_ready_to_playback` | Audio ready → playback confirmation, including any remaining unlock wait |

Inspect/export a comparable session locally:

```js
const samples = performance.getEntriesByType('measure')
  .filter(entry => entry.name.startsWith('vivian:'))
  .map(({ name, duration, detail }) => ({ name, ms: duration, ...detail }));
console.table(samples);
// Save JSON.stringify(samples, null, 2) locally for the next run.
```

`send_to_first_token` uses opt-in `Accept: application/x-ndjson` on `/api/chat`. Authentication/rate-limit rejection retains its HTTP status before streaming. The stream transmits a timing-only token event, then a final `{event:"reply", status, data}` envelope containing the existing sanitized JSON contract. It does not reveal partial dialogue or reasoning. Groq/Cerebras SSE and Gemini SSE are assembled server-side before the existing persona/output/history flow. Legacy JSON callers retain their contract. A non-streaming provider response has no first-token sample; it is not falsely labelled as one. If a provider fails after its first token, the timing describes that first observed attempt; the final reply may come from a fallback provider.

Provider timing includes upstream network plus generation; transport/client timing is the residual after subtracting server preparation and provider time. It is diagnostic rather than a pure wire-latency measurement. No live provider/Safari performance claim is made from fixtures.

## Verification and remaining production checks

Verification passed: 216 unit tests, 18 focused performance tests (included in the unit run), 17 authenticated route integration tests, 12 disposable PostgreSQL tests, browser assertions, TypeScript and a production build. New/changed support modules and new tests pass targeted lint. Full-repo lint retains the baseline's 21 errors/309 warnings (existing `any`, effect-state, escaping and vendor-runtime issues), with no new errors.

Before calling the device rollout complete, use actual imported models on desktop and iPhone/iPad: cached/cold scenes, A reload, A → B → C while loading, failed replacement, orientation changes, context recovery, and speech → STT → chat → TTS. Export the timing table before/after on the same device/network/provider configuration. Confirm local startup while cloud requests are stalled. There are no licensed assets or provider credentials in this executor to establish those production timings.
