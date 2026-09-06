import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import { json } from './tools.mjs';

export class Rpc extends EventEmitter {
  constructor() { super(); this.next = 1; this.pending = new Map(); this.closed = false; }
  async connect(config, cwd) {
    if (config.transport === 'websocket') {
      this.socket = new WebSocket(config.websocketUrl, { maxPayload: 16 * 1024 * 1024 });
      this.socket.on('message', data => this.receive(data.toString()));
      this.socket.on('close', () => this.fail(new Error('Codex WebSocket closed')));
      this.socket.on('error', error => this.fail(error));
      this.send = message => this.socket.send(json(message));
      await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Codex connection timeout')), 10000); this.socket.once('open', () => { clearTimeout(timer); resolve(); }); this.socket.once('error', e => { clearTimeout(timer); reject(e); }); });
    } else {
      const args = ['app-server', ...(config.transport === 'proxy' ? ['proxy'] : ['--listen', 'stdio://'])];
      this.child = spawn(config.command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      this.lines = createInterface({ input: this.child.stdout }); this.lines.on('line', line => this.receive(line));
      this.child.stderr.on('data', data => this.emit('diagnostic', String(data).slice(0, 2000)));
      this.child.once('error', e => this.fail(e)); this.child.once('exit', code => this.fail(new Error(`Codex process exited (${code})`)));
      this.send = message => this.child.stdin.write(json(message) + '\n');
    }
    const result = await this.request('initialize', { clientInfo: { name: 'minecraft_companion', title: 'Minecraft Companion', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.notify('initialized', {}); return result;
  }
  receive(line) {
    let message; try { message = JSON.parse(line); } catch { this.emit('diagnostic', 'Ignored non-JSON Codex output'); return; }
    if (message.id !== undefined && !message.method) {
      const p = this.pending.get(message.id); if (!p) return; this.pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error.message || json(message.error))); else p.resolve(message.result);
    } else if (message.id !== undefined) this.emit('request', message);
    else this.emit('notification', message);
  }
  request(method, params, timeoutMs = 15000) {
    if (this.closed || !this.send) return Promise.reject(new Error('Codex transport is closed'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out; delivery may be uncertain`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  respond(id, result) { this.send({ jsonrpc: '2.0', id, result }); }
  reject(id, message) { this.send({ jsonrpc: '2.0', id, error: { code: -32601, message } }); }
  fail(error) {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); this.emit('closed', error);
  }
  close() { this.fail(new Error('Controller closed')); this.lines?.close(); this.child?.stdin.end(); this.child?.kill(); this.socket?.close(); }
}
