import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import mc from 'minecraft-protocol';
import { ROOT, loadConfig, isLoopback } from '../src/config.mjs';
import { call } from '../src/client.mjs';
import { ensureSession } from '../src/session.mjs';
import { atomicJson } from '../src/store.mjs';

const dir = path.resolve(process.env.COMPANION_RUNTIME || path.join(ROOT, 'runtime'));
const configFile = path.resolve(process.env.COMPANION_CONFIG || path.join(ROOT, 'config.local.json'));
const timeoutMs = Number(process.argv[2] || 180) * 1000;
const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const pidAt = file => { try { return Number(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const progress = text => console.error(`[MAKMOLGA] ${text}`);

async function background(command, args, cwd, logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, 'stdout.log'), 'a');
  const err = fs.openSync(path.join(logDir, 'stderr.log'), 'a');
  try {
    const child = spawn(command, args, { cwd, detached: true, windowsHide: true, stdio: ['ignore', out, err],
      env: { ...process.env, COMPANION_RUNTIME: dir, COMPANION_CONFIG: configFile } });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); return child.pid;
  } finally { fs.closeSync(out); fs.closeSync(err); }
}

async function portOpen(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(1500, () => finish(false));
  });
}

async function ensureServer(config, deadline) {
  const { host, port, targetVersion, clientVersion } = config.minecraft;
  const listening = await portOpen(host, port);
  let startedPid;
  if (!listening && isLoopback(host)) {
    const world = path.join(dir, 'local-world');
    const jar = path.join(world, 'server.jar');
    const propertiesFile = path.join(world, 'server.properties');
    const eulaFile = path.join(world, 'eula.txt');
    if (!fs.existsSync(jar) || !fs.existsSync(propertiesFile) || !fs.existsSync(eulaFile)) throw new Error('Local world is not prepared. See README.md; this command does not create or replace a world.');
    const properties = fs.readFileSync(propertiesFile, 'utf8');
    if (!/^server-ip=127\.0\.0\.1\s*$/m.test(properties) || !new RegExp(`^server-port=${port}\\s*$`, 'm').test(properties)) throw new Error('Local server.properties must match the configured loopback address and port.');
    if (!/^eula=true\s*$/m.test(fs.readFileSync(eulaFile, 'utf8'))) throw new Error('Local server EULA has not been accepted.');
    startedPid = await background(config.proxy.java, ['-Xms512M', '-Xmx2G', '-jar', jar, 'nogui'], world, world);
    progress(`Local world starting (PID ${startedPid}).`);
  }
  let error;
  do {
    if (startedPid && !alive(startedPid)) throw new Error('Local server exited. Inspect runtime/local-world/stderr.log.');
    try {
      const status = await mc.ping({ host, port, version: clientVersion, closeTimeout: 4000, noPongTimeout: 1500 });
      const version = String(status.version?.name || '');
      if (!version.split(/[^a-zA-Z0-9.]+/).includes(targetVersion)) throw new Error(`Server reports ${version}, expected ${targetVersion}.`);
      progress(`Minecraft ${version} responds at ${host}:${port}.`); return;
    } catch (caught) {
      error = caught;
      if (listening || !startedPid) throw new Error(`Configured server is not ready: ${error.message}. No existing process was stopped.`);
    }
    await delay(1000);
  } while (Date.now() < deadline);
  throw new Error(`Local server did not become ready: ${error?.message}`);
}

async function acquireLock(lock) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    try {
      if (!alive(pidAt(lock)) && Date.now() - fs.statSync(lock).mtimeMs > 3000) { fs.unlinkSync(lock); continue; }
    } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (Date.now() >= deadline) throw new Error('Another MAKMOLGA startup is still running. Inspect it before retrying.');
    await delay(500);
  }
}

async function main() {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 30000 || timeoutMs > 600000) throw new Error('Timeout must be 30–600 seconds.');
  if (!fs.existsSync(configFile)) throw new Error('Prepare config.local.json with your server, owner UUID and Codex controller first. See README.md.');
  const config = loadConfig(configFile);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'start-session.lock'); await acquireLock(lock);
  try {
    const invoke = (name, timeout = 40000) => call(name, {}, { dir, timeoutMs: timeout });
    const result = await ensureSession(config, {
      probe: async () => {
        let session;
        try { session = await invoke('companion_session', 2500); }
        catch (error) {
          if (error.code === 'ENOENT' || error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError') return null;
          throw new Error(`Cannot inspect the runtime: ${error.message}. An older runtime may need a restart.`);
        }
        if (path.resolve(session.root || '.') !== ROOT) throw new Error('The runtime endpoint belongs to a different project.');
        return session;
      },
      runtimeAlive: () => alive(pidAt(path.join(dir, 'daemon.lock'))),
      ensureServer: deadline => ensureServer(config, deadline),
      startRuntime: async () => { const pid = await background(process.execPath, [path.join(ROOT, 'src/main.mjs')], ROOT, dir); progress(`Companion starting (PID ${pid}).`); },
      prepare: () => invoke('companion_prepare'),
      connect: () => invoke('minecraft_connect')
    }, { timeoutMs });
    atomicJson(path.join(dir, 'last-start.json'), { checkedAt: new Date().toISOString(), ...result });
    console.log(JSON.stringify(result, null, 2));
  } finally { if (pidAt(lock) === process.pid) fs.unlinkSync(lock); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
