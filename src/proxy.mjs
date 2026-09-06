import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT } from './config.mjs';
import { delay } from './jobs.mjs';
export const PROXY_VERSION = '3.4.12';
export const PROXY_SHA256 = '32ce9ad871aeb03286823c29da262ebd75992864e7857db283f103525c7fc0cb';
export const PROXY_URL = 'https://github.com/ViaVersion/ViaProxy/releases/download/v3.4.12/ViaProxy-3.4.12.jar';
export function portOpen(port) { return new Promise(resolve => { const s = net.connect({ host: '127.0.0.1', port }); const done = value => { s.destroy(); resolve(value); }; s.setTimeout(250, () => done(false)); s.on('connect', () => done(true)); s.on('error', () => done(false)); }); }
export class ProxyProcess {
  constructor(config, store) { this.config = config; this.store = store; this.child = null; }
  async start() {
    if (!this.config.proxy.enabled) return;
    if (this.child && this.child.exitCode === null) return;
    const c = this.config; const jar = path.resolve(ROOT, c.proxy.jar);
    if (!fs.existsSync(jar)) throw new Error('ViaProxy missing. Run: node scripts/setup.mjs --download-proxy');
    const hash = createHash('sha256').update(fs.readFileSync(jar)).digest('hex');
    if (hash !== PROXY_SHA256) throw new Error('ViaProxy checksum mismatch.');
    if (await portOpen(c.proxy.port)) throw new Error('Proxy port already occupied. Inspect the existing process; refusing to connect to an unknown proxy.');
    const cwd = path.join(this.store.dir, 'viaproxy'); fs.mkdirSync(cwd, { recursive: true });
    const args = ['-Xmx384M', '-Djava.awt.headless=true', '-jar', jar, 'cli', '--bind-address', `127.0.0.1:${c.proxy.port}`, '--target-address', `${c.minecraft.host}:${c.minecraft.port}`, '--target-version', c.minecraft.targetVersion, '--auth-method', c.proxy.authMethod, '--minecraft-account-index', String(c.proxy.accountIndex), '--proxy-online-mode', 'false', '--chat-signing', 'true', '--ignore-protocol-translation-errors', 'false'];
    const child = this.child = spawn(c.proxy.java, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream(path.join(cwd, 'console.log'), { flags: 'a', mode: 0o600 });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    let failure;
    child.on('error', e => { failure = e; }); child.once('exit', () => { log.end(); this.store.event('proxy_exit', { code: child.exitCode }); });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error('ViaProxy exited. Inspect runtime/viaproxy/console.log.');
      if (await portOpen(c.proxy.port)) { this.store.event('proxy_ready', { targetVersion: c.minecraft.targetVersion, clientVersion: c.minecraft.clientVersion }); return; }
      await delay(200);
    }
    this.stop(); throw new Error('ViaProxy startup timeout.');
  }
  stop() { this.child?.kill(); this.child = null; }
}
