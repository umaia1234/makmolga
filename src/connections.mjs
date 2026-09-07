import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig, configSchema, routeSchema } from './config.mjs';
import { atomicJson } from './store.mjs';
import { inspectProvider, findProgram, runProgram, terminateTree } from './provider-process.mjs';
import { CliRpc } from './cli-rpc.mjs';
import { Rpc } from './rpc.mjs';
import { Store } from './store.mjs';
import { call } from './client.mjs';
import { characters } from './characters.mjs';
import { backedJson } from './settings.mjs';
import { GameSetup } from './game-setup.mjs';
import { downloads } from './downloads.mjs';
export { backedJson } from './settings.mjs';

export function registerConnections(root = ROOT, home = os.homedir(), { antigravity = true } = {}) {
  const definition = { command: process.execPath, args: [path.join(root, 'src/mcp.mjs')], env: { COMPANION_RUNTIME: path.join(root, 'runtime') } };
  const changes = [path.join(root, '.mcp.json'), path.join(root, '.agents/mcp_config.json')].map(file => backedJson(file, data => {
    if (data.mcpServers != null && (typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers))) throw new Error('Invalid MCP server settings');
    data.mcpServers = { ...data.mcpServers, makmolga: definition }; return data;
  }));
  // Scope automatic approval to the game MCP server. Do not relax terminal,
  // browser, filesystem, other MCP servers or existing deny/ask rules.
  if (antigravity) changes.push(backedJson(path.join(home, '.gemini/antigravity-cli/settings.json'), data => {
    data.permissions ??= {}; data.permissions.allow ??= [];
    if (!Array.isArray(data.permissions.allow)) throw new Error('Invalid Antigravity permission settings');
    if (!data.permissions.allow.includes('mcp(makmolga/*)')) data.permissions.allow.push('mcp(makmolga/*)');
    return data;
  }));
  return changes;
}
export function saveConnections(update, { root = ROOT } = {}) {
  const file = path.join(root, 'config.local.json');
  const config = loadConfig(file);
  if (!update || typeof update !== 'object' || Object.keys(update).some(key => !['routing', 'characters'].includes(key))) throw new Error('Invalid connection settings');
  if (Object.hasOwn(update, 'characters') && (!update.characters || typeof update.characters !== 'object' || Array.isArray(update.characters))) throw new Error('Invalid character routes');
  const next = configSchema.parse({ ...config, connections: { ...config.connections, ...update, characters: { ...config.connections.characters, ...update.characters } } });
  const changed = backedJson(file, previous => ({ ...previous, connections: next.connections }));
  return { ...changed, connections: next.connections };
}
export async function autoConfigure({ root = ROOT, home = os.homedir(), install = false, onProgress = () => {} } = {}) {
  const config = loadConfig(path.join(root, 'config.local.json'));
  const found = {};
  const needed = [...new Set(characters.map(c => config.connections.characters[c.id]?.provider).filter(p => p && p !== 'codex'))];
  for (const provider of needed) {
    onProgress(`${provider === 'claude' ? 'Claude Code' : 'Antigravity'} 설치 확인 중`);
    let info = await inspectProvider(provider, config.connections.providers[provider].command);
    if (!info.installed && install) { await installProvider(provider, { root, onProgress }); info = await inspectProvider(provider, null); }
    found[provider] = info;
  }
  const registrations = registerConnections(root, home, { antigravity: needed.includes('antigravity') });
  const saved = backedJson(path.join(root, 'config.local.json'), previous => {
    const current = configSchema.parse(previous);
    const providers = structuredClone(current.connections.providers);
    for (const p of Object.keys(found)) if (found[p].installed) providers[p].command = found[p].command;
    return { ...previous, ...(current.owner.uuid ? { controller: { ...previous.controller, enabled: true } } : {}), connections: { ...current.connections, routing: 'characters', providers } };
  });
  return { providers: found, saved, registrations };
}
export async function installProvider(provider, { root = ROOT, onProgress = () => {} } = {}) {
  if (!['codex', 'claude', 'antigravity'].includes(provider)) throw new Error('Unsupported automatic installer');
  if (process.platform !== 'win32') throw new Error('이 자동 설치 프로그램은 Windows용입니다. 공식 CLI를 설치한 뒤 다시 확인해 주세요.');
  const existing = findProgram(provider, null); if (existing) return { installed: true, reused: true, command: existing };
  if (provider === 'codex') {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!fs.existsSync(npmCli)) throw new Error('배포판의 Start-Makmolga.cmd로 다시 실행해 주세요. npm을 찾지 못했습니다.');
    const destination = path.join(root, 'runtime/codex');
    onProgress('공식 Codex CLI를 이 맠몰가 폴더에 설치하고 있습니다.');
    const result = await runProgram(process.execPath, [npmCli, 'install', '--prefix', destination, '--no-audit', '--no-fund', '--save-exact', `@openai/codex@${downloads.codex}`], { cwd: root, timeoutMs: 300000 });
    if (result.code !== 0) throw new Error('Codex 다운로드를 완료하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    const candidates = [
      path.join(destination, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
      path.join(destination, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
      path.join(destination, 'node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
      path.join(destination, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe'),
      path.join(destination, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe'),
      path.join(destination, 'node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe')
    ];
    const command = candidates.find(fs.existsSync); if (!command) throw new Error('설치된 Codex 실행 파일을 찾지 못했습니다.');
    const info = await inspectProvider('codex', command); if (!info.installed) throw new Error('설치된 Codex를 실행하지 못했습니다.');
    backedJson(path.join(root, 'config.local.json'), previous => ({ ...previous, controller: { ...previous.controller, command } }));
    return info;
  }
  const url = provider === 'claude' ? 'https://claude.ai/install.ps1' : 'https://antigravity.google/cli/install.ps1';
  onProgress('공식 설치 프로그램 다운로드 중');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`공식 설치 다운로드 실패 (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 1024 * 1024 || !bytes.length) throw new Error('Invalid installer size');
  const folder = path.join(root, 'runtime/installers'); fs.mkdirSync(folder, { recursive: true });
  const script = path.join(folder, `${provider}-install.ps1`); fs.writeFileSync(script, bytes);
  atomicJson(path.join(folder, `${provider}-receipt.json`), { source: url, downloadedAt: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex') });
  onProgress('설치 및 실행 파일 검증 중');
  const result = await runProgram('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    ...(provider === 'antigravity' ? ['--skip-aliases'] : [])], { timeoutMs: 300000 });
  if (result.code !== 0) throw new Error('공식 설치 프로그램이 완료되지 않았습니다. 네트워크와 설치 로그를 확인해 주세요.');
  const info = await inspectProvider(provider, null); if (!info.installed) throw new Error('설치 후 실행 파일을 확인하지 못했습니다.');
  return info;
}
export async function probeConnection(provider, model, { root = ROOT, command, timeoutMs = 95000 } = {}) {
  const dir = path.join(root, 'runtime/connection-probes', randomUUID()); const store = new Store(dir);
  const proof = randomUUID(), start = Date.now(); let toolCalls = 0, reply = '', fault;
  const rpc = provider === 'codex' ? new Rpc() : new CliRpc(store, { provider, model, command });
  const spec = [{ type: 'function', name: 'minecraft_status', description: 'Read the connection diagnostic fixture.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }];
  const prompt = 'This is a MAKMOLGA connection check. Use only minecraft_status. It returns diagnostic fixture data, not a real world. Read probe and return it verbatim. No other tools or tasks.';
  rpc.on('request', m => {
    if (m.method === 'item/tool/call' && m.params.tool === 'minecraft_status') {
      toolCalls++; rpc.respond(m.id, { success: true, contentItems: [{ type: 'inputText', text: jsonProof(proof) }] });
    } else rpc.reject(m.id, 'Only minecraft_status is available in this diagnostic');
  });
  try {
    await rpc.connect({ transport: 'stdio', command: findProgram(provider, command), idleTimeoutSeconds: Math.floor(timeoutMs / 1000) - 5 }, ROOT);
    const { thread } = await rpc.request('thread/start', { cwd: dir, ...(model ? { model } : {}), developerInstructions: prompt, dynamicTools: spec, ephemeral: true, environments: [] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('연결 시험 시간이 초과되었습니다. 계정과 네트워크를 확인해 주세요.')), timeoutMs);
      rpc.on('closed', error => { fault = error.message; clearTimeout(timer); reject(error); });
      rpc.on('notification', m => {
        if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') reply = m.params.item.text;
        if (m.method === 'turn/completed') { clearTimeout(timer); m.params.turn.status === 'completed' ? resolve() : reject(new Error(fault || '모델이 연결 시험을 완료하지 못했습니다.')); }
      });
      rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'minecraft_status를 호출해서 결과의 probe 값을 그대로 답해주세요.', text_elements: [] }] }).catch(e => { clearTimeout(timer); reject(e); });
    });
    if (!toolCalls || !reply.includes(proof)) throw new Error('모델 응답은 왔지만 실제 도구 결과를 확인하지 못했습니다.');
    return { ok: true, provider, model, toolCalls, elapsedMs: Date.now() - start, checkedAt: new Date().toISOString(), note: '실제 모델 응답과 게임 도구 왕복을 확인했습니다.' };
  } finally { rpc.close(); }
}
const jsonProof = probe => JSON.stringify({ connection: 'diagnostic-fixture', probe });

export class ConnectionService {
  constructor(root = ROOT) { this.root = root; this.tasks = new Map(); this.providers = []; this.logins = new Map(); this.game = new GameSetup(root); this.checksFile = path.join(root, 'runtime/connection-checks.json'); }
  config() { return loadConfig(path.join(this.root, 'config.local.json')); }
  async refresh() {
    const config = this.config();
    this.providers = await Promise.all(['codex', 'claude', 'antigravity'].map(id => {
      const login = [...this.logins.values()].some(l => l.provider === id && ['starting', 'waiting', 'verifying'].includes(l.state));
      // Never start another OAuth flow while the owner is completing one.
      return login ? this.providers.find(p => p.id === id) || { id, installed: true, auth: 'required', state: 'login_required', note: '진행 중인 공식 로그인 창에서 완료해 주세요.' }
        : inspectProvider(id, id === 'codex' ? config.controller.command : config.connections.providers[id].command);
    }));
    await this.game.inspect(); return this.snapshot();
  }
  snapshot() {
    const config = this.config(); let checks = {};
    try { checks = JSON.parse(fs.readFileSync(this.checksFile, 'utf8')); } catch {}
    return { providers: this.providers, connections: config.connections, characters: characters.map(({ id, name, tagline, color }) => ({ id, name, tagline, color })),
      checks, fallbackRoute: { provider: 'codex', model: config.controller.model }, game: this.game.state || { settings: this.game.settings(), session: { running: false } }, tasks: [...this.tasks.values()].slice(-12), logins: [...this.logins.values()].map(({ child, timer, output, ...l }) => l), root: this.root };
  }
  task(label, action) {
    if ([...this.tasks.values()].some(t => t.state === 'running')) throw new Error('현재 연결 작업이 진행 중입니다. 완료 후 다시 시도해 주세요.');
    const task = { id: randomUUID(), label, state: 'running', progress: label, startedAt: new Date().toISOString() }; this.tasks.set(task.id, task);
    void action(text => task.progress = text).then(result => { task.state = 'done'; task.result = result; task.progress = '완료되었습니다.'; }, error => { task.state = 'failed'; task.error = error.message; task.progress = error.message; });
    return task;
  }
  async action(name, input = {}) {
    if (name === 'game-lookup') { const { lookupOwner } = await import('./game-setup.mjs'); return lookupOwner(input.name); }
    if (name === 'game-status') return this.game.inspect();
    if (name === 'game-save') { if ([...this.tasks.values()].some(t => t.state === 'running')) throw new Error('준비 작업이 끝난 뒤 설정을 저장해 주세요.'); return this.game.save(input); }
    if (name === 'game-prepare') return this.task('게임 실행 환경 준비', progress => this.game.prepare(progress));
    if (name === 'game-install') return this.task('Minecraft에 모드 설치', progress => this.game.installMod(input.gameDirectory, progress));
    if (name === 'game-server') return this.task('게임 서버 확인', () => this.game.checkServer());
    if (name === 'game-login') return this.game.loginBot();
    if (name === 'game-start') return this.task('동료와 함께 시작', progress => this.game.start(progress));
    if (name === 'game-stop') return this.game.control('stop');
    if (name === 'game-resume') return this.game.control('resume');
    if (name === 'game-shutdown') return this.game.control('shutdown');
    const valid = id => { if (!['codex', 'claude', 'antigravity'].includes(id)) throw new Error('Unknown provider'); };
    if (name === 'refresh') return this.task('설치와 로그인 확인', async () => { await this.refresh(); return { refreshed: true }; });
    if (name === 'auto') return this.task('동료 자동 연결', async progress => { const result = await autoConfigure({ root: this.root, install: true, onProgress: progress }); await this.refresh(); return result; });
    if (name === 'save') return saveConnections(input, { root: this.root });
    if (name === 'install') { valid(input.provider); return this.task('공식 CLI 설치', async progress => { const result = await installProvider(input.provider, { root: this.root, onProgress: progress }); await this.refresh(); return result; }); }
    if (name === 'probe') {
      valid(input.provider);
      const config = this.config();
      const selected = routeSchema.parse({ provider: input.provider, model: input.model ?? null });
      return this.task('모델·도구 연결 시험', async progress => {
        progress('실제 모델에 게임 상태 읽기를 요청하고 있습니다.');
        const result = await probeConnection(selected.provider, selected.model, { root: this.root, command: selected.provider === 'codex' ? config.controller.command : config.connections.providers[selected.provider].command });
        const key = `${selected.provider}:${selected.model || 'default'}`;
        backedJson(this.checksFile, old => ({ ...old, [key]: result })); return result;
      });
    }
    if (name === 'login') { valid(input.provider); return this.login(input.provider); }
    if (name === 'login-code') {
      const login = this.logins.get(input.id);
      if (!login || login.state !== 'waiting' || typeof input.code !== 'string' || !/^[^\s]{4,4096}$/.test(input.code)) throw new Error('로그인 요청이 만료되었거나 코드가 올바르지 않습니다.');
      login.child.stdin.write(input.code.trim() + '\n'); login.state = 'verifying'; return { state: login.state };
    }
    if (name === 'apply') return this.task('실행 중인 동료에 설정 적용', async () => {
      try { const result = await call('companion_reload_connections', {}, { dir: path.join(this.root, 'runtime'), timeoutMs: 40000 }); return { applied: true, controller: result.controller, note: '대화 연결 설정을 적용했습니다.' }; }
      catch (error) { if (/ENOENT|fetch failed|Unknown tool/.test(error.message)) throw new Error('맠몰가 실행기를 시작하거나 업데이트한 뒤 다시 적용해 주세요. Start-Makmolga.ps1로 실행할 수 있습니다.'); throw error; }
    });
    throw new Error('Unknown connection action');
  }
  login(provider) {
    const existing = [...this.logins.values()].find(l => l.provider === provider && ['starting', 'waiting', 'verifying'].includes(l.state)); if (existing) return { id: existing.id };
    const config = this.config(), command = findProgram(provider, provider === 'codex' ? config.controller.command : config.connections.providers[provider].command);
    if (!command) throw new Error('먼저 프로그램을 설치해 주세요.');
    // Explicit login may open the native default browser; read-only inspections use manual mode.
    const child = spawn(command, provider === 'claude' ? ['auth', 'login'] : provider === 'codex' ? ['login'] : ['-p', '/usage', '--print-timeout', '60s'], { cwd: this.root, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const login = { id: randomUUID(), provider, state: 'starting', url: null, acceptsCode: provider === 'antigravity', child, output: '' };
    this.logins.set(login.id, login);
    const receive = bytes => {
      login.output = (login.output + String(bytes)).slice(-20000);
      for (const raw of login.output.match(/https:\/\/[^\s<>"\x1b]+/g) || []) {
        try { const u = new URL(raw); if (['accounts.google.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com', 'auth.openai.com'].includes(u.hostname)) { login.url = u.href; if (login.state === 'starting') login.state = 'waiting'; if (provider === 'antigravity') login.expiresAt ||= Date.now() + 60000; } } catch {}
      }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive); child.stdin.on('error', () => {});
    child.on('error', () => { login.state = 'failed'; login.note = '로그인 프로그램을 시작하지 못했습니다.'; });
    login.timer = setTimeout(() => { login.state = 'expired'; login.url = null; terminateTree(child); }, 180000);
    child.on('close', code => { clearTimeout(login.timer); login.state = code === 0 ? 'done' : 'expired'; login.url = null; login.output = ''; void this.refresh(); });
    return { id: login.id };
  }
  close() { for (const login of this.logins.values()) { clearTimeout(login.timer); terminateTree(login.child); } }
}
