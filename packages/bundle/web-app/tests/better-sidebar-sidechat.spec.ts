/** Regression coverage for the patched better-sidebar Side Chat event route. */

import { describe, expect, it } from 'vitest'
import { buildSidechatApi } from 'dsh-better-sidebar/src/sidechat-routes.ts'
import type { SidechatLogEvent } from 'dsh-better-sidebar/src/sidechat-core.ts'

function event(type: string, seq: number): SidechatLogEvent {
  return { type, seq, time: seq, data: {} }
}

function contextWithEvents(events: readonly SidechatLogEvent[], live: boolean): Parameters<typeof buildSidechatApi>[0] {
  return {
    get(name: string): unknown {
      if (name === 'agents') {
        return { get: () => live ? { session: { events } } : undefined }
      }
      if (name === 'sessionPersistence') {
        return { inspect: () => Promise.resolve({ meta: {}, events }) }
      }
      return undefined
    },
  } as unknown as Parameters<typeof buildSidechatApi>[0]
}

describe('patched better-sidebar Side Chat events', () => {
  const events = [
    event('session/created', 0),
    event('session/end-seed', 1),
    event('user/message', 2),
    event('assistant/message', 3),
  ]

  it('returns only thread-owned live events and supports tail polling', async () => {
    const api = buildSidechatApi(contextWithEvents(events, true))

    await expect(api['sidechat.events']({ childId: 'child' })).resolves.toEqual({
      events: events.slice(2),
    })
    await expect(api['sidechat.events']({ childId: 'child', afterSeq: 2 })).resolves.toEqual({
      events: events.slice(3),
    })
  })

  it('reads cold threads from persistence and rejects an invalid cursor', async () => {
    const api = buildSidechatApi(contextWithEvents(events, false))

    await expect(api['sidechat.events']({ childId: 'child' })).resolves.toEqual({
      events: events.slice(2),
    })
    await expect(api['sidechat.events']({ childId: 'child', afterSeq: -1 }))
      .rejects.toThrow('afterSeq must be a non-negative integer')
  })
})
