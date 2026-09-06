import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { dispatch, json } from './tools.mjs';
import { atomicJson } from './store.mjs';
import path from 'node:path';

export function sameToken(a, b) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export async function serve(runtime) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    const reply = (status, body) => { if (!res.writableEnded) { res.statusCode = status; res.end(json(body)); } };
    // No browser cross-origin access; API credentials never appear in a URL.
    if (req.headers.origin || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return reply(403, { error: 'Local clients only' });
    if (!sameToken(String(req.headers.authorization || ''), `Bearer ${runtime.store.token}`)) return reply(401, { error: 'Unauthorized' });
    if (req.method !== 'POST' || req.url !== '/call') return reply(404, { error: 'Not found' });
    let raw = ''; let oversized = false;
    req.on('data', chunk => { raw += chunk; if (Buffer.byteLength(raw) > 262144) { oversized = true; reply(413, { error: 'Request too large' }); req.destroy(); } });
    req.on('end', async () => {
      if (oversized) return;
      try {
        const body = JSON.parse(raw);
        if (body.name === 'companion_shutdown' && server.listenerCount('shutdownRequested')) { reply(200, { result: { shuttingDown: true } }); setTimeout(() => server.emit('shutdownRequested'), 25); return; }
        const result = await dispatch(runtime, body.name, body.arguments); reply(200, { result });
      }
      catch (error) { reply(400, { error: error.message }); }
    });
  });
  server.requestTimeout = 35000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(runtime.config.api.port, '127.0.0.1', resolve); });
  const port = server.address().port;
  atomicJson(path.join(runtime.store.dir, 'endpoint.json'), { url: `http://127.0.0.1:${port}`, pid: process.pid });
  return server;
}
