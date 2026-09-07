// Child of an official provider CLI. Its credential only authorizes the current
// model turn, never daemon lifecycle or a future turn.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { definitions, json } from './tools.mjs';
import { isLoopback } from './config.mjs';

const endpoint = new URL(process.env.MAKMOLGA_TURN_URL);
const token = process.env.MAKMOLGA_TURN_TOKEN;
if (endpoint.protocol !== 'http:' || !isLoopback(endpoint.hostname) || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Missing local turn authorization');
const handle = serveStdio(() => {
  const server = new McpServer({ name: 'makmolga', version: '0.4.0' });
  for (const d of definitions) server.registerTool(d.name, { description: d.description, inputSchema: d.schema,
    annotations: { readOnlyHint: d.readOnly ?? false, destructiveHint: !d.readOnly, openWorldHint: true } }, async args => {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: json({ name: d.name, arguments: args }), signal: AbortSignal.timeout(40000), redirect: 'error' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Turn no longer active');
      return result;
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  return server;
});
process.on('SIGTERM', () => void handle.close());
process.on('SIGINT', () => void handle.close());
