import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.mjs';
import { downloadVerified, downloads } from '../src/downloads.mjs';
import { verifyDirectory, verifyArchive } from './verify-release.mjs';

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))).version;
const artifact = `MAKMOLGA-26.2-v${version}-windows-x64`;
const stage = path.join(ROOT, 'dist', `candidate-${randomUUID().slice(0, 8)}`, artifact);
fs.mkdirSync(stage, { recursive: true });
const copy = name => { const source = path.join(ROOT, name), target = path.join(stage, name); if (!fs.existsSync(source)) throw new Error('Missing release source: ' + name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(source, target, { recursive: true, dereference: false }); };
for (const name of ['package.json', 'package-lock.json', 'README.md', 'START-HERE.md', 'NOTICE.md', 'Start-Makmolga.cmd', 'Start-Makmolga.ps1', 'Start-Companion.ps1', 'Stop-Companion.ps1', 'Connect-Companions.ps1', 'src', 'ui', 'resources']) copy(name);
for (const name of ['bootstrap.ps1', 'start-session.mjs', 'connections.mjs', 'setup.mjs', 'codex-server.mjs', 'doctor.mjs', 'verify-release.mjs', 'install-skill.mjs', 'probe-provider.mjs']) copy('scripts/' + name);
copy('skills/minecraft-companion'); copy('skills/makmolga-start');
for (const name of ['CONNECTIONS.md', 'PRIVACY.md', 'RELEASE.md', 'RELEASE-v040-alpha1.md']) copy('docs/' + name);
copy('docs/images/setup-center-v040.jpg');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'character-pack/characters.json')));
fs.mkdirSync(path.join(stage, 'character-pack'), { recursive: true });
fs.writeFileSync(path.join(stage, 'character-pack/characters.json'), JSON.stringify(catalog, null, 2) + '\n');
for (const name of ['README.md', 'SOURCE-README.md', 'SOURCE-manifest.json']) copy('character-pack/' + name);
const assetRoot = 'fabric-mod/src/main/resources/assets/companion';
fs.mkdirSync(path.join(stage, assetRoot), { recursive: true }); fs.writeFileSync(path.join(stage, assetRoot, 'characters.json'), JSON.stringify(catalog, null, 2) + '\n');
for (const c of catalog.characters) { copy(`character-pack/personas/${c.id}.md`); copy('character-pack/' + c.skin); copy(`${assetRoot}/textures/skins/${c.id}.png`); }
fs.mkdirSync(path.join(stage, 'mods'));
fs.copyFileSync(path.join(ROOT, 'fabric-mod/build/libs', `companion-selector-26.2-${version}.jar`), path.join(stage, 'mods', `companion-selector-26.2-${version}.jar`));
await downloadVerified(downloads.fabricApi, path.join(stage, 'mods', path.basename(downloads.fabricApi.url)));
const files = {};
function index(dir, prefix = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isSymbolicLink()) throw new Error('Symlink in release: ' + prefix + e.name);
    if (e.isDirectory()) index(path.join(dir, e.name), prefix + e.name + '/');
    else files[prefix + e.name] = createHash('sha256').update(fs.readFileSync(path.join(dir, e.name))).digest('hex');
  }
}
index(stage);
fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ schema: 1, version, edition: 'standard', minecraft: '26.2', platform: 'windows-x64', builtAt: new Date().toISOString(), files }, null, 2) + '\n');
verifyDirectory(stage);
const zip = path.join(ROOT, 'dist', artifact + '.zip');
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -LiteralPath $env:MAKMOLGA_STAGE -DestinationPath $env:MAKMOLGA_ZIP -CompressionLevel Optimal -Force'], { windowsHide: true, encoding: 'utf8', timeout: 120000, env: { ...process.env, MAKMOLGA_STAGE: stage, MAKMOLGA_ZIP: zip } });
if (r.status !== 0) throw new Error('Packaging failed: ' + r.stderr);
const verification = verifyArchive(zip);
const jar = path.join(ROOT, 'dist', `companion-selector-26.2-${version}.jar`); fs.copyFileSync(path.join(stage, 'mods', path.basename(jar)), jar);
const sums = [zip, jar].map(file => `${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n') + '\n';
fs.writeFileSync(path.join(ROOT, 'dist', `SHA256SUMS-v${version}.txt`), sums);
fs.mkdirSync(path.join(ROOT, 'runtime'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'runtime/release-candidate.json'), JSON.stringify({ version, stage, zip, jar, verification }, null, 2) + '\n');
console.log(JSON.stringify({ stage, zip, jar, verification }, null, 2));
