import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const position = z.object({ x: z.number().finite().min(-30000000).max(30000000), y: z.number().finite().min(-64).max(320), z: z.number().finite().min(-30000000).max(30000000) }).strict();
export const configSchema = z.object({
  minecraft: z.object({ host: z.string().default('127.0.0.1'), port: z.number().int().min(1).max(65535).default(25565), targetVersion: z.string().default('26.2'), clientVersion: z.string().default('26.1'), username: z.string().default('CompanionBot'), auth: z.enum(['microsoft', 'offline']).default('microsoft'), allowOfflineLocal: z.boolean().default(false), autoConnect: z.boolean().default(false), reconnect: z.boolean().default(true), reconnectAttempts: z.number().int().min(0).max(10).default(5) }).strict().prefault({}),
  owner: z.object({ username: z.string().default(''), uuid: z.string().default(''), requireVerifiedChat: z.boolean().default(false), prefix: z.string().max(32).default('!봇 ') }).strict().prefault({}),
  api: z.object({ port: z.number().int().min(0).max(65535).default(47831) }).strict().prefault({}),
  proxy: z.object({ enabled: z.boolean().default(true), port: z.number().int().min(1).max(65535).default(25568), java: z.string().default('java'), jar: z.string().default('runtime/vendor/ViaProxy-3.4.12.jar'), authMethod: z.enum(['ACCOUNT', 'NONE']).default('ACCOUNT'), accountIndex: z.number().int().min(0).default(0) }).strict().prefault({}),
  safety: z.object({ minHealth: z.number().min(2).max(19).default(8), disconnectHealth: z.number().min(1).max(8).default(4), minOxygen: z.number().min(1).max(15).default(8), autoEat: z.boolean().default(true), eatBelow: z.number().min(1).max(19).default(16), maxTravel: z.number().min(1).max(512).default(64), home: position.nullable().default(null) }).strict().prefault({}),
  controller: z.object({ enabled: z.boolean().default(false), transport: z.enum(['stdio', 'websocket', 'proxy']).default('stdio'), command: z.string().default('codex'), websocketUrl: z.string().default('ws://127.0.0.1:4500'), threadId: z.string().nullable().default(null), model: z.string().nullable().default(null), replyInGame: z.boolean().default(true), maxTurnsPerHour: z.number().int().min(1).max(300).default(30), idleTimeoutSeconds: z.number().int().min(30).max(3600).default(300) }).strict().prefault({})
}).strict();

export const defaults = configSchema.parse({});
export const isLoopback = host => ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
export function loadConfig(file = process.env.COMPANION_CONFIG || path.join(ROOT, 'config.local.json')) {
  const config = configSchema.parse(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  if (config.minecraft.auth === 'offline' && !(config.minecraft.allowOfflineLocal && isLoopback(config.minecraft.host))) throw new Error('Offline auth is restricted to explicitly enabled local test/LAN servers.');
  if (config.proxy.enabled && config.minecraft.auth === 'microsoft' && config.proxy.authMethod !== 'ACCOUNT') throw new Error('Online servers through ViaProxy require a bot account in ViaProxy (ACCOUNT).');
  if (config.controller.transport === 'websocket') {
    const u = new URL(config.controller.websocketUrl);
    if (u.protocol !== 'ws:' || !isLoopback(u.hostname)) throw new Error('The controller WebSocket must be a loopback ws:// endpoint.');
  }
  if (config.safety.disconnectHealth >= config.safety.minHealth) throw new Error('disconnectHealth must be lower than minHealth.');
  return config;
}
