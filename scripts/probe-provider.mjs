import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { CliRpc } from '../src/cli-rpc.mjs';

// Optional real-account smoke check. The tool is a fixture: never joins a game.
// --resume-check uses two actual model requests and reopens the saved transport.
const provider = process.argv[2] || 'claude', model = process.argv[3] || null;
assert.ok(['claude', 'antigravity'].includes(provider));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makmolga-probe-'));
const proof = randomUUID(), route = { provider, model, command: null };
const prompt = 'You are a Minecraft companion. Speak polite Korean. Use only the provided Minecraft MCP tools. This is an isolated connection diagnostic.';
let calls = 0, rpc;
function engine() {
  const transport = new CliRpc(new Store(dir), route);
  transport.on('request', ({ id, params }) => {
    if (params.tool !== 'minecraft_status') return transport.reject(id, 'Only the status fixture is available.');
    calls++; transport.respond(id, { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ connection: 'test-fixture', probe: proof }) }] });
  });
  return transport;
}
async function turn(threadId, text) {
  const current = rpc;
  return new Promise((resolve, reject) => {
    let reply = '';
    const clean = () => { clearTimeout(timer); current.off('notification', receive); current.off('closed', fail); };
    const fail = error => { clean(); reject(error); };
    const receive = m => {
      if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') reply = m.params.item.text;
      if (m.method === 'turn/completed') { clean(); m.params.turn.status === 'completed' ? resolve(reply) : reject(new Error('Probe turn failed')); }
    };
    const timer = setTimeout(() => { clean(); current.close(); reject(new Error('Probe timed out')); }, 100000);
    current.on('notification', receive); current.on('closed', fail);
    current.request('turn/start', { threadId, input: [{ type: 'text', text }] }).catch(fail);
  });
}
try {
  rpc = engine(); await rpc.connect({ idleTimeoutSeconds: 90 });
  const { thread } = await rpc.request('thread/start', { developerInstructions: prompt });
  const first = await turn(thread.id, 'minecraft_status를 한 번 호출하고 결과의 probe 값을 답해주세요. 테스트용 도구이며 실제 게임에 접속하지 않습니다.');
  assert.equal(calls, 1); assert.ok(first.includes(proof));
  const remoteId = rpc.store.data.controller.cliSessions[thread.id].remoteId;
  assert.ok(remoteId); rpc.close();
  let resumed = false;
  if (process.argv.includes('--resume-check')) {
    rpc = engine(); await rpc.connect({ idleTimeoutSeconds: 90 });
    await rpc.request('thread/resume', { threadId: thread.id, developerInstructions: prompt });
    const second = await turn(thread.id, '도구를 호출하지 말고, 바로 직전 대화에서 도구가 반환했던 probe 값만 그대로 답해주세요.');
    assert.equal(calls, 1); assert.ok(second.includes(proof));
    assert.equal(rpc.store.data.controller.cliSessions[thread.id].remoteId, remoteId); resumed = true;
  }
  console.log(JSON.stringify({ ok: true, provider, model, toolCalls: calls, resumed, ready: rpc.store.data.events.filter(e => e.type === 'provider_turn_ready').map(({ model, toolCount }) => ({ model, toolCount })), directory: dir }));
} finally { rpc?.close(); }
