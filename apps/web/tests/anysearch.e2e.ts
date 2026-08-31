/** Bundled AnySearch providers and tools over the shipped Web Loader composition. */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-web'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const KEY_REF = credentialRef('DSH_ANYSEARCH_BUNDLED_TEST_KEY')
const SOURCE_URL = 'https://docs.example.test/anysearch'
const SOURCE = { title: 'AnySearch fixture', url: SOURCE_URL, snippet: 'Search integration', content: 'Page content' }

interface CapturedRequest {
  path: string
  authorization: string | undefined
  body: { query?: string; url?: string; tag?: string; params?: Record<string, unknown> }
}

function textContent(result: ToolResult): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

describe('bundled AnySearch', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
  let server: Server
  let callIndex = 0
  const requests: CapturedRequest[] = []

  function execute(name: string, args: unknown): Promise<ToolResult> {
    return scaffold.ctx.tools.execute({
      name,
      arguments: args,
      callId: ToolCallId(`anysearch-${++callIndex}`),
      agent: handle.agent,
      signal: new AbortController().signal,
    })
  }

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { raw += chunk })
      request.on('end', () => {
        const body = (raw === '' ? {} : JSON.parse(raw)) as CapturedRequest['body']
        const path = request.url ?? ''
        requests.push({ path, authorization: request.headers.authorization, body })
        if (body.query === 'redirect') {
          response.writeHead(302, { location: '/redirect-target' })
          response.end()
          return
        }
        const status = body.query === 'invalid-key' ? 401
          : body.query === 'quota' ? 402
            : body.query === 'limited' ? 429 : 200
        response.writeHead(status, { 'content-type': 'application/json', 'retry-after': '2' })
        if (status !== 200) {
          response.end(JSON.stringify({ code: status, message: 'Fixture service limit', request_id: 'fixture-limit' }))
          return
        }
        let data: unknown
        if (path === '/v1/search') {
          data = { results: [SOURCE], metadata: { total_results: 1, search_time_ms: 5 } }
        } else if (path === '/v1/extract') {
          data = { url: body.url, title: SOURCE.title, content: SOURCE.content }
        } else if (path === '/v1/domains') {
          data = { domains: [{ domain: 'academic', description: 'Papers', sub_domain_count: 1 }] }
        } else if (path === '/v1/sub-domains?domain=academic') {
          data = { domains: [{
            domain: 'academic',
            description: 'Papers',
            sub_domains: [{ sub_domain: 'academic/arxiv', description: 'Preprints', params: {} }],
          }] }
        } else {
          response.end(JSON.stringify({ code: 1, message: 'Unexpected fixture route' }))
          return
        }
        response.end(JSON.stringify({ code: 0, message: 'ok', request_id: 'fixture-search', data }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address() as AddressInfo
    scaffold = await launchWebScaffold({
      anySearch: { baseURL: `http://127.0.0.1:${address.port}`, apiKeyEnv: KEY_REF },
    })
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('bundled-anysearch'),
      meta: { cwd: scaffold.workspaceCwd },
      setup: ctx => scaffold.ctx.agentPresets.mount(ctx).then(() => undefined),
    })
  })

  beforeEach(async () => {
    requests.length = 0
    await scaffold.ctx.credentials.unset(KEY_REF)
  })

  afterAll(async () => {
    try {
      await handle?.dispose()
      await scaffold?.close()
    } finally {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
          })
        })
      }
    }
  })

  it('uses anonymous search and extraction while presets own the standard tools', async () => {
    expect(scaffold.ctx.tools.get('web_fetch')).toBeUndefined()
    expect(scaffold.ctx.tools.get('web_search')).toBeUndefined()
    const search = await execute('web_search', { queries: ['anonymous'] })
    expect(search.isError, textContent(search)).toBe(false)
    expect(search.meta).toMatchObject({ sources: [{ url: SOURCE_URL, title: SOURCE.title }] })
    const fetched = await execute('web_fetch', { url: SOURCE_URL })
    expect(fetched.isError, textContent(fetched)).toBe(false)
    expect(textContent(fetched)).toContain(SOURCE.content)
    expect(fetched.meta).toMatchObject({ url: SOURCE_URL, statusCode: 200, truncated: false })
    expect(requests.map(request => request.path)).toEqual(['/v1/search', '/v1/extract'])
    expect(requests.every(request => request.authorization === undefined)).toBe(true)
    expect(await scaffold.ctx.credentials.resolve(KEY_REF)).toBeUndefined()
  })

  it('discovers verticals and renders advanced results through current tool APIs', async () => {
    const catalog = await execute('anysearch_capabilities', {})
    expect(catalog.isError, textContent(catalog)).toBe(false)
    expect(textContent(catalog)).toContain('academic')
    const verticals = await execute('anysearch_capabilities', { domains: ['academic'] })
    expect(verticals.isError, textContent(verticals)).toBe(false)
    expect(textContent(verticals)).toContain('academic/arxiv')
    const result = await execute('anysearch_search', {
      query: 'preprint', tag: 'academic/arxiv', params: {}, includeContent: true,
    })
    expect(result.isError, textContent(result)).toBe(false)
    expect(textContent(result)).toContain(SOURCE.content)
    expect(result.meta).toMatchObject({ sources: [{ url: SOURCE_URL }], truncated: false })
    expect(requests.at(-1)?.body).toMatchObject({ query: 'preprint', tag: 'academic/arxiv', params: {} })
  })

  it('re-reads optional credentials and never retries a rejected key anonymously', async () => {
    await scaffold.ctx.credentials.set(KEY_REF, 'fixture-key-one')
    expect((await execute('anysearch_search', { query: 'credential-one' })).isError).toBe(false)
    await scaffold.ctx.credentials.set(KEY_REF, 'fixture-key-two')
    expect((await execute('web_fetch', { url: SOURCE_URL })).isError).toBe(false)
    const rejected = await execute('anysearch_search', { query: 'invalid-key' })
    expect(rejected.isError).toBe(true)
    expect(textContent(rejected)).toContain('401')
    expect(textContent(rejected)).not.toContain('fixture-key-two')
    expect(requests.map(request => request.authorization)).toEqual([
      'Bearer fixture-key-one', 'Bearer fixture-key-two', 'Bearer fixture-key-two',
    ])
  })

  it('keeps batch successes alongside quota and rate-limit failures', async () => {
    const result = await execute('anysearch_batch_search', {
      items: [{ query: 'success' }, { query: 'quota' }, { query: 'limited' }],
    })
    expect(result.isError, textContent(result)).toBe(false)
    expect(textContent(result)).toContain('1 succeeded, 2 failed')
    expect(textContent(result)).toContain(SOURCE_URL)
    expect(textContent(result)).toContain('402')
    expect(textContent(result)).toContain('429')
    expect(requests).toHaveLength(3)
  })

  it('does not follow credential-bearing redirects', async () => {
    await scaffold.ctx.credentials.set(KEY_REF, 'fixture-key-redirect')
    const result = await execute('anysearch_search', { query: 'redirect' })
    expect(result.isError).toBe(true)
    expect(requests.map(request => request.path)).toEqual(['/v1/search'])
    expect(textContent(result)).not.toContain('fixture-key-redirect')
  })
})
