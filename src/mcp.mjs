import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { definitions, json } from './tools.mjs';
import { call } from './client.mjs';

export function createServer() {
  const server = new McpServer({ name: 'minecraft-companion', version: '0.1.0' });
  for (const d of definitions) server.registerTool(d.name, { description: d.description, inputSchema: d.schema, annotations: { readOnlyHint: d.readOnly ?? false, destructiveHint: !d.readOnly, openWorldHint: true } }, async args => {
    try { return { content: [{ type: 'text', text: json(await call(d.name, args)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  return server;
}
const handle = serveStdio(createServer);
process.on('SIGINT', () => { void handle.close(); });
process.on('SIGTERM', () => { void handle.close(); });
