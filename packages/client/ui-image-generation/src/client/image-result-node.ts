/** Turn-scoped projection of generated-image Tool results into one final Chat node. */
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {
  ConversationLocation, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'

/** Keyed Chat renderer kind for generated-image previews. */
export const IMAGE_GENERATION_RESULT_KIND = 'image-generation-result'

const IMAGE_TOOL_NAMES = new Set([
  'generate_image',
  'edit_image',
  'get_image_generation_task',
])

const IMAGE_MEDIA_TYPES = new Set<unknown>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** Final renderer payload for all distinct generated images in one Turn. */
export interface ImageGenerationResultData {
  readonly turn: number
  readonly images: readonly ImageAttachmentRef[]
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Generated images placed beside the Turn's final Assistant answer. */
    'image-generation-result': ImageGenerationResultData
  }
}

interface ImageGenerationState extends ImageGenerationResultData {
  readonly imageCallIds: ReadonlySet<string>
  readonly resultSeq: number | undefined
  readonly answerSeq: number | undefined
  readonly endSeq: number | undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.has(value)
}

function imageRef(value: unknown): ImageAttachmentRef | undefined {
  if (!isRecord(value)) return undefined
  const attachmentId = value.attachment_id
  const mediaType = value.media_type
  const name = value.name
  if (typeof attachmentId !== 'string'
    || attachmentId.length === 0
    || !isImageMediaType(mediaType)
    || !isPositiveInteger(value.bytes)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || (name !== undefined && typeof name !== 'string')) return undefined
  return {
    attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(name === undefined ? {} : { name }),
  }
}

/**
 * Parse the bundled image plugin's durable `tool/result.meta.images` value.
 * Invalid entries are omitted; the returned references retain provider order.
 * @param value - untrusted durable result metadata.
 * @returns validated image references, possibly empty.
 */
export function imageRefsFromPresentationMeta(value: unknown): readonly ImageAttachmentRef[] {
  if (!isRecord(value) || !Array.isArray(value.images)) return []
  const refs: ImageAttachmentRef[] = []
  for (const candidate of value.images) {
    const ref = imageRef(candidate)
    if (ref !== undefined) refs.push(ref)
  }
  return refs
}

function initialState(turn: number): ImageGenerationState {
  return {
    turn,
    imageCallIds: new Set(),
    images: [],
    resultSeq: undefined,
    answerSeq: undefined,
    endSeq: undefined,
  }
}

function addCall(state: ImageGenerationState, callId: string): ImageGenerationState {
  return { ...state, imageCallIds: new Set([...state.imageCallIds, callId]) }
}

function mergeImages(
  current: readonly ImageAttachmentRef[],
  additions: readonly ImageAttachmentRef[],
): readonly ImageAttachmentRef[] {
  const ids = new Set(current.map(image => image.attachmentId))
  const next = [...current]
  for (const image of additions) {
    if (ids.has(image.attachmentId)) continue
    ids.add(image.attachmentId)
    next.push(image)
  }
  return next
}

function applyMatch(state: ImageGenerationState, match: ConversationMatch): ImageGenerationState {
  const event = match.event
  if (event.type === 'tool/call') {
    return addCall(state, String(event.data.callId))
  }
  if (event.type === 'tool/result') {
    const callId = String(event.data.message.source.callId)
    if (!state.imageCallIds.has(callId)) return state
    return {
      ...state,
      images: mergeImages(state.images, imageRefsFromPresentationMeta(event.data.meta)),
      resultSeq: event.seq,
      answerSeq: undefined,
    }
  }
  if (event.type === 'assistant/message') {
    return state.resultSeq === undefined || event.seq <= state.resultSeq
      ? state
      : { ...state, answerSeq: event.seq }
  }
  if (event.type === 'turn/end') return { ...state, endSeq: event.seq }
  return state
}

function latestLocation(context: ConversationNodeContext<ImageGenerationState>): ConversationLocation {
  return context.matches.at(-1)?.location ?? context.start?.location ?? { kind: 'unresolved' }
}

/** One generated-image row per Turn, re-anchored to the Assistant message after the latest image result. */
export const imageGenerationResultDefinition: ConversationNodeDefinition<ImageGenerationState> = {
  kind: IMAGE_GENERATION_RESULT_KIND,
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/call' && IMAGE_TOOL_NAMES.has(event.data.name)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'tool/result'
      && isAppendSurfaceEvent(event)
      && imageRefsFromPresentationMeta(event.data.meta).length > 0) {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'assistant/message' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') {
      throw new Error('image-generation-result start requires turn/start')
    }
    return initialState(match.event.data.turn)
  },
  update: (context, match) => applyMatch(context.state, match),
  publication: match => match.event.type === 'tool/call' || match.event.type === 'turn/start'
    ? 'none'
    : 'immediate',
  buildViewNode: (context): ChatConversationViewNode | null => {
    const state = context.state
    if (state === undefined || state.images.length === 0 || state.resultSeq === undefined) return null
    return {
      key: context.key,
      kind: IMAGE_GENERATION_RESULT_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: state.answerSeq ?? state.endSeq ?? state.resultSeq,
      location: latestLocation(context),
      visibility: 'visible',
      data: { turn: state.turn, images: state.images },
    }
  },
}
