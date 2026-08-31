#!/usr/bin/env node
/** Inert Windows-MCP substitute: stdio stays real, desktop effects become a call ledger. */

import { appendFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'windows-mcp-fixture', version: '1.0.0' })
for (const name of ['Snapshot', 'PowerShell']) {
  server.registerTool(name, {
    description: `Record one inert ${name} call for the Windows permission scenario.`,
    inputSchema: {},
  }, async () => {
    await appendFile('desktop-calls.txt', `${name}\n`)
    return { content: [{ type: 'text', text: `${name} executed` }] }
  })
}
await server.connect(new StdioServerTransport())
