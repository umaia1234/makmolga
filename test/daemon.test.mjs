import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ROOT, defaults } from '../src/config.mjs';
import { atomicJson } from '../src/store.mjs';
import { call } from '../src/client.mjs';
import { delay } from '../src/jobs.mjs';
import { tempDir } from './helpers.mjs';

test('real daemon starts disconnected, answers HTTP, refuses duplicate ownership, and shuts down', { timeout: 15000 }, async t => {
  const dir = tempDir(); const configFile = path.join(dir, 'config.json'); const config = structuredClone(defaults); config.api.port = 0; atomicJson(configFile, config);
  const env = { ...process.env, COMPANION_RUNTIME: dir, COMPANION_CONFIG: configFile };
  const child = spawn(process.execPath, [path.join(ROOT, 'src/main.mjs')], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); t.after(() => child.kill());
  let log = ''; child.stderr.on('data', b => { log += b; }); const deadline = Date.now() + 5000;
  while (!fs.existsSync(path.join(dir, 'endpoint.json')) && Date.now() < deadline) await delay(40);
  const status = await call('minecraft_status', {}, { dir }); assert.equal(status.connection, 'disconnected', log);
  const duplicate = spawn(process.execPath, [path.join(ROOT, 'src/main.mjs')], { cwd: ROOT, env, windowsHide: true, stdio: 'ignore' });
  assert.notEqual((await once(duplicate, 'exit'))[0], 0);
  assert.equal((await call('companion_shutdown', {}, { dir })).shuttingDown, true);
  assert.equal((await exited)[0], 0); assert.equal(fs.existsSync(path.join(dir, 'daemon.lock')), false);
});
