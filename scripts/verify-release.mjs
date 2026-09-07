import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const forbidden = /(^|\/)(?:\.git|\.codex|\.agents|memory|runtime|work|node_modules|config\.local\.json|project\.local\.json|\.mcp\.json|api-token|\.env(?:\..*)?)(\/|$)|\.bak$|\.log$/;
const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]);
export function inspectJar(file) {
  const code = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($env:MAKMOLGA_JAR)
try {
  $m = [IO.StreamReader]::new($z.GetEntry('fabric.mod.json').Open()); try { $mod = $m.ReadToEnd() | ConvertFrom-Json } finally { $m.Dispose() }
  $c = [IO.StreamReader]::new($z.GetEntry('assets/companion/characters.json').Open()); try { $catalog = $c.ReadToEnd() | ConvertFrom-Json } finally { $c.Dispose() }
  @{mod=$mod;catalog=$catalog;entries=@($z.Entries | ForEach-Object FullName)} | ConvertTo-Json -Depth 15 -Compress
} finally { $z.Dispose() }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { env: { ...process.env, MAKMOLGA_JAR: path.resolve(file) }, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Cannot inspect the Fabric JAR: ' + result.stderr.slice(0, 1800));
  return JSON.parse(result.stdout);
}
export function verifyDirectory(directory, { installed = false } = {}) {
  directory = fs.realpathSync(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release.json')));
  if (manifest.schema !== 1 || manifest.edition !== 'originals') throw new Error('Unknown release manifest');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (forbidden.test(name) || name.includes('\\') || name.split('/').includes('..') || path.isAbsolute(name)) throw new Error('Forbidden package path: ' + name);
    const file = path.join(directory, name);
    if (!fs.existsSync(file) || digest(file) !== hash) throw new Error('Missing or changed release file: ' + name);
  }
  if (!installed) for (const name of walk(directory)) if (name !== 'release.json' && !Object.hasOwn(manifest.files, name)) throw new Error('Unexpected package file: ' + name);
  for (const name of ['Start-Makmolga.cmd', 'scripts/bootstrap.ps1', 'src/main.mjs', 'src/game-setup.mjs', 'ui/connections/index.html', 'ui/connections/setup.css', 'package-lock.json', 'resources/downloads.json', 'START-HERE.md', 'NOTICE.md']) if (!manifest.files[name]) throw new Error('Required file missing: ' + name);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))), lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')));
  if (pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages[''].version !== manifest.version) throw new Error('Package version mismatch');
  const jar = inspectJar(path.join(directory, 'mods', `companion-selector-26.2-${manifest.version}.jar`));
  const expected = ['clchan', 'fablechan'];
  const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'character-pack/characters.json')));
  if (jar.mod.version !== manifest.version || JSON.stringify(jar.catalog.characters.map(c => c.id).sort()) !== JSON.stringify(expected) || JSON.stringify(catalog.characters.map(c => c.id).sort()) !== JSON.stringify(expected)) throw new Error('JAR/catalog/version mismatch');
  if (jar.entries.some(e => /textures\/skins\/(yanro|gpchan|doro|gemchan|spiki)\.png$/.test(e))) throw new Error('Non-release character art in JAR');
  for (const c of catalog.characters) {
    for (const file of [path.join(directory, 'character-pack', c.skin), path.join(directory, 'fabric-mod/src/main/resources/assets/companion/textures/skins', c.id + '.png')]) if (digest(file) !== c.sha256) throw new Error('Skin/catalog checksum mismatch');
    if (!fs.existsSync(path.join(directory, 'character-pack/personas', c.id + '.md'))) throw new Error('Persona missing');
  }
  return { ok: true, version: manifest.version, edition: manifest.edition, files: Object.keys(manifest.files).length, characters: expected, sha256Verified: true };
}
export function verifyArchive(archive) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'makmolga-verify-'));
  try {
    const code = 'Expand-Archive -LiteralPath $env:MAKMOLGA_ARCHIVE -DestinationPath $env:MAKMOLGA_EXTRACT';
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', code], { env: { ...process.env, MAKMOLGA_ARCHIVE: path.resolve(archive), MAKMOLGA_EXTRACT: temp }, windowsHide: true, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) throw new Error('Cannot extract release: ' + r.stderr);
    const roots = fs.readdirSync(temp); if (roots.length !== 1 || !fs.statSync(path.join(temp, roots[0])).isDirectory()) throw new Error('Expected one release folder');
    return { ...verifyDirectory(path.join(temp, roots[0])), archiveSha256: digest(archive) };
  } finally { if (!path.basename(temp).startsWith('makmolga-verify-') || path.dirname(temp) !== os.tmpdir()) throw new Error('Invalid temporary directory'); fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const target = process.argv[2]; if (!target) throw new Error('Pass a release ZIP or folder.'); console.log(JSON.stringify(target.endsWith('.zip') ? verifyArchive(target) : verifyDirectory(target, { installed: process.argv.includes('--installed') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
