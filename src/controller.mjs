import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { Rpc } from './rpc.mjs';
import { dispatch, toolSpec, json } from './tools.mjs';
import { personaContext } from './characters.mjs';
import { characterSpeech, personaInstructions } from './voice.mjs';

export class Controller {
  constructor(runtime, rpc = new Rpc()) {
    this.runtime = runtime; this.store = runtime.store; this.config = runtime.config.controller; this.rpc = rpc;
    this.activeTurn = null; this.sending = false; this.started = false; this.fault = false; this.closed = false; this.replied = new Set();
    this.rpc.on('notification', m => { this.onNotification(m).catch(e => this.store.event('controller_event_error', { error: e.message })); });
    this.rpc.on('request', m => { this.onRequest(m).catch(e => { try { this.rpc.reject(m.id, e.message); } catch {} }); });
    this.rpc.on('closed', e => { if (!this.closed) { this.fault = true; this.lastError = e.message; this.store.event('controller_disconnected', { error: e.message }); } });
  }
  async start() {
    if (this.closed || this.fault) throw new Error('Controller is closed or faulted. Inspect events before restarting the runtime.');
    if (this.started) return;
    if (!this.starting) this.starting = this.initialize().catch(error => {
      this.fault = true; this.lastError = error.message; this.rpc.close(); throw error;
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  status() {
    return { enabled: this.config.enabled, ready: this.config.enabled && this.started && !this.closed && !this.fault,
      starting: !!this.starting, fault: this.fault, closed: this.closed, activeTurn: this.activeTurn,
      threadId: this.threadId || this.store.data.controller.threadId || null, characterId: this.characterKey === 'unselected' ? null : this.characterKey ?? null,
      rateLimited: !!this.rateLimited, error: this.lastError || null };
  }
  async prepare() {
    await this.start();
    if (!this.activeTurn) await this.selectCharacterThread();
    const account = await this.rpc.request('account/read', { refreshToken: false });
    if (account.requiresOpenaiAuth !== false && !account.account) {
      this.fault = true; this.lastError = 'Codex login is required. Sign in and restart the companion runtime.';
      throw new Error(this.lastError);
    }
  }
  async initialize() {
    if (!this.runtime.config.owner.uuid) throw new Error('Set owner.uuid before enabling the controller.');
    await this.rpc.connect(this.config, ROOT);
    await this.selectCharacterThread();
    if (this.closed || this.fault) throw new Error('Controller closed while starting.');
    this.started = true; this.store.event('controller_ready', { threadId: this.threadId, transport: this.config.transport });
  }
  async selectCharacterThread() {
    if (!this.switching && this.characterKey === (this.store.data.helper?.characterId || 'unselected')) return;
    if (!this.switching) this.switching = this.bindCharacterThread().finally(() => { this.switching = null; });
    await this.switching;
    if (!this.activeTurn && this.characterKey !== (this.store.data.helper?.characterId || 'unselected')) await this.selectCharacterThread();
  }
  async bindCharacterThread() {
    const characterId = this.store.data.helper?.characterId ?? null;
    const key = characterId || 'unselected';
    if (this.characterKey === key) return;
    if (this.activeTurn) throw new Error('Finish the active character turn before changing its conversation.');
    // Separate conversational memory for each persona; the common owner inbox
    // and actual Minecraft world state remain shared.
    const threads = this.store.data.controller.characterThreads || {};
    if (!Object.keys(threads).length && this.store.data.controller.threadId && !this.store.data.controller.legacyThreadId)
      this.store.data.controller.legacyThreadId = this.store.data.controller.threadId;
    const savedId = threads[key] || (this.config.threadId && !Object.keys(threads).length ? this.config.threadId : null);
    let result;
    const prompt = fs.readFileSync(path.join(ROOT, 'skills', 'minecraft-companion', 'references', 'controller-prompt.md'), 'utf8') + '\n\n' + personaInstructions(characterId);
    if (savedId) {
      result = await this.rpc.request('thread/resume', { threadId: savedId, developerInstructions: prompt });
      // Only a thread created with this tool bundle is a supported standalone controller.
      // An existing Desktop conversation uses the MCP mode instead.
    } else {
      result = await this.rpc.request('thread/start', { cwd: ROOT, ...(this.config.model ? { model: this.config.model } : {}), developerInstructions: prompt, dynamicTools: toolSpec(), environments: [], ephemeral: false, serviceName: 'minecraft-companion' });
    }
    this.threadId = result.thread.id; this.characterKey = key;
    this.store.data.controller.characterThreads = { ...threads, [key]: this.threadId };
    this.store.data.controller.threadId = this.threadId; this.store.save();
    const active = result.thread.turns?.findLast(t => t.status === 'inProgress'); if (active) this.activeTurn = active.id;
    this.store.event('controller_character_ready', { characterId, threadId: this.threadId });
  }
  run() {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => { this.pump().catch(error => { this.fault = true; this.store.event('controller_failed', { error: error.message }); }); }, 500);
  }
  voiceForTurn(turnId) {
    const voices = this.store.data.controller.speechTurns || {};
    if (turnId && Object.hasOwn(voices, turnId)) return voices[turnId];
    return this.pendingVoice !== undefined ? this.pendingVoice : this.store.data.helper?.characterId ?? null;
  }
  rememberVoice(turnId, characterId) {
    if (!turnId) return;
    const voices = { ...this.store.data.controller.speechTurns, [turnId]: characterId };
    this.store.data.controller.speechTurns = Object.fromEntries(Object.entries(voices).slice(-32));
    this.store.data.controller.lastSpeechTurnId = turnId; this.store.save();
  }
  async pump() {
    if (this.closed || this.sending || this.fault) return;
    const message = this.store.data.messages.find(m => m.status === 'pending'); if (!message) return;
    this.sending = true;
    try {
      if (!this.started) await this.start();
      const helperRevision = this.store.data.helper?.revision || 0;
      // Finish the current character's reply before starting the newly selected character.
      if (this.activeTurn && helperRevision !== (this.store.data.controller.activeHelperRevision || 0)) return;
      if (!this.activeTurn) await this.selectCharacterThread();
      const recent = (this.store.data.controller.requests || []).filter(t => Date.now() - t < 3600000);
      if (recent.length >= this.config.maxTurnsPerHour) {
        if (!this.rateLimited) { this.rateLimited = true; this.store.event('controller_rate_limited'); } return;
      }
      this.rateLimited = false;
      this.store.data.controller.requests = [...recent, Date.now()];
      this.store.updateMessage(message.id, { status: 'sending', threadId: this.threadId });
      const params = { threadId: this.threadId, clientUserMessageId: message.id, input: [{ type: 'text', text: message.text, text_elements: [] }] };
      const voice = this.activeTurn ? this.voiceForTurn(this.activeTurn) : this.store.data.helper?.characterId ?? null;
      this.pendingVoice = voice;
      try {
        const result = this.activeTurn
          ? await this.rpc.request('turn/steer', { ...params, expectedTurnId: this.activeTurn })
          : await this.rpc.request('turn/start', { ...params, additionalContext: personaContext(this.store) });
        this.activeTurn = result.turn?.id || result.turnId || this.activeTurn;
        this.rememberVoice(this.activeTurn, voice);
        this.store.data.controller.activeHelperRevision = helperRevision;
        this.store.updateMessage(message.id, { status: 'delivered', turnId: this.activeTurn });
        this.armDeadline();
      } catch (error) {
        // A timeout may occur after acceptance. Preserve it for reconciliation; do not replay automatically.
        this.store.updateMessage(message.id, { status: 'uncertain', error: error.message });
        this.store.event('message_delivery_uncertain', { id: message.id, error: error.message });
      } finally { this.pendingVoice = undefined; }
    } finally { this.sending = false; }
  }
  armDeadline() {
    clearTimeout(this.turnTimer); const turnId = this.activeTurn;
    if (!turnId) return;
    this.turnTimer = setTimeout(async () => {
      if (this.activeTurn !== turnId) return;
      this.runtime.stop('Controller turn exceeded configured time limit');
      try { await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId }); } catch {}
      this.store.event('controller_turn_timeout', { turnId });
    }, this.config.idleTimeoutSeconds * 1000);
  }
  async onNotification({ method, params = {} }) {
    if (!this.threadId || params.threadId !== this.threadId) return;
    if (method === 'turn/started') { this.activeTurn = params.turn.id; this.rememberVoice(this.activeTurn, this.voiceForTurn(this.activeTurn)); this.armDeadline(); }
    if (method === 'turn/completed' && params.turn.id === this.activeTurn) { this.activeTurn = null; clearTimeout(this.turnTimer); this.store.event('controller_turn_completed', { turnId: params.turn.id, status: params.turn.status }); }
    if (method === 'item/completed' && params.item?.type === 'userMessage') {
      const item = params.item; const id = item.clientId || item.id;
      const text = item.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      if (text) this.store.message({ id, text, source: 'codex', owner: this.runtime.config.owner.uuid, status: 'delivered' });
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') {
      const item = params.item; if (this.replied.has(item.id)) return; this.replied.add(item.id);
      if (this.replied.size > 1000) this.replied.delete(this.replied.values().next().value);
      const characterId = this.voiceForTurn(params.turnId || this.activeTurn || this.store.data.controller.lastSpeechTurnId);
      const text = characterSpeech(characterId, item.text);
      this.store.event('controller_reply', { threadId: this.threadId, characterId, text, ...(text !== item.text ? { modelText: item.text } : {}) });
      if (this.config.replyInGame && this.runtime.connection === 'connected') await this.runtime.say(text, { characterId });
    }
  }
  async onRequest({ id, method, params = {} }) {
    if (method === 'item/tool/call' && params.threadId === this.threadId) {
      try { const speechCharacterId = this.voiceForTurn(params.turnId || this.activeTurn || this.store.data.controller.lastSpeechTurnId); const result = await dispatch(this.runtime, params.tool, params.arguments, { speechCharacterId }); this.rpc.respond(id, { success: true, contentItems: [{ type: 'inputText', text: json(result) }] }); }
      catch (error) { this.rpc.respond(id, { success: false, contentItems: [{ type: 'inputText', text: error.message }] }); }
    } else if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.rpc.respond(id, { decision: 'decline' }); this.store.event('controller_approval_required', { method });
    } else { this.rpc.reject(id, 'Interactive approval/input must be handled in the Codex client.'); }
  }
  close() { this.closed = true; clearInterval(this.timer); clearTimeout(this.turnTimer); this.rpc.close(); }
}
