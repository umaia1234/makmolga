import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';
import { loadConfig } from '../src/config.mjs';
import { ProxyProcess } from '../src/proxy.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Store } from '../src/store.mjs';
import { protocolFixture } from './protocol-fixture.mjs';
import { tempDir, testConfig, finished } from './helpers.mjs';
import { delay } from '../src/jobs.mjs';

async function freePort() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function readVarint(buffer, offset) { let n = 0, shift = 0; for (let i = offset; i < buffer.length && i < offset + 5; i++) { n |= (buffer[i] & 127) << shift; if (!(buffer[i] & 128)) return { n, end: i + 1 }; shift += 7; } return null; }

test('26.2 wire translation round trip carries real Mineflayer movement and chat', { timeout: 50000 }, async t => {
  const installed = loadConfig();
  if (!fs.existsSync(new URL('../runtime/vendor/ViaProxy-3.4.12.jar', import.meta.url))) return t.skip('Run setup --download-proxy for the Java integration test.');
  const fixture = await protocolFixture(); t.after(fixture.close);
  const downstream = testConfig(); downstream.minecraft.port = fixture.port; downstream.proxy = { ...installed.proxy, enabled: true, authMethod: 'NONE', port: await freePort() };
  const lower = new ProxyProcess(downstream, new Store(tempDir())); t.after(() => lower.stop()); await lower.start();
  const sockets = new Set(); const observedProtocols = [];
  const tap = net.createServer(front => {
    const back = net.connect({ host: '127.0.0.1', port: downstream.proxy.port }); sockets.add(front); sockets.add(back);
    front.pipe(back); back.pipe(front); front.on('error', () => back.destroy()); back.on('error', () => front.destroy());
    front.on('close', () => { sockets.delete(front); back.destroy(); }); back.on('close', () => { sockets.delete(back); front.destroy(); });
    let pending = Buffer.alloc(0); let done = false;
    front.on('data', bytes => {
      if (done) return; pending = Buffer.concat([pending, bytes]);
      const size = readVarint(pending, 0); if (!size || pending.length < size.end + size.n) return;
      const id = readVarint(pending, size.end); const version = id && readVarint(pending, id.end);
      if (id?.n === 0 && version) observedProtocols.push(version.n); done = true;
    });
  });
  tap.listen(0, '127.0.0.1'); await once(tap, 'listening'); t.after(() => { for (const s of sockets) s.destroy(); tap.close(); });
  const upstream = testConfig(); upstream.minecraft.port = tap.address().port; upstream.minecraft.targetVersion = '26.2'; upstream.proxy = { ...installed.proxy, enabled: true, authMethod: 'NONE', port: await freePort() };
  const runtime = new Runtime(upstream, new Store(tempDir())); t.after(() => runtime.close());
  await runtime.connect(); const deadline = Date.now() + 15000;
  while (runtime.connection !== 'connected' && Date.now() < deadline) await delay(100);
  assert.equal(runtime.connection, 'connected', JSON.stringify(runtime.store.data.events));
  await delay(300); const before = runtime.bot.entity.position.clone();
  const job = runtime.action('control', { keys: ['forward'], milliseconds: 400 }); await finished(runtime); assert.equal(job.status, 'completed');
  assert.ok(runtime.bot.entity.position.distanceTo(before) > 0.1); await runtime.say('26.2 번역 경로 확인');
  assert.ok(observedProtocols.includes(776), `Observed protocols: ${observedProtocols}`);
  assert.ok(fixture.packets.some(p => p.name === 'chat_message' && p.packet.message.includes('26.2')));
  t.diagnostic('Verified 775 → 776 → 775 handshake/chunks/movement/chat on loopback. This is not a vanilla 26.2 gameplay test.');
});
