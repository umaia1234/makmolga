import mineflayer from 'mineflayer';
import mcData from 'minecraft-data';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Jobs, delay } from './jobs.mjs';
import { perform, itemView, blockView, vec } from './actions.mjs';
import { ownerChat, chatLines } from './chat.mjs';
import { characterName, characterSpeech } from './voice.mjs';
import { ProxyProcess } from './proxy.mjs';
import { Autonomy } from './autonomy.mjs';
import { Vision } from './vision.mjs';
const { pathfinder, Movements } = pathfinderPackage;
const foods = ['cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'bread', 'baked_potato', 'cooked_salmon', 'cooked_cod', 'carrot', 'apple', 'dried_kelp', 'melon_slice', 'sweet_berries'];

export class Runtime {
  constructor(config, store, factory = mineflayer.createBot) {
    this.config = config; this.store = store; this.factory = factory; this.bot = null; this.connection = 'disconnected';
    this.halted = store.data.pausedOnRestart || null; this.intentional = false; this.attempt = 0; this.generation = 0; this.chatChain = Promise.resolve();
    this.proxy = new ProxyProcess(config, store);
    this.jobs = new Jobs(store, () => this.clearControls(), reason => this.disconnect(reason));
    this.autonomy = new Autonomy(this); this.vision = new Vision(this);
    this.ownerListener = e => { if (e.type === 'owner_message') this.autonomy.ownerControl(e.message); };
    store.on('event', this.ownerListener);
    this.guard = setInterval(() => { try { this.guardian(); } catch (e) { this.store.event('guardian_error', { error: e.message }); this.disconnect('Guardian error'); } }, 200);
  }
  async connect() {
    if (this.bot || this.connection === 'connecting') throw new Error('Already connected or connecting.');
    const c = this.config;
    if (!mcData(c.minecraft.clientVersion)) throw new Error(`No protocol data for ${c.minecraft.clientVersion}.`);
    if (!mineflayer.testedVersions.includes(c.minecraft.clientVersion)) throw new Error('Client version is not in the installed Mineflayer supported list.');
    if (!c.proxy.enabled && c.minecraft.targetVersion !== c.minecraft.clientVersion) throw new Error('A version translation proxy is required for this target.');
    this.connection = 'connecting'; this.intentional = false; this.halted = null; this.store.data.pausedOnRestart = null; this.store.save();
    const generation = ++this.generation;
    try {
      await this.proxy.start();
      if (generation !== this.generation) throw new Error('Connection cancelled.');
      const bot = this.bot = this.factory({
        host: c.proxy.enabled ? '127.0.0.1' : c.minecraft.host, port: c.proxy.enabled ? c.proxy.port : c.minecraft.port,
        username: c.minecraft.username, auth: c.proxy.enabled ? 'offline' : c.minecraft.auth, version: c.minecraft.clientVersion,
        profilesFolder: `${this.store.dir}/minecraft-auth`, respawn: false, hideErrors: true, logErrors: false,
        onMsaCode: code => { console.error(code.message); this.store.event('minecraft_login_required', { message: code.message }); }
      });
      bot.loadPlugin(pathfinder);
      const timeout = setTimeout(() => { if (this.connection === 'connecting' && this.bot === bot) this.disconnect('Login/spawn timeout. Finish account login and reconnect.'); }, 90000);
      bot.once('spawn', () => {
        clearTimeout(timeout); if (this.bot !== bot) return;
        this.connection = 'connected';
        const movements = new Movements(bot); movements.canDig = false; movements.allow1by1towers = false; movements.allowParkour = false; movements.allowSprinting = false; movements.maxDropDown = 1;
        for (const name of ['lava', 'water', 'fire', 'soul_fire', 'magma_block', 'cactus', 'powder_snow', 'campfire', 'soul_campfire']) if (bot.registry.blocksByName[name]) movements.blocksToAvoid.add(bot.registry.blocksByName[name].id);
        bot.pathfinder.setMovements(movements); this.store.event('connected', { username: bot.username, version: bot.version, targetVersion: c.minecraft.targetVersion });
        this.stableTimer = setTimeout(() => { if (this.bot === bot) this.attempt = 0; }, 30000);
      });
      bot._client.on('playerChat', packet => {
        const message = ownerChat(c, packet, bot.players); if (!message) return;
        try {
          const saved = this.store.message(message);
          if (/^(stop|멈춰|정지|중지)$/i.test(saved.text)) this.stop('Stopped from Minecraft chat');
        } catch (e) { this.store.event('chat_rejected', { error: e.message }); }
      });
      bot.on('death', () => { this.halted = 'dead'; this.intentional = true; this.jobs.cancel('Bot died'); this.store.event('death'); });
      bot.on('kicked', reason => { this.store.event('kicked', { reason: String(reason).slice(0, 1000) }); });
      bot.on('error', error => { this.store.event('minecraft_error', { error: error.message }); });
      bot.once('end', reason => {
        clearTimeout(timeout); clearTimeout(this.stableTimer); if (this.bot !== bot) return;
        this.jobs.cancel('Connection ended'); this.bot = null; this.connection = 'disconnected'; this.store.event('disconnected', { reason: String(reason) });
        if (!this.intentional && c.minecraft.reconnect && this.attempt < c.minecraft.reconnectAttempts) {
          const wait = Math.min(30000, 1000 * 2 ** this.attempt++);
          this.reconnectTimer = setTimeout(() => this.connect().catch(e => this.store.event('reconnect_failed', { error: e.message })), wait);
        }
      });
      return this.snapshot();
    } catch (error) { this.connection = 'disconnected'; this.bot = null; throw error; }
  }
  clearControls() {
    const b = this.bot; if (!b) return;
    try { b.pathfinder?.setGoal(null); } catch {}
    try { b.clearControlStates(); } catch {}
    try { b.stopDigging(); } catch {}
    try { b.deactivateItem(); } catch {}
    try { if (b.currentWindow) b.closeWindow(b.currentWindow); } catch {}
  }
  stop(reason = 'Stopped by owner') { this.halted = reason; this.store.event('halted', { reason }); return this.jobs.cancel(reason); }
  resume() {
    this.requireBot();
    if (this.jobs.active) throw new Error('Wait for the cancelled action to settle.');
    if (this.config.safety.protectiveStops && (this.bot.health < this.config.safety.minHealth || this.bot.entity.isInWater || this.bot.entity.isInLava)) throw new Error('Unsafe state. Recover health / leave water before resuming work.');
    this.halted = null; this.store.data.pausedOnRestart = null; this.store.save(); return this.snapshot();
  }
  disconnect(reason = 'Disconnected by owner') {
    if (this.intentional && this.connection === 'disconnected') return { disconnected: true };
    this.intentional = true; this.generation++; clearTimeout(this.reconnectTimer); clearTimeout(this.stableTimer);
    this.halted = reason; this.jobs.cancel(reason); this.bot?.quit(reason); this.connection = 'disconnected';
    return { disconnected: true };
  }
  requireBot() { if (!this.bot?.entity || this.connection !== 'connected') throw new Error('Bot has not spawned. Connect and inspect status first.'); if (this.bot.health <= 0) throw new Error('Bot is dead.'); return this.bot; }
  action(name, args) {
    this.requireBot();
    if (this.halted && !['eat'].includes(name)) throw new Error(`Bot halted: ${this.halted}. Inspect and resume first.`);
    return this.jobs.start(name, args, (signal, progress) => perform(this, name, args, signal, progress), ['build', 'farm', 'sort', 'follow'].includes(name) ? 300000 : 60000);
  }
  foodItem(name) { return this.bot?.inventory.items().find(i => foods.includes(i.name) && (!name || i.name === name)); }
  guardian() {
    const b = this.bot; if (this.connection !== 'connected' || !b?.entity || b.health <= 0) return;
    const c = this.config.safety;
    const danger = b.entity.isInLava ? 'lava' : b.health <= c.disconnectHealth ? 'critical_health' : b.entity.isInWater && (b.oxygenLevel ?? 20) <= c.minOxygen ? 'low_oxygen' : b.health < c.minHealth ? 'low_health' : null;
    if (danger !== (this.lastDanger ?? null)) {
      this.lastDanger = danger;
      this.store.event('survival_observation', { danger, health: b.health, oxygen: b.oxygenLevel });
      if (danger) this.autonomy.nextAt = Math.min(this.autonomy.nextAt, Date.now());
    }
    if (c.protectiveStops && (b.health <= c.disconnectHealth || b.entity.isInLava)) { this.store.event('emergency_disconnect', { health: b.health, lava: !!b.entity.isInLava }); this.disconnect('Critical health or lava'); return; }
    if (c.protectiveStops && b.entity.isInWater && (b.oxygenLevel ?? 20) <= c.minOxygen) {
      if (!this.rescuing) { this.rescuing = true; this.stop('Low oxygen: swim to surface'); }
      if (b.currentWindow) b.closeWindow(b.currentWindow);
      b.setControlState('jump', true); return;
    }
    if (this.rescuing && !b.entity.isInWater) { this.rescuing = false; b.setControlState('jump', false); this.store.event('surface_reached'); }
    if (c.protectiveStops && b.health < c.minHealth && !this.halted) this.stop('Health below work threshold');
    if (c.autoEat && b.food <= c.eatBelow && !this.jobs.active && this.foodItem() && !this.rescuing && !b.currentWindow) this.action('eat', {});
  }
  snapshot() {
    const b = this.bot;
    return { connection: this.connection, halted: this.halted, targetVersion: this.config.minecraft.targetVersion, clientVersion: this.config.minecraft.clientVersion, translation: this.config.proxy.enabled ? `ViaProxy ${this.config.minecraft.clientVersion} → ${this.config.minecraft.targetVersion}; new content may be remapped` : null,
      bot: b?.entity ? { username: b.username, position: b.entity.position, yaw: b.entity.yaw, pitch: b.entity.pitch, health: b.health, food: b.food, oxygen: b.oxygenLevel, inWater: !!b.entity.isInWater, inLava: !!b.entity.isInLava, onGround: b.entity.onGround, dimension: b.game?.dimension, level: b.experience?.level, time: b.time?.timeOfDay, inventory: b.inventory?.items().map(itemView) ?? [] } : null,
      activeJob: this.jobs.active?.job ?? null, helper: this.store.data.helper ?? null, controller: this.store.data.controller,
      autonomy: this.autonomy.status(), vision: this.vision.status(), pendingMessages: this.store.data.messages.filter(m => ['pending', 'uncertain'].includes(m.status)).length };
  }
  observe({ radius = 16, blocks = [], count = 32 } = {}) {
    const b = this.requireBot();
    const entities = Object.values(b.entities).filter(e => e.id !== b.entity.id && e.position.distanceTo(b.entity.position) <= radius).sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position)).slice(0, count).map(e => ({ id: e.id, name: e.name, type: e.type, username: e.username, position: e.position, distance: e.position.distanceTo(b.entity.position) }));
    const ids = blocks.map(n => b.registry.blocksByName[n]?.id).filter(Number.isInteger);
    const found = ids.length ? b.findBlocks({ matching: ids, maxDistance: radius, count }).map(p => blockView(b.blockAt(p))) : [];
    return { ...this.snapshot(), entities, blocks: found, visiblePlayers: Object.values(b.players).map(p => ({ username: p.username, uuid: p.uuid, visible: !!p.entity })) };
  }
  async say(text, { characterId = this.store.data.helper?.characterId } = {}) {
    this.requireBot(); const b = this.bot; const speech = characterSpeech(characterId, text);
    const send = async () => { for (const line of chatLines(speech, 8, characterName(characterId), line => characterSpeech(characterId, line))) { if (this.bot !== b || this.connection !== 'connected') throw new Error('Chat connection ended'); b.chat(line); await delay(600); } return { sent: true, text: speech, characterId, displayName: characterName(characterId) }; };
    const result = this.chatChain.then(send, send); this.chatChain = result.catch(() => {}); return result;
  }
  close() { clearInterval(this.guard); this.store.removeListener('event', this.ownerListener); this.store.data.pausedOnRestart = this.halted; this.store.save(); this.disconnect('Companion stopped'); this.proxy.stop(); }
}
