# Supabase chat history

The browser conversation list uses the existing `conversations` and `messages` tables. Both authorized accounts share the existing `default` companion identity, including history. Supabase is the durable store; browser storage is a cache for unsynced messages and the device's active thread selection.

## Setup

Apply `supabase/migrations/20261006005533_cloud_conversation_history.sql` after the existing memory migrations, before deploying the application. Existing rows remain intact and receive stable message UUIDs. No new provider credentials are required: server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` supply database access. Tables retain RLS; browser roles have no direct grants. The `SECURITY INVOKER` append RPC is callable only by `service_role` through the application's existing verified-account Auth guard.

## API

- `GET /api/conversations?offset=0`: up to 50 shared thread metadata records and nullable `nextOffset`.
- `GET /api/conversations?id=<uuid>&after=0`: up to 100 messages and nullable `nextCursor`. Cursor order follows the immutable database sequence; the client sorts the complete transcript by message timestamp for display.
- `PUT /api/conversations`: `{ id, title, create, messages: [{ id, from: "me" | "vivian", text, timestamp }] }`. One batch contains 1–100 messages. Bodies are streamed under a 2 MiB limit; each message is at most 16,000 characters. A transaction locks the thread and appends immutable message IDs. Repeated IDs cannot duplicate or overwrite persisted content. `create: false` prevents a deleted thread from being silently recreated.

`POST /api/chat` accepts optional `conversationId`, `conversationTitle`, `conversationCreate`, `userMessageId`, and `assistantMessageId`. Active chat saves the selected user/reply pair before returning, with a two-second history deadline and a `historySaved` response field. Storage failure does not prevent text generation or completion. Old clients without the optional IDs keep the previous request contract and legacy history path. TTS playback is independent of persistence; passive welcomes remain ephemeral until the user actually chats.

## Browser behavior

Local transcripts are assigned stable UUIDs and cached before their first cloud upload. The client follows every history page, loads saved threads on startup, and refreshes on focus, reconnect, every 30 seconds and when the Chat panel opens. New local messages are sent in serialized batches with ID-based deduplication. An outage shows a visible history notice; reconnect retries the cache. Different device additions are merged rather than replacing an entire transcript. The Chat panel can expand the active transcript.

Reset Vivian pauses and drains pending writes before deleting the shared history. A failed reset retains the local cache. A device holding an already deleted thread cannot append to it without starting a new conversation. Devices/tabs are independent caches; synchronization is periodic, not a live typing channel. If both cloud and browser storage are unavailable, messages can remain only in the current tab; they cannot survive closing that tab. Browser reload during an unavailable cloud save depends on its local cache.

## Verification

- `npm run test:history`: migration IDs, merging, validation, pagination, failure behavior and Auth ordering.
- `npm run test:history:integration`: real Next routes with local Auth/REST/model fixtures, two authorized sessions, before-response persistence, degraded storage, pagination and reset.
- `npm run test:history:postgres`: actual migration, preserved legacy rows, database grants/RLS, retry/concurrency, atomic rollback and deleted-thread protection. Defaults to an isolated `vivian-history-postgres` Podman container; override `HISTORY_TEST_RUNTIME` and `HISTORY_TEST_CONTAINER` for a disposable test container. No live Supabase database is used.

Production migration `20261006005533` was applied and verified on 2026-10-06 to project `ai-waifu` (`frqixaqknuyerovnrndq`). Existing two conversations and 88 messages were retained. A rolled-back service-role transaction verified RPC create/retry/append, atomic rejection and deleted-thread protection. Cross-device physical-device testing and application deployment remain pending.
