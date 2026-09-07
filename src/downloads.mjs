import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT } from './config.mjs';
import { runProgram } from './provider-process.mjs';

export const downloads = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/downloads.json'), 'utf8'));
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export async function downloadVerified(spec, file, { fetcher = fetch, progress = () => {} } = {}) {
  if (!/^https:\/\//.test(spec.url) || !/^[a-f0-9]{64}$/.test(spec.sha256)) throw new Error('Invalid download manifest');
  if (fs.existsSync(file) && sha256(file) === spec.sha256) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.download`;
  try {
    const response = await fetcher(spec.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`다운로드 응답 ${response.status}`);
    const hash = createHash('sha256'); let total = 0, last = 0;
    const fd = fs.openSync(temporary, 'wx');
    try {
      for await (const bytes of response.body) {
        total += bytes.length; if (total > 512 * 1024 * 1024) throw new Error('다운로드 크기 제한을 초과했습니다.');
        hash.update(bytes); fs.writeFileSync(fd, bytes);
        if (Date.now() - last > 1000) { progress(`공식 파일 다운로드 중 · ${Math.round(total / 1048576)} MB`); last = Date.now(); }
      }
    } finally { fs.closeSync(fd); }
    if (hash.digest('hex') !== spec.sha256) throw new Error('다운로드한 파일의 체크섬이 다릅니다. 설치를 중단했습니다.');
    fs.renameSync(temporary, file); return file;
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export async function extractZip(archive, destination) {
  if (process.platform !== 'win32') throw new Error('자동 설치는 Windows x64에서 지원합니다.');
  fs.mkdirSync(destination, { recursive: true });
  const result = await runProgram('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:MAKMOLGA_ARCHIVE -DestinationPath $env:MAKMOLGA_EXTRACT -Force'],
    { env: { ...process.env, MAKMOLGA_ARCHIVE: archive, MAKMOLGA_EXTRACT: destination }, timeoutMs: 180000 });
  if (result.code !== 0) throw new Error('압축을 풀지 못했습니다. 폴더 쓰기 권한과 남은 디스크 공간을 확인해 주세요.');
}
export async function findJava(root = ROOT, configured) {
  const candidates = [configured, process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin/java.exe'), 'java'];
  const installed = path.join(root, 'runtime/java');
  if (fs.existsSync(installed)) for (const dir of fs.readdirSync(installed)) candidates.push(path.join(installed, dir, 'bin/java.exe'));
  for (const base of [path.join(process.env.APPDATA || '', '.minecraft/runtime'), path.join(process.env.LOCALAPPDATA || '', 'Packages')]) {
    if (!path.isAbsolute(base) || !fs.existsSync(base)) continue;
    if (base.endsWith('Packages')) {
      for (const dir of fs.readdirSync(base).filter(n => n.startsWith('Microsoft.4297127D64EC6_'))) candidates.push(path.join(base, dir, 'LocalCache/Local/runtime/java-runtime-epsilon/windows-x64/java-runtime-epsilon/bin/java.exe'));
    } else candidates.push(path.join(base, 'java-runtime-epsilon/windows-x64/java-runtime-epsilon/bin/java.exe'));
  }
  for (const command of [...new Set(candidates.filter(Boolean))]) {
    if (command !== 'java' && !fs.existsSync(command)) continue;
    const r = await runProgram(command, ['-version'], { timeoutMs: 5000 });
    const text = r.stdout + r.stderr, major = Number(text.match(/version "(\d+)/)?.[1]);
    if (r.code === 0 && major >= 25) return { available: true, command, version: text.trim().split('\n')[0] };
  }
  return { available: false, command: null, version: null };
}
export async function ensureJava(root = ROOT, configured, progress = () => {}) {
  let java = await findJava(root, configured); if (java.available) return java;
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Java 25 이상을 설치하고 다시 확인해 주세요. 자동 설치는 Windows x64용입니다.');
  progress('이 폴더에 Java 실행 환경을 준비하고 있습니다.');
  const archive = await downloadVerified(downloads.java, path.join(root, 'runtime/downloads/java.zip'), { progress });
  await extractZip(archive, path.join(root, 'runtime/java'));
  java = await findJava(root); if (!java.available) throw new Error('Java 설치 후 실행을 확인하지 못했습니다.'); return java;
}
