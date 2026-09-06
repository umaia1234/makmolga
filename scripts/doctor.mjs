import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import mineflayer from 'mineflayer';
import data from 'minecraft-data';
import { ROOT, loadConfig } from '../src/config.mjs';
import { PROXY_SHA256 } from '../src/proxy.mjs';
import { createHash } from 'node:crypto';
import { atomicJson } from '../src/store.mjs';
const require = createRequire(import.meta.url);
const config = loadConfig(); const jar = path.resolve(ROOT, config.proxy.jar);
const java = spawnSync(config.proxy.java, ['-version'], { windowsHide: true, encoding: 'utf8' });
const result = { checkedAt: new Date().toISOString(), node: process.version, target: config.minecraft.targetVersion, client: config.minecraft.clientVersion, mineflayer: require('mineflayer/package.json').version, officialMineflayerLatest: mineflayer.latestSupportedVersion,
  clientDataAvailable: !!data(config.minecraft.clientVersion), targetDataAvailable: !!data(config.minecraft.targetVersion), proxyRequired: config.minecraft.clientVersion !== config.minecraft.targetVersion,
  proxyDownloadedAndVerified: fs.existsSync(jar) && createHash('sha256').update(fs.readFileSync(jar)).digest('hex') === PROXY_SHA256,
  javaAvailable: java.status === 0, javaVersion: (java.stderr || '').split('\n')[0], ownerConfigured: !!config.owner.uuid, autoConnect: config.minecraft.autoConnect, controllerEnabled: config.controller.enabled,
  liveServerTested: false, note: 'This diagnostic checks installed software. It does not assert gameplay compatibility or log in to a server.' };
if (process.argv.includes('--online')) {
  const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Mojang manifest HTTP ${response.status}`);
  result.mojangLatest = (await response.json()).latest;
  result.targetIsLatestRelease = result.mojangLatest.release === config.minecraft.targetVersion;
}
atomicJson(path.join(ROOT, 'docs', 'compatibility-check.json'), result); console.log(JSON.stringify(result, null, 2));
if (!result.clientDataAvailable || (config.proxy.enabled && (!result.proxyDownloadedAndVerified || !result.javaAvailable))) process.exitCode = 1;
