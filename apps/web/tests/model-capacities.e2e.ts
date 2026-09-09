/** Saved model budgets through the shipped Web settings, adapters, and HTTP serializers. */

import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  PROVIDER_SUPPLIERS, joinRequestURL,
  type ProviderAccessPreset,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/provider-presets.ts'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const PLANS = PROVIDER_SUPPLIERS.flatMap(supplier => supplier.access)
const BUDGETS = [
  [32_000, 8_000], [64_000, 16_000], [128_000, 32_000],
  [256_000, 64_000], [512_000, 8_000], [1_000_000, 64_000],
] as const
const INPUT = createUserMessage({
  content: [{ type: 'text', text: 'Reply with OK.' }],
  source: { kind: 'plugin', plugin: 'capacity-test' },
})
const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/model-capacities', import.meta.url))

async function saveProfile(scaffold: WebScaffold, plan: ProviderAccessPreset, profile: object): Promise<void> {
  await scaffold.ctx.settings.update(settingsNamespace(plan.settingsNs),
    plan.settingsNs === 'llm-deepseek' ? profile : { providers: { [plan.provider]: profile } })
}

async function callModel(scaffold: WebScaffold, provider: string, model: string, effort = 'off') {
  const info = await scaffold.ctx.llm.resolveModelInfo(provider, model)
  const prepared = await scaffold.ctx.llm.prepareCall({
    provider, model,
    ...info.reasoning?.efforts.some(option => option.id === effort)
      ? { reasoningEffort: ReasoningEffortId(effort) } : {},
  })
  const chunks = []
  for await (const chunk of prepared.stream({
    ...prepared.config, messages: [INPUT], signal: AbortSignal.timeout(25_000),
  })) chunks.push(chunk)
  return { prepared, chunks }
}

/** Minimal successful streams; only the upstream reply is substituted. */
function replyEvents(path: string, model: string): object[] {
  if (path.endsWith('/messages')) return [
    { type: 'message_start', message: { id: 'capacity', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 4, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  if (path.endsWith('/responses')) return [
    { type: 'response.created', response: { id: 'capacity', model, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { id: 'msg', type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: 'msg', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: 'msg', output_index: 0, content_index: 0, delta: 'OK' },
    { type: 'response.output_item.done', output_index: 0, item: { id: 'msg', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] } },
    { type: 'response.completed', response: { id: 'capacity', model, status: 'completed', output: [], usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ]
  return [
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 1 } },
  ]
}

describe('preset model capacity settings over real HTTP serializers', () => {
  let scaffold: WebScaffold
  let server: Server
  let upstream: string
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    await scaffold.ctx.credentials.set(credentialRef('CAPACITY_TEST_KEY'), 'capacity-test-key')
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      request.on('end', () => {
        const data = JSON.parse(body) as Record<string, unknown>
        const path = request.url ?? ''
        requests.push({ path, body: data })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const event of replyEvents(path, String(data['model']))) {
          if ('type' in event) response.write(`event: ${String(event.type)}\n`)
          response.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        if (!path.endsWith('/messages') && !path.endsWith('/responses')) response.write('data: [DONE]\n\n')
        response.end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('HTTP fixture has no port')
    upstream = `http://127.0.0.1:${address.port}`
    const fetch = globalThis.fetch
    const origins = new Set(PLANS.flatMap(plan => plan.protocols.map(protocol => new URL(protocol.baseURL).origin)))
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      return origins.has(url.origin)
        ? fetch(new Request(`${upstream}${url.pathname}${url.search}`, request))
        : fetch(input, init)
    })
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await scaffold?.close()
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    }
  })

  it.each(PLANS.flatMap(plan => plan.protocols.map(protocol => ({ plan, protocol }))))(
    '$plan.provider / $protocol.api applies all context and output choices after saving',
    async ({ plan, protocol }) => {
      const profile = { ...plan.initialProfile, apiKeyEnv: 'CAPACITY_TEST_KEY', baseURL: protocol.baseURL,
        ...plan.settingsNs === 'llm-pi-ai' ? { api: protocol.api } : {} }
      await saveProfile(scaffold, plan, profile)
      const model = (await scaffold.ctx.llm.listModels(plan.provider))[0]
      if (model === undefined) throw new Error(`Preset ${plan.provider} has no models`)
      for (const [contextWindow, maxTokens] of BUDGETS) {
        await saveProfile(scaffold, plan, { ...profile, models: [{ id: model.id, contextWindow, maxTokens }] })
        const { prepared, chunks } = await callModel(scaffold, plan.provider, model.id)
        expect(prepared.context?.contextWindow).toBe(contextWindow)
        expect(prepared.config.maxTokens).toBe(maxTokens)
        expect(chunks.at(-1), JSON.stringify(chunks.at(-1))).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
        const sent = requests.at(-1)!
        expect(sent.path).toBe(new URL(joinRequestURL(protocol.baseURL, protocol.requestPath)).pathname)
        expect(sent.body['max_tokens'] ?? sent.body['max_completion_tokens'] ?? sent.body['max_output_tokens']).toBe(maxTokens)
        expect(sent.body).not.toHaveProperty('contextWindow')
      }
    },
  )

  it('keeps all three OpenCode Go protocols automatic when model budgets change', async () => {
    const models = [
      { id: 'glm-5.2', path: '/zen/go/v1/chat/completions' },
      { id: 'minimax-m3', path: '/zen/go/v1/messages' },
      { id: 'gpt-5.6-luna', path: '/zen/go/v1/responses' },
    ]
    await scaffold.ctx.settings.mutate(settingsNamespace('llm-pi-ai'), [
      { op: 'unset', path: ['providers', 'opencode-go', 'api'] },
      { op: 'unset', path: ['providers', 'opencode-go', 'baseURL'] },
      { op: 'set', path: ['providers', 'opencode-go', 'models'], value: models.map(model => ({ id: model.id, contextWindow: 256_000, maxTokens: 32_000 })) },
    ])
    for (const model of models) {
      const { prepared, chunks } = await callModel(scaffold, 'opencode-go', model.id)
      expect(prepared.context?.contextWindow).toBe(256_000)
      expect(prepared.config.maxTokens).toBe(32_000)
      expect(chunks.at(-1), JSON.stringify(chunks.at(-1))).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      const sent = requests.at(-1)!
      expect(sent.path).toBe(model.path)
      expect(sent.body['max_tokens'] ?? sent.body['max_completion_tokens'] ?? sent.body['max_output_tokens']).toBe(32_000)
    }
  })

  it('fits the output ceiling inside remaining context on catalog-backed models', async () => {
    await scaffold.ctx.settings.mutate(settingsNamespace('llm-pi-ai'), [{
      op: 'set', path: ['providers', 'zhipu-cn', 'models'],
      value: [{ id: 'glm-5.2', contextWindow: 32_000, maxTokens: 64_000 }],
    }])
    const { prepared, chunks } = await callModel(scaffold, 'zhipu-cn', 'glm-5.2')
    expect(prepared.config.maxTokens).toBe(64_000)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    const sent = requests.at(-1)!.body['max_tokens']
    expect(sent).toBeGreaterThan(0)
    expect(sent).toBeLessThan(32_000)
  })

  it('saves and reopens the capacity choices through the browser', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ locale: ZH_BROWSER_LOCALE, viewport: { width: 1440, height: 1000 } })
      await page.goto(scaffold.authenticatedUrl)
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.getByRole('button', { name: '模型', exact: true }).click()
      await dialog.getByRole('tab', { name: '服务接入', exact: true }).click()
      await dialog.getByRole('button', { name: /编辑 .*zhipu-cn/u }).click()
      await dialog.getByRole('button', { name: '容量 1', exact: true }).click()
      const context = dialog.getByRole('combobox', { name: '上下文窗口 1', exact: true })
      const output = dialog.getByRole('combobox', { name: '最大输出 token 1', exact: true })
      await context.selectOption('256000')
      await output.selectOption('32000')
      if (webSnapshotMode() !== 'replay') await mkdir(SNAPSHOT_DIR, { recursive: true })
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'capacity-selects.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await dialog.getByRole('button', { name: /编辑 .*zhipu-cn/u }).waitFor()
      await expect.poll(async () => (await scaffold.ctx.llm.resolveModelInfo('zhipu-cn', 'glm-5.2')).context?.contextWindow).toBe(256_000)
      const { prepared } = await callModel(scaffold, 'zhipu-cn', 'glm-5.2')
      expect(prepared.config.maxTokens).toBe(32_000)
      await dialog.getByRole('button', { name: /编辑 .*zhipu-cn/u }).click()
      await dialog.getByRole('button', { name: '容量 1', exact: true }).click()
      expect(await context.inputValue()).toBe('256000')
      expect(await output.inputValue()).toBe('32000')
      await assertFixtureInventory(SNAPSHOT_DIR, ['capacity-selects.expected.md'])
      await output.scrollIntoViewIfNeeded()
      if (webSnapshotMode() !== 'replay') {
        await dialog.locator('div[class*="modelAdvanced"]').screenshot({
          path: fileURLToPath(new URL('../../../.artifacts/model-capacity-selects.png', import.meta.url)),
        })
      }
    } finally {
      await browser.close()
    }
  }, 60_000)
})

const liveHome = process.env['DSH_MODEL_CAPACITY_TEST_HOME']
const liveSettings = liveHome === undefined ? {} : load(await readFile(join(liveHome, 'settings.yaml'), 'utf8')) as Record<string, Record<string, unknown>>
const liveRefs = liveHome === undefined ? {} : (load(await readFile(join(liveHome, '.credentials.yaml'), 'utf8')) as { refs: Record<string, string> }).refs

function liveProfile(plan: ProviderAccessPreset): Record<string, unknown> {
  const section = liveSettings[plan.settingsNs]
  if (plan.settingsNs === 'llm-deepseek') return section ?? {}
  return (section?.['providers'] as Record<string, Record<string, unknown>> | undefined)?.[plan.provider] ?? {}
}

function liveKey(plan: ProviderAccessPreset): string | undefined {
  const profile = liveProfile(plan)
  const ref = typeof profile['apiKeyEnv'] === 'string' ? profile['apiKeyEnv']
    : plan.settingsNs === 'llm-deepseek' ? 'DEEPSEEK_API_KEY' : `${plan.provider.toUpperCase().replaceAll('-', '_')}_API_KEY`
  return liveRefs[ref]
}

describe.skipIf(liveHome === undefined)('live preset capacity acceptance', () => {
  let scaffold: WebScaffold
  const results: Array<Record<string, unknown>> = []
  const sent: Array<{ model: unknown; maxTokens: unknown }> = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    const fetch = globalThis.fetch
    const origins = new Set(PLANS.flatMap(plan => plan.protocols.map(protocol => new URL(protocol.baseURL).origin)))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.method === 'POST' && origins.has(new URL(request.url).origin)) {
        const data = await request.clone().json() as Record<string, unknown>
        sent.push({ model: data['model'], maxTokens: data['max_tokens'] ?? data['max_completion_tokens'] ?? data['max_output_tokens'] })
      }
      return fetch(input, init)
    })
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await scaffold?.close()
    const directory = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'model-capacity-live-results.json'), `${JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2)}\n`)
  })

  for (const plan of PLANS) {
    it.skipIf(liveKey(plan) === undefined)(`${plan.provider} accepts saved budgets with a short real reply`, async () => {
      const key = liveKey(plan)!
      await scaffold.ctx.credentials.set(credentialRef('CAPACITY_LIVE_KEY'), key)
      const profile = { ...plan.initialProfile, ...liveProfile(plan), apiKeyEnv: 'CAPACITY_LIVE_KEY' }
      await saveProfile(scaffold, plan, profile)
      const models = await scaffold.ctx.llm.listModels(plan.provider)
      const failures: string[] = []
      for (const model of models) {
        for (const [contextWindow, maxTokens] of BUDGETS) {
          await saveProfile(scaffold, plan, { ...profile, models: [{ id: model.id, contextWindow, maxTokens }] })
          const before = sent.length
          const { prepared, chunks } = await callModel(scaffold, plan.provider, model.id, 'low')
          const finish = chunks.at(-1)
          const reply = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
          const request = sent.at(-1)
          const failure = finish?.type === 'finish' && finish.reason.kind === 'error' ? finish.reason.failure : undefined
          const accepted = finish?.type === 'finish' && finish.reason.kind === 'stop' && reply.trim().length > 0
          const result = {
            provider: plan.provider, model: model.id, contextWindow: prepared.context?.contextWindow,
            configuredMaxTokens: prepared.config.maxTokens,
            sentMaxTokens: sent.length > before ? request?.maxTokens : undefined,
            accepted, outputCharacters: reply.length,
            ...failure === undefined ? {} : { code: failure.code, message: failure.message.replaceAll(key, '[REDACTED]') },
          }
          results.push(result)
          console.info('Capacity probe:', JSON.stringify(result))
          if (!accepted || result.contextWindow !== contextWindow
            || result.configuredMaxTokens !== maxTokens || result.sentMaxTokens !== maxTokens) {
            failures.push(`${plan.provider}/${model.id} ${contextWindow}/${maxTokens}: ${failure?.code ?? 'budget or reply mismatch'}`)
          }
        }
      }
      expect(failures).toEqual([])
    }, 300_000)
  }
})
