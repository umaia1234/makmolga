import fs from 'node:fs';
import path from 'node:path';
import { ROOT, isLoopback } from './config.mjs';

export async function call(name, args = {}, options = {}) {
  const dir = options.dir || process.env.COMPANION_RUNTIME || path.join(ROOT, 'runtime');
  const endpoint = JSON.parse(fs.readFileSync(path.join(dir, 'endpoint.json'), 'utf8'));
  const url = new URL(endpoint.url);
  if (url.protocol !== 'http:' || !isLoopback(url.hostname)) throw new Error('Refusing a non-loopback endpoint.');
  const token = fs.readFileSync(path.join(dir, 'api-token'), 'utf8').trim();
  const response = await fetch(`${url.origin}/call`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }), signal: AbortSignal.timeout(options.timeoutMs ?? 40000) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body.result;
}
