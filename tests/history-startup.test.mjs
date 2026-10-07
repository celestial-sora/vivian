import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import * as historyContract from '../lib/chat-history.ts';
import { loadSceneModule } from './scene-module-loader.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let view, index = 0, effects = [], finish, background;
  const refs = [];
  const hooks = {
    useRef(initial) { const at = index++; return refs[at] ??= { current: initial }; },
    useReducer(reducer, initial) { view ??= initial; return [view, action => { view = reducer(view, action); }]; },
    useCallback(fn) { return fn; }, useEffect(fn) { effects.push(fn); },
  };
  const window = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval() {} });
  const loaded = loadSceneModule('../lib/use-conversation-history.ts', {
    react: hooks, '@/lib/chat-history': historyContract,
    '@/lib/startup-background': { scheduleBackgroundWork(fn) { background = fn; return () => { background = undefined; }; } },
    '@/lib/chat-history-client': { fetchHistory: () => new Promise(resolve => { finish = resolve; }), appendHistory: async () => {} },
  }, { window, AbortController, clearInterval() {}, crypto: webcrypto, queueMicrotask, localStorage: { getItem: () => null, setItem() {} } });
  const render = (busy = false) => {
    index = 0; effects = []; const history = loaded.useConversationHistory({ from: 'vivian', text: 'pending' }, 'pending', busy);
    effects[0](); return history;
  };
  let history = render(); const cleanup = effects.find(fn => fn.toString().includes('mounted.current = true'))();
  return { get view() { return view; }, history, render, cleanup, release: () => background(), finish: value => finish(value) };
}
const cloud = [{ id: 'cloud-thread', title: 'Cloud', updatedAt: 1, cloud: true, messages: [{ id: 'message', from: 'me', text: 'cloud text' }] }];
test('local composer becomes ready before history fetch, then a pristine device restores its cloud thread', async () => {
  const f = fixture(); await tick(); assert.equal(f.view.ready, true);
  let h = f.render(); h.setMessages([{ from: 'vivian', text: 'new welcome' }]); // An ephemeral greeting must not prevent restoration.
  f.render(); f.release(); await tick(); f.finish(cloud); await tick();
  assert.equal(f.view.activeConversationId, 'cloud-thread'); assert.equal(f.view.messages[0].text, 'cloud text'); f.cleanup();
});
test('a user turn or explicit navigation while cloud history loads wins over automatic restoration', async () => {
  for (const navigate of [false, true]) {
    const f = fixture(); await tick(); f.render(); f.release(); await tick();
    const h = f.render();
    if (navigate) h.setActiveConversationId('chosen-thread');
    h.setMessages([{ id: 'local-message', from: 'me', text: 'local text' }]); f.render(true);
    f.finish(cloud); await tick();
    assert.equal(f.view.messages[0].text, 'local text'); assert.notEqual(f.view.activeConversationId, 'cloud-thread'); f.cleanup();
  }
});
