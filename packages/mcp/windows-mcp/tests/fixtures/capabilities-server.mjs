#!/usr/bin/env node
/** External desktop fixture for regional capture and tool-correlated model sampling. */

import { appendFile } from 'node:fs/promises'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'windows-mcp-capabilities-fixture', version: '1' }, { capabilities: { tools: {} } })
const region = { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 }
const definitions = [
  { name: 'Snapshot', properties: { region } },
  { name: 'Screenshot', properties: { region } },
  { name: 'Scrape', properties: { url: { type: 'string' }, query: { type: 'string' } }, required: ['url'] },
]
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: definitions.map(({ name, properties, required }) => ({
    name, description: `Exercise the inert ${name} desktop capability.`,
    inputSchema: { type: 'object', properties, ...required === undefined ? {} : { required } },
  })),
}))
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args, _meta } = request.params
  await appendFile('desktop-calls.txt', `${name} ${JSON.stringify(args)}\n`)
  switch (name) {
    case 'Snapshot': return { content: [{ type: 'text', text: `Snapshot region: ${JSON.stringify(args.region)}` }] }
    case 'Screenshot': return { content: [
      { type: 'text', text: `Screenshot region: ${JSON.stringify(args.region)}` },
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' },
    ] }
    case 'Scrape': {
      const result = await server.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: `Raw scraped content from ${args.url}:\n\nMenu | The ticket costs 42 yuan. | Footer` } }],
        systemPrompt: `Extract meaningful webpage content. Focus specifically on: ${args.query}.`,
        maxTokens: 2048, metadata: _meta,
      })
      return { content: [{ type: 'text', text: `URL: ${args.url}\nContent:\n${result.content.text}` }] }
    }
    default: throw new Error(`Unexpected desktop tool: ${name}`)
  }
})
await server.connect(new StdioServerTransport())
