/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test infrastructure, not an application module. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const loadGuard = require('./helpers/ux-request-guard.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
for (const component of ['orders/orders-board.tsx', 'accounts/accounts-board.tsx', 'chat/chat-client.tsx']) {
  test(`${component}: B resolves first; A late completion ignored`, async () => {
    const { RequestSequencer } = loadGuard(component);
    const seq = new RequestSequencer();
    const a = deferred(), b = deferred();
    let data = 'initial';
    const ra = seq.begin();
    const pa = a.promise.then((value) => { if (!seq.isStale(ra.id)) data = value; });
    const rb = seq.begin();
    const pb = b.promise.then((value) => { if (!seq.isStale(rb.id)) data = value; });
    b.resolve('B'); await pb;
    a.resolve('A'); await pa;
    assert.equal(data, 'B');
    assert.equal(ra.signal.aborted, true);
    seq.begin();
    assert.equal(seq.isStale(rb.id), true);
  });
  if (!component.startsWith('chat/')) {
    for (const status of [403, 500]) test(`${component}: JSON ${status} retains data; retry succeeds`, async () => {
      const { parseJsonResponse } = loadGuard(component);
      let data = ['good'];
      let error;
      try { data = (await parseJsonResponse({ ok: false, status, json: async () => ({ error: 'no' }) })).orders ?? []; }
      catch (e) { error = e; }
      assert.equal(error.status, status);
      assert.deepEqual(data, ['good']);
      data = (await parseJsonResponse({ ok: true, status: 200, json: async () => ({ orders: ['retried'] }) })).orders;
      assert.deepEqual(data, ['retried']);
    });
  }
}
function chatHarness() {
  const source = process.env.UX_BASELINE === '1'
    ? require('node:child_process').execFileSync('git', ['show', 'HEAD:src/app/chat/chat-client.tsx'], { cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8' })
    : fs.readFileSync(require('node:path').resolve(__dirname, '../src/app/chat/chat-client.tsx'), 'utf8');
  const code = source.slice(source.indexOf('  async function openSession('), source.indexOf('  if (loadingConfig)'));
  const { RequestSequencer } = loadGuard('chat/chat-client.tsx');
  const state = { messages: [{ id: 'saved', content: 'old' }], active: 'A', draft: '', pending: false, sending: false };
  const requests = [];
  const context = {
    activeSessionId: 'A', sending: false, historyBusy: { current: false },
    sendFlight: { current: null }, mounted: { current: true }, historySeqRef: { current: new RequestSequencer() },
    optimisticIdCounter: { current: 0 },
    setMessages: (v) => { state.messages = typeof v === 'function' ? v(state.messages) : v; },
    setActiveSessionId: (v) => { state.active = v; },
    setLoadingMessages: (v) => { state.pending = v; },
    setDraft: (v) => { state.draft = v; }, setSending: (v) => { state.sending = v; },
    setSessions: () => {}, setConfig: () => {}, toast: { error: () => {} }, t: (v) => v,
    fetch: (url, init) => { const d = deferred(); requests.push({ ...d, url, init }); return d.promise; },
  };
  const actions = vm.runInNewContext(stripTypeScriptTypes(code) + '\n({ openSession, startNewChat, send })', context);
  return { state, requests, ...actions };
}
test('chat actual actions: A history late after B is ignored', async () => {
  const h = chatHarness();
  const a = h.openSession('A'); const b = h.openSession('B');
  h.requests[1].resolve({ ok: true, json: async () => ({ messages: [{ id: 'B' }] }) }); await b;
  h.requests[0].resolve({ ok: true, json: async () => ({ messages: [{ id: 'A' }] }) }); await a;
  assert.equal(h.state.messages[0].id, 'B');
  assert.equal(h.state.active, 'B');
  assert.equal(h.state.pending, false);
});
test('chat actual actions: New Chat invalidates pending history including late rejection', async () => {
  const h = chatHarness(); const a = h.openSession('A');
  h.startNewChat(); h.requests[0].reject(new Error('offline')); await a;
  assert.equal(h.state.active, null); assert.equal(h.state.messages.length, 0); assert.equal(h.state.pending, false);
});
for (const success of [true, false]) test(`chat actual actions: send blocks switch/New Chat; ${success ? 'reply' : 'rollback by id'}`, async () => {
  const h = chatHarness(); const send = h.send('question');
  void h.openSession('B'); h.startNewChat();
  assert.equal(h.state.active, 'A'); assert.equal(h.requests.length, 1);
  h.state.messages.push({ id: 'unrelated', content: 'keep' });
  if (success) h.requests[0].resolve({ ok: true, json: async () => ({ sessionId: 'A', reply: 'answer' }) });
  else h.requests[0].reject(new Error('offline'));
  await send;
  assert.equal(h.state.messages.some((m) => m.id === 'unrelated'), true);
  assert.equal(h.state.messages.some((m) => m.id.startsWith('tmp-')), success);
  assert.equal(h.state.sending, false);
  h.startNewChat(); assert.equal(h.state.active, null);
});
test('chat actual actions: send waits for history (no concurrent transcript replacement)', async () => {
  const h = chatHarness(); const a = h.openSession('A');
  void h.send('question'); assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ ok: true, json: async () => ({ messages: [] }) }); await a;
});
