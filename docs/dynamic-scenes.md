# User-managed Dynamic Scene Backgrounds

Scene meaning comes exclusively from the user's 1–50 character label. Images are presentation assets. The backend never captions, classifies, embeds or sends scene images to any model.

## Architecture and changed files

- `lib/custom-scenes.ts`: removed the obsolete browser-only implementation; existing IndexedDB data is left intact.
- `lib/scenes.ts`: shared scene/presentation contracts, label/ID validation and limits.
- `lib/scene-images.ts`: bounded upload parsing, secure HTTP(S) import, real raster decoding and WebP/thumbnail conversion.
- `lib/scene-store.ts`: account-scoped Supabase persistence, object storage, preferences, deferred cleanup and validated execution.
- `lib/scene-api.ts`, `app/api/scenes/**`: authenticated and rate-limited library/create/update/delete, image, preview and preference routes.
- `lib/auth/server.ts`: optional success callback exposes the already-verified account to a route; scene loading introduces no second Auth request.
- `lib/jev.ts`, `lib/chat-decision.ts`, `app/api/chat/route.ts`: optional scene probabilities in the existing batch, structured scene decision, Harness validation and normal chat JSON delivery.
- `lib/use-scene-library.ts`, `app/components/scene-manager.tsx`, `app/components/scene-background.tsx`, `app/companion.tsx`, `app/globals.css`: persistent library/settings, native floating panel, user input/previews/cards/actions and preloaded crossfade.
- `supabase/migrations/20261003032056_dynamic_scenes.sql`: database and private storage setup.
- `tests/scenes.test.mjs`, `tests/scenes.integration.test.mjs`, `tests/scene-module-loader.mjs`, `tests/scene-fixture.mjs`, `tests/scene-upstream-fixture.mjs`: image/security/service/route regression fixtures and tests. Existing JEV/Auth suites are extended; the Auth fixture gives the two permitted test accounts distinct IDs.
- `package.json`, `package-lock.json`: explicit pinned Sharp dependency (already used transitively by Next), small `ipaddr.js` parser and scene test scripts.
- `README.md`, `handoff.md`: setup and verification notes.

## Database and storage

Apply the migration to **Vivian's existing Supabase project** before deploying this feature. Existing `SUPABASE_URL` / server-only `SUPABASE_SERVICE_ROLE_KEY` and public Auth configuration suffice. No new secret is required.

`vivian_scenes` stores UUID IDs, actual Auth user UUIDs, labels, generated object keys, source type and timestamps. `vivian_scene_preferences` stores Auto Scene (default OFF), current scene, optional built-in day/night preset and a revision UUID. A composite ownership foreign key rejects cross-account selections and clears the current scene atomically on deletion. The library is limited to 50 scenes per user, including a database trigger for concurrent inserts.

RLS limits authenticated reads to the owner. Direct authenticated/anonymous writes are revoked: all mutations pass through Vivian's allowlist, same-origin checks and server validation. Service-role queries still explicitly filter by user ID. These tables are separate from the existing intentionally shared `default` memory/relationship identity.

The private `vivian-scenes` bucket holds `<user UUID>/<random UUID>.<jpg|png|webp|avif>` and its `.thumb.webp` thumbnail. No public Storage policies or permanent external hotlinks are used. Image routes authenticate and check ownership before reading objects; their responses are private and must revalidate, varying on Cookie/Authorization. Labels and presentation URLs are returned to the client, while storage keys and source URLs are omitted.

Creation uploads both objects before inserting a scene row. Replacement uses a new object key and checks the prior key before committing. Database triggers queue replaced/deleted objects in `vivian_scene_image_gc`; staging uploads are queued before writing storage. Best-effort immediate deletion removes objects normally. After a failure, subsequent scene library/mutation requests retry unreferenced queued objects older than one hour. References are checked first to handle uncertain commits safely. This is request-driven cleanup, not a scheduled global sweeper; long-unused/deleted accounts may need an operational service-role cleanup job.

## Image security and limits

- JPG, PNG, WebP and AVIF only; 8 MiB maximum input and bounded actual request/download streams.
- Reject non-image/mismatched content, SVG, animation, excessive dimensions (12,000 per side / 40 million pixels), invalid/truncated content and unsupported compression.
- Sharp validates and fully decodes the raster, then preserves the exact original bytes, resolution and source MIME type (including original metadata). Only the 480×300 WebP thumbnail is oriented, resized and stripped of metadata (quality 72). Generated keys use the validated image format; never trust user filenames. Existing previously compressed scenes must be replaced using their original source to recover full resolution.
- URL imports accept HTTP(S), ports 80/443, no embedded credentials, 2048-character URL limit, 10-second total fetch deadline and at most three redirects.
- IP range parsing rejects loopback, private, link-local, carrier NAT, metadata, multicast, reserved/documentation and IPv4-mapped private addresses. IPv6 must be public global unicast. Internal hostnames and Azure's platform virtual IP are rejected.
- Resolve every DNS answer and reject the host if any answer is non-public. Pin the socket lookup to an approved address with an explicit address family; validate every redirect again. No source cookies, authorization, proxy credentials or ambient request headers are forwarded.

## Frontend behavior

Scenes and Gallery use the existing floating workspace, typography, colors and responsive sizing. Add Scene has a required empty label input, upload/drop zone or URL input, preview, cancel, saving state and actionable errors. File previews use revocable local Blob URLs; URL previews come from the backend's validated/re-encoded bytes and never create scene records. Saving a URL imports it into private storage.

Cards show lazy-loaded thumbnails, label, active state and menus for apply/edit label/replace/delete. Selecting preloads before updating preferences; the background retains its previous loaded layer until a new layer can fade in. Failed loads retain the prior scene/default. Reduced-motion users get an immediate swap after preload. After library load, the active full-resolution image is preloaded first, followed by other scenes and built-in presets one at a time at low fetch priority. Each preload waits for image decoding, is reused by selection/crossfade, and retries after failures. Retained decoded-image references use a 64 MiB LRU budget (the latest single image may exceed it); older images can be reloaded when selected. Unmount/library changes stop queued warming without interrupting an image shared with selection. The built-in day/night presets remain available, and deleting an active custom scene restores a default.

Legacy device-only IndexedDB scenes are not silently uploaded or assigned labels: re-add an image and explicitly write its meaning in the new library. The old IndexedDB data is not deleted.

## JEV and Harness contract

The established System One `noul` format remains unchanged. When Auto Scene is ON, the backend loads only owned scene IDs/labels and preferences under a 600 ms total storage deadline. The adapter projects only `{id,label}` into `availableScenes`; neither images, source URLs, private image URLs nor storage paths enter JEV. The active scene is excluded from candidates. Each candidate adds one compact probability question to the **same** `jev-latest` request. There is no additional model call, vision operation or metadata generation.

The adapter converts probabilities to `{change:true,id}` only when the highest score is at least 0.85 and exceeds the runner-up by at least 0.1. Otherwise (including missing/malformed optional scene answers) it returns `{change:false}` while preserving other valid decisions. Scene questions are omitted entirely when Auto Scene is OFF. Passive greeting/idle modes do not select scenes. Disabled/unconfigured JEV also bypasses scene context loading.

The Harness checks schema, enabled mode, offered ID, active ID and account ownership. After normal conversation generation succeeds, execution rechecks the row and object availability using Storage `info`, then atomically updates the selection only if Auto Scene is still ON and the saved preference revision matches the turn's snapshot. Manual selection/toggle changes or concurrent turns invalidate stale proposals. Execution has a separate 600 ms deadline. Scene errors return no change and never invalidate a conversation reply.

The existing chat JSON adds `scene: {change:false}` or `scene: {change:true,id}` beside `text`. The frontend resolves the saved ID, preloads and renders it; JEV/Harness never manipulate DOM. Frontend request generations also prevent late proposals from overriding a more recent manual action.

## Tests

```sh
npm ci
npm run test:scenes
npm run test:jev
npm run build
npm run test:scenes:integration
npm run test:auth:integration
npx tsc --noEmit
npm run lint
```

Existing speech, TTS, model, reset, companion and Auth unit suites remain relevant. Integration tests start production Next servers against local Auth/REST/Storage fixtures. Public image-source DNS/HTTP and JEV/Groq upstreams are simulated in that test subprocess; the actual URL validator, image decoder, routes and chat execution run. No live users, memories or model providers are contacted. Ownership is tested through service tests, route tests with foreign-account IDs, Auth integration, and local migration/RLS validation.

Live Supabase Storage, Google login, JEV accuracy/cost/latency and public Internet import reliability still need deployment-environment validation. Browser viewport checks establish responsive Web behavior, not physical iPhone/Android certification. The feature's new modules lint cleanly; legacy companion/chat and bundled Live2D lint findings are tracked separately and have not been suppressed.

## Verification recorded for this implementation

Clean install and 116 unit tests pass, as do type checking and production build. The five scene route integration tests and six expanded Auth integration tests pass. Local PostgreSQL/PGlite checks validate the migration, RLS, cross-account FK rejection, mutation grants, count limit and cleanup/deletion triggers.

Chromium checks at 1440×900, 390×844 and 844×390 exercised actual upload, backend URL preview/import with simulated public source, mobile drop, editing/replacement, manual selection, persistence, Auto OFF/ON, active deletion, image-load failure/retry and day/night toggles. No horizontal overflow, framework overlay or uncaught JavaScript errors occurred in the workflow. An ordinary chat turn with no scene change made no additional background download.

New scene modules/tests lint cleanly. Full repository lint currently fails with 24 pre-existing errors and 309 warnings; the original and changed legacy files have identical lint counts (19 errors, 10 warnings). No rules or existing tests were weakened. Production services and physical mobile devices were not verified; no migration or deployment was run against production.
