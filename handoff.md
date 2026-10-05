# Handoff — changes made in this chat

Updated: 2026-10-02 (Asia/Bangkok). Rewritten from scratch after implementation and verification, at the user's explicit request. This document covers changes from this chat only; use AGENTS.md for general repository rules.

## Git state and publication

- Work belongs on `main`, as explicitly requested by the user.
- Authentication commit `91ee7d8` was fast-forwarded and pushed to `main`.
- `codex/private-google-auth` was deleted from GitHub and the local checkout.
- `54214ba` adds private Live2D import and animation discovery.
- `2cfe4f0` adds large-texture adaptation, pose expressions, and renames the visible Outfit tab to **Models**.
- No explicit Vercel CLI production deployment was performed for these model changes. Production deployment/alias readiness was not verified in this chat.
- `supabase/.temp/` remains unrelated local untracked state; do not include it in commits.

## Copyright-related Live2D cleanup

- Purchased Live2D assets are no longer distributed with the repository. Model files remain excluded from version control; the tracked Cubism Core runtime is retained.
- Source removal and migration notes are in commits `3e32a80` and `13bb019`, and README.md explains how existing clones should move to the cleaned history without restoring removed assets.
- The user explicitly authorized removing old GitHub build files as well as history because redistribution was prohibited.
- Final read-only audit found zero `.moc3`, `.model3.json`, `.exp3.json`, and `.motion3.json` asset paths in reachable local Git history, zero attached assets across the GitHub releases returned by the API, and zero Actions artifacts.
- This audit does not establish that downloaded clones, external forks, or GitHub cached/unreachable objects have been erased. Never merge old history back into the cleaned repository.
- Both real model ZIPs supplied for testing stayed outside the repository. No model binaries, textures, previews, or ZIP archives were committed or uploaded to a model server.

## Private Google authentication

- Added Supabase Auth Google OAuth, a styled Google login screen, PKCE callback at `/auth/callback`, cookie session refresh in `proxy.ts`, and POST `/auth/signout` from Settings.
- `app/page.tsx` is the server-side access gate; the existing companion UI moved to `app/companion.tsx`.
- Confirmed, non-anonymous accounts are restricted server-side to:
  - `suphloeksangko@gmail.com`
  - `duckchan690@gmail.com`
- Every protected API checks the verified identity independently of Proxy. Client identity claims/user metadata are not trusted. Same-origin checks protect cookie-authenticated mutations; verified bearer tokens support other Vivian clients.
- Both approved accounts retain the existing shared cloud memory/relationship identity (`default`).
- Required public Auth configuration: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or anon key fallback). Configure Supabase's Google provider and allowed callback URLs as documented in README.md. Privileged provider/service-role keys remain server-side.
- Google/Supabase dashboard configuration and a live Google login were not verified here; local Auth fixtures were used for automated checks.
- Main files: `lib/auth/{config,policy,server,fetch}.ts`, `proxy.ts`, `app/login/`, `app/auth/`, and protected API routes.

## Character → Models / Expression / Pose

- Renamed the visible **Outfit** tab to **Models**, and the selector label to **Model**. The internal tab key remains `outfit`; this is an implementation detail, not an unfinished rename.
- Import either a complete ZIP or a folder from Character → Models. Nested archives and multiple model manifests are supported. Select a model, restore it on the next page load, or remove its entire package from browser storage.
- Limits: 512 MB uncompressed and 3,000 files. Check expanded ZIP limits, invalid/escaping/external paths, duplicate files, valid Cubism manifests, and missing referenced assets before saving.
- Packages are stored only in IndexedDB (`vivian-local-models`, `packages`), with the selected model ID in localStorage (`vivian-local-model`). Models do not upload to Supabase, GitHub, Vivian's backend, or another user/device. Changing origin/profile or clearing site data requires re-import.
- Expressions and motion groups/indices come from the imported manifest. Nearby `.exp3.json` and `.motion3.json` files omitted by the artist are also discovered. Nested folders belonging to another model are excluded; declared names/groups are preserved.
- Undeclared motion groups use their folder, recognized Idle names (including Chinese/Japanese idle names), or `Imported`.
- Pose also shows clearly named pose expressions such as sitting, lifting a skirt, and holding a bouquet. These remain in Expression too. Recognition is name-based, not an inference from opaque parameter IDs. A `.pose3.json` itself is not a list of playable motions.
- Pose reset stops manual motions and resets expression state; idle motions can resume. Manual action completion is guarded against cancelled/superseded model loads.
- Common emotion names can be matched to Vivian's mood. Miss's authored reaction mapping is retained. Opaque names are selectable manually.
- Preview uses a supplied preview/icon/thumbnail/portrait/cover image or a model-named image, excluding texture atlases. If no suitable image exists, capture the rendered framebuffer and crop the avatar; extracting Cubism directly into a render texture produced a tiny preview and was corrected.
- Runtime files resolve to private Blob URLs, revoked on model switch/unmount. Backend character identity remains `Miss`; imported avatar selection does not change cloud identity.
- Main files: `lib/local-models.ts`, `app/companion.tsx`, `app/globals.css`.

## Large atlas handling

- `lib/model-textures.ts` inspects PNG dimensions from the header before decoding, plans rendering dimensions against the actual WebGL `MAX_TEXTURE_SIZE`, and applies an RGBA atlas budget: 512 MiB desktop / 128 MiB mobile.
- **Auto** is the default. Oversized atlases are resized sequentially into temporary browser-only render copies. ImageBitmap/canvas resources are released, interrupted loads are aborted, and mipmaps are disabled before rendering.
- Original imported blobs/ZIPs remain unchanged. The UI shows rendered vs original dimensions when adaptation occurs.
- Two 16,384 × 16,384 atlases render at 8,192 × 8,192 under the desktop budget or 4,096 × 4,096 under the mobile budget, if GPU limits permit. These are atlas dimensions, not screen resolution.
- **Original textures** skips the memory budget but still rejects dimensions exceeding the GPU limit. The choice resets to Auto on a fresh page load. Native 16K decoding/upload is much more demanding; full native 16K Princess rendering was not tested.
- Mobile budget calculations and responsive layout were checked; actual iPhone/iPad Safari and Android large-atlas decoding/memory behavior remain unverified. A resizing failure should show an error while text chat stays usable.

## Real model verification

### Miss__4_.zip

- Two 4,096px texture atlases; about 25.9 MB expanded.
- Its manifest omits expressions despite containing 15 `.exp3.json` files. Discovery now exposes and plays all 15, including names containing `#`, Unicode, and trailing spaces.
- No motion files or separate preview image were present. Preview is generated from the rendered model; the Pose tab shows the absence of motions.
- Verified private import, reload restoration, selected expression playback, generated preview, and Original quality at 4K.

### Princess Live 2D Vtuber Model.zip

- About 122.2 MB expanded, including two 16,384 × 16,384 atlases.
- Model manifest: `marrymei.model3.json`; detected 17 expressions and 3 undeclared motion files (`wink`, `待机`, `蝴蝶`).
- Supplied `marrymei.png` is used as the preview. Artist Art images are outside the model folder and are not confused with its textures/preview.
- Sitting (`坐姿`), skirt-lift (`提裙子`), and bouquet (`捧花`) expressions also appear in Pose.
- Verified import/restoration and desktop Auto rendering at 8,192px, with original files still 16,384px. Device reported a 16,384px GPU texture limit.
- Verified blush (`脸红`), sitting pose, wink motion, and reset controls. Full native 16K mode was not executed.

An official Cubism Haru sample was also used locally outside Git to verify ZIP/folder imports, multiple manifests, supplied/generated previews, expressions, motion playback/reset, missing-file rejection, and responsive UI. These test assets are not part of the app.

## Verification and next checks

Passed during this chat:

- `npx tsc --noEmit`
- `git diff --check`
- `npm run build`
- `npm run test:models` — 11 tests covering package discovery, path/reference rejection, Blob URL lifecycle, IndexedDB storage, pose expressions, atlas budgets/GPU limits, and header-only PNG inspection.
- `npm run test:auth` — allowlist/origin policy tests.
- `npm run test:auth:integration` — protected pages/APIs, forged identity rejection, bearer access, PKCE flows, session refresh, logout, missing configuration, and cross-site mutation rejection.
- Focused ESLint checks on the new model/texture helpers and texture tests.

Follow up only where needed: verify live Google provider configuration and production deployment; test real large-atlas behavior on physical Safari/Android devices; use actual motion/expression names from each imported package. Do not bundle either purchased model to make these tests work.

## 2026-10-02 — Tsundere personality and GitHub cleanup

- The user requested removal of the two yandere branches, handling the open PR, and making Vivian strongly tsundere overall.
- Deleted remote branches `feature/yandere-personality` and `fix/vivian-yandere-agency`. Their historical PRs #1 and #3 were already merged; no history was merged back into main.
- Reviewed and closed PR #2 (`Desktop Pet: package Vivian as local Windows app`). It conflicts with main, has failing desktop checks, and its older implementation replaces the authenticated home page/Proxy and removes independent chat API authorization. Its history must not be merged into the cleaned repository. Kept `feature/desktop-pet-local` for separate desktop work.
- Replaced the primary chat personality and relationship initiative instructions with strong tsundere behavior: proud, teasing, flustered by affection, caring through actions. All personality variants retain the same core. Old memory/summary text must not restore the retired personality. Distress takes priority over teasing.
- Updated local greeting fallbacks, personality descriptions, and Live2D mood expression matching. `normalizeMood` maps older stored `yandere` values to `tsundere` on both server and browser reads while retaining shared relationship scores and memory; no destructive database migration is needed.
- Added `npm run test:companion` for old-state compatibility, early relationship flustered reactions, distress precedence, idle scores, and mood decay. Updated README.md.
- Passed: production build, TypeScript, diff whitespace checks, and four companion regression tests. Authentication policy (3 tests) and integration (6 tests) also passed, including page/API access guards and cross-site mutation rejection.
- No explicit CLI production deployment requested or performed for this change; follow the continuation rule to deploy only on request. Do not claim the production alias contains this commit without verifying a deployment.
- Preserve unrelated untracked `supabase/.temp/`.

## 2026-10-02 — TTS delivery for tsundere Vivian

- User requested matching TTS delivery, standard Central Thai with no regional/Isan accent, and readable stammers such as `B- B- Baka`.
- Added `lib/speech.ts`: tsundere teasing/flustered/gentle delivery selection; supportive text takes precedence. Fish S2 receives one inline natural-language performance cue, with standard Central Thai pronunciation instructions for Thai or Thai-containing Global speech. Other configured model families receive plain text.
- Keep the existing Fish voice/reference identity and MP3 settings. Inline accent instructions guide synthesis; actual pronunciation also depends on the selected voice and must be checked by listening. No claim of verified accent quality without an audio check.
- Filter recognizable parenthesized stage directions and source URLs while retaining spoken explanations. Preserve ellipses and repeated syllables. Normalize the romaji interjection `B- B- Baka` to `Ba… Ba… Baka`, retaining the number of attempts, and request natural stammering rather than spelling letter names. Disable the repetition penalty for stammered lines so attempted syllables are not discouraged.
- Speed adjustment stays subtle and now respects the UI's full 0.8–1.2 range. Hardened TTS JSON/text validation against malformed or non-string bodies. API Auth and provider timeout are retained.
- Added `npm run test:speech`: six tests for spoken cleanup, emotional priority, repeated stammer syllables, standard Thai cues, other-language/model compatibility, and speed bounds. Updated README.md.
- Local checks passed: speech tests, TypeScript, focused ESLint, diff whitespace, and production build. Live synthesis was unavailable because local Fish credentials were missing; no real audio was generated or pronunciation verified locally.
- Prior personality commit `0cfc181` was automatically deployed by GitHub to production as `dpl_CWFSwUM6eZ1B5QhCwyAVGnhJPMaK` (READY). Current configured alias is `https://vivianlabs.vercel.app`, verified HTTP 200 at `/login`; old `vivian-chan.vercel.app` returned 404.
- Push this TTS change to main and verify the automatic deployment. No explicit CLI deployment requested. Preserve unrelated `supabase/.temp/`.

### Live Chrome follow-up

- User requested opening Chrome. Reused the existing Vivian tab on `vivianlabs-celestial-sora1.vercel.app`, reloaded to the current deployment, and submitted a short stammered speech test through the normal chat UI.
- Verified production deployment `dpl_2CiZx87jLFNRcXyEELYSBaFnjtJw` READY for commit `07e2cd9`; aliases include `vivianlabs.vercel.app`. Live chat and TTS both returned 200. Fish generated 406,882 bytes in 9,569 ms, language `th`, delivery `flustered`. Voice was already On at 0.98× and TH.
- Live response exposed Unicode nonbreaking hyphens (`B‑ B‑ Baka`) and an inaccurate claim that Vivian could not speak. Extended stammer normalization to Unicode hyphens/dashes and added chat guidance to return requested spoken words directly while not claiming playback succeeded.
- Existing tab had no privately imported avatar and logged a missing model; do not bundle licensed assets to address that. Audio generation success does not by itself verify perceived accent or playback quality.

## 2026-10-02 — General stammer handling

- User clarified that `Baka` was an example, not the only word to support. Removed the word-specific replacement and added Unicode word/fragment handling, including Thai leading vowels, apostrophes, and progressively longer fragments.
- Keep each interrupted attempt and the full target word. Bare Latin consonants use the target word's opening vowel as a pronunciation hint; other scripts retain their written fragments. This is an orthographic hint, not a phonetic dictionary or a guarantee of pronunciation for every language/voice.
- Repeated and single written stammers select expressive delivery and disable repetition suppression. Comfort remains gentle while preserving the requested stammer. Ordinary compounds/acronyms and pauses are not labeled as stammers.
- Expanded `npm run test:speech` to eight tests with 13 multilingual examples plus single fragments and compound/acronym regressions. README.md now describes general support.
- Previous live Chrome check on `aa919d6` confirmed the requested line and successful TTS: 113,475 audio bytes in 3,139 ms. Deployment `dpl_9yH9orkobdMoiLSoQUgTMX4cW5cg` was READY. Actual accent quality was not verified by listening.

## 2026-10-02 — Reply style from the user's Grok screenshots

- User supplied screenshots showing a shy, polite tsundere with natural slang, hesitant pauses, short lines, and mild defensive affection. This updates the earlier forceful tsundere direction.
- Adjusted the shared chat personality, relationship initiative, and optional personality facets to be shy and soft-spoken, with occasional wordplay, light teasing, natural Thai particles, and brief contextual hesitation. Replies address the user's actual message first; neither a denial of affection nor a final question is mandatory every turn.
- Added greeting and compliment examples as tone guidance rather than fixed replies. Normal conversation uses 1–3 short sentences and optional line breaks; explicit informational/help requests retain complete answers. Gestural stage narration is no longer the default.
- Updated local greeting fallbacks and descriptions to match. Retained shared memory, identity, Auth, provider routing, and general stammer support.
- TTS now defaults to reserved, polite, soft-spoken conversation; teasing is selected only when the reply has teasing cues. Flustered/stammered delivery stays bashful and gentle, preserving standard Central Thai instructions and the user's speed control.
- Passed speech tests (8), companion tests (4), TypeScript, focused ESLint, diff whitespace, and production build. Push to main and check the automatic production deployment, then verify the new conversational tone in the existing Chrome session.
- Prior general-stammer live test succeeded on `b3ff955` / `dpl_GHxUpa3JGRifWVe6wdCMMMsVv5H6`: 240,743 audio bytes in 4,687 ms, normal chat UI returning the requested English/Thai sentence. Actual accent quality has not been evaluated by listening.

## 2026-10-02 — User-requested full memory/companion reset

- User explicitly requested resetting mood, all memories, and companion state. Scope: shared cloud memories/history/summary/relationship plus this Chrome device's chats, streak, idle state, and custom instructions. Preserve imported models, account/login, voice/language preferences, and unrelated local files.
- Added Settings → Reset Vivian and authenticated `DELETE /api/memory` with `scope: "all"`. Reset remains scoped to shared `default`; it does not delete Auth accounts or another identity's rows. Deletes messages/conversations, memories, and the companion row, then verifies zero remaining scoped counts. Partial failures are reported and can be retried; this device is only cleared after confirmed server success.
- GET returns initial companion defaults when no state row remains. Client clears summaries/history views, uses a new empty local conversation, resets check-in/idle/custom instruction data, cancels greeting/playback/recording/camera activity, and rejects stale memory/STT responses during the reset. Offline devices retain their local chats.
- Passed: four reset tests (scope isolation, retry, empty identity rejection, incomplete-deletion detection), TypeScript, focused ESLint, whitespace checks, production build, and six Auth integration tests.
- The Supabase connector available here lists a different inactive project; no data in that unrelated project was read or changed. Perform the requested production reset through Vivian's existing secured server and authenticated Chrome UI.
- Prior soft-personality commit `09d49bc` / `dpl_6Q5vq7rZJ3Q8n3nVyYpew5EvTdFb` was READY. Live Chrome greeting test returned a short, hesitant, polite reply to “ไง”. Run any further chat tests before resetting; do not repopulate cloud history with test messages afterward.
- Push this reset capability and verify deployment before invoking the explicitly requested reset in Chrome. Confirm the reset success status, empty memory/history UI, and initial companion values, and save screenshot proof.

### Reset confirmation follow-up

- Native `window.confirm` blocked Chrome automation on the original tab. The user is away from the computer; no reset had run. Replaced it with an inline, accessible confirmation in Settings so the explicitly authorized reset can be completed from a fresh Chrome tab.
- The new Chrome tab works normally. TypeScript, whitespace checks, and production build passed for the confirmation change. Verify the new deployment before running the reset, then record the actual reset outcome.
- Reset capability commit `4ad253c` deployed READY as `dpl_4VuYiFPScVWYc7DMB5WXXQM6SD2H`.

### Production reset completed

- Confirmation commit `c39df09` deployed READY as `dpl_32DJkiYGKvTVuo1MTShhcioaJby6`, with the configured production aliases available.
- Executed the explicitly requested full reset through the fresh authenticated Chrome tab. Production logs confirm `DELETE /api/memory` returned 200; this endpoint verifies zero scoped messages, conversations, memories, and companion rows before returning success.
- Settings displayed “รีเซ็ตแล้ว เริ่มคุยกันใหม่ได้เลยนะ”. Memories was empty; Mood was calm (“สงบ”), check-in 0, Affinity 22, Trust 18, Familiarity 8. Conversations showed only a fresh Daily Talk with no previous messages. Custom instructions were empty. Saved screenshots in `/tmp/vivian-reset-success.png` and `/tmp/vivian-reset-memories.png`.
- Refreshing the fresh Chrome tab retained the reset. No user test chat was sent after resetting; automatic greetings do not write cloud history or relationship state. The original Chrome tab remains unavailable to automation; leave the fresh working tab open for the user.
- Corrected the post-reset empty-message fallback to a short local welcome so the UI does not keep showing the initial “กำลังคิด” placeholder. This does not add a chat message or cloud state.

## 2026-10-02 — Vivian in Sorachan's household

- User requested another full memory reset and a new backstory: Vivian is a member of Sorachan's household. Retain the shy, polite tsundere personality and current TTS.
- Added core fictional canon in `lib/vivian-story.ts`, injected into the shared system prompt for chat, greetings, and vision: a place in Sorachan's home, a reading corner and tea cup, gentle everyday conversation, and slowly growing trust. Default address is “โซระจัง”, honoring a different requested name. Household canon survives resets; it does not restore remembered events, raise relationship scores, or claim physical presence/knowledge of the real home.
- Replaced default viewer/VTuber framing with household conversation and adjusted early closeness wording so a fresh relationship remains consistent with the story. Direct identity questions still receive truthful virtual-companion answers.
- Passed: production build, TypeScript, companion tests (4), and whitespace checks. New story module passes ESLint. Existing route/companion lint diagnostics were checked against HEAD and remain unchanged; those older errors are outside this story change.
- Push and verify the automatic production deployment, check a fresh non-persisted greeting in Chrome, then perform the explicitly requested full reset. Do not send a test user chat after resetting. Preserve unrelated untracked `supabase/.temp/`.

### Household story — live verification and repeat reset completed

- Story commit `eb7756b` deployed READY as `dpl_7cJ5qpeNMZQmeo7qESawaU2fmKGq`, with the configured production aliases available.
- A new, ephemeral greeting in Chrome returned “...ไงโซระจัง แค่พักอ่านหนังสืออยู่… มีอะไรอยากคุยบ้างไหมคะ”. Chat and TTS returned 200; Fish produced 155,479 bytes in 3,038 ms with reserved Thai delivery. No test user chat was submitted.
- Executed the user-requested repeat reset afterward. Settings confirmed success and Vercel request logs confirm `DELETE /api/memory` returned 200. The reset endpoint verifies zero scoped cloud rows before returning success.
- Memories empty; Mood calm (“สงบ”), Affinity 22, Trust 18, Familiarity 8, check-in 0. Conversations shows one fresh empty Daily Talk. Post-reset screen displays a ready local welcome instead of a stuck thinking placeholder. No further chat was sent after resetting.
- Screenshots: `/tmp/vivian-household-greeting.png` and `/tmp/vivian-household-memory-reset.png`. Keep the working Chrome tab open. Household canon remains in source, separate from deleted learned memory/history/state.

## 2026-10-02 — TTS timeout shown in the user's Vercel screenshot

- Production logs confirm the 21:20:36.66 `POST /api/tts` 500 was an uncaught `TimeoutError`. Fish's fetch returned headers, but the subsequent `response.arrayBuffer()` ran outside the catch; the existing 14-second signal could still abort the audio stream there.
- Extended error handling through complete audio consumption. Timeouts during headers or audio return non-cacheable `504/TTS_TIMEOUT`; connection/read failures and empty audio return `502/TTS_UPSTREAM`. Logs include the failing phase and metadata only. Keep the existing voice, model, pronunciation/style, speed, deadline, auth, and client text fallback.
- Added six route regression tests using fixture credentials and simulated partial/stalled streams (no live provider or cloud-memory calls). Passed all six, eight speech tests, TypeScript, focused ESLint, production build, and whitespace checks.
- Push the fix to main and deploy production, then record the READY deployment and alias checks. Unrelated untracked `supabase/.temp/` remains untouched.

### TTS fix — production verification

- Fix commit `4d070f1` pushed to main; explicit production deployment `dpl_7nNNCSqpQd1iJqSo46HxJ73fiEB3` reached READY. `vercel inspect` confirms both configured aliases: `https://vivianlabs.vercel.app` and `https://vivianlabs-celestial-sora1.vercel.app`. The older `vivian-chan.vercel.app` URL in AGENTS.md now returns DEPLOYMENT_NOT_FOUND; no domain changes were made.
- Reloaded the working authenticated Chrome tab and exercised ephemeral greeting synthesis without sending a user chat or writing cloud history. Production logs show `/api/tts` 200 with 193,096 bytes in 4,451 ms; Chrome reports no warning/error. An additional fresh greeting completed in the UI. Actual perceived sound quality and mobile Safari playback were not evaluated.
- The deployment error scan returned no errors at the time checked. Screenshot proof: `/tmp/vivian-tts-fixed.png`. Fish may still exceed the existing deadline; regression tests verify those cases now return controlled JSON instead of an uncaught 500.

## 2026-10-02 — Character expression and pose toggles

- Fixed Character → Expression and Pose buttons so clicking the selected item again disables it. Pose expressions share selection with the Expression tab; motion buttons stop their selected motion and return to idle when toggled off.
- Cubism 4's `resetExpression()` resets playback but retains its current-expression pointer. Clear that pointer to the default expression and cancel the reserved expression load before resetting, allowing the same expression to be enabled again.
- Manual expression/motion selection updates immediately so a second click can cancel loading. Ignore superseded expression completions/errors, retaining the existing model-load and motion-action guards.
- Verified locally with the privately imported Princess model: blush and sitting pose on → off → on → off, wink motion on → off → on → off, rapid double clicks, cancelling a newly loaded expression then re-enabling it, and toggling a shared pose off from Expression. Browser warning/error logs were empty. No live chat, TTS, or cloud-memory calls were used; authentication used the local fixture.
- Passed production build, TypeScript, whitespace checks, and all 11 model tests. Screenshot: `/home/sorachan/.codex/visualizations/2026/10/02/01a0fc34-dd18-7121-a3c6-76e59a7f8535/live2d-toggle-fixed.png`.
- Push this fix and handoff update to `main`. No explicit CLI production deployment requested for this fix. Preserve unrelated untracked `supabase/.temp/`.

## 2026-10-02 — Marymie motion pose remains after toggling off

- User reported Marymie in their current Chrome tab with Imported → 蝴蝶 selected. Reproduced the button deselecting while the model retained the motion's visual state; the existing reset only stops the motion queue, which leaves persisted Cubism parameters untouched.
- Capture each loaded model's authored parameter defaults and initial part opacities before its first ticker update. On manual motion toggle-off and Reset to idle pose, stop the queue, restore those values, and save the restored parameters so the next Cubism frame cannot reload the stale motion baseline. Clear the snapshot when changing/unmounting models.
- Retain the preceding expression-selection fix, normal idle playback, private imported assets, and existing rendering/layout.
- Two regression tests cover persistent accessory values absent from idle, repeated resets, nonzero defaults, part opacity restoration, and separate model baselines. Included them in test:models. The previous 11 model tests passed; TypeScript, focused helper/test ESLint, whitespace checks, and production build passed after aligning the Cubism runtime type with its broad library declaration.
- Push and deploy this fix, then verify Marymie in the user's existing production Chrome tab. Preserve unrelated untracked supabase/.temp/.

### Marymie — production and current-tab verification

- Fix commit `a8ab1b1` pushed and deployed READY as `dpl_AA31P75T4pCwqL48nPFAfauyYn5m`. `vercel inspect` confirms the user's alias `vivianlabs-celestial-sora1.vercel.app` and `vivianlabs.vercel.app` point to this deployment.
- Reloaded the exact existing Chrome tab with the privately imported `marrymei` model. Verified Imported → 蝴蝶 on/off: before the fix, deselection retained the cloud/moon and raised-hand state; after the fix, deselection visibly removes the cloud/moon and returns the character to standing idle.
- Also checked sitting expression on/off and Reset to idle pose after re-enabling 蝴蝶. Both selections clear. Left all pose/motion selections off, with Marymie loaded and Character → Pose open. Chrome warning/error logs empty. Screenshot: `/tmp/marymie-pose-fixed.png`.
- All 13 model tests, production build, TypeScript, whitespace checks, and focused helper/test lint passed. No test user chat was sent and no model files were uploaded or changed.

## 2026-10-03 — JEV decision/reflex layer

- Audited the supplied clean `work` branch at `d38b6f4` and verified it matched remote `main`. Recorded the original runtime in `docs/jev-decision-layer.md` before editing. Read AGENTS and the relevant installed Next route/after guides. Loaded the upstream Karpathy Guidelines because no installed/local copy was found; the attached SKILL.md was Git Identity Guard and governs the commit/push identity.
- Expanded `lib/jev.ts` from one fresh-only question to one ten-question batch. Typed outputs cover fresh information, memory relevance/recall intent, vision, supported local tools, integration preparation, model-class/intent summaries and conversational/supportive/explanatory response mode. Strict validation, per-decision confidence, typed failure status and metadata-only latency logs are included. Preserve `jev-latest`, the 0.85 fresh threshold and two-second deadline.
- `lib/chat-decision.ts` resolves a deterministic plan. The existing chat route still owns Auth/rate limits, memory, tools, provider fallback, final persona/language generation and background writes. State loading overlaps JEV. Explicit intents and actual images win; uncertain/unavailable/disabled/malformed decisions retain legacy behavior. Composio execution now rejects unoffered tools and invalid/non-object JSON arguments.
- JEV receives only bounded current/recent text and capability metadata, never memory rows, persona/state summaries or image/audio data. Speech stays Groq Whisper → chat → Fish Audio. An optional transcript input-source marker preserves room for a separate evidence-grounded STT feature; no correction system is implemented.
- Updated AGENTS, README, environment examples, the Settings description and architecture documentation. Added `npm run test:jev` with 53 decision/client/chat-route tests using fixture credentials, mocked upstream services and no cloud-memory writes.
- Final local checks passed: all 91 unit/mocked route tests (including the 53 JEV tests), all six production Next/Auth integration tests, `npx tsc --noEmit`, production build, focused lint for new/changed helpers/status/tests, and diff whitespace checks.
- Full `npm run lint` still fails with **24 pre-existing errors** in the chat route, companion UI/helper and bundled Cubism runtime. Baseline/final diagnostics were compared by file/rule/message: no additions; warnings decreased from 310 to 309 because ComposioToolCall is now used. Do not claim full lint passes or refactor unrelated systems to hide this debt.
- No live JEV/AI requests, speech playback or upstream latency/calibration/cost were verified. Public Typesafe docs were inaccessible from this environment (proxy 403), so the established repository noul wire format was retained. The ten-question batch is covered by mocked contract tests and still needs real-service validation. Explicit-search/image requests now also incur the bounded JEV pass when enabled. External-tool discovery remains the existing toolkit detector; no new reasoning provider tier, per-action permission UI or full argument-schema validator was added.
- User requested commit and push to `main`; no separate CLI production deployment was requested. Keep any automatic Git deployment separate from the locally verified results above.

## 2026-10-03 — User-provided Vivian dialogue references

- Applied the user's requested dialogue style to the project: shy, polite tsundere speech, Thai self-reference “หนู”, light slang, and flustered playful denials.
- Added all five supplied scenes verbatim to `lib/vivian-dialogue.ts`: hot weather, morning greeting, compliments/teasing, care during illness, and playful pouting on return. The shared `/api/chat` system prompt injects this reference for chat, greetings, idle turns, and vision. Example name “ยูกิ” does not override the user's chosen name or default “โซระจัง”; scene details are not learned memories. Context guidance preserves truthful capabilities, gentle care, and language selection.
- Aligned pronouns in the shared identity/backstory and all three local fallback greetings. Updated README. Provider routing, TTS settings, relationship state, and stored memories were not changed.
- Initial TypeScript check found incomplete workspace dependencies (`@supabase/ssr` and `fflate` missing). Installed the existing lockfile with `npm ci --ignore-scripts --no-audit --no-fund`; no manifest or lockfile changes.
- Passed TypeScript (`npx tsc --noEmit`), all four companion tests, focused ESLint for the dialogue/story modules, whitespace checks, and production build. Live LLM delivery was not evaluated; the managed environment has no provider credentials.
- User subsequently requested production deployment. Vercel CLI/token are absent and the connector's deploy tool reports unavailable; use the existing GitHub production integration for `vivianlabs` and verify the resulting deployment through Vercel tools. Remote `main` has a newer JEV decision-layer commit; integrate it before pushing the personality change.
- Integrated remote JEV commit `dfd3301`, retaining both handoff sections. Production build passes after integration. Updated the JEV route fixture to load the new dialogue module and verify the reference reaches the provider prompt; all 53 JEV tests and four companion tests pass. No live memories or provider services were used.

### Dialogue references — production verification

- Source commit `3ad7264` pushed to main and deployed READY as `dpl_2gvXkQyT38Re34AwSvu28kaRPF1r`. Both `vivianlabs.vercel.app` and `vivianlabs-celestial-sora1.vercel.app` resolve to that commit. Production login returned 200. This agent made no authenticated chat/provider requests.

## 2026-10-03 — New-chat connection errors and Groq fallback failures

- User reported connection errors after creating a fresh local conversation. Production logs at 01:21:41/01:21:47 UTC show `/api/chat` 500 without diagnostic console messages. At 01:21:21, Groq's configured `openai/gpt-oss-120b` returned 429 and hardcoded `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` returned 404; the overall request still returned 200 via provider fallback. These provider statuses alone do not explain the two 500s. No live LLM calls were made by this agent's earlier tests or verification.
- Verified the actual public production Supabase URL references project `frqixaqknuyerovnrndq` (`ai-waifu`), ACTIVE_HEALTHY. Its 01:18–01:26 edge logs show successful Auth/user, companion state, memories, conversations and messages requests (200/201/204/302), with no 429/5xx. The Supabase project's inactive listing result was a different project and was not modified. No memory contents were queried or deleted.
- Reproduced a separate concrete 500 case with mocked services: “วันนี้อากาศร้อนจังเลย” incorrectly forced search, which returned a silent configuration 500 without Gemini. Removed standalone “วันนี้” from explicit search detection; JEV can still identify real fresh-information needs. Missing search configuration now returns a specific `SEARCH_UNAVAILABLE` 503 and a matching UI message. Missing all providers has a separate logged `CHAT_NOT_CONFIGURED` 503.
- Removed the two Groq model probes observed returning 404; quota/model failure now proceeds directly to configured Cerebras/Gemini fallbacks. Bound greetings to 120 output tokens across text providers and other passive turns to 180, retaining 2500 for normal chat. Groq rejection logs include mode and quota/reset/retry headers, without keys, user text or complete provider bodies. The historical 429 did not log enough detail to distinguish request versus token quota.
- Passed production build/TypeScript, all 56 JEV/chat tests, four companion tests and whitespace checks. Regression coverage checks casual today messages without Gemini, explicit unavailable search, immediate provider fallback on Groq 429/404 and greeting token budgets. Live authenticated new-chat reproduction still requires the user's session and exact failing message; do not claim the two historical 500s are conclusively attributed.

### Groq token-limit screenshot and prompt reduction

- First fix `88e17fc` deployed READY as `dpl_65oge1kLGos2QD3tLEXMtVqdAC2K`. User then supplied a Groq dashboard screenshot showing a token-usage spike above the Rate Limit line. This corroborates token-rate pressure; it does not identify the sender of each request or conclusively attribute the two historical application 500s.
- Keep all five original dialogue references in source, but inject shared guidance plus only the relevant scene per turn. Greetings/general turns use a short neutral example. Reference text falls from 3,322 characters to 1,233 for a greeting/general turn (63% fewer characters), or 1,422–1,865 for a matched scene (44–57% fewer characters). These percentages describe the reference section's character length, not measured token savings for the whole prompt. Backstory, memories, personality and language rules stay present.
- Clear stale global error notices when creating or selecting a conversation; historical error bubbles remain in their original conversation. The passive greeting fixture now explicitly exercises empty history. Added route regression coverage for all five scene selections, single-scene prompt size, default guidance, and name handling. All 57 JEV/chat tests, focused ESLint, production build/TypeScript and whitespace checks pass for the final changes. Authenticated live new-chat behavior is not verified from this environment.

### Reduced prompts — production verification

- Commit `778cba6` deployed READY as `dpl_7hxoeyrYMYiCj1odmKvrJ9ZMg6RW`. Both production aliases point to this commit; login returned 200. The preceding fix's runtime logs show two successful chat requests at 01:32:50 and 01:34:04 UTC, but do not identify whether they were new-chat greetings. No live LLM requests were sent by this agent.

## 2026-10-03 — User-supplied anime school roleplay

- User supplied replacements for the existing roleplay sources and requested keeping files separate. Applied the anime-school canon in `lib/vivian-story.ts`: Vivian is a shy tsundere student and Sorachan is her kind femboy classmate within the fictional setting, with a classroom window seat, reading book and lunch box.
- Updated dialogue examples to the school/cosplay wording supplied by the user; retained the one-relevant-scene prompt selection. Aligned all three closeness levels in `lib/companion.ts`, shared chat/greeting/vision identity and goals in `/api/chat`, and the school fallback greeting in `app/companion.tsx`. Updated README. No new consolidated roleplay file was created, no memory reset was performed, and provider limits/routing were not changed.
- Passed production build/TypeScript, all 57 JEV/chat tests, four companion tests, focused story/dialogue ESLint and whitespace checks. Live LLM delivery was not evaluated.
- Publish one atomic commit to main using the GitHub plugin as requested, then verify Vercel's existing Git production integration. No separate Vercel CLI deployment.

## Dynamic scene backgrounds — 2026-10-03

- Replaced the browser-only custom scene implementation with account-owned Supabase scenes, preferences and private Storage. User-written labels are required (1–50 Unicode code points); neither filenames nor any model generate scene meaning. The former IndexedDB data is left intact and can be manually re-imported with explicit labels.
- Scenes/Gallery reuse the existing floating workspace. Add/edit/replace supports real uploads, drag/drop, backend URL import, previews, loading/errors and deletion confirmation. Cards show lazy thumbnails, label and current state. Manual/AI background transitions preload and retain the old image on failure; reduced-motion handling and day/night fallbacks remain.
- New migration: `supabase/migrations/20261003032056_dynamic_scenes.sql` adds `vivian_scenes`, `vivian_scene_preferences`, durable `vivian_scene_image_gc`, RLS/grants, composite account ownership FK with active deletion fallback, a 50-scene limit trigger and private `vivian-scenes` bucket. No binary image data enters normal tables; shared companion memory/relationship identity is unchanged. **Not applied to any live project.**
- Imports use actual raster decoding, metadata stripping, dimension/8 MiB limits, 1920px WebP output and 480px thumbnails. HTTP(S) imports have public-address DNS validation, pinned connections, redirect validation, size/MIME/content limits and timeout. Private/metadata endpoints are rejected. Objects are uploaded before committing scene rows and queued for safe cleanup/retry on failures.
- The existing System One noul batch adds optional scene probabilities using only account-owned IDs and manual labels. No scene bytes, URLs or storage paths enter JEV or the dialogue model. Low confidence/ties/malformed optional answers default to no change. Auto Scene defaults OFF; disabled JEV and passive turns bypass scene preparation.
- Harness validation checks offered IDs, account ownership, live Storage availability and persisted Auto Scene/revision state. Atomic revision comparison protects newer manual/toggle actions and concurrent replies. Scene load/execute each has a 600ms total deadline and failures cannot invalidate text chat. Existing chat JSON carries the validated scene decision to the frontend.
- Verified with a clean `npm ci`: 116 unit tests across existing suites plus scene/JEV cases pass; `npx tsc --noEmit`, production build and `git diff --check` pass. Scene/changed support modules and new tests lint cleanly. Full repository lint reports 24 existing errors / 309 warnings; original vs changed companion/chat/JEV/Auth files have identical lint counts (19 errors / 10 warnings), without suppressing rules.
- Route integration (5 tests) and expanded Auth integration (6 tests) pass against local production Next/Auth/REST/Storage fixtures. URL imports run the real validator/decoder against a simulated public DNS/source; model calls are mocked. Local PostgreSQL/PGlite validation passes schema/label constraints, private bucket, ownership/RLS, direct mutation denial, scene limit, replacement cleanup and deletion FK behavior.
- Browser verification used agent-browser + Chromium at 1440×900, 390×844 and 844×390: actual file upload, local preview, URL preview/import, SSRF error, label edit, image replacement, manual selection, reload persistence, mobile drop, Auto OFF/ON and active deletion fallback. No horizontal overflow, framework overlay or uncaught JS errors in the workflow. Separate failure/performance checks confirm unavailable images retain the prior background/preference, retry succeeds, ordinary chat causes no background download, and day/night toggles both directions.
- Remaining limits: production Supabase/Google/JEV and real Internet imports were not tested (no live credentials available); mobile checks are responsive Chromium viewports, not physical-device certification. Cleanup retries are request-driven after one hour; unused/deleted-account orphan queues may require an operational cleanup job. This work is not deployed.
- Full file/architecture/setup documentation: `docs/dynamic-scenes.md` and README's Dynamic scene backgrounds section.

## 2026-10-03 — Remove floating status pill

- Removed the static “V / Vivian / Online” pill shown in the user's screenshot, plus its unused avatar, dot and responsive CSS. Conversation-list avatars retain their styling.
- `npx tsc --noEmit`, production build and `git diff --check` passed. Companion ESLint results match the committed baseline exactly (11 existing errors, 7 warnings). No new tests were added for this markup-only removal; authenticated browser behavior was not re-tested.
# 2026-10-05 — Private R2 storage and frontend Status

- Prepared private R2 Standard storage for licensed Live2D packages and new scene images. Global SQL quotas reserve 8 decimal GB for models and 2 decimal GB for other files across both authorized accounts. Pending uploads and failed deletions retain reservations; one archive and its expanded model are limited to 512 MiB. Direct multipart transfers avoid serverless body limits. Originals, including 32K textures, remain unchanged and outside Git/deployment bundles.
- Added account-owned model upload/download/delete APIs and owner-scoped IndexedDB caching. Existing local imports can be saved to cloud; existing Supabase scenes remain readable. New scenes use R2 only when configured. Failed quota checks do not fall back to another provider.
- Replaced Gallery with Status in the config menu. Supabase and R2 show used bytes, capacity, and percentage; R2 also shows the 8 GB/2 GB split. Usage refreshes every five seconds while visible, after storage mutations, and on manual refresh. Supabase reports file storage metadata, not database size. R2 reports the application reservation ledger, not objects written outside the app. Unavailable checks do not fabricate zero usage.
- Setup: `docs/private-r2-storage.md`, `.env.example`, and `config/r2-cors.json`. Apply migrations `20261005131311_private_r2_storage.sql` and `20261005133532_storage_status.sql` after the existing scene migration. Set server-only R2 credentials and a dedicated private Standard bucket; configure exact CORS origins and incomplete-upload lifecycle cleanup. Supabase capacity defaults to 1 decimal GB and can be changed with the server-only capacity variable.
- Verified production build, TypeScript, whitespace checks, 13 storage unit tests, six tests applying actual migrations to disposable PostgreSQL 17 (including parallel quota writes and service-only aggregate permissions), 14 model tests, 15 scene unit tests, six Auth integration tests including the new Status endpoint, and five scene integration tests. Other existing unit suites passed. Focused lint passes; full-repository lint retains existing errors (including the unchanged Companion baseline of 11 errors and seven warnings).
- Browser verification used mocked storage and local Auth fixtures, with installed Chromium. Confirmed Gallery replacement, Supabase 25% usage, automatic R2 update from 0% to 80% with Live2D at 100%, and a 390×844 mobile layout without horizontal overflow. Imported a synthetic, non-licensed package, restored its cloud files in a fresh browser session, and deleted it; its deliberately invalid MOC correctly failed rendering. These checks do not verify a live R2 bucket.
- No production deployment, push, live database migration, account upgrade, or live R2 writes were performed. Managed workspace has no production storage credentials. Encryption is provider encryption at rest plus HTTPS, not end-to-end encryption. Storage caps do not cap request charges or other buckets/services.
# 2026-10-05 — Actual provider storage measurements

- User explicitly required actual provider data and per-upload calculations while preparing R2 credentials. The previous R2 Status readout used the real application ledger, but did not inventory R2 itself; replaced that path with uncached, fully paginated S3 object/upload/part listings. Status now displays actual provider-returned bytes, separately from quota committed (actual bytes plus any remaining reservations). Supabase continues to aggregate current Storage metadata. No production mock/fallback usage numbers exist; failed live checks show Unavailable.
- Every new model/R2 scene upload inventories the bucket before any remote writes, compares all keys against all reservations, and persists additional observed bytes through service-only RPC `vivian_storage_observe`. Updated SQL trigger checks reservations plus those bytes under the existing global category lock. Missing credentials/network/listing failures block uploads. Include the third migration `20261005135133_observed_r2_usage.sql` in setup. Existing 8/2 decimal GB and 512 MiB limits are unchanged. Out-of-band writers must remain disabled for the hard quota guarantee: listing Cloudflare and reserving in Postgres cannot form one cross-provider atomic transaction.
- Verified 17 storage tests and seven actual PostgreSQL migration/permission/concurrency tests, six Auth integration tests, TypeScript, focused lint, and production build. Provider fixtures are limited to tests; live R2 verification remains pending the user's credentials. Nothing was deployed or pushed and no live data was touched.

## 2026-10-05 — Live R2 verification

- Tested READY production deployment dpl_CQ1LHnJxMzBD6LBVDzAumczvzb7K through the signed-in Vivian Chrome session. Active aliases are vivianlabs.vercel.app and vivianlabs-celestial-sora1.vercel.app; the old vivian-chan.vercel.app returns DEPLOYMENT_NOT_FOUND.
- Initial upload creation and signing returned 201/200, but browser transfer failed. The private vivian bucket had no CORS policy. Configured the two exact production origins, GET/PUT/HEAD, content-type, exposed ETag, and 300-second preflight caching. Public bucket access remains disabled.
- Chrome ZIP selection remained blocked by the extension after the user enabled file URL access. Saved the already-imported Miss package through the real Character UI instead. Successful two-part upload shows Miss · Cloud. Live Status reports 27.1 MB actual/committed Live2D usage and Other files at 0 B.
- Downloaded actual R2 object f772c7f8-502e-4a35-9e14-75032042727c: 27,123,570 bytes. Compared extracted paths and SHA-256 against /home/sorachan/Documents/Live2D Model/Miss__4_.zip (20,557,358 bytes): all 22 files match, no missing/extra/modified files. ZIP size differs because existing local imports are repackaged without compression. Original ZIP chooser flow remains unverified; actual supplied model contents, R2 upload, and readback are verified. Model retained in private cloud; downloaded archive remains in Downloads. Screenshots: /tmp/vivian-r2-evidence/status.png and /tmp/vivian-r2-evidence/object.png.
- npm ci --ignore-scripts completed; 17 storage tests, 14 model tests, and git diff --check passed. No app code change or deployment. Existing Companion and expression-layer edits preserved.
- User clarified final scope: Cloudflare is for Live2D model storage and scene storage only. Do not add agent tracing or migrate from Vercel. Current implemented allocation remains 8 decimal GB for Live2D and 2 decimal GB for other files; no quota/schema changes were made.

## 2026-10-05 — Original-resolution scenes, preload and unused R2 buffer

- User clarified that 2 decimal GB is an unused safety buffer, not a scene allocation. Models, scene originals, thumbnails, outstanding reservations and observed external bucket bytes now share one 8 decimal GB application budget across both authorized accounts. Status and Models describe this shared budget. SQL locks both category counters in a consistent order to prevent simultaneous model/scene uploads overspending the last bytes.
- Prepared migration `supabase/migrations/20261005152924_shared_r2_budget.sql` using Supabase CLI. Apply after the three existing R2 migrations and before deploying these source changes. It preserves existing objects, RLS/service-only permissions and reservations, and adds original-format MIME support to the legacy private Supabase scene bucket. **Not applied to production.**
- Newly imported/replaced scenes keep exact JPEG/PNG/WebP/AVIF source bytes, dimensions, MIME type and metadata after complete decode validation. Existing 8 MiB/40 MP/dimension limits still apply. Only library thumbnails become resized WebP; originals stay private. Legacy compressed scenes remain readable but require their original image to be re-imported for full resolution. Thumbnail key generation/cleanup now handles every supported original extension.
- After library load, preload the active scene first, then the other full images and built-in day/night presets sequentially at low priority. Wait for full decode before selecting/fading, reuse concurrent requests, retry failures and cancel queued warming on unmount/library changes. Retain decoded images under a 64 MiB LRU budget (latest individual image can exceed this) to avoid holding an entire high-resolution library in memory. Older images may be fetched/decoded again when selected.
- Verified production build, TypeScript, focused ESLint, whitespace checks, 19 scene/preload tests, 17 storage tests, seven real PostgreSQL 16 migration/permission/concurrency tests, five real Next scene route integration tests and six Auth integration tests. Route readback matches the exact uploaded PNG bytes and serves its original MIME; thumbnails remain WebP. Fixed the scene integration test loader to use an encoded file URL so it runs in this workspace path containing spaces. All providers/Auth/LLMs in route integration were local fixtures.
- Updated README and storage/scene documentation. No production migration, deployment, push, or scene writes performed. Preserved pre-existing Companion/expression-layer edits. Previous live Miss model/R2 verification remains valid.

## 2026-10-05 — Cursor/touch wind correction

- Replaced default Live2D pointer tracking with wind in `e8b5d3c`. The first implementation restarted its sine wave at every pointer event and guessed standard hair IDs; continuous movement was barely visible on the loaded artist model.
- `lib/model-wind.ts` now smooths pointer velocity into Cubism's actual physics wind before physics evaluation, so the artist's custom hair/clothing rig responds. Horizontal and vertical swipes decay smoothly after release. Supported body roll and standard hair parameters provide gentle sway/fallback without driving eye tracking or guessing custom parameters. Reduced Motion restores the original wind; model destruction removes pointer/frame listeners and restores the artist's wind settings.
- Localhost serves an existing temporary preview checkout at `/tmp/vivian-dev-bypass.RNjDUd`, not this source directory. Synced only the wind source changes there and reloaded the browser to verify the final version. Actual right/left drag gestures visibly move the loaded model's hair and outfit in opposite directions. Evidence: `/tmp/vivian-wind-right.png` and `/tmp/vivian-wind-left.png`. Physical touch/Safari behavior remains unverified.
- Passed all 18 model tests, including four wind regression tests, TypeScript, focused ESLint, and whitespace checks. Provider services and cloud memory were not used for regression tests. Existing expression-layer edits remain separate from this change.
