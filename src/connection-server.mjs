import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { ROOT } from './config.mjs';
import { sameToken } from './api.mjs';
import { ConnectionService } from './connections.mjs';
import { atomicJson } from './store.mjs';

export async function serveConnections({ root = ROOT, service = new ConnectionService(root), port = 0 } = {}) {
  const token = randomBytes(32).toString('hex');
  const files = new Map([['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']], ['/setup.css', ['setup.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']]]);
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const reply = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) return reply(403, { error: '이 PC의 연결 센터에서만 사용할 수 있습니다.' });
    if (req.method === 'GET' && files.has(req.url)) {
      const [file, type] = files.get(req.url); res.setHeader('Content-Type', type + '; charset=utf-8');
      return res.end(fs.readFileSync(path.join(root, 'ui/connections', file)));
    }
    const skin = /^\/skins\/(yanro|gpchan|doro|gemchan|spiki|clchan|fablechan)\.png$/.exec(req.url);
    if (req.method === 'GET' && skin) { const file = path.join(root, 'fabric-mod/src/main/resources/assets/companion/textures/skins', `${skin[1]}.png`); if (!fs.existsSync(file)) return reply(404, { error: 'Character unavailable' }); res.setHeader('Content-Type', 'image/png'); return res.end(fs.readFileSync(file)); }
    if (!sameToken(String(req.headers.authorization || ''), `Bearer ${token}`)) return reply(401, { error: '연결 센터를 다시 열어 주세요. 이 창의 연결 정보가 만료되었습니다.' });
    if (req.method === 'GET' && req.url === '/api/state') return reply(200, service.snapshot());
    if (req.method !== 'POST' || req.url !== '/api/action') return reply(404, { error: 'Not found' });
    try { let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) return reply(413, { error: '설정 데이터가 너무 큽니다.' }); }
      const input = JSON.parse(raw); reply(200, await service.action(input.action, input.input)); }
    catch (error) { reply(400, { error: error.name === 'ZodError' ? `설정 값을 확인해 주세요. ${error.issues?.[0]?.message || ''}` : error.message }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/#${token}`;
  atomicJson(path.join(root, 'runtime/connections-endpoint.json'), { url, pid: process.pid });
  server.on('close', () => service.close());
  return { server, service, url, token };
}
