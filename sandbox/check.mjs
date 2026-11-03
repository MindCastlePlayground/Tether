import { Client } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const client = new Client({ name: 'sandbox-connection-check', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.env.SANDBOX_PYTHON ?? 'D:/Code/env/Python/Python312/python.exe', args: [process.env.SANDBOX_CONNECT ?? resolve('sandbox/connect.py')] });
try {
  await client.connect(transport);
  console.log('Tools: ' + (await client.listTools()).tools.map(tool => tool.name).join(', '));
  const request = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : { name: 'sandbox_status', arguments: {} };
  console.log(JSON.stringify(await client.callTool(request, undefined, { timeout: 180000 }), null, 2));
} finally { await client.close(); }
