import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { McpText } from '../dist/i18n.js';

class Smoke {
  static async run() {
    for (const language of ['en', 'zh-CN']) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve('dist/mcp.js')],
        env: { BB_CLIENT_CONFIG: resolve('.local/agent.json'), BB_LANGUAGE: language },
        stderr: 'pipe'
      });
      const client = new Client({ name: 'tether-i18n-verifier', version: '0.1.0' });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.equal(tools.length, 12);
        for (const tool of tools) assert.equal(tool.description, McpText.TOOLS[language][tool.name]);
        console.log(`${language}: 12 MCP tool descriptions passed; no bridge calls`);
      } finally { await client.close(); }
    }
  }
}

Smoke.run().catch(() => { console.error('MCP i18n verification failed'); process.exitCode = 1; });
