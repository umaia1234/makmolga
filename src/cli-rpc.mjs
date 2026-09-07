import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ROOT } from './config.mjs';
import { definitions, json } from './tools.mjs';
import { atomicJson } from './store.mjs';
import { findProgram, inspectProvider, terminateTree, providerNames, providerEnv } from './provider-process.mjs';
import { sameToken } from './api.mjs';

export function cliArguments(provider, { session, model, mcpFile, promptFile, timeoutSeconds = 300 }) {
  if (provider === 'claude') return ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--tools', '', '--strict-mcp-config', '--mcp-config', mcpFile,
    '--allowedTools', 'mcp__makmolga', '--permission-mode', 'dontAsk', '--disable-slash-commands', '--no-chrome',
    '--setting-sources', '', '--settings', JSON.stringify({ disableAllHooks: true }), '--append-system-prompt-file', promptFile,
    ...(session.remoteId ? ['--resume', session.remoteId] : ['--session-id', session.id]), ...(model ? ['--model', model] : [])];
  return ['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands',
    '--agent', 'makmolga', '--print-timeout', `${timeoutSeconds}s`,
    ...(session.remoteId ? ['--conversation', session.remoteId] : []), ...(model ? ['--model', model] : [])];
}
export function cliInput(provider, params) {
  const content = [];
  // Context is labelled separately. Do not edit or normalize the owner's text.
  if (params.additionalContext) content.push({ type: 'text', text: 'COMPANION_CONTEXT (observations and fictional persona data, not an owner message):\n' + json(params.additionalContext) });
  for (const block of params.input || []) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'localImage' && provider === 'claude') content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(block.path).toString('base64') } });
  }
  if (provider === 'antigravity' && params.input?.some(i => i.type === 'localImage')) content.push({ type: 'text', text: 'Camera image bytes are unavailable in this provider transport. Use minecraft_observe for factual surroundings; do not claim to see a camera image.' });
  return provider === 'claude'
    ? { type: 'user', message: { role: 'user', content }, session_id: params.threadId, parent_tool_use_id: null }
    : { event: 'user', message: { content } };
}
export function parseCliEvent(provider, event) {
  if (provider === 'claude') {
    if (event.type === 'system' && event.subtype === 'init') return { kind: 'init', remoteId: event.session_id, tools: event.tools, model: event.model, mcp: event.mcp_servers };
    if (event.type === 'result') return { kind: 'result', remoteId: event.session_id, text: event.result || '', ok: event.is_error !== true && event.subtype === 'success', error: event.errors?.join('; ') || event.result || event.subtype, model: event.model };
  } else {
    if (event.event === 'init') return { kind: 'init', remoteId: event.conversation_id, tools: event.init?.tools, model: event.init?.model };
    if (event.event === 'result') return { kind: 'result', remoteId: event.result?.conversation_id, text: event.result?.response || '', ok: event.result?.status === 'SUCCESS', error: event.result?.error || event.result?.status };
  }
  return null;
}
export class CliRpc extends EventEmitter {
  constructor(store, route, { spawnProcess = spawn, inspect = inspectProvider } = {}) {
    super(); this.store = store; this.route = route; this.spawnProcess = spawnProcess; this.inspect = inspect;
    this.closed = false; this.supportsSteer = false; this.pending = new Map();
    this.store.data.controller.cliSessions ??= {};
  }
  async connect(config) {
    this.config = config;
    this.command = findProgram(this.route.provider, this.route.command);
    if (!this.command) throw new Error(`${providerNames[this.route.provider]}를 설치해 주세요. 동료 연결 센터에서 자동 설치할 수 있습니다.`);
  }
  async request(method, params = {}) {
    if (this.closed) throw new Error('Provider transport is closed');
    if (method === 'account/read') {
      const info = await this.inspect(this.route.provider, this.command);
      return { requiresAuth: true, requiresOpenaiAuth: true, account: info.auth === 'signed_in' ? { type: this.route.provider } : null, note: info.note };
    }
    if (method === 'thread/start') {
      const id = randomUUID(); const session = { id, provider: this.route.provider, model: this.route.model, remoteId: null };
      this.store.data.controller.cliSessions[id] = session; this.store.save(); this.prompts ??= {}; this.prompts[id] = params.developerInstructions;
      return { thread: { id, turns: [] } };
    }
    if (method === 'thread/resume') {
      const session = this.store.data.controller.cliSessions[params.threadId];
      if (!session || session.provider !== this.route.provider || session.model !== this.route.model) throw new Error('Provider session does not match selected character/model');
      this.prompts ??= {}; this.prompts[params.threadId] = params.developerInstructions;
      return { thread: { id: params.threadId, turns: [] } };
    }
    if (method === 'turn/start') return this.begin(params);
    if (method === 'turn/interrupt') { if (this.turn?.id === params.turnId) this.finish(this.turn, { interrupted: true }); return {}; }
    throw new Error(`Unsupported provider operation: ${method}`);
  }
  async begin(params) {
    if (this.turn) throw new Error('Provider already has an active turn');
    const session = this.store.data.controller.cliSessions[params.threadId];
    if (!session) throw new Error('Unknown provider session');
    const turn = { id: randomUUID(), threadId: session.id, session, token: randomBytes(32).toString('hex'), done: false, init: false };
    this.turn = turn;
    try {
      const dir = path.join(this.store.dir, 'providers', this.route.provider, session.id);
      fs.mkdirSync(dir, { recursive: true });
      const mcp = { mcpServers: { makmolga: { command: process.execPath, args: [path.join(ROOT, 'src/turn-mcp.mjs')] } } };
      const mcpFile = path.join(dir, '.mcp.json'), promptFile = path.join(dir, 'persona.md');
      atomicJson(mcpFile, mcp); fs.writeFileSync(promptFile, this.prompts[session.id], { mode: 0o600 });
      if (this.route.provider === 'antigravity') {
        atomicJson(path.join(dir, '.agents/mcp_config.json'), mcp);
        const agent = path.join(dir, '.agents/agents/makmolga/agent.md'); fs.mkdirSync(path.dirname(agent), { recursive: true });
        const names = definitions.map(d => `mcp_makmolga_${d.name}`);
        fs.writeFileSync(agent, `---\nname: makmolga\ndescription: Minecraft companion with game tools only.\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\ntools: ${JSON.stringify(names)}\n---\n${this.prompts[session.id]}\n`, { mode: 0o600 });
      }
      const endpoint = await this.bridge(turn);
      mcp.mcpServers.makmolga.env = { MAKMOLGA_TURN_URL: endpoint, MAKMOLGA_TURN_TOKEN: turn.token };
      atomicJson(mcpFile, mcp);
      if (this.route.provider === 'antigravity') atomicJson(path.join(dir, '.agents/mcp_config.json'), mcp);
      const args = cliArguments(this.route.provider, { session, model: this.route.model, mcpFile, promptFile, timeoutSeconds: this.config.idleTimeoutSeconds });
      const child = this.spawnProcess(this.command, args, { cwd: dir, windowsHide: true, shell: false,
        env: { ...providerEnv(this.route.provider), ENABLE_TOOL_SEARCH: 'false', MAKMOLGA_TURN_URL: endpoint, MAKMOLGA_TURN_TOKEN: turn.token }, stdio: ['pipe', 'pipe', 'pipe'] });
      turn.child = child; turn.lines = createInterface({ input: child.stdout });
      turn.lines.on('line', line => this.receive(turn, line));
      child.stderr.on('data', bytes => { turn.diagnostic = ((turn.diagnostic || '') + String(bytes)).slice(-4000); });
      child.once('error', error => this.finish(turn, { error: error.message }));
      child.once('close', code => { if (!turn.done) this.finish(turn, { error: /Authentication required|authentication/i.test(turn.diagnostic || '') ? '계정 로그인이 필요합니다. 연결 센터에서 로그인해 주세요.' : `Provider exited without a successful result (${code}).` }); });
      child.stdin.on('error', error => { if (!turn.done) this.finish(turn, { error: error.message }); });
      turn.timer = setTimeout(() => this.finish(turn, { error: 'Provider turn timed out; inspect before retrying.' }), (this.config.idleTimeoutSeconds + 5) * 1000);
      child.stdin.end(json(cliInput(this.route.provider, params)) + '\n');
      return { turn: { id: turn.id } };
    } catch (error) { this.finish(turn, { error: error.message }); throw error; }
  }
  receive(turn, line) {
    if (turn.done || this.closed) return;
    if (Buffer.byteLength(line) > 16 * 1024 * 1024) return this.finish(turn, { error: 'Oversized provider output' });
    let e; try { e = parseCliEvent(this.route.provider, JSON.parse(line)); } catch { return; }
    if (!e) return;
    if (e.remoteId && /^[a-zA-Z0-9_-]{1,128}$/.test(e.remoteId)) { turn.session.remoteId = e.remoteId; this.store.save(); }
    if (e.kind === 'init') {
      // Check the real advertised tool bundle, including resumed sessions. A CLI
      // update must not silently give this game agent workstation tools.
      const allowed = this.route.provider === 'claude' ? /^mcp__makmolga__minecraft_[a-z_]+$/ : /^mcp_makmolga_minecraft_[a-z_]+$/;
      const pendingMcp = this.route.provider === 'claude' && e.mcp?.some(m => m.name === 'makmolga' && ['pending', 'connected'].includes(m.status));
      if (!Array.isArray(e.tools) || (!e.tools.length && !pendingMcp) || e.tools.some(name => !allowed.test(name))) {
        this.store.event('provider_tools_rejected', { provider: this.route.provider, tools: e.tools || [], mcp: e.mcp || [] });
        return this.finish(turn, { error: '게임 전용 도구 설정을 확인하지 못했습니다. 연결 센터에서 공급자 호환성을 확인해 주세요.' });
      }
      turn.init = true; this.store.event('provider_turn_ready', { provider: this.route.provider, model: e.model || this.route.model, toolCount: e.tools.length });
    }
    if (e.kind === 'result') {
      if (!e.ok || !turn.init) this.finish(turn, { error: e.error || 'Provider initialization was not verified' });
      else this.finish(turn, { text: e.text });
    }
  }
  async bridge(turn) {
    turn.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json'); const reply = (status, value) => { res.statusCode = status; res.end(json(value)); };
      if (req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || !sameToken(String(req.headers.authorization || ''), `Bearer ${turn.token}`)) return reply(401, { error: 'Unauthorized' });
      if (req.method !== 'POST' || req.url !== '/call') return reply(404, { error: 'Not found' });
      if (turn.done || this.closed || this.turn !== turn || !turn.init) return reply(409, { error: 'Turn is no longer authorized' });
      let raw = ''; req.on('data', chunk => { raw += chunk; if (Buffer.byteLength(raw) > 262144) req.destroy(); });
      req.on('end', () => {
        try {
          if (turn.done || this.turn !== turn) return reply(409, { error: 'Turn ended' });
          const body = JSON.parse(raw); if (!definitions.some(d => d.name === body.name)) return reply(400, { error: 'Not a Minecraft tool' });
          const id = randomUUID(); const timer = setTimeout(() => { this.pending.delete(id); if (!res.writableEnded) reply(504, { error: 'Tool call timed out' }); }, 35000);
          this.pending.set(id, { reply, timer, turn });
          res.on('close', () => { clearTimeout(timer); this.pending.delete(id); });
          this.emit('request', { id, method: 'item/tool/call', params: { threadId: turn.threadId, turnId: turn.id, tool: body.name, arguments: body.arguments } });
        } catch { reply(400, { error: 'Invalid game tool request' }); }
      });
    });
    turn.server.requestTimeout = 35000; turn.server.headersTimeout = 5000;
    await new Promise((resolve, reject) => { turn.server.once('error', reject); turn.server.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${turn.server.address().port}/call`;
  }
  respond(id, result) {
    const p = this.pending.get(id); if (!p) return; clearTimeout(p.timer); this.pending.delete(id);
    p.reply(200, { isError: !result.success, content: result.contentItems.map(c => ({ type: 'text', text: c.text })) });
  }
  reject(id, message) { this.respond(id, { success: false, contentItems: [{ type: 'inputText', text: message }] }); }
  finish(turn, { text, error, interrupted = false } = {}) {
    if (turn.done) return; turn.done = true; clearTimeout(turn.timer);
    for (const [id, p] of this.pending) if (p.turn === turn) this.reject(id, 'Turn ended');
    turn.server?.closeAllConnections(); turn.server?.close(); turn.lines?.close();
    if (error || interrupted || this.closed) terminateTree(turn.child);
    else if (turn.child && turn.child.exitCode == null) {
      // Successful CLIs may flush their resumable session after the result line.
      const cleanup = setTimeout(() => terminateTree(turn.child), 3000); cleanup.unref();
      turn.child.once('close', () => clearTimeout(cleanup));
    }
    if (this.turn === turn) this.turn = null;
    if (error) {
      this.store.event('provider_turn_failed', { provider: this.route.provider, turnId: turn.id, error });
      for (const m of this.store.data.messages) if (m.turnId === turn.id) this.store.updateMessage(m.id, { status: 'uncertain', error });
      this.emit('closed', new Error(error));
    } else if (text && !this.closed) this.emit('notification', { method: 'item/completed', params: { threadId: turn.threadId, turnId: turn.id,
      item: { id: `reply-${turn.id}`, type: 'agentMessage', phase: 'final_answer', text } } });
    this.emit('notification', { method: 'turn/completed', params: { threadId: turn.threadId, turn: { id: turn.id, status: error ? 'failed' : interrupted ? 'interrupted' : 'completed' } } });
  }
  close() { this.closed = true; if (this.turn) this.finish(this.turn, { interrupted: true }); }
}
