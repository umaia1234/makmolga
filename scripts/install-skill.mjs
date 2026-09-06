import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { atomicJson } from '../src/store.mjs';

const skillName = 'makmolga-start';
const skillsRoot = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills');
const destination = path.join(skillsRoot, skillName);
const registration = path.join(destination, 'project.local.json');
if (fs.existsSync(destination)) {
  if (!fs.existsSync(registration) || JSON.parse(fs.readFileSync(registration, 'utf8')).managedBy !== 'makmolga') throw new Error(`Skill folder is not managed by this installer: ${destination}`);
}
for (const relative of ['SKILL.md', 'agents/openai.yaml', 'scripts/start.mjs']) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'skills', skillName, relative), target);
}
atomicJson(registration, { managedBy: 'makmolga', projectRoot: ROOT, installedAt: new Date().toISOString() });
console.log(JSON.stringify({ installed: true, skill: skillName, path: destination, projectRoot: ROOT }, null, 2));
