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

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/univer-skills', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const PROVIDER = 'univer-skills-fixture'
const MODEL = 'scripted-skills'
const SKILLS = ['univer', 'univer-doc', 'univer-sheet', 'univer-slide'] as const
const PROMPT = 'Load the univer, univer-doc, univer-sheet, and univer-slide skills in that order. Read instructions only; do not create or modify files. Then reply SKILLS_READY.'
const requirePlugin = createRequire(new URL('../../../packages/bundle/web-app/package.json', import.meta.url))

/** Only the model is scripted; the real agent loop owns all skill calls and recorded events. */
class OfficeSkillsAdapter extends LlmAdapter {
  private calls = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: MODEL, context: { contextWindow: 128_000 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const name = SKILLS[this.calls++]
    if (name !== undefined) {
      const id = ToolCallId(`load-${name}`)
      const args = JSON.stringify({ name })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.calls !== SKILLS.length + 1) throw new Error('Office skill fixture received an unexpected model request')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'SKILLS_READY' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SKILLS_READY' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe.skipIf(MODE === 'record')('bundled Univer skill instructions', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'refresh' ? {} : {
      replayFixture: FIXTURE,
      compareReplaySession: true,
      replayProviders: [{
        id: PROVIDER,
        name: PROVIDER,
        models: [{ id: MODEL, name: MODEL, contextWindow: 128_000 }],
      }],
    })
    if (MODE === 'refresh') {
      scaffold.ctx.effect(
        () => scaffold.ctx.llm.registerAdapter([PROVIDER], new OfficeSkillsAdapter()),
        'synthetic Office skill recording',
      )
    }
    // This read-only Session anchors installed resource paths under the existing {{cwd}} token.
    const skillPackage = dirname(dirname(requirePlugin.resolve('dsh-univer-office')))
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('univer-skills'),
      meta: { cwd: skillPackage, agentPreset: 'standard' },
      agentOptions: { provider: PROVIDER, model: MODEL },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 0) throw new AggregateError(failures, 'Univer skill snapshot teardown failed')
  })

  it('logs the complete current instructions for document, sheet, and slide authoring', async () => {
    const prompts = MODE === 'refresh' ? [PROMPT] : fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
    expect(prompts).toEqual([PROMPT])
    for (const prompt of prompts) {
      handle.agent.followup(createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: prompt }],
      }))
      await handle.agent.whenIdle()
    }
    await scaffold.ctx.sessions.flush(handle.agent.session)
    const events = handle.agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/call').map(event => ({
      name: event.data.name,
      arguments: event.data.arguments,
    }))).toEqual(SKILLS.map(name => ({ name: 'skill', arguments: JSON.stringify({ name }) })))
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(SKILLS.length)
    for (const [index, event] of results.entries()) {
      const block = event.data.message.content[0]
      expect(block?.type).toBe('tool-result')
      if (block?.type !== 'tool-result') throw new Error('Skill call has no recorded tool result')
      expect(block.isError).not.toBe(true)
      expect(block.content).toHaveLength(1)
      const content = block.content[0]
      expect(content?.type).toBe('text')
      if (content?.type !== 'text') throw new Error('Skill result has no text content')
      expect(content.text).toContain(`<skill_content name="${SKILLS[index]!}">`)
    }
    const lastAssistant = events.filter(event => event.type === 'assistant/message').at(-1)
    expect(lastAssistant?.data.message.content).toEqual([{ type: 'text', text: 'SKILLS_READY' }])
    if (MODE === 'refresh') await recordFixture(scaffold, handle.agent.session.id, FIXTURE)
  })

  it('keeps its synthetic recording inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl'])
  })
})
