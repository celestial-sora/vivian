import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../app/companion.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function speak('), end = source.indexOf('  async function sendMessage(', start);
const speakSource = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let unlock, respond; const calls = [], measures = [];
  const abortRef = { current: null }, speakIdRef = { current: 0 };
  const audio = { pause() {}, removeAttribute() {}, setAttribute() {}, play: async () => { calls.push('play'); }, src: '' };
  const bindings = {
    mutedRef: { current: false }, speakIdRef, ttsAbortRef: abortRef, speakingRef: { current: false },
    window: { setTimeout: (fn, ms) => ms === 140 ? setTimeout(fn, 0) : setTimeout(fn, ms), clearTimeout },
    TTS_TIMEOUT_MS: 1000, AUDIO_UNLOCK_MS: 1000, PLAYBACK_START_MS: 1000, AUDIO_SYNC_SETTLE_MS: 140,
    AbortController, URL, Audio: class {}, speechSpeedRef: { current: .98 }, speechLanguageRef: { current: 'th' }, audioRef: { current: audio },
    withTimeout: async promise => promise,
    unlockAudio: () => new Promise(resolve => { calls.push('unlock'); unlock = resolve; }),
    authFetch: () => new Promise((resolve, reject) => { calls.push('tts'); respond = response => resolve(response); abortRef.current.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))); }),
    startTiming: name => ({ name, done: false }), finishTiming: (span, detail) => { if (span && !span.done) { span.done = true; measures.push({ name: span.name, detail }); } }, cancelTiming: span => { if (span) span.done = true; },
    startLipSync() {}, stopLipSync() {}, resetReaction() {}, console: { error() {} },
  };
  const speak = new Function(...Object.keys(bindings), `${speakSource}\nreturn speak;`)(...Object.values(bindings));
  return { speak, calls, measures, abortRef, speakIdRef, unlock: () => unlock(), respond: value => respond(value) };
}
test('TTS starts alongside unlocking, but shared Safari playback waits; request/audio/playback timings remain separate', async () => {
  const f = fixture(); const speaking = f.speak('fixture', { name: 'reply_to_audio_start' });
  assert.ok(f.calls.includes('tts')); assert.ok(f.calls.includes('unlock')); assert.ok(!f.calls.includes('play'));
  f.respond({ ok: true, blob: async () => new Blob(['fixture audio']), headers: new Headers({ 'Server-Timing': 'fish;dur=20' }) }); await tick();
  assert.ok(!f.calls.includes('play')); assert.equal(f.measures[0].name, 'tts_request_to_audio_ready');
  f.unlock(); assert.equal(await speaking, true);
  assert.deepEqual(f.measures.map(m => m.name), ['tts_request_to_audio_ready', 'tts_request_to_audio_start', 'reply_to_audio_start', 'audio_ready_to_playback']);
});
test('cancelled synthesis cannot start audio or leave a pending successful timing', async () => {
  const f = fixture(); const speaking = f.speak('fixture'); f.abortRef.current.abort(); f.unlock();
  assert.equal(await speaking, false); assert.ok(!f.calls.includes('play'));
});
