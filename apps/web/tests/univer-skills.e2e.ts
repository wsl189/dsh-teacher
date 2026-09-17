/** Record synthetic model calls and replay the real bundled Office skill instructions. */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import {
  createUserMessage, LlmAdapter, ToolCallId,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  assertFixtureInventory, fixtureUserPrompts, launchWebScaffold, recordFixture,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

const MODE = webSnapshotMode()
const MODEL = 'scripted-skills'
const SKILLS = ['univer', 'univer-doc', 'univer-sheet', 'univer-slide'] as const
const PROMPT = 'Load the univer, univer-doc, univer-sheet, and univer-slide skills in that order. Read instructions only; do not create or modify files. Then reply SKILLS_READY.'
const requirePlugin = createRequire(new URL('../../../packages/bundle/web-app/package.json', import.meta.url))
const SCENARIOS = [
  {
    name: 'univer-skills',
    title: 'bundled Univer skill instructions',
    skills: SKILLS,
    prompt: PROMPT,
    cwd: dirname(dirname(requirePlugin.resolve('dsh-univer-office'))),
  },
  {
    name: 'ppt-master-workspace',
    title: 'bundled PPT Master workspace instructions',
    skills: ['ppt-master'],
    prompt: 'Load the ppt-master skill. Read instructions only; do not create or modify files. Then reply SKILLS_READY.',
    cwd: fileURLToPath(new URL('../../../packages/skill/skill-ppt-master/assets/ppt-master', import.meta.url)),
  },
] as const

/** Only the model is scripted; the real agent loop owns all skill calls and recorded events. */
class OfficeSkillsAdapter extends LlmAdapter {
  private calls = 0

  constructor(private readonly skills: readonly string[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: MODEL, context: { contextWindow: 128_000 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const name = this.skills[this.calls++]
    if (name !== undefined) {
      const id = ToolCallId(`load-${name}`)
      const args = JSON.stringify({ name })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.calls !== this.skills.length + 1) throw new Error('Office skill fixture received an unexpected model request')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'SKILLS_READY' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SKILLS_READY' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

for (const scenario of SCENARIOS) {
  describe.skipIf(MODE === 'record')(scenario.title, () => {
    const snapshotDir = fileURLToPath(new URL(`../../../snapshots/web/${scenario.name}`, import.meta.url))
    const fixture = join(snapshotDir, 'session.v3.jsonl')
    const provider = `${scenario.name}-fixture`
    let scaffold: WebScaffold
    let handle: AgentHandle

    beforeAll(async () => {
      scaffold = await launchWebScaffold(MODE === 'refresh' ? {} : {
        replayFixture: fixture,
        compareReplaySession: true,
        replayProviders: [{
          id: provider,
          name: provider,
          models: [{ id: MODEL, name: MODEL, contextWindow: 128_000 }],
        }],
      })
      if (MODE === 'refresh') {
        scaffold.ctx.effect(
          () => scaffold.ctx.llm.registerAdapter([provider], new OfficeSkillsAdapter(scenario.skills)),
          'synthetic Office skill recording',
        )
      }
      // Each read-only Session anchors resource and workspace paths under the existing {{cwd}} token.
      handle = await scaffold.ctx.agents.create({
        sessionId: SessionId(scenario.name),
        meta: { cwd: scenario.cwd, agentPreset: 'standard' },
        agentOptions: { provider, model: MODEL },
        setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
      })
    })

    afterAll(async () => {
      const failures: unknown[] = []
      await handle?.dispose().catch((error: unknown) => failures.push(error))
      await scaffold?.close().catch((error: unknown) => failures.push(error))
      if (failures.length === 1) throw failures[0]
      if (failures.length > 0) throw new AggregateError(failures, 'Office skill snapshot teardown failed')
    })

    it('logs the complete current instructions for each requested skill', async () => {
      const prompts = MODE === 'refresh' ? [scenario.prompt] : fixtureUserPrompts(await readFile(fixture, 'utf8'))
      expect(prompts).toEqual([scenario.prompt])
      for (const prompt of prompts) {
        handle.agent.followup(createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: prompt }],
        }))
        await handle.agent.whenIdle()
      }
      await scaffold.ctx.sessions.flush(handle.agent.session)
      const events = handle.agent.session.snapshotEvents()
      if (scenario.name === 'univer-skills') {
        const request = events.find(event => event.type === 'request/header')
        if (request?.type !== 'request/header') throw new Error('Office skill session has no request header')
        const api = request.data.header.tools?.find(tool => tool.name === 'univer_api')
        if (api === undefined) throw new Error('Office skill request has no univer_api schema')
        const properties = api.parameters.properties as Record<string, { description?: string }>
        expect({
          action: properties.action?.description,
          description: api.description,
          limit: properties.limit?.description,
          queries: properties.queries?.description,
        }).toMatchInlineSnapshot(`
          {
            "action": "find discovers API labels; show documents a known exact Class.member label, type, enum, or class. Prefer exact member or type lookups; show a class only for its complete API inventory.",
            "description": "Look up the bundled, version-matched Univer Facade API. Prefer show for exact Class.member labels and named types or enums. When a member is unknown, use find with API-name keywords or identifier fragments, a relevant unit, and limit 5 or 10. Show a whole class only when its complete API inventory is needed. Find is case-insensitive. Each query runs independently; queries are never combined as AND, and find does not interpret intent.",
            "limit": "Find-only maximum matches per query. Prefer 5 or 10. This does not limit show responses; use exact member or type labels for focused show queries.",
            "queries": "For find, API-name keywords or identifier fragments such as newChart or conditionalFormat. For show, known exact labels such as FWorksheet.newChart or ChartTypeString; group labels needed for the next operation. If show returns not-found, use find rather than repeatedly guessing labels. Find queries are case-insensitive and independent, not AND terms.",
          }
        `)
      }
      expect(events.filter(event => event.type === 'tool/call').map(event => ({
        name: event.data.name,
        arguments: event.data.arguments,
      }))).toEqual(scenario.skills.map(name => ({ name: 'skill', arguments: JSON.stringify({ name }) })))
      const results = events.filter(event => event.type === 'tool/result')
      expect(results).toHaveLength(scenario.skills.length)
      for (const [index, event] of results.entries()) {
        const block = event.data.message.content[0]
        expect(block?.type).toBe('tool-result')
        if (block?.type !== 'tool-result') throw new Error('Skill call has no recorded tool result')
        expect(block.isError).not.toBe(true)
        expect(block.content).toHaveLength(1)
        const content = block.content[0]
        expect(content?.type).toBe('text')
        if (content?.type !== 'text') throw new Error('Skill result has no text content')
        const name = scenario.skills[index]
        expect(content.text).toContain(`<skill_content name="${name!}">`)
        if (name === 'ppt-master') {
          expect(content.text).toContain(`Current session workspace (JSON-encoded path): ${JSON.stringify(scenario.cwd)}.`)
          expect(content.text).toContain('`--dir`')
        }
      }
      const lastAssistant = events.filter(event => event.type === 'assistant/message').at(-1)
      expect(lastAssistant?.data.message.content).toEqual([{ type: 'text', text: 'SKILLS_READY' }])
      if (MODE === 'refresh') await recordFixture(scaffold, handle.agent.session.id, fixture)
    })

    it('keeps its synthetic recording inventory closed', async () => {
      await assertFixtureInventory(snapshotDir, ['session.v3.jsonl'])
    })
  })
}
