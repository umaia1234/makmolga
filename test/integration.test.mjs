import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { serve } from '../src/api.mjs';
import { ROOT } from '../src/config.mjs';
import { call } from '../src/client.mjs';
import { fixture, finished } from './helpers.mjs';

test('HTTP API enforces token/origin, validates action, and returns job results', async t => {
  const { runtime, store } = fixture(t); const server = await serve(runtime); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/call`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://attacker.example', Authorization: `Bearer ${store.token}` }, body: '{}' })).status, 403);
  const status = await call('minecraft_status', {}, { dir: store.dir }); assert.equal(status.bot.health, 20);
  await assert.rejects(call('minecraft_action', { action: { type: 'control', keys: ['bad'] } }, { dir: store.dir }));
  const job = await call('minecraft_action', { action: { type: 'control', milliseconds: 50 } }, { dir: store.dir }); await finished(runtime);
  assert.equal((await call('minecraft_job', { id: job.id }, { dir: store.dir })).status, 'completed');
});
test('actual MCP stdio client discovers tools and controls the persistent runtime', { timeout: 30000 }, async t => {
  const { runtime, store } = fixture(t); const server = await serve(runtime); t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new Client({ name: 'companion-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src/mcp.mjs')], env: { ...process.env, COMPANION_RUNTIME: store.dir }, stderr: 'pipe' });
  t.after(() => client.close()); await client.connect(transport);
  const list = await client.listTools(); assert.equal(list.tools.length, 15);
  const result = await client.callTool({ name: 'minecraft_status', arguments: {} }); assert.equal(JSON.parse(result.content[0].text).bot.health, 20);
  const action = await client.callTool({ name: 'minecraft_action', arguments: { action: { type: 'control', keys: ['forward'], milliseconds: 1000 } } });
  const jobId = JSON.parse(action.content[0].text).id;
  await client.callTool({ name: 'minecraft_stop', arguments: {} }); await finished(runtime);
  const stopped = await client.callTool({ name: 'minecraft_job', arguments: { id: jobId } }); assert.equal(JSON.parse(stopped.content[0].text).status, 'cancelled');
});
