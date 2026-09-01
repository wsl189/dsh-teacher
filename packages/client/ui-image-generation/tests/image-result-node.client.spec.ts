import { describe, expect, it } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConversationMatch, ConversationNodeDefinition, ConversationStartMatch,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEvent, SurfaceOp } from '@deepseek-ai/dsh-session/types'
import {
  IMAGE_GENERATION_RESULT_KIND, imageGenerationResultDefinition, imageRefsFromPresentationMeta,
  type ImageGenerationResultData,
} from '../src/client/image-result-node.ts'

interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [imageGenerationResultDefinition] }
  fallbackEntry(): undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    const snapshot = (): ChatSnapshot => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

const firstImage = {
  attachment_id: 'sha256:first',
  media_type: 'image/png',
  bytes: 100,
  width: 640,
  height: 320,
  name: 'first.png',
} as const

const secondImage = {
  attachment_id: 'sha256:second',
  media_type: 'image/webp',
  bytes: 200,
  width: 320,
  height: 640,
} as const

function at(
  seq: number,
  type: string,
  data: unknown,
  surfaceOp?: SurfaceOp,
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq, time: seq * 100, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }),
    } as SessionEvent,
  }
}

function completeEvents(): SessionLiveEventEntry[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'assistant/message', {
      turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'call-1', name: 'generate_image', arguments: '{}' }] },
    }, 'append'),
    at(4, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'generate_image', arguments: '{}' }),
    at(5, 'tool/result', {
      turn: 1, step: 1,
      message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: '{}' }] },
      meta: { images: [firstImage] },
    }, 'append'),
    at(6, 'step/end', { turn: 1, step: 1 }),
    at(7, 'step/start', { turn: 1, step: 2 }),
    at(8, 'assistant/message', {
      turn: 1, step: 2, message: { content: [{ type: 'tool-call', id: 'call-2', name: 'get_image_generation_task', arguments: '{}' }] },
    }, 'append'),
    at(9, 'tool/call', { turn: 1, step: 2, callId: 'call-2', name: 'get_image_generation_task', arguments: '{}' }),
    at(10, 'tool/result', {
      turn: 1, step: 2,
      message: { source: { callId: 'call-2' }, content: [{ type: 'text', text: '{}' }] },
      meta: { images: [firstImage, secondImage] },
    }, 'append'),
    at(11, 'step/end', { turn: 1, step: 2 }),
    at(12, 'step/start', { turn: 1, step: 3 }),
    at(13, 'assistant/message', {
      turn: 1, step: 3, message: { content: [{ type: 'text', text: 'Done.' }] },
    }, 'append'),
    at(14, 'step/end', { turn: 1, step: 3 }),
    at(15, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

function assembler(entries: readonly SessionLiveEventEntry[], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

function imageNode(value: ConversationNodeAssembler): ChatConversationViewNode | undefined {
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return [...snapshot.nodes.values()][0]
}

function imageData(value: ConversationNodeAssembler): ImageGenerationResultData | undefined {
  return imageNode(value)?.data as ImageGenerationResultData | undefined
}

describe('generated-image result Conversation Definition', () => {
  it('deduplicates one Turn and anchors it to the Assistant answer after the latest result', () => {
    const events = completeEvents()
    const afterFirstResult = assembler(events.slice(0, 5))
    expect(imageNode(afterFirstResult)?.anchorSeq).toBe(5)

    const complete = assembler(events)
    expect(imageNode(complete)).toMatchObject({
      kind: IMAGE_GENERATION_RESULT_KIND,
      anchorSeq: 13,
      visibility: 'visible',
    })
    expect(imageData(complete)).toEqual({
      turn: 1,
      images: [
        {
          attachmentId: 'sha256:first', mediaType: 'image/png', bytes: 100,
          width: 640, height: 320, name: 'first.png',
        },
        {
          attachmentId: 'sha256:second', mediaType: 'image/webp', bytes: 200,
          width: 320, height: 640,
        },
      ],
    })
  })

  it('uses Turn end when no Assistant answer follows the latest image result', () => {
    const events = completeEvents().slice(0, 11)
    events.push(at(12, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(imageNode(assembler(events))?.anchorSeq).toBe(12)
  })

  it('keeps an update-only history tail pending and converges when the start page arrives', () => {
    const events = completeEvents()
    const value = assembler(events.slice(3), true)
    expect(imageNode(value)).toBeUndefined()
    value.prepend(events.slice(0, 3), false)
    value.flush()
    expect(imageData(value)).toEqual(imageData(assembler(events)))
  })

  it('converges when a complete Turn arrives through live append', () => {
    const events = completeEvents()
    const value = assembler(events.slice(0, 1))
    for (const event of events.slice(1)) value.append(event)
    value.flush()
    expect(imageNode(value)).toEqual(imageNode(assembler(events)))
  })

  it('requires a recognized image Tool call and append-origin result metadata', () => {
    const base = [at(1, 'turn/start', { turn: 1 })]
    const unknownCall = at(2, 'tool/call', {
      turn: 1, step: 1, callId: 'other', name: 'other_tool', arguments: '{}',
    })
    const unknownResult = at(3, 'tool/result', {
      turn: 1, step: 1,
      message: { source: { callId: 'other' }, content: [{ type: 'text', text: '{}' }] },
      meta: { images: [firstImage] },
    }, 'append')
    expect(imageNode(assembler([...base, unknownCall, unknownResult]))).toBeUndefined()

    const imageCall = at(4, 'tool/call', {
      turn: 1, step: 1, callId: 'image', name: 'edit_image', arguments: '{}',
    })
    const replacement = at(5, 'tool/result', {
      turn: 1, step: 1,
      message: { source: { callId: 'image' }, content: [{ type: 'text', text: '{}' }] },
      meta: { images: [firstImage] },
    }, { op: 'replace', start: 3, end: 3 })
    expect(imageNode(assembler([...base, imageCall, replacement]))).toBeUndefined()
  })

  it('validates durable presentation metadata entry by entry', () => {
    expect(imageRefsFromPresentationMeta(null)).toEqual([])
    expect(imageRefsFromPresentationMeta({ images: 'not-an-array' })).toEqual([])
    expect(imageRefsFromPresentationMeta({
      images: [
        null,
        { ...firstImage, attachment_id: '' },
        { ...firstImage, media_type: 'image/svg+xml' },
        { ...firstImage, bytes: 0 },
        { ...firstImage, width: 1.5 },
        { ...firstImage, height: Number.NaN },
        { ...firstImage, name: 3 },
        firstImage,
        { ...secondImage, media_type: 'image/jpeg' },
        { ...secondImage, media_type: 'image/gif' },
      ],
    })).toEqual([
      {
        attachmentId: 'sha256:first', mediaType: 'image/png', bytes: 100,
        width: 640, height: 320, name: 'first.png',
      },
      {
        attachmentId: 'sha256:second', mediaType: 'image/jpeg', bytes: 200,
        width: 320, height: 640,
      },
      {
        attachmentId: 'sha256:second', mediaType: 'image/gif', bytes: 200,
        width: 320, height: 640,
      },
    ])
  })

  it('keeps defensive direct calls explicit', () => {
    const invalidStart = {
      event: at(1, 'tool/call', {
        turn: 1, step: 1, callId: 'image', name: 'generate_image', arguments: '{}',
      }).event,
      role: 'start' as const,
      location: { kind: 'unresolved' as const },
    } satisfies ConversationStartMatch
    const context: Parameters<typeof imageGenerationResultDefinition.start>[0] = {
      key: 'image-generation-result:1', kind: IMAGE_GENERATION_RESULT_KIND, id: '1',
      matches: [invalidStart], start: invalidStart, state: undefined, current: new Map(),
    }
    expect(() => imageGenerationResultDefinition.start(context, invalidStart, { previous: () => undefined }))
      .toThrow('image-generation-result start requires turn/start')
    expect(imageGenerationResultDefinition.publication?.(invalidStart)).toBe('none')
    expect(imageGenerationResultDefinition.match(at(2, 'step/start', { turn: 1, step: 1 }).event)).toBeNull()
    expect(imageGenerationResultDefinition.buildViewNode?.({ ...context, matches: [], start: undefined })).toBeNull()

    const unmatched = {
      event: at(3, 'step/end', { turn: 1, step: 1 }).event,
      role: 'update' as const,
      location: { kind: 'unresolved' as const },
    } satisfies ConversationMatch
    const start = {
      event: at(4, 'turn/start', { turn: 1 }).event,
      role: 'start' as const,
      location: { kind: 'unresolved' as const },
    } satisfies ConversationStartMatch
    const state = imageGenerationResultDefinition.start({ ...context, matches: [start], start }, start, { previous: () => undefined })
    expect(imageGenerationResultDefinition.update({ ...context, matches: [start], start, state }, unmatched)).toBe(state)

    const call = {
      event: at(5, 'tool/call', {
        turn: 1, step: 1, callId: 'image', name: 'generate_image', arguments: '{}',
      }).event,
      role: 'update' as const,
      location: { kind: 'unresolved' as const },
    } satisfies ConversationMatch
    const result = {
      event: at(6, 'tool/result', {
        turn: 1, step: 1,
        message: { source: { callId: 'image' }, content: [{ type: 'text', text: '{}' }] },
        meta: { images: [firstImage] },
      }, 'append').event,
      role: 'update' as const,
      location: { kind: 'unresolved' as const },
    } satisfies ConversationMatch
    const called = imageGenerationResultDefinition.update(
      { ...context, matches: [start, call], start, state }, call,
    )
    const completed = imageGenerationResultDefinition.update(
      { ...context, matches: [start, call, result], start, state: called }, result,
    )
    const startLocationNode = imageGenerationResultDefinition.buildViewNode?.({
      ...context, matches: [], start, state: completed,
    }) as ChatConversationViewNode | null
    expect(startLocationNode?.location).toEqual(start.location)
    const unresolvedLocationNode = imageGenerationResultDefinition.buildViewNode?.({
      ...context, matches: [], start: undefined, state: completed,
    }) as ChatConversationViewNode | null
    expect(unresolvedLocationNode?.location).toEqual({ kind: 'unresolved' })
  })
})
