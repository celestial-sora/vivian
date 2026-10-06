# Vivian AI Companion — Agent & Development Rules

## 🤖 Agent Customization & Workflow

This document provides instructions for AI agents (GitHub Copilot, Claude, etc.) working on the Vivian project.

---

## 📋 Project Context

**Project:** Vivian AI Companion  
**Stack:** Next.js 16.3.3 + React 19 + TypeScript + Tailwind CSS v4  
**Architecture:** Shared Vivian backend/AI systems with separate Web, Desktop, iOS, and Android clients  
**Database:** Supabase PostgreSQL (optional, gracefully degraded if unavailable)  
**Deployment:** Vercel for Web; native mobile build/distribution is branch-specific  

### Active platform branches
- `main` — Vivian Web App / production source of truth
- `feature/desktop-pet-local` — Vivian Desktop Pet
- `feature/native-ios` — Native iOS client
- `feature/native-android` — Native Android client

### Native mobile rules
- iOS and Android must reuse Vivian's existing backend, AI, memory, chat, voice, and account contracts where practical.
- Do not turn either native app into a WebView wrapper of the website.
- Keep platform-specific UI and OS integrations inside their respective native branches.
- Preserve one shared Vivian identity and cloud memory across Web, Desktop, iOS, and Android.
- Never duplicate or expose provider API keys in native client code.

### Store release targets

#### iOS
- Branch: `feature/native-ios`
- Bundle ID: `com.celestialsora.vivian`
- Distribution stages: Development → TestFlight → App Store
- Keep signing certificates, provisioning profiles, and App Store credentials out of the repository.
- Configure native permission descriptions for microphone, camera, photos, notifications, and background audio only when those capabilities are used.
- App Privacy disclosures must match the actual data collected by Vivian and all third-party SDKs.

#### Android
- Branch: `feature/native-android`
- Package name: `com.celestialsora.vivian`
- Distribution stages: Internal Testing → Closed Testing → Google Play Production
- Release artifacts must be signed Android App Bundles (`.aab`) for Play distribution.
- Keep keystores, signing passwords, service-account credentials, and Play Console secrets out of the repository.
- Data Safety declarations and runtime permissions must match the actual app behavior.

#### Shared store release rules
- Privacy Policy and Terms of Service are required before public store release.
- Users must have a clear way to delete their Vivian account and associated cloud data when account creation is supported.
- Never embed OpenRouter, Gemini, ElevenLabs, Fish Audio, Supabase service-role, or any other privileged provider secret in iOS or Android binaries.
- Native clients call Vivian's secured backend over HTTPS; provider credentials remain server-side.
- Store metadata, screenshots, age/content ratings, privacy disclosures, and permission descriptions must be reviewed before submission.
- Keep Vivian memory identity shared across Web, Desktop, iOS, and Android unless a platform-specific privacy constraint requires otherwise.
- Test voice, camera/vision, notifications, auth, memory sync, account deletion, and degraded-network behavior before every store release.

---

## 🎯 Key Constraints & Requirements

### Live2D Graphics System
```typescript
// ✅ CORRECT — Cubism 4 support
import { Container } from "pixi-live2d-display/cubism4";
import { Application } from "pixi.js";  // v6.x ONLY

// ❌ WRONG — Cubism 2 (will fail)
import { Container } from "pixi-live2d-display";
```

**Must-Haves:**
1. `pixi.js@^6.5.10` (NOT v7+)
2. Cubism Core runtime loaded via `<Script strategy="beforeInteractive">` in `layout.tsx`
3. Dynamic import of Live2D display (client-side only)
4. Canvas ref for PIXI.Application

### API Routes

#### `/api/chat` — LLM Proxy
- **Input:** `{ messages: ChatMessage[], userId?: string }`
- **Behavior:**
  - Try Groq first for normal text chat
  - Fall back to Cerebras, then Gemini when configured
  - Detect search intents ("search", "news", "latest", etc.) → use Gemini + google_search tool
- **Output:** `{ content: string, sources?: { title, url }[] }`
- **Side Effects:**
  - Logs to Supabase `conversations` + `messages` tables
  - May extract memories and save to Supabase `memories` table

#### `/api/memory` — Memory CRUD
- **GET:** Fetch all memories + last 100 messages
- **POST:** `{ memory: string, category?: string, importance?: 1-5 }` → upsert
- **DELETE:** `{ id?: number, clearAll?: boolean }` → remove
- **Graceful degradation:** Return empty arrays if Supabase unavailable

#### `/api/stt` — Speech-to-Text
- **Input:** FormData with audio file (wav, mp3, webm)
- **Output:** `{ text: string }`
- **API:** ElevenLabs Scribe v2 with `language_code: "tha"`

#### `/api/tts` — Text-to-Speech
- **Input:** `{ text: string }`
- **Output:** audio/mp3 stream (binary)
- **API:** Fish Audio with prosody: speed=0.95, volume=0, loudness_norm=true

### Environment Variables

**Required:**
- `GROQ_API_KEY` — Primary LLM provider

**Optional but Important:**
- `CEREBRAS_API_KEY` — Text chat fallback
- `GEMINI_API_KEY` — Fallback LLM + vision and web search capability
- `OPENROUTER_API_KEY` — Background memory extraction and conversation compression
- `ELEVENLABS_API_KEY` — Speech-to-Text
- `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICE_ID` — Text-to-Speech
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Memory persistence

---

## 🛠️ Common Development Tasks

### Deployment Workflow
- After every completed code change, run a production deployment with `vercel --prod`.
- Confirm the deployment reaches `READY` and the configured production alias is available.

### Adding a New API Route
1. Create file at `app/api/[feature]/route.ts`
2. Export `POST`, `GET`, `DELETE` functions as needed
3. Use Supabase admin client from `lib/supabase-admin.ts` for DB access
4. Always handle missing environment variables gracefully (return error object with status, don't throw)
5. Add the route description to [README.md](README.md) when it affects public setup or behavior

### Updating Chat Intelligence
**Location:** `app/api/chat/route.ts`

- **System Prompt:** Inject personality + memory context
- **Memory Loading:** Fetch top 8 memories before sending to LLM
- **Search Detection:** Regex patterns in `searchKeywords` array
- **Provider Logic:** Modify the provider blocks in `app/api/chat/route.ts` to adjust fallback order

### Implementing New Live2D Animations
**Location:** `app/companion.tsx` (client component); `app/page.tsx` verifies authentication before rendering it.

```typescript
// Set expression
model.setExpression("happy");  // or "sad", "surprised", etc.

// Animate parameter
model.setParameterValueById("ParamMouthOpenY", 0.8);  // 0-1 range

// Reset expression
model.setExpression(null);
```

**Available Parameters:**
- `ParamMouthOpenY` — Mouth opening (for lip-sync)
- Expression IDs: See model manifest (witch.model3.json)

### Testing Voice Features
1. Record audio via `MediaRecorder` API
2. POST to `/api/stt` with audio blob
3. Display transcript in chat
4. POST to `/api/tts` with AI response text
5. Trigger lip-sync on audio playback via frequency analysis

---

## 🚫 Anti-Patterns & Things to Avoid

### ❌ Don't

1. **Upgrade PixiJS to v7+**
   ```typescript
   // ❌ WRONG
   "pixi.js": "^7.4.2"
   ```
   Breaks `pixi-live2d-display@0.4.0` compatibility.

2. **Forget Cubism Core preload**
   ```tsx
   // ❌ WRONG
   <Script src="/live2d/live2dcubismcore.min.js" />
   
   // ✅ CORRECT
   <Script src="/live2d/live2dcubismcore.min.js" strategy="beforeInteractive" />
   ```

3. **Use wrong import path for Live2D**
   ```typescript
   // ❌ WRONG
   import { Container } from "pixi-live2d-display";
   
   // ✅ CORRECT
   import { Container } from "pixi-live2d-display/cubism4";
   ```

4. **Forget graceful API degradation**
   ```typescript
   // ❌ WRONG
   const user = await supabase.from("users").select();
   
   // ✅ CORRECT
   const user = await supabase?.from("users").select() ?? null;
   ```

5. **Load Live2D model on server**
   ```typescript
   // ❌ WRONG
   export default async function Page() {
     const model = await loadLive2D();  // ← Server-side
   }
   
   // ✅ CORRECT
   "use client";
   export default function Page() {
     useEffect(() => {
       const model = loadLive2D();  // ← Client-side only
     }, []);
   }
   ```

6. **Expose API keys in client code**
   ```typescript
   // ❌ WRONG
   const response = await fetch(`https://api.openrouter.ai/...?key=${process.env.OPENROUTER_API_KEY}`);
   
   // ✅ CORRECT
   const response = await fetch("/api/chat", { method: "POST", body });
   // API key used only in `app/api/chat/route.ts` (server-side)
   ```

7. **Forget error boundaries for async operations**
   ```typescript
   // ❌ WRONG
   const text = await speechToText(audio);
   setMessages([...messages, { role: "user", content: text }]);
   
   // ✅ CORRECT
   try {
     const text = await speechToText(audio);
     setMessages([...messages, { role: "user", content: text }]);
   } catch (err) {
     console.error("STT failed:", err);
     setError("Could not transcribe audio");
   }
   ```

---

## ✅ Code Quality Standards

### TypeScript
- Use `strict: true` in `tsconfig.json`
- Prefer interfaces over types for object shapes
- Always type function parameters and return values
- Use discriminated unions for API responses

### React
- Prefer functional components with hooks
- Use `useCallback` to memoize event handlers
- Use `useEffect` with proper dependency arrays
- Avoid prop drilling; use context for global state (if needed)

### CSS
- Use Tailwind classes first, custom CSS only when necessary
- Keep responsive breakpoints consistent (mobile-first approach)
- Define custom colors/spacing in `tailwind.config.ts` if needed

### API Routes
- Always validate request body with type guards
- Return consistent error format: `{ error: string, status: number }`
- Use HTTP status codes correctly (400 bad request, 500 server error, etc.)
- Log important operations for debugging

---

## 📚 File Navigation Guide

| File | Purpose | Edit Frequency |
|------|---------|----------------|
| `app/page.tsx` | Server-side authentication gate | Low |
| `app/companion.tsx` | Main UI component (chat + Live2D) | High |
| `app/api/chat/route.ts` | LLM routing logic | High |
| `app/layout.tsx` | Root layout (Cubism Core loader) | Low |
| `app/globals.css` | Styling | Medium |
| `lib/supabase-admin.ts` | Database client | Low |
| `public/live2d/` | Live2D assets | Low |
| `package.json` | Dependencies | Low |

---

## 🔍 Debugging Tips

### Live2D Model Won't Load
1. Check browser console for errors
2. Verify `window.Live2DCubismCore` is defined (Cubism Core loaded?)
3. Check that `witch.model3.json` points to correct texture folder
4. Verify model file path is correct in `lib/models.ts` and `app/companion.tsx`

### API Keys Not Working
1. Check environment variables are set on Vercel
2. Test API key directly in terminal (not via app)
3. Check API usage quota/limits on provider dashboard
4. Verify request format matches provider docs

---

## Cursor Handoff — Current State (2026-09-02)

This section is the current source of truth for continuing work. Read it before changing the app.

### Product identity

- Product: Vivian Personal Project
- Character: Vivian
- Codename: Columbina
- Production URL: https://vivian-chan.vercel.app
- Repository: https://github.com/celestial-sora/ai-waifu
- Git branches: `main` (Web), `feature/desktop-pet-local` (Desktop), `feature/native-ios` (iOS), `feature/native-android` (Android)
- Latest committed version: `6808570` (`feat: auto-capture camera frame on vision queries, prioritize Gemini for image recognition, and scrub meta system phrases`)
- Latest production deployment: `Ready in 41s (https://vivian-chan.vercel.app)`

### Actual runtime flow

0. A new conversation requests `mode: "greeting"` from `/api/chat`, using recent turns from the previous local session and durable memory to compose a fresh welcome. Reopening an existing conversation does not replace its messages. Idle greetings use recent turns from the current session. Greetings do not alter cloud relationship state or write cloud history. If welcome generation fails, the client uses a short local greeting. An in-flight welcome is cancelled when the user sends a message or switches conversations.
1. User types or holds the microphone button.
2. Microphone audio is sent to `POST /api/stt`.
3. The transcript is shown in the STT preview bubble and auto-submitted to `POST /api/chat`.
4. `/api/chat` loads durable memory from Supabase, then calls Groq as the primary LLM for normal text chat.
5. If Groq fails or times out, `/api/chat` falls back to Cerebras and then Gemini when configured.
6. Provider requests have a 25-second timeout; the browser chat request has a 35-second timeout.
7. The response is sent to `POST /api/tts` using Fish Audio.
8. The UI waits for audio playback to start, then shows Vivian's response bubble so text and speech are synchronized.
9. Audio amplitude drives `ParamMouthOpenY`; the reply also drives Live2D expression/motion mapping.
10. Conversation messages and durable memories are persisted through Supabase when available.

### Current known issue / test target

- Test the complete STT → chat → TTS flow on iPhone/iPad Safari, especially the first audio response and provider timeout behavior.
- Vercel logs previously showed `/api/tts` status 200 while the first browser playback was silent. The client now serializes Safari audio unlock and real playback to avoid that race.
- If chat remains on `thinking`, inspect `/api/chat` duration and status in Vercel logs. It should now terminate within the configured timeouts rather than hang indefinitely.

### Current UI direction

- Full-screen Live2D companion UI optimized for iPhone/iPad portrait and landscape.
- Keep the bottom input pill and full-screen scene. Vivian's speech and STT preview are frameless text above the composer; each new line rises and sharpens into view. Thinking uses animated text/dots, with reduced-motion support. The menu opens as a floating overlay without resizing the scene.
- Latest UI polish adds smoother hover/active transitions, SVG feedback, focus glow, and the Memory icon.
- Keep the purple witch model and existing layout direction. Do not replace the model or redesign the structure without explicit approval.
- On orientation change, Live2D re-measures the real stage bounds, resizes the renderer for device pixel ratio, and re-centers the model.

### Live2D facts that must not be changed casually

- Purchased model assets remain excluded from Git and deployment bundles. Character → Models validates licensed ZIPs/folders and caches originals in IndexedDB via `lib/local-models.ts`. When R2 is configured, user-authorized private cloud sync uses `lib/cloud-models.ts`; see `docs/private-r2-storage.md`. The global hard quotas are 8 decimal GB for Live2D and 2 decimal GB for other R2 files, including pending/deleting objects. Per-model archive and expanded limits remain 512 MiB.
- `app/companion.tsx` reads imported manifests and discovers undeclared `.exp3.json`/`.motion3.json` files for expressions and motion groups, resolves every runtime file to a revocable local Blob URL, and supports multiple manifests/outfits per package. No bundled model is required for text chat.
- Preview images use supplied preview/icon/thumbnail files, excluding texture atlases; models without one get a renderer snapshot. All model URLs are released on switching/unmount.
- `lib/model-textures.ts` plans atlas sizes against GPU limits and a 128 MiB desktop / 64 MiB mobile RGBA budget. Auto remains the default, keeps original dimensions when they fit, and caps atlases at 4096px. PNGs over 4096² pixels are downsampled by bounded scanlines with area filtering and premultiplied alpha in `lib/png-render-copy.ts`; do not send huge source atlases to native image decoders or skip pixels when downsizing. Large interlaced/16-bit PNGs fail with an actionable message. Original quality must respect both GPU and memory limits. Originals stay unchanged. The IndexedDB v2 catalog loads metadata first; every rendering entry point must hydrate the selected package before creating model resources. Retain the v1 migration and reject saving catalog-only entries over originals. An interrupted-load breadcrumb pauses automatic model loading on the next session reload. Recognizable pose expressions also appear in Pose.
- Runtime import remains `pixi-live2d-display/cubism4` with PixiJS 6. Cubism Core must load before the model runtime.
- Safari may retain IndexedDB Blob handles with missing backing objects after a crash. `hydrateModelPackage` probes small slices and uses one authorized cloud recovery for `NotFoundError` / missing Blob errors. Use `availableModelPackage` at startup, selection and rendering; keep unrelated errors visible, preserve local-only originals, and update in-memory handles after recovery.
- Backend character identity remains `Miss`; browser avatar choice does not change cloud memory identity.
- Test model package validation, private file resolution, and storage with `npm run test:models`. Keep neutral resets and text-chat degradation when avatar loading fails.

### Provider and security rules

- Never print, commit, or place API keys in this file, Notion, Trello, client code, or `NEXT_PUBLIC_*` variables.
- Provider secrets belong only in Vercel environment variables.
- Web access now requires Supabase Auth with confirmed email, restricted to `suphloeksangko@gmail.com` and `duckchan690@gmail.com`. Keep the allowlist server-side and guard every API independently of Proxy. Never trust client-supplied identity or `user_metadata` for authorization.
- `app/page.tsx` is the server-side gate; `app/companion.tsx` retains the existing client UI. Google OAuth uses `/auth/callback`; Settings provides POST `/auth/signout`. Configure public Supabase URL/publishable key and the Google provider before live login testing.
- Both authorized accounts retain the existing shared `default` memory/relationship identity. Do not widen access, separate user data, add a home server, Python backend, self-hosted LLM, or GPU infrastructure unless explicitly requested.
- TTS and Live2D failures must never prevent text chat from completing.
- Search and vision requests use Gemini; normal text chat uses Groq first, then Cerebras and Gemini as fallbacks.

### Safe continuation workflow

1. Read this handoff and inspect the current files before editing.
2. Preserve unrelated user edits. Use `AGENTS.md` for development rules and the user-requested `handoff.md` for changes and verification from this chat.
3. Run `npx tsc --noEmit` and `git diff --check` after meaningful changes.
4. Test the affected route/UI locally where possible.
5. Commit only intentional source changes with a descriptive message.
6. Push `main` before production deployment.
7. Deploy with `XDG_CACHE_HOME=/tmp vercel deploy --prod --yes` only when deployment is requested.
8. After deployment, verify the configured production alias and report the Git commit plus Vercel deployment ID.

### Performance Issues
1. Profile React component renders (DevTools → Profiler)
2. Check for unnecessary re-renders
3. Use `React.memo()` for expensive child components
4. Lazy-load Live2D imports using `dynamic()`

### Memory Leaks
1. Clean up event listeners in `useEffect` cleanup functions
2. Cancel in-flight requests on component unmount
3. Avoid storing large objects in component state

---

## 🚀 Deployment Notes

- **Vercel Build:** `next build` runs automatically
- **Environment Variables:** Set via Vercel dashboard (Settings → Environment Variables)
- **Database:** Supabase connection string in `SUPABASE_URL` env var
- **Monitoring:** Check Vercel Analytics + server-side logs
- **Performance:** Monitor LCP, FID, CLS via Web Vitals

---

## 📞 Questions?

Refer to:
1. [README.md](README.md) — Quick start + feature overview
2. Browser console — Runtime errors
3. Vercel logs — Deployment/server-side issues

---

**Remember:** This is a production application. Test thoroughly, especially on mobile devices before deploying.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## JEV Decision Layer — Current Architecture (2026-10-03)

This section supersedes older fresh-only JEV and preflight descriptions above. Read [docs/jev-decision-layer.md](docs/jev-decision-layer.md) for the pre-change audit, contract, confidence rules, privacy limits and latency tradeoffs.

- **JEV decides:** `lib/jev.ts` sends one batched `jev-latest` System One request for fresh information, memory relevance, vision relevance, time/weather/calculator use, external-integration preparation and broad response mode. Typed intent/model-class summaries reuse those scores. JEV never creates dialogue, executes tools, changes permissions or writes memory.
- **Harness validates and executes:** `lib/chat-decision.ts` turns validated decisions into a `ChatPlan`; `/api/chat` keeps execution, Auth/rate limits, provider routing and after-response persistence. Explicit search/toolkit/local-tool detection and actual image presence win. Composio was removed on 2026-10-06. External app actions are unavailable until a separately configured MCP integration is implemented. Existing provider/account permissions remain authoritative.
- **Main LLM creates:** retain Vivian's personality/story, relationship state, reasoning and final response generation. Broad response guidance uses fixed code-owned strings. Do not move character generation into JEV or make decisions a source of arbitrary prompts/commands.
- `TYPESAFE_API_KEY` (alias `JEV_API_KEY`) enables JEV without requiring Gemini. Gemini is still needed to route ambiguous fresh requests to search and to handle images. `JEV_ENABLED=false` disables decisions. `/api/jev/status` reports enabled/configured state without exposing keys.
- Preserve the existing fresh-information threshold **>= 0.85** and two-second timeout. Missing keys, disabled JEV, timeout, API failure and malformed output retain legacy preparation/routing. Low confidence keeps conservative defaults; only confident negative decisions may skip memory/account preparation. Passive greetings/idle/vision_idle bypass JEV and preserve existing memory behavior.
- Build compact context before retrieving memory: at most 1,200 current-message characters plus two earlier turns of 240 characters each and availability/capability flags. Never send memory rows, full summaries, persona prompts, image/audio bytes or credentials to JEV. Companion-state loading overlaps JEV; independent execution preparation stays parallel.
- Development logs JEV status/elapsed milliseconds; `JEV_DEBUG=true` explicitly enables metadata-only logs elsewhere. Keep normal production quiet. One batched call may add up to two seconds to explicit-search/image requests that previously skipped JEV; measure upstream latency before changing deadlines or expanding questions.
- STT is Groq Whisper, TTS is Fish Audio. `JevContext.inputSource` leaves room for later transcript/evidence decisions; this change adds no STT correction or extra speech request. Keep a future correction model separate and evidence-grounded.
- Verification: `npm ci`, `npm run test:jev`, all existing unit suites including the TTS route tests, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:auth:integration`, `git diff --check`. JEV/chat tests mock upstream services and persistence; never use real cloud memories for regression tests. Report existing failures separately rather than suppressing them.

## Cloud chat history — 2026-10-06

- `conversations`/`messages` now back the browser conversation list through authenticated `/api/conversations` GET/PUT. Both allowed accounts retain the existing shared `default` identity. Cloud writes are append-only by stable client message UUID; never replace an entire transcript from one device.
- Apply `20261006005533_cloud_conversation_history.sql` before deployment. Tables and `vivian_save_conversation` RPC are service-only, with RLS enabled. Local history migrates with cached stable UUIDs and remains a retry cache during outages.
- `/api/chat` accepts optional conversation/message IDs and saves the active user/reply pair before returning, independently of TTS. Legacy clients retain the original request contract. Passive greetings remain ephemeral. Reset must pause and drain pending history writes before deleting cloud data.
- Verify with `npm run test:history`, `npm run test:history:integration` and `npm run test:history:postgres` (disposable local Postgres container only). No regression test may use live chat history.
