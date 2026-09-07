import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import mc from 'minecraft-protocol';
import { z } from 'zod';
import { ROOT, loadConfig, configSchema, isLoopback } from './config.mjs';
import { call } from './client.mjs';
import { backedJson } from './settings.mjs';
import { atomicJson } from './store.mjs';
import { findJava, ensureJava, downloads, downloadVerified, sha256 } from './downloads.mjs';
import { findProgram, runProgram } from './provider-process.mjs';
import { PROXY_URL, PROXY_SHA256, PROXY_VERSION } from './proxy.mjs';

const playerName = z.string().trim().regex(/^[A-Za-z0-9_]{3,16}$/, '게임 이름은 영문·숫자·밑줄 3~16자입니다.');
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, '올바른 사용자 UUID가 필요합니다.');
export const gameSettingsSchema = z.object({
  gameDirectory: z.string().trim().min(1).max(2048).refine(path.isAbsolute, '게임 폴더 전체 경로를 입력해 주세요.'),
  host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9._:\-]+$/, '서버 주소에는 프로토콜이나 포트를 붙이지 마세요.'),
  port: z.number().int().min(1).max(65535), ownerName: playerName, ownerUuid: uuid, botName: playerName,
  accountIndex: z.number().int().min(0).max(99), prefix: z.string().max(32), autonomy: z.boolean(), vision: z.boolean()
}).strict();
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const localDir = root => path.join(root, 'runtime');
function existingGameDirectory(value) {
  if (!path.isAbsolute(value) || !fs.existsSync(value)) throw new Error('존재하는 Minecraft 게임 폴더를 지정해 주세요.');
  const dir = fs.realpathSync(value);
  if (!['launcher_profiles.json', 'launcher_profiles_microsoft_store.json', 'versions', 'mods'].some(n => fs.existsSync(path.join(dir, n)))) throw new Error('Minecraft 폴더인지 확인할 수 없습니다. 런처에서 게임 폴더를 확인해 주세요.');
  return dir;
}
function childPath(root, name) {
  const file = path.resolve(root, name), relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid installation path');
  if (fs.existsSync(file) && fs.realpathSync(file) !== file) throw new Error('설치 대상의 연결 폴더는 지원하지 않습니다. 실제 게임 폴더를 선택해 주세요.');
  return file;
}
export async function lookupOwner(name, { fetcher = fetch } = {}) {
  name = playerName.parse(name);
  const response = await fetcher(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('게임 이름을 찾지 못했습니다. Java Edition 프로필 이름을 확인하거나 고급 설정에 UUID를 입력해 주세요.');
  const profile = await response.json();
  if (!/^[a-f0-9]{32}$/i.test(profile.id) || profile.name?.toLowerCase() !== name.toLowerCase()) throw new Error('공식 프로필 응답을 확인하지 못했습니다.');
  return { ownerName: profile.name, ownerUuid: profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5') };
}
export class GameSetup {
  constructor(root = ROOT, { invoke = call, runner = runProgram, javaFinder = findJava, javaInstaller = ensureJava, downloader = downloadVerified } = {}) {
    this.root = root; this.invoke = invoke; this.runner = runner; this.javaFinder = javaFinder; this.javaInstaller = javaInstaller; this.downloader = downloader; this.state = null;
  }
  config() { return loadConfig(path.join(this.root, 'config.local.json')); }
  settings() {
    const c = this.config(), saved = readJson(path.join(this.root, 'runtime/setup.json'), {});
    return { gameDirectory: saved.gameDirectory || path.join(process.env.APPDATA || process.env.HOME || this.root, '.minecraft'), host: c.minecraft.host, port: c.minecraft.port,
      ownerName: c.owner.username, ownerUuid: c.owner.uuid, botName: c.minecraft.username, accountIndex: c.proxy.accountIndex,
      prefix: readJson(path.join(this.root, 'config.local.json'), {}).owner?.prefix ?? '', autonomy: c.autonomy.enabled, vision: c.vision.enabled };
  }
  async session() {
    try {
      const result = await this.invoke('companion_session', {}, { dir: localDir(this.root), timeoutMs: 2000 });
      if (path.resolve(result.root || '.') !== path.resolve(this.root)) throw new Error('다른 맠몰가 폴더의 실행기입니다. 해당 실행기를 먼저 확인해 주세요.');
      return result;
    } catch (e) { if (e.code === 'ENOENT' || e.cause?.code === 'ECONNREFUSED') return null; throw e; }
  }
  async inspect() {
    const settings = this.settings(), c = this.config();
    let session = null, sessionError = null;
    try { session = await this.session(); } catch (error) { sessionError = error.message; }
    const java = await this.javaFinder(this.root, c.proxy.java);
    const modDir = path.join(settings.gameDirectory, 'mods');
    const version = readJson(path.join(this.root, 'package.json'), { version: 'development' }).version;
    const jar = path.resolve(this.root, c.proxy.jar);
    this.state = { settings, version, java: { available: java.available, version: java.version }, proxyReady: fs.existsSync(jar) && sha256(jar) === PROXY_SHA256,
      modInstalled: fs.existsSync(path.join(modDir, `companion-selector-26.2-${version}.jar`)),
      loaderInstalled: fs.existsSync(path.join(settings.gameDirectory, `versions/fabric-loader-${downloads.loader}-26.2`)),
      session: session ? { running: true, connection: session.runtime.connection, halted: session.runtime.halted, ready: session.controller.ready,
        activeJob: !!session.runtime.activeJob, activeTurn: !!session.controller.activeTurn, character: session.runtime.helper?.selected?.character?.name || null,
        health: session.runtime.health, error: session.controller.error || null } : { running: false }, sessionError };
    return this.state;
  }
  async save(input) {
    const v = gameSettingsSchema.parse(input), c = this.config();
    if (c.minecraft.auth === 'offline' && !isLoopback(v.host)) throw new Error('이 설치는 로컬 시험 월드 인증을 사용합니다. 외부 서버로 바꾸기 전에 온라인 봇 계정 설정이 필요합니다.');
    const current = await this.session();
    if (current && JSON.stringify(v) !== JSON.stringify(this.settings())) throw new Error('게임 설정을 바꾸려면 아래의 실행기 종료를 먼저 눌러 주세요. 진행 중인 대화와 작업은 자동으로 취소하지 않습니다.');
    const codex = findProgram('codex', c.controller.command);
    const next = configSchema.parse({ ...c, minecraft: { ...c.minecraft, host: v.host, port: v.port, username: v.botName },
      owner: { ...c.owner, username: v.ownerName, uuid: v.ownerUuid, prefix: v.prefix }, proxy: { ...c.proxy, accountIndex: v.accountIndex },
      controller: { ...c.controller, enabled: true, ...(codex ? { command: codex } : {}) }, autonomy: { ...c.autonomy, enabled: v.autonomy }, vision: { ...c.vision, enabled: v.vision } });
    backedJson(path.join(this.root, 'config.local.json'), () => next);
    backedJson(path.join(this.root, 'runtime/setup.json'), data => ({ ...data, gameDirectory: v.gameDirectory }));
    await this.inspect(); return { saved: true, note: '게임 설정을 저장했습니다. AI 로그인과 서버 접속을 준비한 뒤 함께 시작을 눌러 주세요.' };
  }
  async prepare(progress = () => {}) {
    const c = this.config(), java = await this.javaInstaller(this.root, c.proxy.java, progress);
    await this.downloader({ url: PROXY_URL, sha256: PROXY_SHA256 }, path.join(this.root, `runtime/vendor/ViaProxy-${PROXY_VERSION}.jar`), { progress });
    backedJson(path.join(this.root, 'config.local.json'), old => ({ ...old, proxy: { ...old.proxy, java: java.command, jar: `runtime/vendor/ViaProxy-${PROXY_VERSION}.jar` } }));
    await this.inspect(); return { ready: true, note: '게임 연결에 필요한 실행 환경을 준비했습니다.' };
  }
  async installMod(directory, progress = () => {}) {
    const game = existingGameDirectory(directory), configDir = childPath(game, 'config'), mods = childPath(game, 'mods');
    if (process.platform === 'win32') {
      const running = await this.runner('powershell.exe', ['-NoProfile', '-Command', '$p = Get-CimInstance Win32_Process -Filter "Name=\'javaw.exe\' OR Name=\'java.exe\'" | Where-Object { $_.CommandLine -match "KnotClient|net\\.minecraft\\.client\\.main\\.Main|devlaunchinjector" }; if ($p) { exit 2 }'], { timeoutMs: 15000 });
      if (running.code !== 0) throw new Error('Minecraft를 종료한 뒤 설치해 주세요. 게임 프로세스를 확인하지 못한 경우에도 설치를 진행하지 않습니다.');
    }
    const java = await this.javaInstaller(this.root, this.config().proxy.java, progress);
    const version = readJson(path.join(this.root, 'package.json'), {}).version;
    const fileName = `companion-selector-26.2-${version}.jar`;
    const source = [path.join(this.root, 'mods', fileName), path.join(this.root, 'fabric-mod/build/libs', fileName)].find(fs.existsSync);
    if (!source) throw new Error('배포판의 모드 파일이 없습니다. 설치 ZIP 전체를 다시 풀어 주세요.');
    const api = await this.downloader(downloads.fabricApi, path.join(this.root, 'runtime/downloads', path.basename(downloads.fabricApi.url)), { progress });
    const profileId = `fabric-loader-${downloads.loader}-26.2`;
    const hasLauncher = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'].some(f => fs.existsSync(path.join(game, f)));
    if (!fs.existsSync(path.join(game, 'versions', profileId)) && hasLauncher) {
      for (const file of ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json']) if (fs.existsSync(path.join(game, file))) fs.copyFileSync(path.join(game, file), path.join(game, `${file}.makmolga-${Date.now()}.bak`));
      const installer = await this.downloader(downloads.fabricInstaller, path.join(this.root, 'runtime/downloads/fabric-installer.jar'), { progress });
      progress('공식 설치기로 Fabric 26.2 프로필을 준비하고 있습니다.');
      const result = await this.runner(java.command, ['-jar', installer, 'client', '-dir', game, '-mcversion', '26.2', '-loader', downloads.loader], { timeoutMs: 180000 });
      if (result.code !== 0 || !fs.existsSync(path.join(game, 'versions', profileId, profileId + '.json'))) throw new Error('Fabric 설치를 완료하지 못했습니다. 런처를 닫고 다시 설치하거나 공식 Fabric 설치기를 사용해 주세요.');
    }
    fs.mkdirSync(mods, { recursive: true }); fs.mkdirSync(configDir, { recursive: true });
    const backup = path.join(this.root, 'runtime/mod-backups', `${Date.now()}-${randomUUID().slice(0, 8)}`); fs.mkdirSync(backup, { recursive: true });
    const old = fs.readdirSync(mods).filter(f => /^(companion-selector-26\.2-.*|fabric-api-.*)\.jar$/.test(f));
    const installed = [], moved = [];
    try {
      for (const name of old) { const file = childPath(mods, name); if (!fs.statSync(file).isFile()) throw new Error('모드 파일 형식을 확인해 주세요.'); fs.copyFileSync(file, path.join(backup, name), fs.constants.COPYFILE_EXCL); fs.unlinkSync(file); moved.push(name); }
      for (const file of [source, api]) { const target = childPath(mods, path.basename(file)); fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); installed.push(target); if (sha256(file) !== sha256(target)) throw new Error('설치 후 파일 검증에 실패했습니다.'); }
      backedJson(path.join(configDir, 'companion-selector.json'), value => {
        if (value.schemaVersion != null && value.schemaVersion !== 1) throw new Error('새로운 형식의 캐릭터 설정입니다. 자동 변경하지 않습니다.');
        return { ...value, schemaVersion: 1, runtimeDirectory: this.root, worlds: value.worlds || {} };
      });
    } catch (error) {
      for (const file of installed) if (fs.existsSync(file)) fs.unlinkSync(file);
      for (const name of moved) fs.copyFileSync(path.join(backup, name), childPath(mods, name));
      throw error;
    }
    backedJson(path.join(this.root, 'runtime/setup.json'), value => ({ ...value, gameDirectory: game }));
    await this.inspect(); return { installed: true, backup, note: hasLauncher ? `설치했습니다. 런처에서 fabric-loader-26.2 설치 항목을 선택해 주세요. 버전은 ${profileId}입니다.` : '모드를 설치했습니다. 사용하시는 런처에서 Fabric 26.2 인스턴스를 선택해 주세요.' };
  }
  async checkServer() {
    const c = this.config();
    let result;
    try { result = await mc.ping({ host: c.minecraft.host, port: c.minecraft.port, version: c.minecraft.clientVersion, closeTimeout: 5000, noPongTimeout: 1500 }); }
    catch (error) { throw new Error(`서버가 응답하지 않습니다. ${c.minecraft.host}:${c.minecraft.port} 주소와 포트, LAN 공개 상태를 확인해 주세요. (${error.code || '연결 시간 초과'})`, { cause: error }); }
    const version = String(result.version?.name || '');
    if (!version.split(/[^A-Za-z0-9.]+/).includes(c.minecraft.targetVersion)) throw new Error(`서버 버전은 ${version}입니다. 이 배포판은 ${c.minecraft.targetVersion}용입니다.`);
    return { reachable: true, version, note: `Minecraft ${version} 서버가 응답했습니다. 실제 봇 로그인은 함께 시작에서 확인합니다.` };
  }
  async loginBot() {
    if (await this.session()) throw new Error('실행기를 종료한 뒤 봇 계정을 연결해 주세요.');
    const c = this.config(), jar = path.resolve(this.root, c.proxy.jar), java = await this.javaFinder(this.root, c.proxy.java);
    if (!java.available || !fs.existsSync(jar) || sha256(jar) !== PROXY_SHA256) throw new Error('실행 환경 준비를 먼저 눌러 주세요.');
    const cwd = path.join(this.root, 'runtime/viaproxy'); fs.mkdirSync(cwd, { recursive: true });
    const child = spawn(java.command, ['-jar', jar], { cwd, windowsHide: false, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); return { opened: true, note: 'ViaProxy의 Accounts에서 별도 봇 계정으로 로그인하고 창을 닫아 주세요. 계정 비밀번호는 이 화면에 입력하지 않습니다.' };
  }
  async start(progress = () => {}) {
    const settings = this.settings(); gameSettingsSchema.parse(settings);
    const c = this.config(); if (!c.controller.enabled) throw new Error('게임 설정 저장을 먼저 눌러 주세요.');
    progress('게임 서버와 AI 로그인을 확인하고 동료를 연결합니다.');
    const result = await this.runner(process.execPath, [path.join(this.root, 'scripts/start-session.mjs'), '180'], { cwd: this.root, timeoutMs: 200000,
      env: { ...process.env, COMPANION_RUNTIME: localDir(this.root), COMPANION_CONFIG: path.join(this.root, 'config.local.json') }, onOutput: text => { const lines = text.trim().split('\n'); if (lines.at(-1)?.startsWith('[MAKMOLGA]')) progress(lines.at(-1)); } });
    await this.inspect();
    if (result.code !== 0) throw new Error(`동료를 시작하지 못했습니다. ${result.stderr.trim().split('\n').at(-1) || '설정과 실행 환경을 확인해 주세요.'}`);
    const data = JSON.parse(result.stdout); if (!data.ready || this.state.session.connection !== 'connected') throw new Error('실제 동료 접속을 확인하지 못했습니다.');
    return { ready: true, note: '동료가 접속했습니다. 게임에서 H로 친구를 고르고 말을 걸어 주세요.' };
  }
  async control(action) {
    const allowed = { stop: 'minecraft_stop', resume: 'minecraft_resume', shutdown: 'companion_shutdown' };
    if (!allowed[action]) throw new Error('Unknown game control');
    if (!await this.session()) throw new Error('실행 중인 동료가 없습니다.');
    await this.invoke(allowed[action], {}, { dir: localDir(this.root) });
    if (action === 'shutdown') { for (let i = 0; i < 20 && await this.session(); i++) await delay(100); }
    await this.inspect(); return { ok: true, note: { stop: '움직임을 멈췄습니다. 다시 움직이기로 재개할 수 있습니다.', resume: '중지 상태를 해제했습니다.', shutdown: '실행기를 종료했습니다.' }[action] };
  }
}
