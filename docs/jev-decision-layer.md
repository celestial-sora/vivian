# JEV decision layer

## Audit before implementation (2026-10-03)

Verified against `d38b6f4` on the supplied `work` branch, not inferred from older AGENTS handoffs.

- `app/api/chat/route.ts` authenticates and rate-limits requests, trims history to 12 turns / 4,500 characters, and builds user, image and passive-mode state.
- Explicit `searchIntent` matches bypass JEV. Otherwise, only active chat with Gemini configured calls `lib/jev.ts::needsCurrentInformation`.
- JEV uses `https://api.typesafe.ai/v1/systemone`, `jev-latest`, one `noul` question, up to 1,200 user-message characters, and `AbortSignal.timeout(2000)`. A score **>= 0.85** enables fresh-information routing. Missing keys, bad responses and errors return false. Errors previously logged warnings in production.
- After JEV, one Promise.all loads up to 30 ranked durable memories (8 enter the main prompt), companion state, regex-selected local tools, Composio connected accounts and up to 10 tools from regex-selected toolkits.
- Local tools are web search (Tavily), Bangkok time, weather (Open-Meteo), calculator and memory retrieval. In practice the route passes an empty memory list to runTools; the actual memory context is loaded separately.
- Supplied images always route to Gemini. Fresh information routes to Tavily preparation plus Gemini google_search. Normal text uses Groq, Cerebras, then Gemini; JEV does not select a provider or generate text.
- Groq/Cerebras may request Composio functions; the route executes these and sends results back for final language generation. JEV has no execution path. Existing Composio account scope and authorization must remain intact.
- The main prompt includes Vivian's story/personality, user instructions, relationship state, summary, memories and tool results. After-response code saves history/state, extracts durable memories and compresses old turns. Greetings do not write cloud history/state.
- `app/companion.tsx` captures live camera frames or attaches user images before chat, calls TTS after chat and drives Live2D. STT is actually Groq Whisper (`app/api/stt/route.ts`), not the old ElevenLabs description; TTS is Fish Audio. Speech and avatar failures retain text chat.
- `/api/jev/status` reports key presence only; keys are server-side. Existing tests use Node's runner, TypeScript stripping and VM-transpiled route fixtures, plus production Next/Auth integration fixtures.

Old flow: input → explicit search or fresh-only JEV → parallel memory/state/tools → provider routing → main LLM → background persistence → TTS/UI.

## Final flow and responsibility boundary

As of 2026-10-06, Composio has been removed. The earlier audit above describes historical behavior. External app actions are unavailable; no MCP servers are configured. The integration decision fields remain reserved in the JEV contract, with the chat route reporting integrations unavailable and no toolkit candidates.

Input → compact context → **one batched JEV pass** → validated `ChatPlan` → parallel memory/local tools preparation → existing provider chain/main LLM → existing background persistence → TTS/UI. Companion-state loading overlaps the decision request. Greeting, idle and vision_idle keep their existing behavior and bypass JEV.

**LLM creates. JEV decides. Code executes.**

- **JEV = fast probabilistic decisions.** `lib/jev.ts` sends ten independent `noul` questions in one `jev-latest` request and validates all answers as finite values in [0, 1]. It returns a typed `VivianDecision` or a typed failure with elapsed milliseconds. It has no tool, database, permission or action imports.
- **Harness = validation + execution.** `lib/chat-decision.ts` resolves a concrete plan; `app/api/chat/route.ts` remains the orchestrator. It supplies only known tool names, preserves explicit intents, and currently executes only the existing local tools. Composio has been removed; MCP is not connected. Existing Auth, rate limits, account scope, side-effect paths and provider timeouts remain in place; a JEV tool signal is never permission to perform an action. Provider/platform permission checks still apply; this change does not implement new per-action approval rules or full argument-schema validation.
- **Main LLM = reasoning + language + Vivian personality.** The existing persona/story/state prompt and provider fallback chain remain. Broad response hints come from fixed Harness-owned strings, not model-generated instructions. JEV never writes dialogue or changes relationship state. Durable-memory extraction and writes remain after-response code.

## Decision contract and confidence

`VivianDecision` contains fresh-information, memory, vision and four tool decisions, each with `{ required, confidence }`. Tools are restricted to time, weather, calculator and integration preparation; web search follows the fresh-information decision and memory retrieval follows the memory decision. Intent, model class and response mode have closed string unions and confidence. A separate recall-intent question distinguishes ordinary companion conversation that benefits from memory from an actual request to recall past facts. Intent and model class are derived from the same scores, avoiding additional sequential calls; they are advisory summaries, not independent calibrated categorical probabilities. Model classes match actual capabilities: `text`, `search`, `vision`. No new provider/model tier is introduced. Supportive mode captures broad emotional context without an emotion taxonomy or diagnosis.

A `noul` value p becomes `required = p >= 0.5`, `confidence = max(p, 1-p)`. The Harness acts on positive signals only at confidence **>= 0.85**, preserving the old fresh threshold. It skips memory preparation only on a confident negative. Integration preparation is gated by capability availability; the chat route currently sets integrations to false. Personal/uncertain chat defaults to retrieval. Explicit memory-recall detection and a confident recall intent keep retrieval; toolkit candidates are currently empty. Existing regex tools cannot be vetoed. JEV can add only known local tools; tool implementations still parse their inputs deterministically.

Actual image presence always selects vision. JEV cannot discard an image, request camera capture or invent visual evidence. Confident vision relevance without an image becomes a fixed request-for-image hint to the main LLM. Fresh information requires Gemini before JEV can promote an ambiguous request to search. Explicit search without Gemini still returns the existing configuration error. Text retains Groq → Cerebras → Gemini.

Any missing, invalid or out-of-range answer invalidates the batch. Disabled/missing-key/empty-input, timeout, API/network failure and malformed output return a null decision. The Harness then uses existing regex routing, memory retrieval and provider order. Per-decision low confidence has the same conservative defaults. JEV never becomes a chat dependency.

## Context, privacy and speech compatibility

The request contains up to 1,200 current-message characters, the last two earlier turns capped at 240 characters each, image presence, memory availability, search/integration capability flags and up to three deterministic toolkit candidates. Availability means configured credentials, not a live database or account check. The JEV adapter constructs an allowlisted state object; extra fields are never serialized. No image/audio binaries, memory rows, user IDs, credentials, system/persona prompts, companion summaries or database contents enter the request. Recent-turn snippets can contain user information; they are intentionally bounded, not a substitute for a future redaction policy.

`JevContext.inputSource` can distinguish `text` and `transcript` without coupling decisions to the chat UI. Current STT remains Groq Whisper and TTS remains Fish Audio. A later STT feature can build an evidence-specific context from the raw transcript plus bounded audio metadata and use the same decision boundary before a separate correction model. No transcript correction, audio-evidence questions, audio transport or extra STT request is implemented here. Corrections would need explicit evidence grounding; JEV must not hallucinate transcript text.

## Latency and debugging

One provider request replaces the old fresh-only request; there is no retry or decision-call chain. The existing two-second signal bounds headers and response-body reads. State loading starts alongside JEV; independent execution preparation remains in Promise.all. No real upstream latency claim is made from mocked tests.

With JEV enabled, explicit search and image chats now also perform a decision pass and may incur up to two seconds that they previously skipped. Active text without Gemini can now use JEV for other decisions and has the same possible added wait. Larger batches may have different service latency/cost than the old single question. `JEV_ENABLED=false` restores the deterministic path. `elapsedMs` measures the actual decision pass; development or `JEV_DEBUG=true` logs only status/elapsedMs, never user text, keys or decisions. Normal production is quiet. This is not a guarantee on the entire chat duration; existing upstream tool/provider deadlines are unchanged.

## Verification workflow

Run `npm ci`, `npm run test:jev`, existing unit suites (including `tests/tts.test.mjs`), `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:auth:integration` and `git diff --check`. New tests use the real JEV adapter, parser, Harness and chat route with mocked upstream/auth/persistence services. Auth integration uses local production Next servers and local Auth fixtures. Tests never contact real JEV/AI providers or write cloud memories. Live provider accuracy, confidence calibration, cost and latency still require real-service evaluation.
