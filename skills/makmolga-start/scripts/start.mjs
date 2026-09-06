import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

try {
  const registrationFile = fileURLToPath(new URL('../project.local.json', import.meta.url));
  if (!fs.existsSync(registrationFile)) throw new Error('Run node scripts/install-skill.mjs from your MAKMOLGA project first.');
  const registration = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
  if (registration.managedBy !== 'makmolga' || !path.isAbsolute(registration.projectRoot)) throw new Error('Invalid local MAKMOLGA registration. Reinstall the skill.');
  const root = registration.projectRoot;
  const entry = path.join(root, 'scripts/start-session.mjs');
  if (!fs.existsSync(entry)) throw new Error('The registered MAKMOLGA project moved. Run its scripts/install-skill.mjs again.');
  const child = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, COMPANION_RUNTIME: path.join(root, 'runtime'), COMPANION_CONFIG: path.join(root, 'config.local.json') } });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
