import fs from 'node:fs';
import { call } from './client.mjs';
import { json } from './tools.mjs';
const [command = 'status', ...rest] = process.argv.slice(2);
const aliases = { status: 'minecraft_status', connect: 'minecraft_connect', disconnect: 'minecraft_disconnect', stop: 'minecraft_stop', resume: 'minecraft_resume', observe: 'minecraft_observe', inbox: 'minecraft_inbox', events: 'minecraft_events', job: 'minecraft_job', action: 'minecraft_action', say: 'minecraft_chat', shutdown: 'companion_shutdown' };
try {
  let name = aliases[command] || command; let args = {};
  if (command === 'chat') { name = 'minecraft_owner_message'; args = { text: rest.join(' '), forward: true }; }
  else if (command === 'say') args = { text: rest.join(' ') };
  else if (command === 'job') args = { id: rest[0] };
  else if (rest[0] === '--file') args = JSON.parse(fs.readFileSync(rest[1], 'utf8'));
  else if (rest[0]) args = JSON.parse(rest.join(' '));
  console.log(json(await call(name, args)));
} catch (error) { console.error(error.message); process.exitCode = 1; }
