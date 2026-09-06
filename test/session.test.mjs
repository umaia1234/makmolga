import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureSession } from '../src/session.mjs';
import { ROOT } from '../src/config.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Store } from '../src/store.mjs';
import { atomicJson } from '../src/store.mjs';
import { testConfig, tempDir } from './helpers.mjs';

function setup() {
  const config = testConfig(); config.controller.enabled = true;
  const state = { protocol: 1, pid: 123, server: { host: config.minecraft.host, port: config.minecraft.port },
    owner: { uuid: config.owner.uuid, prefix: config.owner.prefix }, controller: { enabled: true, ready: false },
    runtime: { connection: 'connected', halted: null, helper: { characterId: 'yanro', revision: 4 }, activeJob: null, pendingMessages: 0, bot: { health: 20 } } };
  const calls = [];
  const services = {
    probe: async () => structuredClone(state), runtimeAlive: async () => true,
    ensureServer: async () => { calls.push('server'); }, startRuntime: async () => { calls.push('runtime'); },
    prepare: async () => { calls.push('prepare'); state.controller.ready = true; return structuredClone(state); },
    connect: async () => { calls.push('connect'); state.runtime.connection = 'connected'; }
  };
  return { config, state, calls, services };
}

test('repeated standby reuses the running bot and preserves character and active work', async () => {
  const { config, state, calls, services } = setup(); state.runtime.activeJob = { id: 'building' };
  const first = await ensureSession(config, services); const second = await ensureSession(config, services);
  assert.equal(first.pid, second.pid); assert.equal(second.reusedRuntime, true);
  assert.equal(second.mode, 'working'); assert.deepEqual(second.helper, { characterId: 'yanro', revision: 4 });
  assert.deepEqual(calls, ['prepare', 'prepare']);
});

test('cold startup waits for a real bot connection after starting missing services', async () => {
  const { config, state, calls, services } = setup(); let running = false;
  state.runtime.connection = 'disconnected';
  services.probe = async () => running ? structuredClone(state) : null;
  services.runtimeAlive = async () => false;
  services.startRuntime = async () => { calls.push('runtime'); running = true; };
  const result = await ensureSession(config, services, { intervalMs: 1 });
  assert.equal(result.ready, true); assert.equal(result.reusedRuntime, false);
  assert.equal(result.mode, 'waiting_for_owner_chat');
  assert.equal(calls.filter(c => c === 'runtime').length, 1); assert.equal(calls.filter(c => c === 'connect').length, 1);
});

test('standby waits for an existing daemon that has not opened its API yet', async () => {
  const { config, state, calls, services } = setup(); let probes = 0;
  services.probe = async () => ++probes < 3 ? null : structuredClone(state);
  await ensureSession(config, services, { intervalMs: 1 });
  assert.deepEqual(calls, ['prepare']);
});

test('halt, controller failure and changed settings never cause an automatic restart or resume', async () => {
  for (const change of [s => { s.runtime.halted = 'dead'; }, s => { s.controller.fault = true; }, s => { s.owner.prefix = 'changed'; }]) {
    const { config, state, calls, services } = setup(); change(state);
    await assert.rejects(ensureSession(config, services), /halted|faulted|different/);
    assert.deepEqual(calls, []);
  }
});

test('an occupied or unavailable server cannot cause the runtime to start', async () => {
  const { config, calls, services } = setup(); services.probe = async () => null; services.runtimeAlive = async () => false;
  services.ensureServer = async () => { throw new Error('Port belongs to a different service'); };
  await assert.rejects(ensureSession(config, services), /different service/); assert.deepEqual(calls, []);
});

test('updating a paused runtime preserves its stop reason across a graceful restart', () => {
  const dir = tempDir(); const first = new Runtime(testConfig(), new Store(dir));
  first.disconnect('Critical health or lava'); first.close();
  const second = new Runtime(testConfig(), new Store(dir));
  try { assert.equal(second.snapshot().halted, 'Critical health or lava'); assert.equal(second.connection, 'disconnected'); }
  finally { second.close(); }
});

test('installed skill resolves its registered project from an unrelated working directory', () => {
  const home = tempDir(); const elsewhere = tempDir();
  const install = spawnSync(process.execPath, [path.join(ROOT, 'scripts/install-skill.mjs')], { cwd: elsewhere, env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', windowsHide: true });
  assert.equal(install.status, 0, install.stderr);
  const skill = path.join(home, 'skills/makmolga-start');
  assert.equal(JSON.parse(fs.readFileSync(path.join(skill, 'project.local.json'), 'utf8')).projectRoot, ROOT);
  // Replace only this isolated test registration with a tiny local project.
  const project = path.join(home, 'project with spaces'); fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(project, 'scripts/start-session.mjs'), 'console.log(JSON.stringify({cwd: process.cwd(), runtime: process.env.COMPANION_RUNTIME}));');
  atomicJson(path.join(skill, 'project.local.json'), { managedBy: 'makmolga', projectRoot: project });
  const run = spawnSync(process.execPath, [path.join(skill, 'scripts/start.mjs')], { cwd: elsewhere, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).cwd, project);
  assert.equal(JSON.parse(run.stdout).runtime, path.join(project, 'runtime'));
});
