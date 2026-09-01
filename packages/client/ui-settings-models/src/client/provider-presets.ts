/**
 * Product-owned presets for the domestic provider routes shown together on
 * the Models settings page. An access plan is one real LLM provider route:
 * it therefore keeps its own credential reference, wire protocol, endpoint,
 * and model catalog while the client presents sibling routes under one
 * supplier. Capability-specific routes share that access plan's credential
 * and supply the image-generation and speech-recognition use-case selectors.
 */

import type { ModelsKey } from './locales.ts'

/** A protocol and endpoint pairing accepted by one provider access route. */
export interface ProviderProtocolPreset {
  /** pi-ai wire protocol or capability-specific request adapter. */
  api: string
  /** Official SDK base URL for this protocol and access plan. */
  baseURL: string
  /** Path appended by the adapter for the request type. */
  requestPath: string
  /** Localized protocol label. */
  labelKey: ModelsKey
  /** Whether an absent profile field already inherits this pairing from the installed adapter catalog. */
  inherited?: boolean
}

/** One model-use category available through a route's LLM endpoint. */
export interface ProviderRequestTypePreset {
  id: 'chat' | 'vision' | 'coding' | 'image' | 'speech'
  labelKey: ModelsKey
  explanationKey: ModelsKey
  /** Capability route when it differs from the access plan's LLM protocol. */
  protocols?: readonly [ProviderProtocolPreset, ...ProviderProtocolPreset[]]
  /** Product-owned model directory for this capability route. */
  models?: readonly ProviderCapabilityModelPreset[]
}

/** One model supplied by a capability-specific route. */
export interface ProviderCapabilityModelPreset {
  /** Provider-owned model id sent on the capability request. */
  id: string
  /** Human-facing model name. */
  name: string
}

/** One independently authenticated access plan grouped beneath a supplier. */
export interface ProviderAccessPreset {
  /** Registered LLM route id. */
  provider: string
  /** Settings namespace that owns the route profile. */
  settingsNs: 'llm-deepseek' | 'llm-pi-ai'
  /** Address of the route profile inside its namespace. */
  settingsPath: readonly string[]
  /** Localized access-plan label. */
  labelKey: ModelsKey
  /** Optional plan restriction or key-isolation notice. */
  noticeKey?: ModelsKey
  /** Protocol choices and their coupled official endpoints. */
  protocols: readonly ProviderProtocolPreset[]
  /** LLM request categories whose models share this route. */
  requestTypes: readonly ProviderRequestTypePreset[]
  /**
   * Seed for a route absent from pi-ai's installed catalog. It is written only
   * when the user saves that route; catalog routes keep their provider-owned
   * models and compatibility defaults.
   */
  initialProfile?: Readonly<Record<string, unknown>>
  /** Whether this product preset names a route absent from pi-ai's catalog. */
  declared?: boolean
}

/** One supplier containing one or more independently authenticated access plans. */
export interface ProviderSupplierPreset {
  id: 'zhipu' | 'kimi' | 'deepseek' | 'qwen' | 'minimax'
  nameKey: ModelsKey
  summaryKey: ModelsKey
  shortLabel: string
  access: readonly [ProviderAccessPreset, ...ProviderAccessPreset[]]
}

const CHAT: ProviderRequestTypePreset = {
  id: 'chat',
  labelKey: 'requestTypeChat',
  explanationKey: 'requestTypeChatHint',
}

const VISION: ProviderRequestTypePreset = {
  id: 'vision',
  labelKey: 'requestTypeVision',
  explanationKey: 'requestTypeVisionHint',
}

const CODING: ProviderRequestTypePreset = {
  id: 'coding',
  labelKey: 'requestTypeCoding',
  explanationKey: 'requestTypeCodingHint',
}

const capabilityProtocol = (
  api: string,
  baseURL: string,
  requestPath: string,
  labelKey: ModelsKey,
): ProviderProtocolPreset => ({ api, baseURL, requestPath, labelKey })

const capabilityModel = (id: string, name = id): ProviderCapabilityModelPreset => ({ id, name })

const ZHIPU_IMAGE: ProviderRequestTypePreset = {
  id: 'image',
  labelKey: 'requestTypeImageGeneration',
  explanationKey: 'requestTypeImageGenerationHint',
  protocols: [capabilityProtocol(
    'zhipu-image',
    'https://open.bigmodel.cn/api/paas/v4',
    '/images/generations',
    'protocolZhipuImage',
  )],
  models: [capabilityModel('glm-image', 'GLM-Image')],
}

const ZHIPU_SPEECH: ProviderRequestTypePreset = {
  id: 'speech',
  labelKey: 'requestTypeSpeechRecognition',
  explanationKey: 'requestTypeSpeechRecognitionHint',
  protocols: [capabilityProtocol(
    'zhipu-asr',
    'https://open.bigmodel.cn/api/paas/v4',
    '/audio/transcriptions',
    'protocolZhipuSpeech',
  )],
  models: [capabilityModel('glm-asr-2512', 'GLM-ASR-2512')],
}

const QWEN_IMAGE: ProviderRequestTypePreset = {
  id: 'image',
  labelKey: 'requestTypeImageGeneration',
  explanationKey: 'requestTypeImageGenerationHint',
  protocols: [capabilityProtocol(
    'dashscope-image',
    'https://dashscope.aliyuncs.com',
    '/api/v1/services/aigc/multimodal-generation/generation',
    'protocolQwenImage',
  )],
  models: [
    capabilityModel('qwen-image-3.0-pro', 'Qwen Image 3.0 Pro'),
    capabilityModel('qwen-image-3.0', 'Qwen Image 3.0'),
  ],
}

const QWEN_SPEECH: ProviderRequestTypePreset = {
  id: 'speech',
  labelKey: 'requestTypeSpeechRecognition',
  explanationKey: 'requestTypeSpeechRecognitionHint',
  protocols: [capabilityProtocol(
    'dashscope-asr',
    'https://dashscope.aliyuncs.com',
    '/api/v1/services/audio/asr/transcription',
    'protocolQwenSpeech',
  )],
  models: [capabilityModel('qwen3-asr-flash-filetrans', 'Qwen3 ASR Flash FileTrans')],
}

const MINIMAX_IMAGE: ProviderRequestTypePreset = {
  id: 'image',
  labelKey: 'requestTypeImageGeneration',
  explanationKey: 'requestTypeImageGenerationHint',
  protocols: [capabilityProtocol(
    'minimax-image',
    'https://api.minimaxi.com',
    '/v1/image_generation',
    'protocolMiniMaxImage',
  )],
  models: [capabilityModel('image-01', 'MiniMax Image-01')],
}

const OPENAI = (baseURL: string, inherited = false): ProviderProtocolPreset => ({
  api: 'openai-completions',
  baseURL,
  requestPath: '/chat/completions',
  labelKey: 'protocolOpenAiChat',
  ...inherited ? { inherited: true } : {},
})

const RESPONSES = (baseURL: string): ProviderProtocolPreset => ({
  api: 'openai-responses',
  baseURL,
  requestPath: '/responses',
  labelKey: 'protocolOpenAiResponses',
})

const ANTHROPIC = (baseURL: string, inherited = false): ProviderProtocolPreset => ({
  api: 'anthropic-messages',
  baseURL,
  requestPath: '/v1/messages',
  labelKey: 'protocolAnthropicMessages',
  ...inherited ? { inherited: true } : {},
})

const GLM_STANDARD_MODELS = [
  { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'] },
  { id: 'glm-5-turbo', name: 'GLM-5 Turbo', input: ['text'] },
  { id: 'glm-5v-turbo', name: 'GLM-5V Turbo', input: ['text', 'image'] },
] as const

const QWEN_STANDARD_MODELS = [
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', input: ['text', 'image'] },
  { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', input: ['text'] },
] as const

const QWEN_CODING_MODELS = [
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', input: ['text', 'image'] },
  { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', input: ['text'] },
  { id: 'glm-5', name: 'GLM-5', input: ['text'] },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', input: ['text', 'image'] },
  { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', input: ['text'] },
] as const

const MINIMAX_MODELS = [
  { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', contextWindow: 204_800, input: ['text'] },
  { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax-M2.7 Highspeed', contextWindow: 204_800, input: ['text'] },
  { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', contextWindow: 204_800, input: ['text'] },
] as const

/** The five first-party domestic supplier presets in display order. */
export const PROVIDER_SUPPLIERS: readonly [ProviderSupplierPreset, ...ProviderSupplierPreset[]] = [
  {
    id: 'zhipu',
    nameKey: 'supplierZhipu',
    summaryKey: 'supplierZhipuSummary',
    shortLabel: 'GLM',
    access: [
      {
        provider: 'zhipu-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'zhipu-cn'],
        labelKey: 'accessStandard',
        protocols: [
          OPENAI('https://open.bigmodel.cn/api/paas/v4'),
          ANTHROPIC('https://open.bigmodel.cn/api/anthropic'),
        ],
        requestTypes: [CHAT, VISION, ZHIPU_IMAGE, ZHIPU_SPEECH],
        declared: true,
        initialProfile: {
          displayName: 'Zhipu GLM Standard API',
          api: 'openai-completions',
          baseURL: 'https://open.bigmodel.cn/api/paas/v4',
          models: GLM_STANDARD_MODELS,
        },
      },
      {
        provider: 'zai-coding-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'zai-coding-cn'],
        labelKey: 'accessGlmCoding',
        noticeKey: 'noticeGlmCoding',
        protocols: [
          OPENAI('https://open.bigmodel.cn/api/coding/paas/v4', true),
          ANTHROPIC('https://open.bigmodel.cn/api/anthropic'),
        ],
        requestTypes: [CODING],
      },
    ],
  },
  {
    id: 'kimi',
    nameKey: 'supplierKimi',
    summaryKey: 'supplierKimiSummary',
    shortLabel: 'K',
    access: [
      {
        provider: 'moonshotai-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'moonshotai-cn'],
        labelKey: 'accessKimiStandard',
        protocols: [OPENAI('https://api.moonshot.cn/v1', true)],
        requestTypes: [CHAT, VISION],
      },
      {
        provider: 'kimi-coding',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'kimi-coding'],
        labelKey: 'accessKimiCode',
        noticeKey: 'noticeKimiCode',
        protocols: [
          ANTHROPIC('https://api.kimi.com/coding', true),
          OPENAI('https://api.kimi.com/coding/v1'),
        ],
        requestTypes: [CODING, VISION],
      },
    ],
  },
  {
    id: 'deepseek',
    nameKey: 'supplierDeepSeek',
    summaryKey: 'supplierDeepSeekSummary',
    shortLabel: 'DS',
    access: [
      {
        provider: 'deepseek-official',
        settingsNs: 'llm-deepseek',
        settingsPath: [],
        labelKey: 'accessStandard',
        noticeKey: 'noticeDeepSeek',
        protocols: [OPENAI('https://api.deepseek.com', true)],
        requestTypes: [CHAT, VISION, CODING],
      },
    ],
  },
  {
    id: 'qwen',
    nameKey: 'supplierQwen',
    summaryKey: 'supplierQwenSummary',
    shortLabel: 'QW',
    access: [
      {
        provider: 'qwen-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'qwen-cn'],
        labelKey: 'accessQwenStandard',
        protocols: [
          OPENAI('https://dashscope.aliyuncs.com/compatible-mode/v1'),
          RESPONSES('https://dashscope.aliyuncs.com/compatible-mode/v1'),
          ANTHROPIC('https://dashscope.aliyuncs.com/apps/anthropic'),
        ],
        requestTypes: [CHAT, VISION, CODING, QWEN_IMAGE, QWEN_SPEECH],
        declared: true,
        initialProfile: {
          displayName: 'Alibaba Model Studio Standard API',
          api: 'openai-completions',
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: QWEN_STANDARD_MODELS,
        },
      },
      {
        provider: 'qwen-coding-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'qwen-coding-cn'],
        labelKey: 'accessQwenCoding',
        noticeKey: 'noticeQwenCoding',
        protocols: [
          OPENAI('https://coding.dashscope.aliyuncs.com/v1'),
          ANTHROPIC('https://coding.dashscope.aliyuncs.com/apps/anthropic'),
        ],
        requestTypes: [CODING, VISION],
        declared: true,
        initialProfile: {
          displayName: 'Alibaba Model Studio Coding Plan',
          api: 'openai-completions',
          baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
          models: QWEN_CODING_MODELS,
        },
      },
      {
        provider: 'qwen-token-plan-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'qwen-token-plan-cn'],
        labelKey: 'accessQwenToken',
        noticeKey: 'noticeQwenToken',
        protocols: [
          OPENAI('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', true),
          RESPONSES('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),
          ANTHROPIC('https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic'),
        ],
        requestTypes: [CHAT, VISION, CODING, QWEN_IMAGE, QWEN_SPEECH],
      },
    ],
  },
  {
    id: 'minimax',
    nameKey: 'supplierMiniMax',
    summaryKey: 'supplierMiniMaxSummary',
    shortLabel: 'MM',
    access: [
      {
        provider: 'minimax-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'minimax-cn'],
        labelKey: 'accessStandard',
        protocols: [
          ANTHROPIC('https://api.minimaxi.com/anthropic', true),
          OPENAI('https://api.minimaxi.com/v1'),
        ],
        requestTypes: [CHAT, VISION, CODING, MINIMAX_IMAGE],
      },
      {
        provider: 'minimax-token-plan-cn',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'minimax-token-plan-cn'],
        labelKey: 'accessMiniMaxToken',
        noticeKey: 'noticeMiniMaxToken',
        protocols: [
          ANTHROPIC('https://api.minimaxi.com/anthropic'),
          OPENAI('https://api.minimaxi.com/v1'),
        ],
        requestTypes: [CHAT, VISION, CODING, MINIMAX_IMAGE],
        declared: true,
        initialProfile: {
          displayName: 'MiniMax Token Plan',
          api: 'anthropic-messages',
          baseURL: 'https://api.minimaxi.com/anthropic',
          models: MINIMAX_MODELS,
        },
      },
    ],
  },
]

const ACCESS_BY_PROVIDER = new Map(
  PROVIDER_SUPPLIERS.flatMap(supplier => supplier.access.map(access => [access.provider, access] as const)),
)

/** Every route owned by the domestic supplier workspace. */
export const PRESET_PROVIDER_IDS: ReadonlySet<string> = new Set(ACCESS_BY_PROVIDER.keys())

/**
 * Find the product preset for one registered provider route.
 * @param provider - registered provider route id.
 * @returns the matching access preset, or undefined outside the product inventory.
 */
export function providerAccessPreset(provider: string): ProviderAccessPreset | undefined {
  return ACCESS_BY_PROVIDER.get(provider)
}

/**
 * Find the supplier containing one provider route.
 * @param provider - registered provider route id.
 * @returns the owning supplier preset, or undefined outside the product inventory.
 */
export function providerSupplierPreset(provider: string): ProviderSupplierPreset | undefined {
  return PROVIDER_SUPPLIERS.find(supplier => supplier.access.some(access => access.provider === provider))
}

/**
 * Join an SDK base URL and the request path the selected protocol appends.
 * @param baseURL - protocol-specific SDK base URL.
 * @param requestPath - request path appended by the adapter.
 * @returns the complete request URL, or an empty string for an empty base URL.
 */
export function joinRequestURL(baseURL: string, requestPath: string): string {
  const base = baseURL.trim().replace(/\/+$/u, '')
  if (base.length === 0) return ''
  return `${base}/${requestPath.replace(/^\/+/, '')}`
}
