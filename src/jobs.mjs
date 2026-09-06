import { randomUUID } from 'node:crypto';

export const abortError = reason => Object.assign(new Error(String(reason || 'Cancelled')), { name: 'AbortError' });
export function check(signal) { if (signal.aborted) throw abortError(signal.reason); }
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal.reason));
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError(signal.reason)); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export class Jobs {
  constructor(store, cleanup, onStuck = () => {}) { this.store = store; this.cleanup = cleanup; this.onStuck = onStuck; this.active = null; }
  start(name, args, operation, timeoutMs = 60000) {
    if (this.active) throw new Error(`Busy: ${this.active.job.id}. Cancel it or wait before another action.`);
    const job = { id: randomUUID(), name, args, status: 'running', startedAt: new Date().toISOString(), progress: null };
    const control = new AbortController(); const state = { job, control }; this.active = state; this.store.job(job);
    const timer = setTimeout(() => this.cancel('Action timed out'), timeoutMs);
    const progress = value => { check(control.signal); job.progress = value; this.store.save(); };
    state.done = Promise.resolve().then(() => { check(control.signal); return operation(control.signal, progress); }).then(result => {
      check(control.signal); job.status = 'completed'; job.result = result;
    }).catch(error => {
      job.status = control.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message;
    }).finally(() => {
      clearTimeout(timer); clearTimeout(state.stuckTimer); this.cleanup(); job.finishedAt = new Date().toISOString();
      if (this.active === state) this.active = null;
      this.store.event('job_finished', { job });
    });
    this.store.event('job_started', { jobId: job.id, name });
    return job;
  }
  cancel(reason = 'Stopped by owner') {
    const state = this.active; this.cleanup();
    if (!state) return { stopped: true, activeJob: null };
    if (!state.control.signal.aborted) {
      state.control.abort(reason); state.job.status = 'cancelling'; this.store.save();
      state.stuckTimer = setTimeout(() => { if (this.active === state) this.onStuck('Cancelled action did not settle; disconnecting to prevent stale actions.'); }, 1500);
    }
    return { stopped: true, activeJob: state.job.id };
  }
  get(id) { const job = this.store.data.jobs.find(j => j.id === id); if (!job) throw new Error('Job not found'); return job; }
}
