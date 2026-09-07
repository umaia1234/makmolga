import { EventEmitter } from 'node:events';
import { Rpc } from './rpc.mjs';
import { CliRpc } from './cli-rpc.mjs';
import { findProgram } from './provider-process.mjs';

export class RoutedRpc extends EventEmitter {
  constructor(runtime) { super(); this.runtime = runtime; }
  async connect(config, cwd) { this.config = config; this.cwd = cwd; }
  async use(route) {
    const key = JSON.stringify(route); if (key === this.key) return;
    if (this.engine) { this.engine.removeAllListeners(); this.engine.close(); }
    this.engine = route.provider === 'codex' ? new Rpc() : new CliRpc(this.runtime.store, route);
    for (const event of ['notification', 'request', 'closed', 'diagnostic']) this.engine.on(event, payload => this.emit(event, payload));
    this.supportsSteer = this.engine.supportsSteer !== false;
    const config = { ...this.config, command: route.provider === 'codex' ? findProgram('codex', route.command) || route.command : route.command, model: route.model };
    try { await this.engine.connect(config, this.cwd); this.key = key; }
    catch (error) { this.key = null; this.engine.removeAllListeners(); this.engine.close(); throw error; }
  }
  request(...args) { return this.engine.request(...args); }
  respond(...args) { return this.engine.respond(...args); }
  reject(...args) { return this.engine.reject(...args); }
  close() { this.engine?.removeAllListeners(); this.engine?.close(); }
}
