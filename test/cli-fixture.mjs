// A real child-process fixture: exercises stdout framing, MCP HTTP and exit
// behavior without network model calls, accounts or the player's game.
import { randomUUID } from 'node:crypto';
const provider = process.argv.includes('--agent') ? 'antigravity' : 'claude';
let raw = ''; for await (const bytes of process.stdin) raw += bytes;
const input = JSON.parse(raw), text = JSON.stringify(input);
const id = process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : process.argv.includes('--session-id') ? process.argv[process.argv.indexOf('--session-id') + 1] : randomUUID();
const emit = e => process.stdout.write(JSON.stringify(e) + '\n');
const bad = text.includes('fixture-host-tools');
emit(provider === 'claude' ? { type: 'system', subtype: 'init', session_id: id, tools: bad ? ['Bash'] : ['mcp__makmolga__minecraft_status'], model: 'fixture-model' }
  : { event: 'init', conversation_id: id, init: { tools: bad ? ['run_command'] : ['mcp_makmolga_minecraft_status'], model: 'fixture-model' } });
if (text.includes('fixture-hold') || bad) await new Promise(resolve => setTimeout(resolve, 30000));
const response = await fetch(process.env.MAKMOLGA_TURN_URL, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MAKMOLGA_TURN_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'minecraft_status', arguments: {} }) });
const body = await response.json();
if (text.includes('fixture-crash-after-tool')) process.exit(3);
const answer = body.content?.[0]?.text || body.error;
emit(provider === 'claude' ? { type: 'result', subtype: 'success', is_error: false, session_id: id, result: answer }
  : { event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: answer } });
