import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fixture, OWNER } from './helpers.mjs';
import { Controller } from '../src/controller.mjs';
import { dispatch } from '../src/tools.mjs';
import { directions } from '../src/vision.mjs';

class Rpc extends EventEmitter {
  calls = [];
  async connect() {}
  close() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread', turns: [] } };
    if (method === 'turn/start') return { turn: { id: `turn-${this.calls.length}` } };
    return {};
  }
  respond(id, result) { this.result = result; }
  reject() {}
}
function setup(t) {
  const f = fixture(t); f.store.data.helper = { characterId: 'gpchan', worldKey: 'test-world', revision: 1 };
  f.runtime.config.autonomy.enabled = true; f.runtime.autonomy.nextAt = 0;
  const rpc = new Rpc(), controller = new Controller(f.runtime, rpc); t.after(() => controller.close());
  return { ...f, rpc, controller };
}
test('idle planning is separate from the owner inbox and its final response stays private', async t => {
  const { runtime, store, controller, rpc, bot } = setup(t); await controller.pump();
  const call = rpc.calls.find(c => c.method === 'turn/start'); assert.match(call.params.clientUserMessageId, /^autonomy-/);
  assert.equal(store.data.messages.length, 0); assert.equal(runtime.autonomy.turn(controller.activeTurn).origin, 'autonomy');
  await controller.onNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: controller.activeTurn, item: { type: 'userMessage', id: 'server-item', clientId: call.params.clientUserMessageId, content: call.params.input } } });
  await controller.onNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: controller.activeTurn, item: { type: 'agentMessage', id: 'plan', text: 'private plan', phase: 'final_answer' } } });
  assert.equal(store.data.messages.length, 0); assert.equal(bot.calls.length, 0);
});
test('ordinary owner chat steers the same turn without cancelling the current game job', async t => {
  const { store, controller, rpc, runtime } = setup(t); await controller.pump(); const old = controller.activeTurn;
  const job = await dispatch(runtime, 'minecraft_action', { action: { type: 'control', keys: ['forward'], milliseconds: 2000 } }, { origin: 'autonomy' });
  store.message({ id: 'owner', text: '무슨 생각하세요?', source: 'minecraft', owner: OWNER });
  await assert.rejects(dispatch(runtime, 'minecraft_action', { action: { type: 'control' } }, { origin: 'autonomy' }), /owner message/);
  await controller.pump(); const last = rpc.calls.at(-1); assert.equal(last.method, 'turn/steer'); assert.equal(last.params.input[0].text, '무슨 생각하세요?');
  assert.equal(controller.activeTurn, old); assert.equal(job.status, 'running'); assert.equal(runtime.jobs.active.job.id, job.id);
  assert.equal(rpc.calls.some(c => c.method === 'turn/interrupt'), false);
  assert.equal(store.data.messages.length, 1); assert.equal(store.data.messages[0].status, 'delivered');
  await controller.pump(); assert.equal(rpc.calls.filter(c => c.method === 'turn/steer').length, 1);
  assert.equal(runtime.autonomy.data.requests.length, 1); assert.equal(store.data.controller.requests.length, 1);
  runtime.stop('test cleanup');
});
test('halts, offline state, disabled autonomy, pending uncertainty and separate budgets prevent idle calls', async t => {
  const { runtime, controller, rpc, store } = setup(t);
  runtime.stop('Critical health'); await controller.pump(); assert.equal(rpc.calls.length, 0);
  runtime.halted = null; runtime.connection = 'disconnected'; await controller.pump(); assert.equal(rpc.calls.length, 0);
  runtime.connection = 'connected'; runtime.autonomy.configure({ enabled: false }); await controller.pump(); assert.equal(rpc.calls.length, 0);
  runtime.autonomy.configure({ enabled: true }); store.message({ text: 'uncertain', source: 'codex', owner: OWNER, status: 'uncertain' });
  runtime.autonomy.nextAt = 0; await controller.pump(); assert.equal(rpc.calls.length, 0); store.data.messages = [];
  runtime.autonomy.data.requests = Array(24).fill(Date.now()); await controller.pump(); assert.equal(rpc.calls.length, 0);
  store.data.controller.requests = Array(31).fill(Date.now());
  store.message({ text: '지금 상태를 알려 주세요', source: 'codex', owner: OWNER }); await controller.pump(); assert.ok(rpc.calls.some(c => c.method === 'turn/start'));
});
test('autonomy allows normal game choices while preserving owner and account boundaries', async t => {
  const { runtime } = setup(t);
  for (const [tool, args] of [['minecraft_resume', {}], ['minecraft_connect', {}], ['minecraft_owner_message', { text: 'invented' }], ['minecraft_autonomy', { enabled: true }]])
    await assert.rejects(dispatch(runtime, tool, args, { origin: 'autonomy' }), /actual owner/);
  const actions = []; runtime.action = (name, args) => { actions.push({ name, args }); return { id: 'simulated', status: 'running' }; };
  for (const action of [
    { type: 'enchant', position: { x: 0, y: 64, z: 0 }, slot: 1, expectedName: 'book', choice: 0, maxLevelSpend: 1 },
    { type: 'anvil', position: { x: 0, y: 64, z: 0 }, leftSlot: 1, leftName: 'book', rightSlot: 2, rightName: 'book', maxLevelSpend: 5 },
    { type: 'interact', action: 'attack', entityId: 10 },
    { type: 'interact', action: 'activate', position: { x: 0, y: 64, z: 0 } }
  ]) await dispatch(runtime, 'minecraft_action', { action }, { origin: 'autonomy' });
  assert.deepEqual(actions.map(a => a.name), ['enchant', 'anvil', 'interact', 'interact']);
  assert.equal(actions[0].args.maxLevelSpend, 1);
});
test('optional intentions need no physical job but any referenced job must be real', async t => {
  const { runtime, store } = setup(t);
  const plan = { goal: '식량 확인', mood: '차분함', status: 'considering', nextStep: '주변 밭 보기', reason: '재료 확인 필요', remember: ['주인은 씨앗을 남겨 달라고 하셨습니다.'] };
  runtime.autonomy.updatePlan(plan);
  await dispatch(runtime, 'minecraft_plan', { ...plan, status: 'working' });
  await assert.rejects(dispatch(runtime, 'minecraft_plan', { ...plan, status: 'working', jobId: 'invented' }), /Job not found/);
  const loaded = new store.constructor(store.dir); assert.equal(loaded.data.autonomy.characters['test-world/gpchan'].goal, plan.goal);
  store.data.helper.characterId = 'doro'; assert.equal(runtime.autonomy.status().plan, null);
  store.data.helper.characterId = 'gpchan'; store.data.helper.worldKey = 'different'; assert.equal(runtime.autonomy.status().plan, null);
});
test('persona reactions have no probability gate; explicit stop and refusal switches still work', async t => {
  const { runtime, store } = setup(t);
  const context = JSON.parse(runtime.autonomy.context({ text: '밭을 돌봐 주세요' }).value);
  assert.equal(context.conversation.playfulRefusals, true); assert.equal('negotiation' in context, false);
  store.message({ text: '거절 끄기', owner: OWNER, source: 'minecraft' }); assert.equal(runtime.autonomy.refusals(), false);
  store.message({ text: '자율 모드 꺼', owner: OWNER, source: 'minecraft' }); assert.equal(runtime.autonomy.enabled(), false);
  store.message({ text: '멈춰', owner: OWNER, source: 'codex' }); assert.equal(runtime.halted, 'Stopped by owner');
  store.message({ text: '자율 모드 켜', owner: OWNER, source: 'minecraft' }); assert.equal(runtime.autonomy.available(), false);
});
test('different spontaneous remarks flow immediately; exact repeats add no fake owner messages', async t => {
  const { runtime, bot, store } = setup(t);
  await runtime.autonomy.say('밭을 한번 둘러보겠습니다.', 'gpchan');
  assert.equal((await runtime.autonomy.say('밭을 한번 둘러보겠습니다.', 'gpchan')).sent, false);
  await runtime.autonomy.say('같이 산책하실래요?', 'gpchan');
  assert.equal(bot.calls.length, 2); assert.equal(store.data.messages.length, 0);
});
test('looking around and conversation remain available while a physical job runs', t => {
  const { runtime } = setup(t);
  runtime.action('control', { keys: ['forward'], milliseconds: 1000 });
  assert.equal(runtime.autonomy.due(), true);
  runtime.stop('test cleanup');
});
test('six-direction vision is current-world evidence with size, identity, age and position checks', async t => {
  const { runtime, bot } = setup(t); runtime.config.vision.enabled = true; bot.player = { uuid: OWNER };
  assert.equal(runtime.vision.status().available, false);
  assert.throws(() => runtime.vision.poll({ worldKey: 'other', characterId: 'gpchan' }), /WORLD_MISMATCH/);
  const { request } = runtime.vision.poll({ worldKey: 'test-world', characterId: 'gpchan' });
  // Parser fixture only. Real GPU PNG output is tested separately in a running client.
  const png = Buffer.alloc(40); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12); png.writeUInt32BE(request.size, 16); png.writeUInt32BE(request.size, 20);
  const frame = { requestId: request.requestId, worldKey: request.worldKey, botUuid: OWNER, direction: 'front', capturedAt: Date.now(), position: { x: 0, y: 64, z: 0 }, dimension: 'minecraft:overworld', png: png.toString('base64') };
  assert.throws(() => runtime.vision.accept({ ...frame, position: { x: 50, y: 64, z: 0 } }), /misplaced/);
  assert.throws(() => runtime.vision.accept({ ...frame, capturedAt: 0 }), /Stale/);
  for (const direction of directions) runtime.vision.accept({ ...frame, direction });
  assert.equal(runtime.vision.input().filter(i => i.type === 'localImage').length, 6);
  bot.entity.position.x = 30; assert.equal(runtime.vision.status().available, false); assert.equal(runtime.vision.input().length, 0);
});
