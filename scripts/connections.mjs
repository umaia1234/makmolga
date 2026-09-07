import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../src/config.mjs';
import { autoConfigure } from '../src/connections.mjs';
import { serveConnections } from '../src/connection-server.mjs';

function openBrowser(url) {
  // Encoded PowerShell argument contains only a validated local URL.
  const u = new URL(url); if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw new Error('Invalid setup URL');
  if (process.platform === 'win32') {
    const code = `Start-Process '${url.replace(/'/g, "''")}'`;
    const child = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' }); child.on('error', e => console.error(e.message));
  } else { const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }); child.on('error', e => console.error(e.message)); }
}
if (process.argv.includes('--auto')) {
  const result = await autoConfigure({ install: process.argv.includes('--install'), onProgress: text => console.error(text) });
  console.log(JSON.stringify(result, null, 2));
} else {
  let existing;
  try {
    const endpoint = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime/connections-endpoint.json'), 'utf8'));
    const url = new URL(endpoint.url);
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^[a-f0-9]{64}$/.test(url.hash.slice(1))) {
      const r = await fetch(`${url.origin}/api/state`, { headers: { Authorization: `Bearer ${url.hash.slice(1)}` }, signal: AbortSignal.timeout(1500) });
      if (r.ok && (await r.json()).root === ROOT) existing = endpoint.url;
    }
  } catch {}
  if (existing) { if (process.argv.includes('--open')) openBrowser(existing); console.log('동료 연결 센터가 이미 실행 중입니다.'); }
  else {
    const { server, service, url } = await serveConnections();
    console.log('동료 연결 센터를 시작했습니다.');
    if (process.argv.includes('--open')) openBrowser(url);
    void service.action('refresh');
    process.on('SIGINT', () => { server.closeAllConnections(); server.close(); });
    process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
  }
}
