import test from 'node:test';
import assert from 'node:assert/strict';
import { protocolFixture } from './protocol-fixture.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Store } from '../src/store.mjs';
import { tempDir, testConfig, finished } from './helpers.mjs';
import { delay } from '../src/jobs.mjs';

test('real Mineflayer logs in, receives chunks, and sends movement/chat packets', { timeout: 20000 }, async t => {
  const fixture = await protocolFixture(); t.after(fixture.close);
  const config = testConfig(); config.minecraft.port = fixture.port;
  const runtime = new Runtime(config, new Store(tempDir())); t.after(() => runtime.close());
  await runtime.connect();
  const deadline = Date.now() + 12000;
  while (runtime.connection !== 'connected' && Date.now() < deadline) await delay(50);
  assert.equal(runtime.connection, 'connected', JSON.stringify(runtime.store.data.events));
  assert.equal(runtime.bot.version, '26.1');
  await delay(300);
  const before = runtime.bot.entity.position.clone();
  const job = runtime.action('control', { keys: ['forward'], milliseconds: 400 }); await finished(runtime);
  assert.equal(job.status, 'completed'); assert.ok(runtime.bot.entity.position.distanceTo(before) > 0.1);
  await runtime.say('통신 테스트');
  assert.ok(fixture.packets.some(p => p.name === 'position' || p.name === 'position_look'));
  assert.ok(fixture.packets.some(p => p.name === 'chat_message' && p.packet.message.includes('통신 테스트')));
  assert.deepEqual(fixture.errors, []);
});
