import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n', { mode: 0o600 });
  // Windows virus scanners/indexers can briefly deny replacement of a file.
  // Keep the old file intact and retry the atomic rename; never unlink it first.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * 2 ** attempt);
    }
  }
}
export class Store extends EventEmitter {
  constructor(dir) {
    super(); this.dir = dir; fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { messages: [], jobs: [], events: [], seq: 0, controller: { threadId: null } };
    for (const job of this.data.jobs) if (['queued', 'running', 'cancelling'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Runtime restarted; inspect world before retrying.'; }
    for (const message of this.data.messages) if (message.status === 'sending') message.status = 'uncertain';
    const tokenPath = path.join(dir, 'api-token');
    if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.token = fs.readFileSync(tokenPath, 'utf8').trim();
    this.save();
  }
  save() { atomicJson(this.file, this.data); }
  event(type, value = {}) {
    const event = { seq: ++this.data.seq, at: new Date().toISOString(), type, ...value };
    this.data.events.push(event); this.data.events = this.data.events.slice(-1000); this.save(); this.emit('event', event); return event;
  }
  message({ id = randomUUID(), text, source, owner, status = 'pending' }) {
    const existing = this.data.messages.find(m => m.id === id);
    if (existing) return existing;
    if (this.data.messages.filter(m => ['pending', 'sending', 'uncertain'].includes(m.status)).length >= 200) throw new Error('Owner inbox full; process or dismiss queued messages first.');
    const message = { id, text, source, owner, role: 'user', at: new Date().toISOString(), status };
    this.data.messages.push(message);
    if (this.data.messages.length > 2000) this.data.messages = this.data.messages.filter(m => !['delivered', 'dismissed'].includes(m.status)).concat(this.data.messages.filter(m => ['delivered', 'dismissed'].includes(m.status)).slice(-1000));
    this.save(); this.event('owner_message', { message }); return message;
  }
  updateMessage(id, changes) { const m = this.data.messages.find(m => m.id === id); if (!m) throw new Error('Message not found'); Object.assign(m, changes); this.save(); return m; }
  job(job) { this.data.jobs.push(job); this.data.jobs = this.data.jobs.slice(-200); this.save(); }
}
