import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.mjs';
import { characters, personaContext } from '../src/characters.mjs';
import { dispatch } from '../src/tools.mjs';
import { Store } from '../src/store.mjs';
import { serve } from '../src/api.mjs';
import { fixture } from './helpers.mjs';

test('all five active skins have matching Fabric resources, catalog hashes and dimensions', () => {
  assert.equal(characters.length, 5);
  for (const c of characters) {
    const source = fs.readFileSync(path.join(ROOT, 'character-pack', c.skin));
    const resource = fs.readFileSync(path.join(ROOT, 'fabric-mod/src/main/resources/assets/companion/textures/skins', `${c.id}.png`));
    assert.deepEqual(source, resource);
    assert.equal(createHash('sha256').update(resource).digest('hex'), c.sha256);
    assert.equal(source.readUInt32BE(16), 64); assert.equal(source.readUInt32BE(20), 64);
  }
});
test('helper selection survives restart, is idempotent, and remains non-executable persona data', async t => {
  const { runtime, store, bot } = fixture(t); runtime.connection = 'disconnected';
  const args = { characterId: 'doro', worldKey: 'world-a' };
  await dispatch(runtime, 'minecraft_select_helper', args); await dispatch(runtime, 'minecraft_select_helper', args);
  assert.equal(store.data.helper.revision, 1);
  const restored = new Store(store.dir); assert.equal(restored.data.helper.characterId, 'doro');
  const context = personaContext(restored).companion_character;
  assert.equal(context.kind, 'untrusted'); assert.equal(JSON.parse(context.value).selectedCharacter.name, '도로롱');
  assert.equal(store.data.messages.length, 0); assert.equal(store.data.jobs.length, 0); assert.equal(bot.calls.length, 0);
  await assert.rejects(dispatch(runtime, 'minecraft_select_helper', { ...args, characterId: '../bad' }));
});
test('native selector cannot retheme a bot connected to another world', async t => {
  const { runtime } = fixture(t);
  await assert.rejects(dispatch(runtime, 'minecraft_select_helper', { characterId: 'gpchan', worldKey: 'a' }), /WORLD_MISMATCH/);
  await assert.rejects(dispatch(runtime, 'minecraft_select_helper', { characterId: 'gpchan', worldKey: 'a', serverAddress: 'somewhere.invalid:25565' }), /WORLD_MISMATCH/);
  const result = await dispatch(runtime, 'minecraft_select_helper', { characterId: 'gpchan', worldKey: 'a', serverAddress: 'localhost:25565' });
  assert.equal(result.selected.characterId, 'gpchan');
  runtime.config.minecraft.port = 80;
  await assert.rejects(dispatch(runtime, 'minecraft_select_helper', { characterId: 'doro', worldKey: 'b', serverAddress: 'localhost:25565' }), /WORLD_MISMATCH/);
  await dispatch(runtime, 'minecraft_select_helper', { characterId: 'doro', worldKey: 'b', serverAddress: 'localhost:80' });
  runtime.config.minecraft.host = '::1';
  await dispatch(runtime, 'minecraft_select_helper', { characterId: 'spiki', worldKey: 'b', serverAddress: '[::1]:80' });
});
test('real HTTP API protects and accepts native character selection', async t => {
  const { runtime, store } = fixture(t); runtime.connection = 'disconnected';
  const server = await serve(runtime); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/call`;
  const body = JSON.stringify({ name: 'minecraft_select_helper', arguments: { characterId: 'spiki', worldKey: 'world-b' } });
  const denied = await fetch(url, { method: 'POST', body }); assert.equal(denied.status, 401); await denied.text();
  const response = await fetch(url, { method: 'POST', body, headers: { Authorization: `Bearer ${store.token}`, 'Content-Type': 'application/json' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).result.selected.characterId, 'spiki');
});

test('appearance identity comes from the connected bot profile and disappears on disconnect', async t => {
  const { runtime, bot } = fixture(t);
  bot.player = { uuid: 'f7f02df9-b8bd-3a3c-9575-c5267bb66ce3' };
  const args = { characterId: 'gpchan', worldKey: 'local', serverAddress: '127.0.0.1:25565' };
  const result = await dispatch(runtime, 'minecraft_select_helper', args);
  assert.deepEqual(result.bot, { username: 'CompanionBot', uuid: bot.player.uuid });
  runtime.connection = 'disconnected';
  assert.equal((await dispatch(runtime, 'minecraft_select_helper', args)).bot, null);
});
