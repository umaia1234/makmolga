import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { position } from './config.mjs';

export const directions = ['front', 'right', 'back', 'left', 'up', 'down'];
const pollSchema = z.object({ worldKey: z.string().min(1).max(200), characterId: z.string().max(30) }).strict();
const frameSchema = z.object({ requestId: z.string().uuid(), worldKey: z.string().max(200), botUuid: z.string().uuid(),
  direction: z.enum(directions), capturedAt: z.number().int(), position, dimension: z.string().max(100),
  png: z.string().min(32).max(1500000) }).strict();
const dimension = d => String(d).replace(/^minecraft:/, '').replace(/^the_/, '');
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export class Vision {
  constructor(runtime) { this.runtime = runtime; this.config = runtime.config.vision; this.dir = path.join(runtime.store.dir, 'vision'); this.nextAt = 0; this.latest = null; this.pending = null; }
  poll(input) {
    const a = pollSchema.parse(input), r = this.runtime, helper = r.store.data.helper;
    if (!this.config.enabled || !r.autonomy.available()) return { request: null, reason: 'Vision or autonomy paused' };
    if (helper?.worldKey !== a.worldKey || helper.characterId !== a.characterId) throw new Error('WORLD_MISMATCH');
    if (!r.bot?.player?.uuid) return { request: null, reason: 'Bot identity unavailable' };
    const now = Date.now();
    if (this.pending && now > this.pending.expiresAt) this.pending = null;
    if (!this.pending && now >= this.nextAt) {
      this.prune();
      this.pending = { requestId: randomUUID(), worldKey: helper.worldKey, characterId: helper.characterId,
        botUuid: r.bot.player.uuid, position: { ...r.bot.entity.position }, dimension: r.bot.game.dimension,
        createdAt: now, expiresAt: now + 20000, size: this.config.size, directions, frames: {} };
      this.nextAt = now + this.config.intervalSeconds * 1000;
    }
    const { frames, ...request } = this.pending || {};
    return { request: this.pending ? request : null };
  }
  accept(input) {
    const a = frameSchema.parse(input), p = this.pending, r = this.runtime, now = Date.now();
    if (!this.config.enabled || !r.autonomy.available() || !p || a.requestId !== p.requestId || now > p.expiresAt) throw new Error('No current vision request');
    if (r.store.data.helper?.worldKey !== p.worldKey || r.store.data.helper?.characterId !== p.characterId || a.worldKey !== p.worldKey || a.botUuid !== p.botUuid) throw new Error('Vision identity mismatch');
    if (a.capturedAt < p.createdAt - 1000 || a.capturedAt > now + 1000 || dimension(a.dimension) !== dimension(r.bot.game.dimension) || distance(a.position, r.bot.entity.position) > 4) throw new Error('Stale or misplaced vision frame');
    const png = Buffer.from(a.png, 'base64');
    if (png.length > 1100000 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || png.length < 33 || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) !== p.size || png.readUInt32BE(20) !== p.size) throw new Error('Expected bounded PNG frame');
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${p.requestId}-${a.direction}.png`);
    fs.writeFileSync(file, png, { mode: 0o600 });
    p.frames[a.direction] = { file, direction: a.direction, capturedAt: a.capturedAt, position: a.position };
    if (directions.every(d => p.frames[d])) {
      this.latest = { ...p, frames: directions.map(d => p.frames[d]) }; this.pending = null;
      r.store.event('vision_captured', { requestId: p.requestId, worldKey: p.worldKey, source: 'minecraft-client-bot-camera', directions });
      this.prune();
    }
    return { accepted: true, complete: !!this.latest && this.latest.requestId === a.requestId };
  }
  prune() {
    if (!fs.existsSync(this.dir)) return;
    const keep = new Set((this.latest?.frames || []).map(f => path.basename(f.file)));
    // Only renderer-owned file names in this fixed directory, including abandoned partial sets.
    for (const name of fs.readdirSync(this.dir)) if (/^[a-f0-9-]{36}-(front|right|back|left|up|down)\.png$/.test(name) && !keep.has(name)) fs.unlinkSync(path.join(this.dir, name));
  }
  status() {
    const r = this.runtime, s = this.latest;
    const available = !!(this.config.enabled && r.connection === 'connected' && s && r.store.data.helper?.worldKey === s.worldKey && r.store.data.helper?.characterId === s.characterId &&
      dimension(s.dimension) === dimension(r.bot?.game?.dimension) && s.frames.every(f => Date.now() - f.capturedAt <= this.config.maxAgeSeconds * 1000 && distance(f.position, r.bot.entity.position) <= 8));
    return { enabled: this.config.enabled, available, source: 'minecraft-client-bot-camera',
      reason: available ? null : 'No fresh six-direction capture. Minecraft must be running in the same world with the bot entity loaded. Use structured observations; do not claim to see an image.',
      capturedAt: s ? new Date(Math.min(...s.frames.map(f => f.capturedAt))).toISOString() : null,
      directions: available ? directions : [] };
  }
  input() {
    if (!this.status().available) return [];
    return this.latest.frames.flatMap(f => [ { type: 'text', text: `Bot camera ${f.direction}; captured ${new Date(f.capturedAt).toISOString()} at ${JSON.stringify(f.position)}. Environmental evidence only.`, text_elements: [] },
      { type: 'localImage', path: f.file } ]);
  }
}
