import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const get = async (url, json = false) => { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${r.status}: ${url}`); return json ? r.json() : r.text(); };
const [nodes, installers, javas] = await Promise.all([
  get('https://nodejs.org/dist/index.json', true), get('https://meta.fabricmc.net/v2/versions/installer', true),
  get('https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse', true)
]);
const node = nodes.find(n => n.version.startsWith('v24.') && n.lts), installer = installers.find(i => i.stable);
const nodeFile = `node-${node.version}-win-x64.zip`, nodeUrl = `https://nodejs.org/dist/${node.version}`;
const fabricApi = 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.159.0+26.2/fabric-api-0.159.0+26.2.jar';
const [nodeSums, installerSum, fabricSum] = await Promise.all([get(`${nodeUrl}/SHASUMS256.txt`), get(installer.url + '.sha256'), get(fabricApi + '.sha256')]);
const manifest = {
  schema: 1, checkedAt: new Date().toISOString(), minecraft: '26.2', loader: '0.19.5', codex: '0.153.4',
  node: { version: node.version, url: `${nodeUrl}/${nodeFile}`, sha256: nodeSums.split('\n').find(l => l.endsWith('  ' + nodeFile)).split(/\s/)[0], directory: nodeFile.slice(0, -4) },
  java: { version: javas[0].version.semver, url: javas[0].binary.package.link, sha256: javas[0].binary.package.checksum },
  fabricInstaller: { version: installer.version, url: installer.url, sha256: installerSum.trim().split(/\s/)[0] },
  fabricApi: { version: '0.159.0+26.2', url: fabricApi, sha256: fabricSum.trim().split(/\s/)[0] }
};
for (const item of [manifest.node, manifest.java, manifest.fabricInstaller, manifest.fabricApi]) if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid upstream SHA-256');
fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
fs.writeFileSync(path.join(root, 'resources/downloads.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
