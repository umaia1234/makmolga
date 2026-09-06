import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.mjs';
const files = [];
for (const dir of ['src', 'scripts', 'test', 'skills/makmolga-start/scripts']) if (fs.existsSync(path.join(ROOT, dir))) for (const file of fs.readdirSync(path.join(ROOT, dir))) if (file.endsWith('.mjs')) files.push(path.join(ROOT, dir, file));
for (const file of files) { const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true }); if (r.status !== 0) { console.error(r.stderr); process.exit(1); } }
console.log(`Syntax checked: ${files.length} modules.`);
