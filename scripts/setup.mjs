import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { ROOT, defaults } from '../src/config.mjs';
import { PROXY_URL, PROXY_SHA256, PROXY_VERSION } from '../src/proxy.mjs';
import { atomicJson } from '../src/store.mjs';

function findJava() {
  const javaFromHome = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (javaFromHome && fs.existsSync(javaFromHome)) return javaFromHome;
  if (spawnSync('java', ['-version'], { windowsHide: true }).status === 0) return 'java';
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const packages = path.join(process.env.LOCALAPPDATA, 'Packages');
    if (fs.existsSync(packages)) for (const name of fs.readdirSync(packages).filter(n => n.startsWith('Microsoft.4297127D64EC6_'))) {
      const java = path.join(packages, name, 'LocalCache/Local/runtime/java-runtime-epsilon/windows-x64/java-runtime-epsilon/bin/java.exe');
      if (fs.existsSync(java)) return java;
    }
  }
  return 'java';
}
const file = path.join(ROOT, 'config.local.json');
if (!fs.existsSync(file)) { const config = structuredClone(defaults); config.proxy.java = findJava(); atomicJson(file, config); console.log('Created config.local.json (auto-connect and LLM controller disabled).'); }
atomicJson(path.join(ROOT, 'config.example.json'), defaults);
const toml = `[mcp_servers.minecraft_companion]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(path.join(ROOT, 'src/mcp.mjs'))}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 45\n`;
fs.mkdirSync(path.join(ROOT, '.codex'), { recursive: true });
const localMcp = path.join(ROOT, '.codex', 'config.toml');
if (!fs.existsSync(localMcp)) fs.writeFileSync(localMcp, toml);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'docs', 'mcp-config.toml'), toml);
if (process.argv.includes('--download-proxy')) {
  const vendor = path.join(ROOT, 'runtime', 'vendor'); fs.mkdirSync(vendor, { recursive: true });
  const jar = path.join(vendor, `ViaProxy-${PROXY_VERSION}.jar`);
  let bytes = fs.existsSync(jar) ? fs.readFileSync(jar) : null;
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== PROXY_SHA256) {
    const response = await fetch(PROXY_URL, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== PROXY_SHA256) throw new Error('Downloaded proxy checksum mismatch.');
    fs.writeFileSync(jar, bytes);
  }
  console.log(`ViaProxy ${PROXY_VERSION} SHA-256 verified.`);
}
if (process.argv.includes('--proxy-login')) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8')); const jar = path.resolve(ROOT, config.proxy.jar);
  if (!fs.existsSync(jar)) throw new Error('Run setup --download-proxy first.');
  const cwd = path.join(ROOT, 'runtime', 'viaproxy'); fs.mkdirSync(cwd, { recursive: true });
  // This explicitly requested command opens the interactive account-login UI.
  const child = spawn(config.proxy.java, ['-jar', jar], { cwd, windowsHide: false, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
console.log('Ready. Edit config.local.json, then npm start. No global Codex configuration was changed.');
