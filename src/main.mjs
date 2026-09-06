import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, ROOT } from './config.mjs';
import { Store } from './store.mjs';
import { Runtime } from './runtime.mjs';
import { Controller } from './controller.mjs';
import { serve } from './api.mjs';

const dir = process.env.COMPANION_RUNTIME || path.join(ROOT, 'runtime');
fs.mkdirSync(dir, { recursive: true });
const lock = path.join(dir, 'daemon.lock');
if (fs.existsSync(lock)) {
  const previous = Number(fs.readFileSync(lock, 'utf8'));
  let running = false; try { process.kill(previous, 0); running = true; } catch {}
  if (running) throw new Error(`Companion runtime already owned by PID ${previous}`);
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
let runtime, controller, server, closing = false;
async function shutdown() {
  if (closing) return; closing = true; controller?.close(); runtime?.close();
  server?.closeAllConnections(); server?.close();
  if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock);
}
process.on('SIGINT', () => { void shutdown().then(() => process.exit()); });
process.on('SIGTERM', () => { void shutdown().then(() => process.exit()); });
try {
  const config = loadConfig(); const store = new Store(dir); runtime = new Runtime(config, store); server = await serve(runtime); controller = new Controller(runtime); controller.run();
  server.on('shutdownRequested', () => { void shutdown().then(() => process.exit()); });
  console.error(`Minecraft Companion ready on 127.0.0.1:${server.address().port}. Bot auto-connect: ${config.minecraft.autoConnect}; LLM controller: ${config.controller.enabled}.`);
  if (config.minecraft.autoConnect) await runtime.connect();
} catch (error) { console.error(error.message); await shutdown(); process.exitCode = 1; }
