import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { ROOT, configSchema } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';

export function tempDir() { const base = path.join(ROOT, 'work', 'companion-tests'); fs.mkdirSync(base, { recursive: true }); return fs.mkdtempSync(path.join(base, 'test-')); }
export const OWNER = '11111111-2222-4333-8444-555555555555';
export function testConfig() { return configSchema.parse({ minecraft: { auth: 'offline', allowOfflineLocal: true, targetVersion: '26.1', reconnect: false }, proxy: { enabled: false }, owner: { username: 'Owner', uuid: OWNER }, api: { port: 0 }, safety: { autoEat: false } }); }
export class FakeBot extends EventEmitter {
  constructor() {
    super(); this.username = 'CompanionBot'; this.version = '26.1'; this.health = 20; this.food = 20; this.oxygenLevel = 20;
    this.entity = { id: 1, position: new Vec3(0, 64, 0), onGround: true, yaw: 0, pitch: 0 }; this.entities = {}; this.players = {};
    this.controls = {}; this.calls = []; this.blocks = new Map(); this.experience = { level: 30 }; this.game = { dimension: 'overworld' }; this._client = new EventEmitter();
    this.inventory = { slots: [], items: () => this.inventory.slots.filter(i => i?.count > 0) };
    this.registry = { blocksByName: { stone: { id: 1 }, wheat: { id: 2 }, chest: { id: 3 } }, itemsByName: { oak_planks: { id: 10 } } };
    this.pathfinder = { setGoal: () => {}, goto: async goal => { this.entity.position = new Vec3(goal.x, goal.y, goal.z); }, bestHarvestTool: () => null };
  }
  addItem(name, count, slot = 36) { const i = { name, count, slot, type: slot + 1, metadata: 0, enchants: [] }; this.inventory.slots[slot] = i; return i; }
  setBlock(p, name, properties = {}) { const pos = new Vec3(p.x, p.y, p.z).floored(); const block = { name, position: pos, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => properties }; this.blocks.set(pos.toString(), block); return block; }
  blockAt(p) { return this.blocks.get(p.floored().toString()) || this.setBlock(p, 'air'); }
  findBlocks() { return []; }
  setControlState(k, value) { this.controls[k] = value; }
  clearControlStates() { this.controls = {}; }
  stopDigging() {} deactivateItem() {}
  closeWindow(w) { this.currentWindow = null; w.close?.(); }
  async look(yaw, pitch) { this.entity.yaw = yaw; this.entity.pitch = pitch; }
  async equip(item) { this.heldItem = item; this.calls.push(['equip', item.name]); }
  async consume() { this.food = 20; this.heldItem.count--; }
  canDigBlock() { return true; }
  async dig(b) { this.calls.push(['dig', b.name]); this.setBlock(b.position, 'air'); }
  async placeBlock(reference, face) {
    const names = { wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots' };
    this.setBlock(reference.position.plus(face), names[this.heldItem.name] || this.heldItem.name, { age: 0 }); this.heldItem.count--; this.calls.push(['place', this.heldItem.name]);
  }
  chat(text) { this.calls.push(['chat', text]); }
  quit(reason) { this.calls.push(['quit', reason]); this.emit('end', reason); }
}
export function fixture(t) {
  const store = new Store(tempDir()); const runtime = new Runtime(testConfig(), store); runtime.bot = new FakeBot(); runtime.connection = 'connected';
  t.after(() => runtime.close()); return { store, runtime, bot: runtime.bot };
}
export async function finished(runtime) { await runtime.jobs.active?.done; }
