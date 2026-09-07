import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const providerNames = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };
export function providerEnv(provider, env = process.env) {
  // Antigravity documents manual OAuth in an SSH environment. Select that
  // transport for this embedded, noninteractive process so status checks never
  // open a browser. No SSH connection is created; the parent environment stays intact.
  return provider === 'antigravity' ? { ...env, SSH_CONNECTION: env.SSH_CONNECTION || '127.0.0.1 0 127.0.0.1 0' } : env;
}
export function findProgram(provider, configured, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const windows = platform === 'win32', name = provider === 'antigravity' ? 'agy' : provider;
  // Launch native programs directly. Never interpolate a path into cmd.exe or PowerShell.
  const candidates = configured ? [configured] : [];
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  if (!configured || configured === name) {
    candidates.push(...String(env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p.replace(/^"|"$/g, ''), name + (windows ? '.exe' : ''))));
    candidates.push(path.join(home, '.local', 'bin', name + (windows ? '.exe' : '')));
    if (windows) {
      candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', name + '.exe'));
      if (provider === 'antigravity') candidates.push(path.join(local, 'agy', 'bin', 'agy.exe'));
      if (provider === 'codex') {
        const base = path.join(local, 'OpenAI', 'Codex', 'bin');
        if (fs.existsSync(base)) for (const dir of fs.readdirSync(base)) candidates.push(path.join(base, dir, 'codex.exe'));
        const packages = path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai');
        candidates.push(path.join(packages, 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
        candidates.push(path.join(packages, 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
        candidates.push(path.join(packages, 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe'));
      }
    }
  }
  return candidates.find(p => path.isAbsolute(p) && (!windows || /\.exe$/i.test(p)) && fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}
export function terminateTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else child.kill('SIGTERM');
}
export function runProgram(command, args, { cwd, env = process.env, timeoutMs = 15000, input, onOutput, stopOnAuth = false } = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false, timedOut = false, authRequired = false;
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (code, error = null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ code, stdout, stderr, error, timedOut, authRequired });
    };
    const timer = setTimeout(() => { timedOut = true; terminateTree(child); finish(null, 'Command timed out'); }, timeoutMs);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', bytes => {
      const text = String(bytes); if (key === 'stdout') stdout = (stdout + text).slice(-262144); else stderr = (stderr + text).slice(-16384);
      onOutput?.(text, key);
      if (stopOnAuth && /Authentication required|Waiting for authentication|not logged in/i.test(stdout + stderr)) {
        authRequired = true; terminateTree(child); finish(1, 'Login required');
      }
    });
    child.once('error', error => finish(null, error.message)); child.once('close', code => finish(code));
    child.stdin.on('error', () => {}); child.stdin.end(input || '');
  });
}
export function codexLoginState(check) {
  const output = check.stdout + check.stderr;
  if (/not logged in/i.test(output)) return 'required';
  return check.code === 0 && /\blogged in\b/i.test(output) ? 'signed_in' : 'unknown';
}
export async function inspectProvider(provider, configured, options = {}) {
  const command = findProgram(provider, configured, options);
  if (!command) return { id: provider, name: providerNames[provider], installed: false, auth: 'unknown', state: 'missing', command: null };
  const version = await runProgram(command, ['--version'], options);
  const info = { id: provider, name: providerNames[provider], installed: version.code === 0, command,
    version: version.stdout.trim().split('\n')[0], auth: 'unknown', state: version.code === 0 ? 'installed' : 'broken' };
  if (!info.installed) return { ...info, note: '실행 파일을 시작하지 못했습니다.' };
  // Unlike `-p /usage`, the official `models` subcommand reports missing auth
  // without starting OAuth or opening a browser.
  const check = await runProgram(command, provider === 'claude' ? ['auth', 'status'] : provider === 'codex' ? ['login', 'status'] : ['models'], { ...options, timeoutMs: 12000, stopOnAuth: true });
  if (provider === 'claude') {
    try { info.auth = JSON.parse(check.stdout).loggedIn ? 'signed_in' : 'required'; } catch { info.auth = 'unknown'; }
  } else if (provider === 'codex') info.auth = codexLoginState(check);
  else info.auth = check.authRequired || /please sign in|not logged in|unauthenticated/i.test(check.stdout + check.stderr) ? 'required' : check.code === 0 ? 'signed_in' : 'unknown';
  info.state = info.auth === 'signed_in' ? 'signed_in' : info.auth === 'required' ? 'login_required' : 'auth_unknown';
  info.note = info.auth === 'signed_in' ? '로그인 확인 · 모델 연결 시험을 할 수 있습니다.' : info.auth === 'required' ? '계정 로그인이 필요합니다.' : '로그인 상태를 확인하지 못했습니다. 연결 시험으로 확인해 주세요.';
  return info;
}
