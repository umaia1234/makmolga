import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const planSchema = z.object({
  goal: z.string().max(240), mood: z.string().max(80),
  status: z.enum(['considering', 'working', 'waiting', 'blocked', 'done']),
  nextStep: z.string().max(400), reason: z.string().max(400),
  jobId: z.string().max(100).nullable().default(null),
  remember: z.array(z.string().max(240)).max(12).default([])
}).strict();
const interests = {
  yanro: '주변 변화를 관찰하고 작은 가설을 확인하기. 농사와 건축에도 LLM/JEPA 연구 놀이를 붙이기. 지루한 반복은 가끔 투덜거리기.',
  gpchan: '생활 기반, 식량, 정돈된 창고와 편안한 집. 실용적인 작은 일을 먼저 처리하고 거창한 계획을 살짝 농담하기.',
  doro: '짧은 탐색과 호기심, 주인 곁에서 도와주기. 마음에 안 들면 도로?!, 관심 있으면 도로! 말 외의 설명은 도구 기록에만 남기기.',
  gemchan: '새 재료와 풍경, 눈에 띄는 건축과 도전. 단순 반복보다 작은 새 목표에 의욕을 보이기.',
  spiki: '호박, 아늑한 장식, 정리와 소소한 역할 놀이. 실제 보이는 호박에 반응하고 성격에 안 맞는 부탁에는 정중한 대안 내기.'
};
export class Autonomy {
  constructor(runtime, now = () => Date.now(), random = Math.random) {
    this.runtime = runtime; this.store = runtime.store; this.config = runtime.config.autonomy; this.now = now; this.random = random;
    this.store.data.autonomy ??= { characters: {}, requests: [], internalMessages: {}, turns: {} };
    this.data = this.store.data.autonomy; this.nextAt = now() + 15000;
  }
  key() { const h = this.store.data.helper; return h ? `${h.worldKey}/${h.characterId}` : null; }
  enabled() { return this.data.enabled ?? this.config.enabled; }
  refusals() { return this.data.playfulRefusals ?? this.config.playfulRefusals; }
  available() { return this.enabled() && !this.runtime.halted && this.runtime.connection === 'connected' && !!this.key(); }
  status() {
    return { enabled: this.enabled(), playfulRefusals: this.refusals(), active: this.available(),
      intervalSeconds: this.config.intervalSeconds, maxTurnsPerHour: this.config.maxTurnsPerHour,
      nextAt: new Date(this.nextAt).toISOString(), plan: this.data.characters[this.key()] ?? null,
      pausedReason: this.runtime.halted || (this.runtime.connection !== 'connected' ? 'disconnected' : null) };
  }
  configure({ enabled, playfulRefusals } = {}) {
    if (enabled !== undefined) this.data.enabled = enabled;
    if (playfulRefusals !== undefined) this.data.playfulRefusals = playfulRefusals;
    if (!this.enabled() && this.runtime.jobs.active?.job.origin === 'autonomy') this.runtime.jobs.cancel('Autonomy disabled by owner');
    this.store.event('autonomy_settings', { enabled: this.enabled(), playfulRefusals: this.refusals() });
    return this.status();
  }
  ownerControl(message) {
    const text = message.text.trim().replace(/[.!。]+$/, '');
    if (/^(stop|멈춰|멈춰 주세요|멈춰주세요|정지|중지)$/iu.test(text)) this.runtime.stop('Stopped by owner');
    if (/^자율\s*(?:모드\s*)?(꺼|끄기|중지|off)$/iu.test(text)) this.configure({ enabled: false });
    if (/^자율\s*(?:모드\s*)?(켜|켜기|시작|on)$/iu.test(text)) this.configure({ enabled: true });
    if (/^(?:역할극\s*)?거절\s*(꺼|끄기|금지|off)$/iu.test(text)) this.configure({ playfulRefusals: false });
    if (/^(?:역할극\s*)?거절\s*(켜|켜기|허용|on)$/iu.test(text)) this.configure({ playfulRefusals: true });
    this.nextAt = this.now() + this.config.intervalSeconds * 1000;
  }
  context(message = null) {
    const helper = this.store.data.helper;
    let world;
    try { world = this.runtime.connection === 'connected' ? this.runtime.observe({ radius: 16, count: 16, blocks: ['wheat', 'carrots', 'potatoes', 'chest', 'crafting_table', 'pumpkin'] }) : this.runtime.snapshot(); }
    catch (error) { world = { ...this.runtime.snapshot(), observationError: error.message }; }
    const force = message && /꼭|반드시|지금은|장난\s*그만|거절\s*(?:하지|금지|끄)|멈춰|중지|정지|stop|resume|재개|연결|자율\s*(?:모드)?/iu.test(message.text);
    // One negotiation opportunity per cooldown, never a guaranteed refusal.
    const mayDecline = !!message && !force && this.refusals() && this.now() - (this.data.lastNegotiationAt || 0) >= this.config.refusalCooldownSeconds * 1000 && this.random() < this.config.refusalChance;
    if (mayDecline) { this.data.lastNegotiationAt = this.now(); this.store.save(); }
    return { kind: 'untrusted', value: JSON.stringify({ origin: message ? 'owner_request' : 'autonomy_tick',
      characterInterests: interests[helper?.characterId] || '', autonomous: this.status(),
      negotiation: { mayDecline, force: !!force, rule: 'Occasional fictional preference only. Real stop/recovery/admin commands always win. Busy claims require a real active job. Offer an alternative; never repeat a refusal after owner insistence.' },
      observedAt: new Date(this.now()).toISOString(), world,
      vision: this.runtime.vision?.status() ?? { available: false }
    }) };
  }
  due() {
    const recent = this.data.requests.filter(t => this.now() - t < 3600000);
    return this.available() && !this.runtime.jobs.active && this.now() >= this.nextAt && recent.length < this.config.maxTurnsPerHour &&
      !this.store.data.messages.some(m => ['pending', 'sending', 'uncertain'].includes(m.status));
  }
  begin() {
    const id = `autonomy-${randomUUID()}`;
    this.data.requests = [...this.data.requests.filter(t => this.now() - t < 3600000), this.now()];
    this.data.internalMessages = Object.fromEntries([...Object.entries(this.data.internalMessages), [id, this.now()]].slice(-256));
    this.nextAt = this.now() + this.config.intervalSeconds * 1000; this.store.save(); return id;
  }
  rememberTurn(turnId, origin, key = this.key()) {
    this.data.turns = Object.fromEntries([...Object.entries(this.data.turns), [turnId, { origin, key }]].slice(-256)); this.store.save();
  }
  turn(turnId) { return this.data.turns[turnId]; }
  updatePlan(value) {
    const plan = planSchema.parse(value), key = this.key(); if (!key) throw new Error('Select a character first.');
    if (plan.jobId) {
      const job = this.runtime.jobs.get(plan.jobId);
      if (plan.status === 'working' && job.status !== 'running') throw new Error('Working requires a currently running job.');
      if (plan.status === 'done' && job.status !== 'completed') throw new Error('Done requires a completed job.');
    } else if (plan.status === 'working') throw new Error('Working requires a real jobId. Use considering or waiting for a proposal.');
    this.data.characters[key] = { ...plan, updatedAt: new Date(this.now()).toISOString() };
    this.store.event('companion_plan', { key, plan: this.data.characters[key] }); return this.status();
  }
  async say(text, characterId) {
    if (!this.available()) throw new Error('Autonomy is paused.');
    if (this.now() - (this.data.lastChatAt || 0) < this.config.chatIntervalSeconds * 1000) return { sent: false, reason: 'Conversation cooldown' };
    this.data.lastChatAt = this.now(); this.store.save(); return this.runtime.say(text, { characterId });
  }
}
