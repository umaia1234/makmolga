import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Controller } from '../src/controller.mjs';
import { Rpc } from '../src/rpc.mjs';
import { fixture, OWNER } from './helpers.mjs';
import { dispatch } from '../src/tools.mjs';

class FakeRpc extends EventEmitter {
  constructor() { super(); this.requests = []; this.responses = []; this.failTurn = false; }
  async connect() { return {}; }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'shared-thread', turns: [] } };
    if (method === 'turn/start' || method === 'turn/steer') { if (this.failTurn) throw new Error('Timed out after acceptance'); if (method === 'turn/start') this.turn = (this.turn || 0) + 1; const id = `turn-${this.turn}`; return { turn: { id }, turnId: id }; }
    return {};
  }
  respond(id, result) { this.responses.push({ id, result }); }
  reject(id, message) { this.responses.push({ id, error: message }); }
  close() {}
}
test('Minecraft and Codex input are exact user text in the same thread and active-turn steering', async t => {
  const { runtime, store } = fixture(t); const rpc = new FakeRpc(); const c = new Controller(runtime, rpc); t.after(() => c.close());
  store.message({ id: 'mc-1', source: 'minecraft', owner: OWNER, text: '밭을 수확해 주세요' }); await c.pump();
  store.message({ id: 'cx-2', source: 'codex', owner: OWNER, text: '씨앗은 남겨 주세요' }); await c.pump();
  const start = rpc.requests.find(r => r.method === 'turn/start'); const steer = rpc.requests.find(r => r.method === 'turn/steer');
  assert.equal(start.params.threadId, steer.params.threadId); assert.equal(start.params.input[0].text, '밭을 수확해 주세요'); assert.equal(steer.params.input[0].text, '씨앗은 남겨 주세요');
  assert.equal(start.params.clientUserMessageId, 'mc-1'); assert.equal(store.data.messages.every(m => m.status === 'delivered'), true);
});
test('ambiguous Codex delivery stays uncertain and is not sent again', async t => {
  const { runtime, store } = fixture(t); const rpc = new FakeRpc(); rpc.failTurn = true; const c = new Controller(runtime, rpc); t.after(() => c.close());
  store.message({ id: 'msg', source: 'minecraft', owner: OWNER, text: '창고 정리' }); await c.pump(); await c.pump();
  assert.equal(store.data.messages[0].status, 'uncertain'); assert.equal(rpc.requests.filter(r => r.method === 'turn/start').length, 1);
});
test('dynamic tools validate input and final reply is relayed only once', async t => {
  const { runtime, bot } = fixture(t); const rpc = new FakeRpc(); const c = new Controller(runtime, rpc); t.after(() => c.close()); await c.start();
  await c.onRequest({ id: 1, method: 'item/tool/call', params: { threadId: 'shared-thread', tool: 'minecraft_action', arguments: { action: { type: 'control', milliseconds: -1 } } } });
  assert.equal(rpc.responses[0].result.success, false);
  const event = { method: 'item/completed', params: { threadId: 'shared-thread', item: { id: 'reply', type: 'agentMessage', phase: 'final_answer', text: '정리했습니다.' } } };
  await c.onNotification(event); await c.onNotification(event); assert.equal(bot.calls.filter(c => c[0] === 'chat').length, 1);
});
test('JSON-RPC request IDs route results and close rejects pending calls', async () => {
  const rpc = new Rpc(); const sent = []; rpc.send = message => sent.push(message);
  const first = rpc.request('one', {}); const second = rpc.request('two', {});
  rpc.receive(JSON.stringify({ id: sent[1].id, result: 2 })); rpc.receive(JSON.stringify({ id: sent[0].id, result: 1 }));
  assert.equal(await first, 1); assert.equal(await second, 2);
  const pending = rpc.request('three', {}); rpc.close(); await assert.rejects(pending, /closed/);
});

test('changed persona is isolated from owner text and waits for the next turn', async t => {
  const { runtime, store } = fixture(t); runtime.connection = 'disconnected';
  const rpc = new FakeRpc(); const c = new Controller(runtime, rpc); t.after(() => c.close());
  await dispatch(runtime, 'minecraft_select_helper', { characterId: 'yanro', worldKey: 'world' });
  store.message({ id: 'a', source: 'codex', owner: OWNER, text: '준비되셨나요?' }); await c.pump();
  let calls = rpc.requests.filter(r => r.method === 'turn/start');
  assert.equal(calls[0].params.input[0].text, '준비되셨나요?');
  assert.equal(JSON.parse(calls[0].params.additionalContext.companion_character.value).selectedCharacter.id, 'yanro');
  await dispatch(runtime, 'minecraft_select_helper', { characterId: 'gemchan', worldKey: 'world' });
  store.message({ id: 'b', source: 'codex', owner: OWNER, text: '밭을 봐 주세요' }); await c.pump();
  assert.equal(store.data.messages[1].status, 'pending'); assert.equal(rpc.requests.filter(r => r.method === 'turn/steer').length, 0);
  await c.onNotification({ method: 'turn/completed', params: { threadId: c.threadId, turn: { id: c.activeTurn, status: 'completed' } } });
  await c.pump(); calls = rpc.requests.filter(r => r.method === 'turn/start');
  assert.equal(calls.length, 2); assert.equal(calls[1].params.input[0].text, '밭을 봐 주세요');
  assert.equal(JSON.parse(calls[1].params.additionalContext.companion_character.value).selectedCharacter.id, 'gemchan');
  assert.equal(store.data.messages.length, 2);
});

test('late replies and tool chat keep their original character after switching helpers', async t => {
  const { runtime, store, bot } = fixture(t); runtime.connection = 'disconnected';
  const rpc = new FakeRpc(); const c = new Controller(runtime, rpc); t.after(() => c.close());
  await dispatch(runtime, 'minecraft_select_helper', { characterId: 'doro', worldKey: 'world' });
  store.message({ id: 'doro-owner', source: 'codex', owner: OWNER, text: '밭을 확인해 주세요' }); await c.pump();
  const first = c.activeTurn;
  await dispatch(runtime, 'minecraft_select_helper', { characterId: 'yanro', worldKey: 'world' });
  await c.onNotification({ method: 'turn/completed', params: { threadId: c.threadId, turn: { id: first, status: 'completed' } } });
  store.message({ id: 'yanro-owner', source: 'codex', owner: OWNER, text: '박사님도 확인해 주세요' }); await c.pump();
  const second = c.activeTurn; assert.notEqual(first, second); runtime.connection = 'connected';
  await c.onNotification({ method: 'item/completed', params: { threadId: c.threadId, turnId: first, item: { id: 'late-doro', type: 'agentMessage', text: '수확했습니다.' } } });
  assert.equal(bot.calls.at(-1)[1], '[봇] 도로?');
  assert.equal(store.data.events.findLast(e => e.type === 'controller_reply').modelText, '수확했습니다.');
  await c.onRequest({ id: 100, method: 'item/tool/call', params: { threadId: c.threadId, turnId: first, tool: 'minecraft_chat', arguments: { text: '도로! doro?' } } });
  assert.equal(bot.calls.at(-1)[1], '[봇] 도로! doro?');
  await c.onNotification({ method: 'item/completed', params: { threadId: c.threadId, turnId: second, item: { id: 'yanro', type: 'agentMessage', text: '지금 상태를 확인하겠습니다.' } } });
  assert.match(bot.calls.at(-1)[1], /LLM/);
  assert.equal(store.data.messages[0].text, '밭을 확인해 주세요');
  assert.equal(store.data.jobs.length, 0);
  assert.equal(new (store.constructor)(store.dir).data.controller.speechTurns[first], 'doro');
});
