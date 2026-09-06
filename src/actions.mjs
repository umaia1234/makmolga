import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import pathfinderPackage from 'mineflayer-pathfinder';
import { check, delay } from './jobs.mjs';
const require = createRequire(import.meta.url);
const { goals } = pathfinderPackage;
export const vec = p => new Vec3(p.x, p.y, p.z);
export const itemView = item => item ? { slot: item.slot, name: item.name, count: item.count, durabilityUsed: item.durabilityUsed, enchants: item.enchants || [], components: item.components } : null;
export const blockView = b => b ? { name: b.name, position: b.position, properties: b.getProperties(), stateId: b.stateId } : null;
const forbidden = new Set(['tnt', 'lava_bucket', 'flint_and_steel', 'fire_charge', 'end_crystal', 'respawn_anchor']);
const containers = /chest|barrel|shulker_box|furnace|smoker|hopper|dispenser|dropper/;

async function step(signal, fn) { check(signal); const result = await fn(); check(signal); return result; }
function blockAt(bot, p) { const block = bot.blockAt(vec(p).floored()); if (!block) throw new Error(`Chunk not loaded at ${JSON.stringify(p)}`); return block; }
function itemNamed(bot, name) { const item = bot.inventory.items().find(i => i.name === name); if (!item) throw new Error(`Missing item: ${name}`); return item; }
function slotItem(bot, slot, expectedName) { const i = bot.inventory.slots[slot]; if (!i || i.name !== expectedName) throw new Error(`Inventory changed at slot ${slot}; inspect again.`); return i; }
const countItem = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
function within(runtime, p) {
  if (runtime.bot.entity.position.distanceTo(vec(p)) > runtime.config.safety.maxTravel) throw new Error('Destination exceeds configured travel radius.');
}
async function approach(runtime, p, signal, radius = 3) {
  const b = runtime.bot; within(runtime, p);
  if (b.entity.position.distanceTo(vec(p).offset(0.5, 0.5, 0.5)) <= radius + 0.5) return;
  await step(signal, () => b.pathfinder.goto(new goals.GoalNear(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), radius)));
}
async function place(runtime, entry, signal) {
  const b = runtime.bot; const target = vec(entry).floored();
  if (forbidden.has(entry.block)) throw new Error(`Placement unsupported: ${entry.block}`);
  const existing = blockAt(b, target);
  if (existing.name === entry.block) return { skipped: true };
  if (!['air', 'cave_air', 'void_air'].includes(existing.name)) throw new Error(`Occupied target: ${existing.name} at ${target}`);
  await approach(runtime, target, signal);
  // Recheck after movement; other players may have changed this location.
  if (!['air', 'cave_air', 'void_air'].includes(blockAt(b, target).name)) throw new Error('Build target changed during movement.');
  const feet = b.entity.position.floored();
  if (target.equals(feet) || target.equals(feet.offset(0, 1, 0))) throw new Error('Placement would intersect the bot. Move first.');
  const offsets = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];
  const offset = offsets.find(o => { const n = b.blockAt(target.plus(o)); return n && n.boundingBox === 'block' && !containers.test(n.name); });
  if (!offset) throw new Error(`No solid placement support at ${target}`);
  await step(signal, () => b.equip(itemNamed(b, entry.block), 'hand'));
  await step(signal, () => b.placeBlock(b.blockAt(target.plus(offset)), offset.scaled(-1)));
  const actual = blockAt(b, target);
  if (actual.name !== entry.block) throw new Error(`Placement verification failed: ${actual.name}`);
  return blockView(actual);
}
async function transfer(runtime, args, signal) {
  const b = runtime.bot; await approach(runtime, args.position, signal);
  const target = blockAt(b, args.position);
  if (!/chest|barrel|shulker_box/.test(target.name)) throw new Error('Expected storage container.');
  const before = countItem(b, args.item);
  const window = await step(signal, () => b.openContainer(target));
  try {
    const item = (args.direction === 'deposit' ? window.items() : window.containerItems()).find(i => i.name === args.item);
    if (!item) throw new Error(`Item unavailable in ${args.direction === 'deposit' ? 'inventory' : 'container'}`);
    const available = (args.direction === 'deposit' ? b.inventory.items() : window.containerItems()).filter(i => i.name === args.item).reduce((n, i) => n + i.count, 0);
    if (available < args.count) throw new Error(`Only ${available} ${args.item} available.`);
    await step(signal, () => window[args.direction](item.type, item.metadata, args.count));
    const after = countItem(b, args.item); const actual = args.direction === 'deposit' ? before - after : after - before;
    if (actual !== args.count) throw new Error(`Transfer differs: requested ${args.count}, observed inventory delta ${actual}. Inspect both inventories before retrying.`);
    return { item: args.item, moved: actual, inventoryCount: after };
  } finally { window.close(); }
}

export async function perform(runtime, name, a, signal, progress) {
  const b = runtime.bot;
  switch (name) {
    case 'control': {
      b.clearControlStates();
      if (a.yaw !== undefined) await step(signal, () => b.look(a.yaw, a.pitch ?? 0, true));
      for (const key of a.keys) b.setControlState(key, true);
      try { await delay(a.milliseconds, signal); } finally { b.clearControlStates(); }
      return { position: b.entity.position };
    }
    case 'goto': {
      within(runtime, a.position);
      await step(signal, () => b.pathfinder.goto(new goals.GoalNear(a.position.x, a.position.y, a.position.z, a.radius)));
      return { position: b.entity.position };
    }
    case 'return_home': {
      if (!runtime.config.safety.home) throw new Error('Set safety.home before returning home.');
      await approach(runtime, runtime.config.safety.home, signal, 1); return { position: b.entity.position };
    }
    case 'follow': {
      const target = b.players[a.player]?.entity; if (!target) throw new Error('Player is not visible.');
      within(runtime, target.position);
      const origin = b.entity.position.clone();
      b.pathfinder.setGoal(new goals.GoalFollow(target, a.distance), true);
      const end = Date.now() + a.seconds * 1000;
      try { while (Date.now() < end) { await delay(250, signal); if (!b.entities[target.id]) throw new Error('Follow target left visible range.'); if (b.entity.position.distanceTo(origin) > runtime.config.safety.maxTravel) throw new Error('Follow reached configured travel radius.'); } }
      finally { b.pathfinder.setGoal(null); }
      return { position: b.entity.position };
    }
    case 'equip': {
      await step(signal, () => b.equip(slotItem(b, a.slot, a.expectedName), a.destination)); return { equipped: a.expectedName, destination: a.destination };
    }
    case 'eat': {
      const allowed = runtime.foodItem(a.item); if (!allowed) throw new Error('No permitted food available.');
      if (b.food >= 20) return { food: b.food, alreadyFull: true };
      await step(signal, () => b.equip(allowed, 'hand')); await step(signal, () => b.consume()); return { food: b.food };
    }
    case 'dig': {
      await approach(runtime, a.position, signal);
      const target = blockAt(b, a.position);
      if (target.name !== a.expectedBlock) throw new Error(`Block changed: ${target.name}`);
      if (containers.test(target.name)) throw new Error('Container removal is excluded from the dig tool.');
      if (target.position.equals(b.entity.position.floored().offset(0, -1, 0))) throw new Error('Cannot dig directly under the bot.');
      if (!b.canDigBlock(target)) throw new Error('Cannot reach/dig this block.');
      const tool = b.pathfinder.bestHarvestTool(target); if (tool) await step(signal, () => b.equip(tool, 'hand'));
      await step(signal, () => b.dig(target));
      const after = blockAt(b, a.position); if (after.name === target.name) throw new Error('Block removal not confirmed.');
      return blockView(after);
    }
    case 'place': return place(runtime, { ...a.position, block: a.block }, signal);
    case 'craft': {
      const item = b.registry.itemsByName[a.item]; if (!item) throw new Error('Unknown recipe output item.');
      let table = null;
      if (a.table) { await approach(runtime, a.table, signal); table = blockAt(b, a.table); if (table.name !== 'crafting_table') throw new Error('Expected crafting table.'); }
      const recipes = b.recipesFor(item.id, null, a.count, table); if (!recipes.length) throw new Error('No craftable recipe; materials/table missing.');
      const recipe = recipes[0]; const crafts = Math.ceil(a.count / recipe.result.count); const before = countItem(b, a.item);
      await step(signal, () => b.craft(recipe, crafts, table));
      return { item: a.item, produced: countItem(b, a.item) - before };
    }
    case 'container': {
      if (a.direction !== 'inspect') return transfer(runtime, a, signal);
      await approach(runtime, a.position, signal); const window = await step(signal, () => b.openContainer(blockAt(b, a.position)));
      try { return { items: window.containerItems().map(itemView), slots: window.inventoryStart }; } finally { window.close(); }
    }
    case 'build': {
      for (const entry of a.blocks) within(runtime, entry);
      const needed = {};
      for (const e of a.blocks) if (blockAt(b, e).name !== e.block) needed[e.block] = (needed[e.block] || 0) + 1;
      for (const [item, count] of Object.entries(needed)) if (countItem(b, item) < count) throw new Error(`Build needs ${count} ${item}; available ${countItem(b, item)}.`);
      let placed = 0; let skipped = 0;
      for (const e of a.blocks) { const r = await place(runtime, e, signal); if (r.skipped) skipped++; else placed++; progress({ placed, skipped, total: a.blocks.length, last: e }); }
      return { placed, skipped };
    }
    case 'farm': {
      const cropMap = { wheat: ['wheat_seeds', 7], carrots: ['carrot', 7], potatoes: ['potato', 7], beetroots: ['beetroot_seeds', 3] };
      const results = [];
      for (const p of a.positions) {
        const crop = blockAt(b, p); const rule = cropMap[crop.name];
        if (!rule || Number(crop.getProperties().age) < rule[1]) { results.push({ position: p, skipped: crop.name }); continue; }
        itemNamed(b, rule[0]); // Reserve a seed before harvesting.
        await approach(runtime, p, signal);
        const current = blockAt(b, p); if (current.name !== crop.name || Number(current.getProperties().age) < rule[1]) continue;
        const soil = blockAt(b, vec(p).offset(0, -1, 0)); if (soil.name !== 'farmland') throw new Error('Crop has no farmland support.');
        await step(signal, () => b.dig(current));
        await step(signal, () => b.equip(itemNamed(b, rule[0]), 'hand'));
        await step(signal, () => b.placeBlock(soil, new Vec3(0, 1, 0)));
        if (blockAt(b, p).name !== crop.name) throw new Error('Replant verification failed.');
        results.push({ position: p, harvested: crop.name, replanted: true }); progress({ processed: results.length, total: a.positions.length });
      }
      return { plots: results, note: 'Nearby drops are picked up by normal movement; inspect inventory before storage.' };
    }
    case 'sort': {
      const moved = [];
      for (const rule of a.rules) for (const name of rule.items) {
        const count = countItem(b, name) - (a.keep[name] ?? 0);
        if (count <= 0) continue;
        // Equipped tools/armor and enchanted items are kept out of bulk sorting.
        if (b.inventory.items().some(i => i.name === name && ((i.enchants?.length ?? 0) > 0 || /_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$/.test(i.name) || ['shears', 'shield', 'bow', 'crossbow', 'trident', 'fishing_rod', 'elytra'].includes(i.name)))) continue;
        moved.push(await transfer(runtime, { position: rule.position, direction: 'deposit', item: name, count }, signal)); progress({ moved });
      }
      return { moved };
    }
    case 'enchant': {
      await approach(runtime, a.position, signal); const target = slotItem(b, a.slot, a.expectedName);
      const window = await step(signal, () => b.openEnchantmentTable(blockAt(b, a.position)));
      try {
        await step(signal, () => window.putTargetItem(target));
        await step(signal, () => window.putLapis(itemNamed(b, 'lapis_lazuli')));
        const end = Date.now() + 7000;
        while (!window.enchantments.some(e => e.level > 0)) { if (Date.now() > end) throw new Error('Enchantment offers timed out.'); await delay(100, signal); }
        const offers = structuredClone(window.enchantments);
        if (a.choice === null) return { offers, level: b.experience.level, preview: true };
        const offer = offers[a.choice];
        if (!offer || offer.level <= 0 || offer.level > b.experience.level || a.choice + 1 > a.maxLevelSpend) throw new Error('Selected enchantment exceeds level/spend limits.');
        if (a.expectedEnchantmentId !== null && offer.expected.enchant !== a.expectedEnchantmentId) throw new Error('Offered enchantment changed; preview again.');
        if ((window.slots[1]?.count || 0) < a.choice + 1) throw new Error('Insufficient lapis.');
        const result = await step(signal, () => window.enchant(a.choice));
        await step(signal, () => window.takeTargetItem()); return { offers, result: itemView(result) };
      } finally {
        // Closing a vanilla table returns both inputs. Never blindly re-enchant on failure.
        window.close();
      }
    }
    case 'anvil': {
      await approach(runtime, a.position, signal);
      const left = slotItem(b, a.leftSlot, a.leftName); const right = slotItem(b, a.rightSlot, a.rightName);
      if (a.leftSlot === a.rightSlot) throw new Error('Anvil inputs must be different slots.');
      const Item = require('prismarine-item')(b.registry);
      const estimates = [Item.anvil(left, right, false, a.rename || undefined).xpCost, Item.anvil(right, left, false, a.rename || undefined).xpCost].filter(n => n > 0);
      const cost = Math.min(...estimates);
      if (!Number.isFinite(cost) || cost > a.maxLevelSpend || cost > b.experience.level || cost >= 40) throw new Error(`Anvil cost ${cost} is unavailable or exceeds budget.`);
      const window = await step(signal, () => b.openAnvil(blockAt(b, a.position)));
      try { const before = b.experience.level; await step(signal, () => window.combine(left, right, a.rename || undefined)); return { estimatedCost: cost, spent: before - b.experience.level, inventory: b.inventory.items().map(itemView) }; }
      finally { window.close(); }
    }
    case 'interact': {
      if (a.entityId !== null) {
        const entity = b.entities[a.entityId]; if (!entity || b.entity.position.distanceTo(entity.position) > 4) throw new Error('Entity is out of reach.');
        if (a.action === 'attack') { if (entity.type === 'player') throw new Error('Player combat is not enabled.'); b.attack(entity); }
        else if (a.action === 'mount') b.mount(entity); else await step(signal, () => b.activateEntity(entity));
      } else if (a.action === 'dismount') b.dismount();
      else if (a.action === 'sleep') { await approach(runtime, a.position, signal); await step(signal, () => b.sleep(blockAt(b, a.position))); }
      else if (a.position) { await approach(runtime, a.position, signal); await step(signal, () => b.activateBlock(blockAt(b, a.position))); }
      else throw new Error('Entity or block position required.');
      return { action: a.action, state: runtime.snapshot() };
    }
    default: throw new Error(`Unknown action ${name}`);
  }
}
