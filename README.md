# Vivian AI Companion

Meet Vivian, a sharp-tongued tsundere AI companion with her own agenda (˶ᵔ ᵕ ᵔ˶). She chats, teases, gets jealous, remembers things, sees shared pictures, and may refuse even the easiest question simply because she feels like it.

- **Live app:** [vivian-chan.vercel.app](https://vivian-chan.vercel.app)
- **Source code:** [github.com/celestial-sora/ai-waifu](https://github.com/celestial-sora/ai-waifu)
- **Built with:** Next.js, React, TypeScript, Supabase, and PixiJS

## Get her running ✨

You’ll need Git, Node.js 22.13 or newer, and npm. Then pop open a terminal and run:

```bash
git clone https://github.com/celestial-sora/ai-waifu.git
cd ai-waifu
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and say hi 💜 On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

## Set up services

Add service keys to `.env.local` to wake up the features you want. See [.env.example](.env.example) for the full list and defaults.

| Service | Environment variables |
| --- | --- |
| Chat | `GROQ_API_KEY` (required); `CEREBRAS_API_KEY` and `GEMINI_API_KEY` are fallbacks |
| Sign-in | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Cloud memory | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Voice input | `GROQ_API_KEY` |
| Voice output | `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICE_ID` |
| Search | `GEMINI_API_KEY`; optional `TAVILY_API_KEY` |
| JEV decisions | `TYPESAFE_API_KEY` or `JEV_API_KEY` |
| Cloud models and backgrounds | Optional Cloudflare R2 setup; see [R2 guide](docs/private-r2-storage.md) |

Tiny but important: keep secret keys in server-side environment variables. Never put provider, service-role, or R2 secrets in variables starting with `NEXT_PUBLIC_` (｡•́︿•̀｡)

## Sign-in & privacy 🔒

Sign-in uses Google through Supabase. The app is limited to two verified accounts: `nicetry@gmail.com` and `goodluck@gmail.com`. Configure Google sign-in and the Supabase URL and publishable key before using the app. Set the Supabase Site URL to `https://vivian-chan.vercel.app` and allow the app's `/auth/callback` URL for production and local development.

Both accounts share the same cloud memories and companion relationship state. Chat history syncs through Supabase across devices, with a browser cache for unsynced messages. Imported Live2D models stay in that browser unless you choose to save them to private cloud storage.

**Menu → Settings** includes sign-out and **Reset Vivian**. Reset clears shared cloud memories, conversation history, and relationship state, along with this device's chat history and local settings. It keeps imported models and does not sign you out.

Keep row-level security (RLS) enabled on Supabase memory tables, with no public read or write policies. The server checks account access before handling protected requests.

## What Vivian gets up to ♡

- **Chat on her terms:** Groq → Cerebras → Gemini provide the language engine, but Vivian is intentionally not a general-purpose assistant. She can answer, tease, dodge, give half an answer, or refuse.
- **Chat history:** Conversations and messages sync through Supabase across devices under the existing shared companion identity. Local copies retain unsynced messages during outages. Existing device history is imported with stable IDs to prevent duplicates. Apply `supabase/migrations/20261006005533_cloud_conversation_history.sql` before deploying this feature.
- **Remember:** Keeps durable relationship-relevant details and mood state. Secrets and sensitive one-off details aren’t saved automatically.
- **Know things:** Search, Bangkok time/weather, calculation, and memory tools can give Vivian context. Tool results are knowledge, not an obligation to tell you the answer.
- **See pictures:** Send an image or camera frame for Gemini to understand.
- **Talk:** ElevenLabs Scribe v2 handles speech input (set `ELEVENLABS_API_KEY`); the mic waits for 2.5 seconds of silence before sending; Fish Audio makes speech output. Vivian’s avatar lip-syncs while she talks. If voice or Live2D has a bad hair day, text chat still works.
- **Personality:** Vivian uses a compiled hersona `tsundere / strong` persona across dialogue providers. She can refuse ordinary questions, including introductions, without revealing the answer in the same turn. Custom instructions adjust her conversation preferences and apply to the next text or microphone turn.
- **Chat in your language:** Automatic, Thai, English, Japanese, Korean, and Chinese.
- **Set the scene:** Add your own labeled backgrounds. Scene images stay private and aren’t analyzed by AI.

External app actions are currently unavailable. MCP servers have not been connected yet.

### A little extra smarts: JEV

JEV is an optional decision service. It decides when fresh information, memory, supported tools, or an automatic scene may be relevant; it never decides that Vivian owes the user a useful answer. Vivian's main language model still writes the conversation. JEV receives a small amount of recent chat text and feature availability, not stored memories, images, audio, or secret keys. If JEV is unavailable, chat uses its regular routing. See [JEV architecture](docs/jev-decision-layer.md).

## Give Vivian a look ✨

Import a model you’re licensed to use from **Character → Models**. Choose a ZIP file or folder with the model manifest and all referenced files. Vivian supports Cubism 4 models and packages with multiple outfits—cute outfit changes included (｡˃ ᵕ ˂ ).

Models are checked and stored in the browser. You can optionally save them to private R2 storage to use them on another device. Each model archive and expanded package must be 512 MiB or smaller. Without a model, text chat still works.

Model files are not included in Git or the deployment. Do not put licensed models under `public/`; files in that folder can be accessed publicly.

## Make her space yours 🌷

Add a scene in **Scenes** with a short label and a JPG, PNG, WebP, or AVIF image, or import an image from an HTTP(S) URL. Vivian uses the label to identify the scene; it does not inspect the image. **AI Auto Scene** is off by default.

Scenes need the migration `20261003032056_dynamic_scenes.sql` applied to Vivian's Supabase project. See [Dynamic scenes](docs/dynamic-scenes.md) for details.

Cloudflare R2 is optional. It stores private model packages and new scene images. The shared storage limit is 8 GB, with 2 GB held back as a buffer. The app's **Menu → Status** panel shows storage use. Follow the [R2 setup guide](docs/private-r2-storage.md) before enabling it. Existing Supabase scene images remain available.

## Main API routes

All protected routes check sign-in and account access.

| Route | What it does |
| --- | --- |
| `/api/chat` | Chat, search, image understanding, and tools |
| `/api/conversations` | GET paginated shared conversations/messages; PUT validated, idempotent message batches |
| `/api/memory` | Read and manage memories and conversation data |
| `/api/stt` | Convert speech to text |
| `/api/tts` | Generate speech audio |
| `/api/scenes/*` | Manage backgrounds |
| `/api/models/*` | Manage private Live2D models |
| `/api/storage/status` | Show storage use |
| `/api/jev/status` | Show whether JEV is configured |

## Developer corner 🛠️

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Run feature tests with scripts such as `npm run test:auth`, `npm run test:jev`, `npm run test:models`, `npm run test:scenes`, and `npm run test:storage`. Some integration tests need local fixtures or PostgreSQL; check the relevant docs first. Do not point tests at production data.

## Project folders

- `app/` — Pages, sign-in flow, and API routes
- `lib/` — Chat, memory, authentication, Live2D, and storage logic
- `supabase/migrations/` — Database changes
- `docs/` — Setup and architecture guides

## Technical notes

- Live2D uses PixiJS 6 and `pixi-live2d-display/cubism4`. Keep PixiJS on version 6.
- Load Live2D in the browser only; Cubism Core must load before the model.
- Keep provider credentials and service-role keys on the server.
- Keep the two-account access allowlist on the server.
- Optional services can fail without stopping text chat.

## License and assets

This repository contains Vivian's application code. Models and other assets may have separate license terms. Live2D credit: **sorachan**. Make sure a model's license allows your intended use and private cloud storage.
