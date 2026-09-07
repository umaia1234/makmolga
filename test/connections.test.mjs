import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, configSchema, recommendedRoutes } from '../src/config.mjs';
import { resolveRoute, routeKey } from '../src/provider-routing.mjs';
import { backedJson, registerConnections, saveConnections, ConnectionService } from '../src/connections.mjs';
import { serveConnections } from '../src/connection-server.mjs';
import { cliInput, cliArguments, CliRpc } from '../src/cli-rpc.mjs';
import { Controller } from '../src/controller.mjs';
import { findProgram, providerEnv, codexLoginState } from '../src/provider-process.mjs';
import { atomicJson } from '../src/store.mjs';
import { fixture, OWNER } from './helpers.mjs';

const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makmolga-connections-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const timeout = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('Condition timed out'); await delay(20); } };
function external(t, provider = 'claude') {
  const f = fixture(t), route = { provider, model: 'fixture-model', command: process.execPath };
  f.runtime.config.connections.routing = 'characters'; f.runtime.config.connections.characters.gpchan = { provider, model: route.model }; f.runtime.config.controller.enabled = true;
  f.store.data.helper = { characterId: 'gpchan', revision: 1, worldKey: 'local' };
  const rpc = new CliRpc(f.store, route, { spawnProcess: (_cmd, args, options) => spawn(process.execPath, [path.join(ROOT, 'test/cli-fixture.mjs'), ...args], options), inspect: async () => ({ auth: 'signed_in' }) });
  const controller = new Controller(f.runtime, rpc); t.after(() => controller.close()); return { ...f, rpc, controller };
}
test('legacy installs keep Codex; character routes isolate Claude models and personas', () => {
  const config = configSchema.parse({}); assert.equal(resolveRoute(config, 'gemchan').provider, 'codex');
  config.connections.routing = 'characters';
  assert.equal(resolveRoute(config, 'gemchan').provider, 'antigravity'); assert.equal(resolveRoute(config, 'fablechan').model, 'fable');
  assert.notEqual(routeKey(resolveRoute(config, 'clchan'), 'clchan'), routeKey(resolveRoute(config, 'fablechan'), 'fablechan'));
  assert.equal(routeKey(resolveRoute(config, 'gpchan'), 'gpchan'), 'gpchan');
  config.controller.model = 'existing-codex-model';
  assert.equal(resolveRoute(config, 'gpchan').model, 'existing-codex-model');
  assert.equal(resolveRoute(config, 'gemchan').model, null);
  assert.notEqual(routeKey({ provider: 'codex', model: 'model-a' }, 'gpchan'), routeKey({ provider: 'codex', model: 'model-b' }, 'gpchan'));
  assert.throws(() => configSchema.parse({ connections: { ...config.connections, characters: { ...recommendedRoutes, fablechan: { provider: 'claude', model: '$(command)' } } } }));
});
test('saved connections preserve all unrelated configuration and back up exact bytes', t => {
  const root = temporary(t), file = path.join(root, 'config.local.json');
  const original = JSON.stringify({ owner: { uuid: OWNER, prefix: '' }, controller: { enabled: true }, minecraft: { port: 24444 }, vision: { enabled: true } }); fs.writeFileSync(file, original);
  const result = saveConnections({ routing: 'characters' }, { root }); const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.owner.prefix, ''); assert.equal(saved.owner.uuid, OWNER); assert.equal(saved.minecraft.port, 24444); assert.equal(saved.vision.enabled, true);
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original);
  assert.equal(saveConnections({ routing: 'characters' }, { root }).changed, false);
  assert.throws(() => saveConnections({ command: 'not permitted' }, { root }));
  const publicRoutes = { clchan: { provider: 'claude', model: 'opus' }, fablechan: { provider: 'codex', model: null } };
  const limited = saveConnections({ routing: 'characters', characters: publicRoutes }, { root });
  assert.deepEqual(limited.connections.characters.clchan, publicRoutes.clchan);
  assert.deepEqual(limited.connections.characters.gpchan, recommendedRoutes.gpchan);
  assert.throws(() => saveConnections({ characters: null }, { root }));
  assert.throws(() => saveConnections({ characters: { unexpected: publicRoutes.clchan } }, { root }));
});

test('Windows atomic settings save survives a real short-lived file lock', { skip: process.platform !== 'win32' }, async t => {
  const root = temporary(t), file = path.join(root, 'settings.json'); atomicJson(file, { original: true });
  const code = '$stream = [IO.File]::Open($env:MAKMOLGA_TEST_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); try { [Console]::Out.WriteLine("locked"); Start-Sleep -Milliseconds 180 } finally { $stream.Dispose() }';
  const child = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, shell: false, env: { ...process.env, MAKMOLGA_TEST_LOCK_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close'); t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', resolve); child.stderr.once('data', bytes => reject(new Error(String(bytes)))); });
  atomicJson(file, { saved: true }); assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { saved: true });
  assert.equal((await exited)[0], 0); assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
});
test('MCP merge is idempotent and retains other servers and permission denies', t => {
  const root = temporary(t), home = path.join(root, 'home');
  backedJson(path.join(root, '.mcp.json'), () => ({ mcpServers: { existing: { command: 'other' } }, other: 42 }));
  backedJson(path.join(home, '.gemini/antigravity-cli/settings.json'), () => ({ theme: 'dark', permissions: { deny: ['command(*)'], ask: ['mcp(existing/*)'], allow: [] } }));
  registerConnections(root, home); const result = registerConnections(root, home);
  assert.equal(result.every(c => !c.changed), true);
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'))); assert.equal(claude.mcpServers.existing.command, 'other'); assert.equal(claude.other, 42);
  const agy = JSON.parse(fs.readFileSync(path.join(home, '.gemini/antigravity-cli/settings.json')));
  assert.deepEqual(agy.permissions, { deny: ['command(*)'], ask: ['mcp(existing/*)'], allow: ['mcp(makmolga/*)'] }); assert.equal(agy.theme, 'dark');
  const bad = path.join(root, 'broken.json'); fs.writeFileSync(bad, '{ invalid'); assert.throws(() => backedJson(bad, () => ({}))); assert.equal(fs.readFileSync(bad, 'utf8'), '{ invalid');
  const unusedHome = path.join(root, 'unused-home'); registerConnections(root, unusedHome, { antigravity: false });
  assert.equal(fs.existsSync(unusedHome), false);
});
test('program discovery never executes shell wrappers and honors explicit paths', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'claude.cmd'), 'echo never');
  assert.equal(findProgram('claude', path.join(root, 'claude.cmd'), { platform: 'win32', env: {}, home: root }), null);
  assert.equal(findProgram('claude', process.execPath), process.execPath);
  assert.equal(findProgram('antigravity', path.join(root, 'missing.exe')), null);
  const environment = { PATH: 'fixture' };
  assert.ok(providerEnv('antigravity', environment).SSH_CONNECTION);
  assert.equal(environment.SSH_CONNECTION, undefined);
  assert.equal(providerEnv('claude', environment), environment);
});

test('a fresh Codex account reports login required and a failed status command never claims signed in', () => {
  assert.equal(codexLoginState({ code: 1, stdout: '', stderr: 'Not logged in\n' }), 'required');
  assert.equal(codexLoginState({ code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }), 'signed_in');
  assert.equal(codexLoginState({ code: 1, stdout: 'Logged in', stderr: 'verification failed' }), 'unknown');
  assert.equal(codexLoginState({ code: null, stdout: '', stderr: 'network timeout' }), 'unknown');
});
test('provider prompts preserve exact owner text and advertise missing Antigravity images', () => {
  const text = '일단… 하던 일 계속 해 주세요!';
  const input = cliInput('antigravity', { input: [{ type: 'text', text }, { type: 'localImage', path: 'not-read.png' }], additionalContext: { scene: 'test' } });
  assert.equal(input.message.content[1].text, text); assert.match(input.message.content[2].text, /unavailable/);
  const args = cliArguments('claude', { session: { id: 'id', remoteId: 'saved' }, model: 'fable', mcpFile: 'mcp.json', promptFile: 'persona.md' });
  assert.ok(args.includes('--resume')); assert.ok(args.includes('--strict-mcp-config')); assert.equal(args.includes('--dangerously-skip-permissions'), false);
});
for (const provider of ['claude', 'antigravity']) test(`${provider}: real process → MCP → game tool → one final reply`, async t => {
  const { rpc, controller, store, bot } = external(t, provider);
  store.message({ text: 'fixture-normal', source: 'minecraft', owner: OWNER }); await controller.pump();
  await timeout(() => store.data.events.some(e => e.type === 'controller_reply'));
  assert.equal(store.data.messages[0].status, 'delivered'); assert.equal(controller.fault, false);
  assert.equal(bot.calls.filter(c => c[0] === 'chat').length, 1);
  assert.ok(store.data.controller.cliSessions[controller.threadId].remoteId);
  const endpoint = rpc.turn; assert.equal(endpoint, null);
});
test('CLI chat remains pending without cancelling work; explicit halt revokes the turn', async t => {
  const { controller, store, runtime, rpc } = external(t);
  store.message({ text: 'fixture-hold', source: 'minecraft', owner: OWNER }); await controller.pump();
  await timeout(() => rpc.turn?.init);
  const turn = rpc.turn, port = turn.server.address().port, token = turn.token;
  store.message({ text: '그냥 같이 걷고 싶었어요', source: 'minecraft', owner: OWNER }); await controller.pump();
  assert.equal(store.data.messages[1].status, 'pending'); assert.equal(runtime.halted, null);
  runtime.stop('Explicit owner stop'); await timeout(() => controller.activeTurn === null);
  assert.equal(rpc.turn, null); assert.equal(turn.done, true);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/call`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' }));
});
test('a provider process crash after tool execution marks delivery uncertain and never replays it', async t => {
  const { controller, store } = external(t);
  store.message({ text: 'fixture-crash-after-tool', source: 'minecraft', owner: OWNER }); await controller.pump();
  await timeout(() => controller.fault);
  assert.equal(store.data.messages[0].status, 'uncertain'); const requests = store.data.controller.requests.length;
  await controller.pump(); assert.equal(store.data.controller.requests.length, requests);
});
test('unexpected host tools fail closed before a game tool is accepted', async t => {
  const { controller, store } = external(t);
  store.message({ text: 'fixture-host-tools', source: 'minecraft', owner: OWNER }); await controller.pump(); await timeout(() => controller.fault);
  assert.ok(store.data.events.some(e => e.type === 'provider_tools_rejected')); assert.equal(store.data.messages[0].status, 'uncertain');
});
test('connection center requires a bearer, rejects foreign origins and cannot dispatch arbitrary tools', async t => {
  const calls = [], service = { snapshot: () => ({ ok: true }), action: async (...args) => { calls.push(args); return { ok: true }; }, close() {} };
  const { server, token } = await serveConnections({ root: temporary(t), service }); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/api/state')).status, 401);
  assert.equal((await fetch(url + '/api/state', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' } })).status, 403);
  const response = await fetch(url + '/api/action', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'save', input: { routing: 'characters' } }) });
  assert.equal(response.status, 200); assert.equal(calls.length, 1);
  const config = new ConnectionService(temporary(t)); await assert.rejects(config.action('arbitrary-command', {}), /Unknown/); config.close();
});
