import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GameSetup, lookupOwner } from '../src/game-setup.mjs';
import { downloadVerified } from '../src/downloads.mjs';

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'makmolga-release-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('makmolga-release-')); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'runtime')); fs.writeFileSync(path.join(root, 'package.json'), '{"version":"9.8.7"}');
  const invoke = async () => { throw Object.assign(new Error('No runtime'), { code: 'ENOENT' }); };
  const game = new GameSetup(root, { invoke, runner: async () => ({ code: 0 }), javaFinder: async () => ({ available: true, command: process.execPath, version: 'fixture Java' }),
    javaInstaller: async () => ({ available: true, command: process.execPath }), downloader: async (_spec, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture Fabric API'); return file; } });
  const settings = { ...game.settings(), gameDirectory: path.join(root, 'minecraft'), ownerName: 'Owner', ownerUuid: '11111111-2222-3333-4444-555555555555', botName: 'CompanionBot' };
  return { root, game, settings };
}
test('first-run game settings need no manual JSON and preserve unrelated configuration with exact backup', async t => {
  const { root, game, settings } = sandbox(t), file = path.join(root, 'config.local.json');
  const before = '{\n "safety": {"home": {"x": 3,"y": 64,"z": 7}}, "controller": {"model": "existing-model"}\n}'; fs.writeFileSync(file, before);
  await game.save(settings);
  const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.owner.uuid, settings.ownerUuid); assert.equal(saved.controller.enabled, true); assert.equal(saved.owner.prefix, '');
  assert.deepEqual(saved.safety.home, { x: 3, y: 64, z: 7 }); assert.equal(saved.controller.model, 'existing-model');
  const backup = fs.readdirSync(root).find(f => f.startsWith('config.local.json.makmolga-')); assert.equal(fs.readFileSync(path.join(root, backup), 'utf8'), before);
  await assert.rejects(game.save({ ...settings, host: 'example.com/command' }));
  await assert.rejects(game.save({ ...settings, ownerUuid: 'not-a-uuid' }));
  await assert.rejects(game.save({ ...settings, command: 'unexpected.exe' }));
});
test('game settings cannot silently replace a running owner or cross the offline host boundary', async t => {
  const { root, game, settings } = sandbox(t); await game.save(settings);
  const file = path.join(root, 'config.local.json'), before = fs.readFileSync(file, 'utf8');
  game.invoke = async () => ({ root, runtime: { activeJob: { id: 'working' } } });
  await assert.rejects(game.save({ ...settings, ownerName: 'Another' }), /종료/); assert.equal(fs.readFileSync(file, 'utf8'), before);
  game.invoke = async () => ({ root: path.join(root, 'other'), runtime: {} });
  await assert.rejects(game.save(settings), /다른 맠몰가/);
  game.invoke = async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };
  const c = JSON.parse(before); c.minecraft.auth = 'offline'; c.minecraft.allowOfflineLocal = true; c.proxy.authMethod = 'NONE'; fs.writeFileSync(file, JSON.stringify(c));
  await assert.rejects(game.save({ ...settings, host: 'remote.example' }), /외부 서버/);
});

test('preparing dependencies before game settings keeps ordinary chat as the first-run default', async t => {
  const { root, game } = sandbox(t);
  assert.equal(game.settings().prefix, '');
  await game.prepare();
  assert.equal(game.settings().prefix, '');
  const file = path.join(root, 'config.local.json'), config = JSON.parse(fs.readFileSync(file));
  config.owner = { prefix: '!friend ' }; fs.writeFileSync(file, JSON.stringify(config));
  await game.prepare(); assert.equal(game.settings().prefix, '!friend ');
});
test('official username lookup validates the returned identity and does not accept command-shaped names', async () => {
  let urls = [];
  const fetcher = async url => { urls.push(url); return Response.json({ id: '11111111222233334444555555555555', name: 'Owner' }); };
  assert.deepEqual(await lookupOwner('Owner', { fetcher }), { ownerName: 'Owner', ownerUuid: '11111111-2222-3333-4444-555555555555' });
  assert.equal(urls[0], 'https://api.mojang.com/users/profiles/minecraft/Owner');
  await assert.rejects(lookupOwner('../private', { fetcher })); assert.equal(urls.length, 1);
  await assert.rejects(lookupOwner('SomeoneElse', { fetcher }), /프로필 응답/);
});
test('download checksums preserve an existing file on corruption and reuse a verified file', async t => {
  const { root } = sandbox(t), file = path.join(root, 'download.jar'); fs.writeFileSync(file, 'old version');
  const bytes = Buffer.from('verified artifact'), spec = { url: 'https://example.com/fixture.jar', sha256: createHash('sha256').update(bytes).digest('hex') };
  await assert.rejects(downloadVerified(spec, file, { fetcher: async () => new Response('wrong bytes') }), /체크섬/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old version'); assert.equal(fs.readdirSync(root).some(n => n.endsWith('.download')), false);
  await downloadVerified(spec, file, { fetcher: async () => new Response(bytes) }); assert.deepEqual(fs.readFileSync(file), bytes);
  await downloadVerified(spec, file, { fetcher: () => { throw new Error('No network expected'); } });
});
test('mod installation backs up JARs, links this runtime and preserves saved world choices', async t => {
  const { root, game, settings } = sandbox(t), dir = settings.gameDirectory;
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true }); fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'mods/companion-selector-26.2-old.jar'), 'old mod'); fs.writeFileSync(path.join(dir, 'mods/unrelated.jar'), 'keep me');
  const prefs = { schemaVersion: 1, worlds: { myWorld: { characterId: 'gpchan', deferred: false } }, runtimeDirectory: 'old' };
  fs.writeFileSync(path.join(dir, 'config/companion-selector.json'), JSON.stringify(prefs));
  fs.mkdirSync(path.join(root, 'mods')); fs.writeFileSync(path.join(root, 'mods/companion-selector-26.2-9.8.7.jar'), 'new mod');
  const result = await game.installMod(dir); assert.equal(result.installed, true);
  assert.equal(fs.readFileSync(path.join(result.backup, 'companion-selector-26.2-old.jar'), 'utf8'), 'old mod');
  assert.equal(fs.readFileSync(path.join(dir, 'mods/unrelated.jar'), 'utf8'), 'keep me');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config/companion-selector.json'))); assert.deepEqual(saved.worlds, prefs.worlds); assert.equal(saved.runtimeDirectory, root);
  assert.equal(fs.existsSync(path.join(dir, 'mods/companion-selector-26.2-old.jar')), false);
});
test('a rejected preferences document rolls a mod upgrade back without replacing unknown mods', async t => {
  const { root, game, settings } = sandbox(t), dir = settings.gameDirectory;
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true }); fs.mkdirSync(path.join(dir, 'config')); fs.mkdirSync(path.join(root, 'mods'));
  fs.writeFileSync(path.join(dir, 'mods/companion-selector-26.2-old.jar'), 'old mod');
  fs.writeFileSync(path.join(root, 'mods/companion-selector-26.2-9.8.7.jar'), 'new mod'); fs.writeFileSync(path.join(dir, 'config/companion-selector.json'), '{broken');
  await assert.rejects(game.installMod(dir));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')), ['companion-selector-26.2-old.jar']);
  assert.equal(fs.readFileSync(path.join(dir, 'mods/companion-selector-26.2-old.jar'), 'utf8'), 'old mod');
  assert.equal(fs.readFileSync(path.join(dir, 'config/companion-selector.json'), 'utf8'), '{broken');
});
test('startup success requires a connected real session even when the launcher exits successfully', async t => {
  const { root, game, settings } = sandbox(t); await game.save(settings);
  game.runner = async () => ({ code: 0, stdout: '{"ready":true}', stderr: '' });
  game.invoke = async () => ({ root, runtime: { connection: 'disconnected' }, controller: { ready: true } });
  await assert.rejects(game.start(), /実際|실제 동료 접속/);
  game.invoke = async () => ({ root, runtime: { connection: 'connected' }, controller: { ready: true } });
  assert.equal((await game.start()).ready, true);
});
