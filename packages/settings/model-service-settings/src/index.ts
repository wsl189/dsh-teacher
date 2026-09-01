/**
 * Typed provider model routes shared by configuration surfaces and
 * capability-specific request consumers.
 *
 * @module @deepseek-ai/dsh-model-service-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'

/** Settings namespace containing provider-owned typed model routes. */
export const MODEL_SERVICE_SETTINGS_NAMESPACE = settingsNamespace('model-service-settings')

/** The four product model types accepted by Models settings. */
export const MODEL_SERVICE_TYPES = ['chat', 'vision', 'speech', 'image'] as const

/** One product model type accepted by Models settings. */
export type ModelServiceType = typeof MODEL_SERVICE_TYPES[number]

/** Request adapters understood by the installed LLM and media consumers. */
export const MODEL_SERVICE_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'openai-audio-transcriptions',
  'qwen-input-audio',
  'openai-images',
  'dashscope-image',
  'minimax-image',
] as const

/** One installed request adapter identifier. */
export type ModelServiceProtocol = typeof MODEL_SERVICE_PROTOCOLS[number]

/** One provider-owned model exposed through a typed request route. */
export interface ModelServiceModel {
  /** Provider-owned model id sent on requests. */
  id: string
  /** Optional human-facing name; the id is used when absent. */
  name?: string
}

/** One complete request endpoint and its model directory. */
export interface ModelServiceRoute {
  /** Complete request URL, including the protocol-specific path. */
  endpoint: string
  /** Installed request adapter used to serialize and parse this route. */
  protocol: ModelServiceProtocol
  /** Models served by this exact endpoint. */
  models: ModelServiceModel[]
}

/** Typed routes sharing one provider identity and credential. */
export interface ModelServiceProviderProfile {
  /** Name shown by configuration and use-case selectors. */
  displayName?: string
  /** Credential reference shared by the provider's routes. */
  apiKeyEnv?: string
  /** Optional routes for each fixed product model type. */
  routes?: Partial<Record<ModelServiceType, ModelServiceRoute>>
}

/** Settings section containing every configured model-service provider. */
export interface ModelServiceSettings {
  /** Provider profiles keyed by stable provider route id. */
  providers: Record<string, ModelServiceProviderProfile>
}

/** Plugin configuration used as the composition layer below user settings. */
export type Config = ModelServiceSettings

const model: z<ModelServiceModel> = z.object({
  id: z.string().required(),
  name: z.string(),
})

const route: z<ModelServiceRoute> = z.object({
  endpoint: z.string().required(),
  protocol: z.union(MODEL_SERVICE_PROTOCOLS).required(),
  models: z.array(model).min(1).required(),
})

const provider: z<ModelServiceProviderProfile> = z.object({
  displayName: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
  routes: z.dict(route, z.union(MODEL_SERVICE_TYPES)) as unknown as z<Partial<Record<ModelServiceType, ModelServiceRoute>>>,
})

/** Runtime schema for the model-service settings section. */
export const Config: z<Config> = z.object({
  providers: z.dict(provider).default({}),
})

const PROTOCOL_TYPES: Readonly<Record<ModelServiceProtocol, readonly ModelServiceType[]>> = Object.freeze({
  'openai-completions': ['chat', 'vision'],
  'openai-responses': ['chat', 'vision'],
  'anthropic-messages': ['chat', 'vision'],
  'openai-audio-transcriptions': ['speech'],
  'qwen-input-audio': ['speech'],
  'openai-images': ['image'],
  'dashscope-image': ['image'],
  'minimax-image': ['image'],
})

/**
 * Validate relationships that the serializable schema cannot express.
 * @param settings - resolved model-service settings.
 * @throws Error naming an invalid provider, route, endpoint, protocol, or model.
 */
export function assertModelServiceSettings(settings: ModelServiceSettings): void {
  for (const [providerId, profile] of Object.entries(settings.providers)) {
    if (providerId.length === 0) throw new Error('model-service-settings: provider ids must be non-empty')
    if (profile.displayName !== undefined && profile.displayName.trim().length === 0) {
      throw new Error(`model-service-settings: provider "${providerId}" has an empty displayName`)
    }
    const modelIds = new Set<string>()
    for (const type of MODEL_SERVICE_TYPES) {
      const entry = profile.routes?.[type]
      if (entry === undefined) continue
      if (!PROTOCOL_TYPES[entry.protocol].includes(type)) {
        throw new Error(
          `model-service-settings: provider "${providerId}" route "${type}" cannot use protocol "${entry.protocol}"`,
        )
      }
      validateEndpoint(entry.endpoint, `provider "${providerId}" route "${type}"`)
      for (const modelEntry of entry.models) {
        if (modelEntry.id.trim().length === 0) {
          throw new Error(`model-service-settings: provider "${providerId}" route "${type}" has an empty model id`)
        }
        if (modelEntry.name !== undefined && modelEntry.name.trim().length === 0) {
          throw new Error(
            `model-service-settings: provider "${providerId}" model "${modelEntry.id}" has an empty name`,
          )
        }
        if (modelIds.has(modelEntry.id)) {
          throw new Error(`model-service-settings: provider "${providerId}" repeats model "${modelEntry.id}"`)
        }
        modelIds.add(modelEntry.id)
      }
    }
  }
}

/**
 * Find the exact typed request route serving a selected model.
 * @param settings - resolved model-service settings.
 * @param providerId - selected provider route id.
 * @param modelId - selected provider-owned model id.
 * @param type - required product model type.
 * @returns the provider profile, route, and model, or undefined when no exact entry exists.
 */
export function findModelServiceRoute(
  settings: ModelServiceSettings,
  providerId: string,
  modelId: string,
  type: ModelServiceType,
): {
  provider: ModelServiceProviderProfile
  route: ModelServiceRoute
  model: ModelServiceModel
} | undefined {
  const providerProfile = settings.providers[providerId]
  const modelRoute = providerProfile?.routes?.[type]
  const modelEntry = modelRoute?.models.find(candidate => candidate.id === modelId)
  return providerProfile === undefined || modelRoute === undefined || modelEntry === undefined
    ? undefined
    : { provider: providerProfile, route: modelRoute, model: modelEntry }
}

/** Cordis plugin name. */
export const name = 'model-service-settings'

/**
 * Register the model-service settings namespace.
 * @param ctx - Host context carrying an optional settings provider.
 * @param config - composition-layer provider routes.
 */
export function apply(ctx: Context, config: Config): void {
  installSettingsSection(ctx, MODEL_SERVICE_SETTINGS_NAMESPACE, Config, config, {
    setSource: () => {},
    onChange: () => {},
    validate: assertModelServiceSettings,
  })
}

function validateEndpoint(value: string, label: string): void {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch (error) {
    throw new TypeError(`model-service-settings: ${label} endpoint must be a complete URL`, { cause: error })
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(endpoint.hostname.toLowerCase())
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))
    || endpoint.username !== '' || endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== '') {
    throw new TypeError(
      `model-service-settings: ${label} endpoint must use HTTPS or loopback HTTP without credentials, query, or fragment`,
    )
  }
}
