# Vivian AI Companion

Vivian is a mobile-first **Live2D AI companion** focused on natural conversation, voice interaction, long-term memory, vision, connected tools, and a shy, soft-spoken tsundere personality.

**Current app codename:** `Sandrome`  
**Production:** https://vivian-chan.vercel.app  
**Repository:** https://github.com/celestial-sora/ai-waifu  
**Primary branch:** `main`

> This README reflects the current implementation on `main` as of September 25, 2026.

## Run locally

Requires Git, Node.js, and npm.

```bash
git clone https://github.com/celestial-sora/ai-waifu.git
cd ai-waifu
npm ci
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` for the last command.

### Configure `.env.local`

Set `GROQ_API_KEY` for the primary chat provider. `CEREBRAS_API_KEY` and `GEMINI_API_KEY` provide chat fallbacks. Gemini is also needed for vision and Gemini-backed search.

Other features are optional:

| Feature | Environment variables |
| --- | --- |
| Persistent memory | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Memory extraction and context compression | `CEREBRAS_API_KEY` |
| Search and connected apps | `TAVILY_API_KEY`, `COMPOSIO_API_KEY` |
| JEV decision layer | `TYPESAFE_API_KEY` (alias `JEV_API_KEY`) |
| Speech input | `GROQ_API_KEY` (optional `GROQ_STT_MODEL`) |
| Speech output | `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICE_ID` (optional `FISH_AUDIO_MODEL`) |

Optional chat model overrides: `GROQ_MODEL` and `GEMINI_MODEL`. Keep keys in `.env.local`; never expose them through `NEXT_PUBLIC_*` or commit them.

### Private Google sign-in

Vivian now requires a verified Supabase Auth session before the companion or any chat, speech, memory, or Jev API can be used. Only `suphloeksangko@gmail.com` and `duckchan690@gmail.com` are authorized; the server checks the confirmed email returned by Supabase Auth. Other accounts are signed out after OAuth and denied access. Missing Auth configuration locks the app rather than bypassing login.

Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` and your hosting environment. A legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported. The public URL must refer to the same Supabase project as `SUPABASE_URL`. **Never use `SUPABASE_SERVICE_ROLE_KEY` as the public Auth key.** The admin key remains server-only for existing memory persistence.

1. Create a Google OAuth Web application client. Set its authorized redirect URI to the Supabase project's callback shown under Authentication → Sign In / Providers → Google (usually `https://<project-ref>.supabase.co/auth/v1/callback`). Put the Google client ID and secret in that provider's settings and enable it; they do not belong in the browser or repository.
2. In Supabase Authentication → URL Configuration, set Site URL to `https://vivian-chan.vercel.app`. Add `https://vivian-chan.vercel.app/auth/callback` and `http://localhost:3000/auth/callback` to Redirect URLs. Add exact callback URLs for any other intended development/deployment origins.
3. Allow new user signups for the first Google login of these accounts. The app allowlist controls access to Vivian; it does not prevent Supabase from creating an Auth record for a denied Google account. Supabase's OAuth access/refresh tokens for a denied account never authorize Vivian's APIs.
4. Keep RLS enabled on `conversations`, `messages`, `memories`, and `companion_state`, with no public read/write policies. Browser clients use Auth only; database operations go through the guarded server routes using the existing service-role client. Do not add blanket `anon` or `authenticated` table policies.
5. Sign in with each allowed Google account, check chat/memory/voice, test an unlisted account, then sign out via Menu → Settings. Direct API calls without a valid session must fail. Test expired sessions and iPhone/iPad Safari as well.

The two allowed accounts share Vivian's existing cloud memory and relationship state (`user_key = 'default'`); this change adds private access without migrating or separating existing data. Local chat history remains in the browser. Login uses a PKCE callback, cookie session refresh, server-side checks independent of Proxy, and same-origin mutation checks. If a session can no longer be refreshed, API responses take the browser back to login. Licensed models are cached locally and can sync to private, account-owned R2 storage when configured; binaries remain untracked and outside deployment bundles.

The Web client uses session cookies. Desktop/native integrations can send a Supabase access token as `Authorization: Bearer <token>` to the same APIs; the server verifies it with Supabase Auth and applies the same two-email allowlist. Those clients must implement Google sign-in and token refresh before using the secured backend; provider/admin keys must remain on the server.

Verification (Node.js 22.13+): `npm run test:auth`, then `npm run build && npm run test:auth:integration`. The integration suite runs local Next servers against a local Auth fixture and clears provider/admin credentials; it does not contact Google, live Supabase, or AI providers. Real Google login still needs to be tested after provider configuration. Rebuild after configuring public environment variables.

Setup references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).

### Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Allow microphone or camera access in your browser if you use those features. Press `Ctrl+C` to stop the server.

Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Current status

The project is now beyond a basic chat + Live2D prototype. The current build includes:

- Live2D Cubism 4 rendering with privately imported licensed models
- Proactive tsundere companion behavior with relationship state and conversational agency
- Fresh AI-generated greetings when the app opens or a new chat starts, with a local fallback when providers are unavailable
- Multi-provider LLM routing with fallback
- Persistent memories, editable memory management, and conversation history
- Voice input and voice output with lip sync
- Camera/image vision support
- Multi-language conversation and speech modes
- Web search and utility tools
- Connected-app tool execution through Composio
- Mobile/iPhone/iPad-oriented rendering, audio unlock, timeout handling, and orientation support
- API rate limiting and bounded provider timeouts

## AI / roleplay behavior

Vivian is not implemented as a stateless assistant. The companion maintains relationship and mood state across conversations.

Current companion state includes:

- `affinity`
- `trust`
- `familiarity`
- persistent mood + mood intensity
- compressed conversation summary
- last interaction / idle timestamps

Supported mood states currently include:

`calm`, `warm`, `playful`, `shy`, `tired`, `melancholy`, and `tsundere`.

The current personality system gives Vivian more conversational agency: she can initiate topics, tease, get flustered by praise, show care while pretending it is incidental, bring previous context back into the conversation, and continue a roleplay scene without always returning control to the user.

Vivian is a shy, polite, soft-spoken tsundere across chat, greetings, and vision: light playful denials, natural Thai slang, short conversational lines, occasional hesitation, and care through listening. Closeness changes how much warmth slips through; it does not replace this core personality. She softens her teasing when the user is upset or asks her to stop. Older stored mood values are normalized on read without deleting shared memory.

Thai replies use “หนู” for self-reference. Five user-provided dialogue references stay in `lib/vivian-dialogue.ts`: hot weather, morning greetings, teasing compliments, caring when ill, and a playful pout on return. Each provider request receives the shared voice guidance and one relevant scene, or a short general example, to keep input token usage lower. They guide shy hesitation, polite endings, and flustered denials according to context. Their example user name “ยูกิ” and scene details do not become user identity or remembered events; Vivian honors the user's chosen name and the active language setting. Illness calls for care rather than blame, and playful pouting does not require the user to report their whereabouts.

Her core backstory in `lib/vivian-story.ts` places her in an anime-style school, with a classroom window seat, an unfinished book, and a lunch box. Sorachan is her kind, femboy classmate in the fictional setting. Chat, greetings, and vision share this story. She normally addresses Sorachan as “โซระจัง” unless another name is requested. This fictional backstory survives memory resets; learned memories, past events, and relationship scores still start fresh. It does not grant knowledge of the user's real school or imply physical presence.

## LLM routing

Normal text chat currently uses this provider order:

1. **Groq** — default `openai/gpt-oss-120b`
2. **Cerebras** — `qwen-3.8-27b`
3. **Gemini** — default `gemini-2.5-flash`

Vision and search requests are routed through Gemini because they depend on Gemini-specific multimodal/search capabilities.

Groq requests use only the configured model before falling back to Cerebras and Gemini; a 429 or unavailable model does not trigger probes of unrelated Groq models. New-chat greetings request at most 120 output tokens, and other passive turns request 180. A casual Thai “วันนี้” does not force web search; explicit search wording and confident JEV fresh-information decisions still do. If Gemini search is unavailable, the UI reports that specific limitation while ordinary text chat remains available.

With `TYPESAFE_API_KEY` (or `JEV_API_KEY`), active chat makes one batched JEV decision request for fresh information, memory retrieval, vision relevance, supported local tools, integration preparation, broad intent, model class and response mode. Gemini is required only to act on fresh-information/vision routing. Explicit search and detected tools retain priority, and supplied images always keep vision routing. Fresh-information confidence must still be **>= 0.85**.

JEV makes probabilistic decisions; the Harness validates them and executes existing capabilities; the main LLM reasons, speaks and maintains Vivian's personality. JEV receives bounded message/recent-turn text and capability metadata, never the memory database, image data, relationship summary or persona. Low confidence keeps conservative defaults. Disabled JEV, failures, malformed results and the two-second timeout retain existing chat routing and memory preparation. Passive greetings/idle skip JEV.

Set `JEV_ENABLED=false` to disable the layer. Development logs status and elapsed milliseconds; `JEV_DEBUG=true` enables those metadata-only logs elsewhere. Normal production emits no JEV logs. Web Settings reads enabled/configured status through `GET /api/jev/status` without returning keys. Keep credentials server-side. Run `npm run test:jev` for decision/client and mocked chat integration regressions. See [the architecture audit and decision contract](docs/jev-decision-layer.md) for boundaries, thresholds, latency tradeoffs and future STT compatibility.

Background memory extraction and conversation-context compression use Cerebras when configured. `OPENROUTER_API_KEY` may remain in the environment for future use, but the app does not currently call OpenRouter.

### Search flow

Search-aware requests currently combine:

- **Tavily** retrieval for search context
- **Gemini Google Search grounding** for grounded search responses

Other built-in tools include:

- Current time/date in `Asia/Bangkok`
- Weather via Open-Meteo
- Calculator
- Memory retrieval

## Connected apps / Composio

Vivian has a Composio integration that can discover connected accounts, select relevant tools, and execute tool calls through supported connected services.

The current intent routing recognizes integrations such as:

- YouTube
- Discord
- Spotify
- GitHub
- Google Calendar
- Gmail
- Notion
- Slack
- Twitter / X

Available actions depend on the accounts and permissions actually connected to Composio.

## Vision

Vivian can receive visual context in two ways:

- Image/file attachment
- Live camera mode

The browser UI can capture camera frames and send them to the chat route for vision analysis. Live vision reactions are rate-limited/cooldown-controlled so the companion does not continuously spam requests.

## Voice

### Speech-to-text

Voice input uses **Groq Whisper Large V3 Turbo** by default. Set `GROQ_STT_MODEL=whisper-large-v3` to favor transcription accuracy over speed.

The selected language can be forwarded to STT to reduce incorrect language/script detection from background noise.

### Text-to-speech

Voice output uses **Fish Audio**.

The current TTS path includes:

- speech-speed control
- soft-spoken tsundere delivery cues for reserved conversation, mild teasing, shy replies, and gentle reassurance on Fish S2 models
- standard Central Thai pronunciation cues for Thai speech (no regional or Isan accent)
- stage-direction filtering so gestures such as `(หลบตา)` are not read aloud
- general word/syllable stammers across scripts, including `H-H-Hello`, `I- I- I'm`, and `ด- ด- เดี๋ยว`; interrupted Latin consonants use the following word's opening vowel, while every written attempt is retained
- Thai/English boundary cleanup
- MP3 output
- a 14-second upstream timeout covering headers and the complete audio body; timeouts return `504/TTS_TIMEOUT`, interrupted or empty audio returns `502/TTS_UPSTREAM`, and text chat still completes
- browser audio-unlock handling for Safari/iOS
- Live2D lip sync driven by playback amplitude

## Languages

The current UI supports these language modes:

- Global / automatic
- Thai
- English
- Japanese
- Korean
- Chinese

The selected language is used by the companion prompt and voice pipeline.

## Memory system

Memory is stored in Supabase PostgreSQL.

Current memory functionality includes:

- Load persistent memories
- Save/upsert memories
- Edit existing memories
- Delete individual memories
- Clear conversation history
- Load recent conversation messages
- Use the most relevant/recent memory context in prompts
- Update memory usage timestamps
- Extract durable memories from conversation when Cerebras is configured
- Compress older conversation turns into a compact conversation summary

Sensitive one-off information and secrets are explicitly excluded from automatic memory extraction.

## Live2D

Import your licensed Cubism model through **Character → Models → Import model ZIP** or **Choose folder**. Include the complete `.model3.json`, `.moc3`, textures, and any referenced expressions, motions, physics, pose, and sound files. ZIPs may include nested directories and multiple model manifests; use the Model / outfit selector to switch between them.

Models are validated and cached in IndexedDB on this browser and origin. When private R2 storage is configured, new imports also sync to an account-owned cloud library and can be loaded on another device. Existing local-only imports have a **Save this model to cloud** action. Clearing site data removes the cache; cloud originals remain until explicitly deleted. The limit is 512 MiB for both the archive and expanded package, and 3,000 files. Only local file references are accepted, and missing referenced assets are reported before saving. Model binaries stay outside GitHub and deployment bundles.

Expression buttons come from `FileReferences.Expressions`; Pose lists every entry in `FileReferences.Motions` by group and plays it on demand. The importer also discovers nearby `.exp3.json` and `.motion3.json` files when artists omit them from the manifest, preserving declared names/groups and excluding nested model folders. Undeclared motions use their folder group, `Idle`, or `Imported`. A `.pose3.json` controls part visibility and does not define selectable animations. Recognizable pose expressions (for example sitting or holding a bouquet) also appear in Pose, while remaining available in Expression. Common emotion names can also be matched to Vivian's mood; opaque expression names remain selectable manually. Models uses a supplied preview/thumbnail/icon/portrait/cover image when present (excluding texture atlases), otherwise captures the rendered model. Remove a package from Models to delete all its saved models from this browser.

Runtime:

- PixiJS `6.5.x`
- `pixi-live2d-display/cubism4`
- Cubism Core loaded before the client model runtime

The model includes multiple expressions and reacts to companion state / responses. Audio amplitude is mapped to mouth movement for lip sync.

The renderer includes mobile-specific resolution and performance handling, especially for iPhone/iPad Safari.

Models → Texture quality defaults to Auto. PNG atlas dimensions are inspected before decoding; GPU texture limits and an RGBA atlas budget (512 MiB desktop, 128 MiB mobile) determine the render size. Large textures are resized sequentially into temporary browser-only copies, with mipmaps disabled. Two 16,384px square atlases render at 8,192px on a compatible desktop or 4,096px under the mobile budget. Original textures remain unchanged in IndexedDB. Original quality bypasses the budget but rejects textures exceeding the device GPU limit; it can require substantially more memory. Render dimensions are shown when Auto adapts a model.

## Tech stack

- Next.js 16.3.3
- React 19.2.8
- TypeScript 5
- Tailwind CSS 4
- PixiJS 6.5
- pixi-live2d-display 0.4
- Supabase PostgreSQL
- Vercel

External AI/services currently used by the codebase include:

- Cerebras
- Groq
- Google Gemini
- Tavily
- Fish Audio
- Composio
- Open-Meteo

## Current limitations

The current production architecture is still a **personal single-user project** rather than a multi-user platform.

Notable limitations:

- Server-side persistence currently uses `userKey = "default"`.
- There is no full application-level multi-user authentication/authorization system yet.
- The avatar library is imported privately through Character; the backend character identity remains `Miss` for compatibility.
- Vision/search depend on Gemini availability.
- Connected-app capabilities depend on Composio account connections and their external permissions.
- In-memory rate-limit buckets are instance-local and are not a distributed rate-limit store.

## Privileged owner / agent policy

Repository automation and privileged agent workflows are intended only for the authorized contributor:

`celestial-sora`

For verified `celestial-sora`, project agents may use connected capabilities required for an explicitly requested task, including private project context, connected services, calendar context, and available computer/browser automation.

This is currently an **agent/repository authorization policy**, not a claim that the web application itself has implemented contributor-based authentication.

Private-data access for an owner-requested task does not automatically authorize publication or disclosure. Passwords, API keys, cookies, access tokens, service-role keys, recovery codes, and unrelated private information must not be committed, logged, or exposed.

## Development notes

- Keep PixiJS on v6 while using `pixi-live2d-display@0.4.0`.
- Keep Cubism Core loaded with `beforeInteractive`.
- Do not load Live2D on the server.
- Provider failures must not leave the UI permanently stuck in a thinking/speaking state.
- TTS or Live2D failures should not prevent text chat from completing.
- Preserve mobile Safari audio-unlock behavior when changing the voice pipeline.
- Keep API credentials server-side only.

## License / Live2D credit

Live2D Credit: **Cai Cat**

This repository contains a personal AI companion project and its application code. Model/assets may have separate usage terms from the source code.

## Project structure

```text
app/
  page.tsx              Server-side authentication gate
  companion.tsx         Client-side Live2D companion UI
  login/                Private Google sign-in screen
  auth/                 OAuth callback and sign-out handlers
  api/
    chat/               LLM routing, tools, vision, memory-context orchestration
    memory/             Memory + conversation CRUD
    stt/                Groq Whisper speech-to-text
    tts/                Fish Audio text-to-speech

lib/
  companion.ts          Relationship, mood and tsundere-agency state
  companion-store.ts    Companion-state persistence
  composio.ts           Connected-app tools
  models.ts             Live2D model configuration
  tools.ts              Search, weather, time, calculator, memory tools
  rate-limit.ts         API request throttling
  supabase-admin.ts     Server-side Supabase client

public/
  live2d/Miss/          Current Live2D model/assets
  backgrounds/          Day/night scene assets

supabase/
  migrations/           Database schema migrations
```

### Licensed model assets

The purchased Miss model is not distributed with this repository. Its model files, textures, expressions, physics, and configuration are excluded from version control. Import your own licensed copy through Character → Models; originals stay in browser storage or your private R2 bucket according to configuration. Without an imported model, text chat remains usable.

Do not commit model files or model archives. `.gitignore` does not restrict HTTP access: anything placed under `public/` is served publicly by Next.js. Do not include the purchased model in public deployments unless its license explicitly allows that distribution.

### After the Live2D history cleanup

All character model assets, including historical models, have been removed from Git history. The Cubism Core runtime remains tracked. A fresh clone can run text chat; import your own licensed model through Character → Models to enable the avatar. Model assets must remain untracked and must not be redistributed.

For an existing clone, copy your licensed `public/live2d/` model folders to a private directory outside the repository before changing Git history. Save any uncommitted source changes separately. Clone the cleaned repository into a new directory, install dependencies, then copy your licensed models back into its ignored `public/live2d/` directory. Keep the tracked Cubism Core runtime from the fresh clone. Confirm `git status --short` does not list model assets before committing.

Do not merge or push old branches/tags into the cleaned repository: that restores the removed history. Reapply source changes as patches, excluding model assets. Retire the old clone after preserving your source changes and licensed files. Rewriting this repository cannot erase copies previously downloaded by other people.

### Resetting Vivian

Settings → **Reset Vivian** permanently clears shared cloud memories, conversation history, the conversation summary, and companion relationship/mood state. It also clears this device's chats, check-in streak, idle timestamps, and custom instructions, then restores the initial companion scores. Imported models, voice/language preferences, and the login account are retained. Other devices retain their own local chat storage.

The authenticated `DELETE /api/memory` request with `{ "scope": "all" }` deletes only the existing shared `default` identity and verifies empty cloud results before acknowledging success. Partial failures can be retried; this device's history is cleared only after a confirmed server response.

## Dynamic scene backgrounds

Open **Scenes → Add Scene**, enter your own short label, then upload/drop a JPG, PNG, WebP or AVIF image (up to 8 MB) or paste an HTTP(S) image URL. Vivian validates and imports both sources into private storage: set `SCENE_STORAGE_PROVIDER=r2` for new R2-backed images; existing Supabase images remain readable. Edit labels, replace/delete images and apply scenes from their cards. **AI Auto Scene** is OFF by default; when ON, the existing batched JEV decision uses only your scene IDs and labels. Images are never analyzed or sent to a model.

Apply `supabase/migrations/20261003032056_dynamic_scenes.sql` to the existing Vivian Supabase project before using this feature. It adds account-owned scene/preferences tables, a cleanup queue and the private `vivian-scenes` bucket; existing shared memories remain unchanged. Existing server Supabase credentials are required for scene persistence. Legacy browser-only scenes can be re-added with an explicit user-written label.

Routes: `GET/POST /api/scenes`, `PATCH/DELETE /api/scenes/:id`, `GET /api/scenes/:id/image`, `POST /api/scenes/preview`, and `PATCH /api/scenes/preferences`. All routes authenticate independently, enforce account ownership and protect mutations against cross-site requests. See [Dynamic scene architecture, limits and testing](docs/dynamic-scenes.md). Run `npm run test:scenes` and, after a production build, `npm run test:scenes:integration`.

## Private Cloudflare R2 storage

The dedicated R2 Standard bucket has global hard limits of **8 decimal GB for Live2D** and **2 decimal GB for other files**, across all accounts. Models are limited to **512 MiB each**. SQL reserves quota before upload, includes pending uploads/failed deletions, and releases it only after remote cleanup. Scene images and thumbnails count toward the other-files budget. The Models panel shows current usage and supports cloud saving, on-demand loading and explicit deletion. Storage limits do not cap R2 request charges or usage in other buckets/services.

Routes: `GET/POST /api/models`, `GET/POST/DELETE /api/models/:id`, and `POST /api/models/:id/parts?first=1`. All authenticate independently and scope files to their owner. Large binaries transfer directly to private R2 through expiring, size-bound multipart URLs; Supabase continues to store Auth and metadata. Follow [R2 configuration, quotas and recovery](docs/private-r2-storage.md) before enabling cloud storage. Run `npm run test:storage` and `npm run test:storage:postgres` for the mocked storage and real local PostgreSQL suites.

**Menu → Status** replaces Gallery and shows storage usage, capacity and percentage for Supabase and R2, plus the 8 GB / 2 GB R2 split. `GET /api/storage/status` refreshes every five seconds while the panel is visible and after uploads/deletions. Supabase reads actual Storage metadata; R2 reads object and incomplete-upload sizes directly from the bucket with full pagination. Quota committed also includes outstanding app reservations. Every new R2 upload checks live bucket usage before reserving space, including files outside the ledger; failed checks block uploads. Supabase file capacity defaults to 1 GB; set `SUPABASE_STORAGE_LIMIT_BYTES` for another plan. Unavailable providers are shown explicitly, without inventing zero usage.
