/** Recorded connectivity request through the shipped Web composition and public Session Remote. */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packChunkRuns } from '@deepseek-ai/dsh-session'
import type { ModelCheckResult } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshots,
} from '@deepseek-ai/dsh-session-snapshot'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/model-verification', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record' && !process.env.DEEPSEEK_API_KEY)('saved model verification transcript', () => {
  let scaffold: WebScaffold
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false })
  })
  afterAll(async () => { await scaffold?.close() })

  it('completes a short tool-free request and persists its private diagnostic session', async () => {
    const response = await scaffold.hostFetch('/api/session/checkModel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'model-verification', method: 'session/checkModel',
        payload: { args: { request: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
      }),
    })
    const body = await response.json() as {
      result: { ok: true; value: ModelCheckResult } | { ok: false; error: { message: string } }
    }
    expect(body.result.ok, JSON.stringify(body.result)).toBe(true)
    if (!body.result.ok) throw new Error(body.result.error.message)
    const persisted = await scaffold.ctx.sessionPersistence.load(body.result.value.sessionId)
    expect(persisted.meta.origin).toBe('subagent')
    expect(scaffold.ctx.sessions.get(body.result.value.sessionId)).toBeUndefined()
    const request = persisted.events.find(event => event.type === 'request/header')
    if (request?.type !== 'request/header') throw new Error('The diagnostic session did not log a request')
    expect(request.data.header.system).toBeUndefined()
    expect(request.data.header.tools).toBeUndefined()
    expect(request.data.header.config.maxTokens).toBe(16)
    expect(persisted.events.filter(event => event.type === 'user/message').map(event => event.data.content))
      .toEqual([[{ type: 'text', text: 'Reply with OK.' }]])
    expect(persisted.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })

    const raw = [
      JSON.stringify({ type: 'session', ...persisted.meta }),
      ...packChunkRuns(persisted.events).map(record => JSON.stringify(record)), '',
    ].join('\n')
    const normalizeContext = { cwd: scaffold.workspaceCwd, sessionIds: [] }
    const actual = normalizeSessionSnapshots([raw], normalizeContext)[0]!
    if (MODE !== 'replay') await mkdir(SNAPSHOT_DIR, { recursive: true })
    await compareOrRefreshGolden(FIXTURE, actual.trimEnd(), MODE)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'system-prompt.expected.md'), formatSystemPromptSnapshot('').trimEnd(), MODE)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'tool-schemas.expected.json'), formatToolSchemasSnapshot([]).trimEnd(), MODE)
    expect(normalizeSessionSnapshots([await readFile(FIXTURE, 'utf8')], normalizeContext)[0]).toBe(actual)
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json'])
  })
})
