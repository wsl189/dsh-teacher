/**
 * Models settings page store: one snapshot joining the configurable-provider
 * directory (`llm/listProviders` joined with `llm/listConfigurableProviders`),
 * the settings namespaces (shared settings mirror),
 * and the referenced credentials (`credentials/describe`). The host stays the
 * single fact source — every mutation writes through the wire and the page
 * re-renders from the next describe, pushed or refetched.
 */

import type {
  ClientRemote, CredentialInfo, LlmConfigurableProvider, LlmProviderInfo,
  ModelCatalogFailure, ModelProviderGroup, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeFace, SettingsRemote } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsSchemaOperations } from './schema-operations.ts'

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route.
 */
const PROBE_ROUTE = '\u0000probe'

/** Settings namespace containing typed provider request routes. */
export const MODEL_SERVICE_SETTINGS_NS = 'model-service-settings'

/** The four model types exposed by Models settings. */
export type ModelServiceType = 'chat' | 'vision' | 'speech' | 'image'

/** One model entry inside a typed provider route. */
export interface ModelServiceModelView {
  readonly id: string
  readonly name: string
}

/** One typed provider route read from the shared settings namespace. */
export interface ModelServiceRouteView {
  readonly endpoint: string
  readonly protocol: string
  readonly models: readonly ModelServiceModelView[]
}

/** One provider profile in the shared typed-route directory. */
export interface ModelServiceProviderView {
  readonly provider: string
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly routes: Readonly<Partial<Record<ModelServiceType, ModelServiceRouteView>>>
  readonly credential?: CredentialInfo
  /** Whether the user layer, rather than composition alone, owns this provider entry. */
  readonly userOwned: boolean
}

/** The credentials Remote methods the Models page reads and writes through. */
export type ModelsCredentials = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>

/** LLM Remote methods used by the Models page. */
export type ModelsLlm = Pick<
  ClientRemote['llm'],
  'discoverModels' | 'listConfigurableProviders' | 'listProviders'
>

/** Session Remote method used to load the configured model catalog. */
export type ModelsSession = Pick<ClientRemote['session'], 'modelCatalog'>

/** One provider row after joining the configurable directory with live routes. */
export interface ProviderDirectoryEntry {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly active: boolean
  readonly declared?: boolean
}

/**
 * Join declared configurable providers with the currently registered routes.
 * @param registered - live provider routes in registration order.
 * @param directory - declared configurable providers in declaration order.
 * @returns declared rows followed by live routes with no declaration.
 */
export function joinProviderDirectory(
  registered: readonly LlmProviderInfo[],
  directory: readonly LlmConfigurableProvider[],
): ProviderDirectoryEntry[] {
  const active = new Set(registered.map(provider => provider.id))
  const declared = new Set(directory.map(entry => entry.provider))
  const rows: ProviderDirectoryEntry[] = directory.map(entry => ({
    provider: entry.provider,
    displayName: entry.displayName,
    settingsNs: entry.settingsNs,
    settingsPath: [...entry.settingsPath],
    active: active.has(entry.provider),
    ...entry.declared === undefined ? {} : { declared: entry.declared },
  }))
  for (const provider of registered) {
    if (declared.has(provider.id)) continue
    rows.push({
      provider: provider.id,
      displayName: provider.name,
      settingsNs: '',
      settingsPath: [],
      active: true,
    })
  }
  return rows
}

/**
 * Every Remote wire face the Models page reaches.
 */
export interface ModelsWire {
  /** The settings Remote namespace: the redacted read and the profile writes. */
  settings: SettingsRemote
  /** Credential state and writes for the references provider profiles name. */
  credentials: ModelsCredentials
  /** Provider directory reads and draft endpoint discovery. */
  llm: ModelsLlm
  /** Configured model catalog used by background-tool model selection. */
  session: ModelsSession
}

/** One provider row the page renders. */
export interface ProviderRow {
  /** The directory entry (route id, display name, settings address, live state). */
  entry: ProviderDirectoryEntry
  /** Whether any layer configures this provider (its profile resolves). */
  configured: boolean
  /** Whether the user layer alone carries the profile (removal restores the base). */
  removable: boolean
  /** The credential reference the resolved profile names, when one does. */
  apiKeyEnv: string | undefined
  /** Credential state for {@link apiKeyEnv}, once described. */
  credential: CredentialInfo | undefined
  /**
   * Credential state for the page's derived `<ROUTE>_API_KEY`, described only
   * while the profile names no reference — the provider-card seat's
   * `keyConfigured` fact for dormant and keyless rows, matching the editor's
   * own derivation rule.
   */
  derivedCredential?: CredentialInfo
}

/** Page snapshot. */
export interface ModelsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the editor. */
  error: string | null
  /** Credential enrichment failure; provider/settings rows remain usable. */
  credentialError: string | null
  /** Model-directory enrichment failure; provider/settings rows remain usable. */
  modelCatalogError: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Every configurable provider joined with its configured/credential state. */
  rows: readonly ProviderRow[]
  /** Namespace views by ns, for the editor's schema/layers/secrets. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
  /** Models advertised by currently configured provider routes. */
  modelGroups: readonly ModelProviderGroup[]
  /** Provider-local model-catalog failures. */
  modelFailures: readonly ModelCatalogFailure[]
  /** Typed model-service routes and their credential state. */
  serviceProviders: readonly ModelServiceProviderView[]
}

/**
 * Parse the typed route directory from its redacted settings value.
 * @param value - resolved `model-service-settings` namespace value.
 * @param user - optional user layer used to mark user-owned provider entries.
 * @returns valid provider and route records; malformed leaves are omitted.
 */
export function modelServiceProviders(value: unknown, user?: unknown): ModelServiceProviderView[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const providers = (value as { providers?: unknown }).providers
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return []
  const types = ['chat', 'vision', 'speech', 'image'] as const
  const output: ModelServiceProviderView[] = []
  const userProviders = typeof user === 'object' && user !== null && !Array.isArray(user)
    && typeof (user as { providers?: unknown }).providers === 'object'
    && (user as { providers?: unknown }).providers !== null
    && !Array.isArray((user as { providers?: unknown }).providers)
    ? (user as { providers: Record<string, unknown> }).providers
    : {}
  for (const [provider, rawProfile] of Object.entries(providers)) {
    if (typeof rawProfile !== 'object' || rawProfile === null || Array.isArray(rawProfile)) continue
    const profile = rawProfile as { displayName?: unknown; apiKeyEnv?: unknown; routes?: unknown }
    const routes: Partial<Record<ModelServiceType, ModelServiceRouteView>> = {}
    const rawRoutes = typeof profile.routes === 'object' && profile.routes !== null && !Array.isArray(profile.routes)
      ? profile.routes as Record<string, unknown>
      : {}
    for (const type of types) {
      const rawRoute = rawRoutes[type]
      if (typeof rawRoute !== 'object' || rawRoute === null || Array.isArray(rawRoute)) continue
      const candidate = rawRoute as { endpoint?: unknown; protocol?: unknown; models?: unknown }
      if (typeof candidate.endpoint !== 'string' || typeof candidate.protocol !== 'string'
        || !Array.isArray(candidate.models)) continue
      const models = candidate.models.flatMap((rawModel): ModelServiceModelView[] => {
        if (typeof rawModel !== 'object' || rawModel === null || Array.isArray(rawModel)) return []
        const model = rawModel as { id?: unknown; name?: unknown }
        if (typeof model.id !== 'string' || model.id.length === 0) return []
        return [{ id: model.id, name: typeof model.name === 'string' ? model.name : model.id }]
      })
      if (models.length > 0) routes[type] = { endpoint: candidate.endpoint, protocol: candidate.protocol, models }
    }
    output.push({
      provider,
      displayName: typeof profile.displayName === 'string' && profile.displayName.length > 0
        ? profile.displayName
        : provider,
      apiKeyEnv: typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
        ? profile.apiKeyEnv
        : deriveKeyRef(provider),
      routes,
      userOwned: Object.hasOwn(userProviders, provider),
    })
  }
  return output
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Derive the conventional credential reference for a provider route: the v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 * @param provider - provider route id (e.g. `anthropic`, `minimax-cn`).
 * @returns the derived reference name (e.g. `MINIMAX_CN_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The wire protocols a hand-declared route may name, read out of the owning
 * namespace's own schema. This stays a schema read rather than a wire field so
 * the choices the page offers cannot drift from the ones the adapter accepts:
 * both come from the same `Config`.
 * @param namespace - the namespace view whose schema declares the profile shape.
 * @param schema - settings schema operations.
 * @returns the protocol identifiers, or an empty list when the schema has none.
 */
export function protocolChoices(
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations,
): string[] {
  if (namespace === undefined) return []
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** The credential reference a resolved profile names (its `apiKeyEnv` field). */
function apiKeyEnvOf(
  namespace: SettingsNamespaceView | undefined,
  path: readonly string[],
  schema: SettingsSchemaOperations,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The models settings page controller (one per settings surface). */
export class ModelsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelsSettingsState> = createSnapshotStore<ModelsSettingsState>({
    status: 'idle', error: null, credentialError: null, modelCatalogError: null,
    writable: false, rows: [], namespaces: new Map(), modelGroups: [], modelFailures: [], serviceProviders: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the page's credentials Remote and LLM wire faces.
   * @param describeFace - the shared mirror's describe face (namespace views and writability).
   */
  constructor(
    private readonly api: Pick<ModelsWire, 'credentials' | 'llm' | 'session'>,
    private readonly schema: SettingsSchemaOperations,
    private readonly describeFace: SettingsDescribeFace,
  ) {}

  /**
   * Refresh the whole page snapshot: the provider directory and the mirror's
   * settings answer in parallel, then one batched credential describe over
   * every referenced ref. Provider failure or absence of an initial settings
   * answer keeps the last good rows and surfaces an error; a failed settings
   * refresh reuses the mirror's held view.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let providers: ProviderDirectoryEntry[]
    let writable: boolean
    let views: readonly SettingsNamespaceView[]
    let modelGroups: ModelProviderGroup[] = []
    let modelFailures: ModelCatalogFailure[] = []
    let modelCatalogError: string | null = null
    try {
      const [registered, declared, , catalog] = await Promise.all([
        this.api.llm.listProviders(),
        this.api.llm.listConfigurableProviders(),
        this.describeFace.ensure(),
        Promise.resolve().then(() => this.api.session.modelCatalog()).catch((error: unknown) => {
          modelCatalogError = messageOf(error)
          return undefined
        }),
      ])
      if (!registered.ok) throw new Error(registered.error.message)
      if (!declared.ok) throw new Error(declared.error.message)
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) {
        throw new Error(mirrored.error ?? 'settings are unavailable in this browser')
      }
      providers = joinProviderDirectory(registered.value, declared.value)
      writable = mirrored.view.writable
      views = mirrored.view.namespaces
      if (catalog !== undefined) {
        if (catalog.ok) {
          modelGroups = [...catalog.value.groups]
          modelFailures = [...catalog.value.failures]
        } else {
          modelCatalogError = catalog.error.message
        }
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    const serviceNamespace = namespaces.get(MODEL_SERVICE_SETTINGS_NS)
    const serviceProviders = modelServiceProviders(serviceNamespace?.value, serviceNamespace?.user)
    const rows: ProviderRow[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const configured = namespace !== undefined
        && (entry.settingsPath.length === 0 || this.schema.getPath(namespace.value, entry.settingsPath) !== undefined)
      const removable = namespace !== undefined
        && entry.settingsPath.length > 0
        && this.schema.hasPath(namespace.user, entry.settingsPath)
        && !this.schema.hasPath(namespace.base, entry.settingsPath)
      return {
        entry,
        configured,
        removable,
        apiKeyEnv: apiKeyEnvOf(namespace, entry.settingsPath, this.schema),
        credential: undefined,
      }
    })
    const refs = [...new Set([
      ...rows.map(row => row.apiKeyEnv ?? deriveKeyRef(row.entry.provider)),
      ...serviceProviders.map(provider => provider.apiKeyEnv),
    ])]
    let credentials: Record<string, CredentialInfo> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe(refs)
        // Credential state is an enrichment for the Models page: neither a
        // business rejection nor a transport failure fails the load. The
        // onboarding projection below retains the failure distinction.
        if (response.ok) credentials = response.value
        else credentialError = response.error.message
      } catch (error) {
        credentialError = messageOf(error)
      }
    }
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.modelCatalogError = modelCatalogError
      s.writable = writable
      s.rows = rows.map((row) => {
        const named = row.apiKeyEnv === undefined ? undefined : credentials[row.apiKeyEnv]
        const derived = row.apiKeyEnv !== undefined ? undefined : credentials[deriveKeyRef(row.entry.provider)]
        return {
          ...row,
          ...named === undefined ? {} : { credential: named },
          ...derived === undefined ? {} : { derivedCredential: derived },
        }
      })
      s.namespaces = namespaces
      s.modelGroups = modelGroups
      s.modelFailures = modelFailures
      s.serviceProviders = serviceProviders.map(provider => ({
        ...provider,
        ...credentials[provider.apiKeyEnv] === undefined
          ? {}
          : { credential: credentials[provider.apiKeyEnv] },
      }))
    })
  }
}

/**
 * Whether a joined row can serve model requests as it stands: the route is
 * registered with the adapter registry, and whatever credential its resolved
 * profile names is stored. A profile naming no reference authenticates through
 * the provider's own path (the Bedrock chain, Vertex ADC, a gateway that needs
 * nothing), as does a live route with no settings address at all, so neither
 * owes this page a key.
 * @param row - one joined provider row.
 * @returns whether the user already has this provider to talk to.
 */
export function providerUsable(row: ProviderRow): boolean {
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}

/** First-run onboarding readiness derived only from the shared Models join. */
export type OnboardingReadiness =
  | { kind: 'loading' }
  | { kind: 'adapter-absent' }
  | { kind: 'provider-ready' }
  | { kind: 'credential-missing' }
  | {
    kind: 'unavailable'
    reason:
      | 'load-failed'
      | 'provider-inactive'
      | 'credentials-unavailable'
      | 'settings-read-only'
      | 'credential-read-only'
  }

/**
 * Project first-run readiness from the provider/settings/credential join used
 * by the Models page. The step exists to leave the user with a model to talk
 * to, so ANY usable provider ends it; only when none exists does the official
 * DeepSeek route — the one route the prompt can offer a key field for — decide
 * whether prompting can help. A missing official configurable-provider
 * declaration means the adapter is not repairable by navigating to Models.
 * @param state - current shared Models join snapshot.
 * @returns the onboarding state without reading a parallel fact source.
 */
export function onboardingReadiness(state: ModelsSettingsState): OnboardingReadiness {
  if ((state.status === 'idle' || state.status === 'loading') && state.rows.length === 0) {
    return { kind: 'loading' }
  }
  if (state.status === 'error') {
    return {
      kind: 'unavailable',
      reason: 'load-failed',
    }
  }
  if (state.rows.some(providerUsable)) return { kind: 'provider-ready' }
  const row = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  if (row === undefined) return { kind: 'adapter-absent' }
  if (!row.entry.active) {
    return {
      kind: 'unavailable',
      reason: 'provider-inactive',
    }
  }
  // Past the usable gate an active route names a reference it has no stored
  // credential for, so the remaining questions are all about that credential.
  if (state.credentialError !== null || row.credential === undefined) {
    return {
      kind: 'unavailable',
      reason: 'credentials-unavailable',
    }
  }
  if (!state.writable) {
    return {
      kind: 'unavailable',
      reason: 'settings-read-only',
    }
  }
  if (!row.credential.writable) {
    return {
      kind: 'unavailable',
      reason: 'credential-read-only',
    }
  }
  return { kind: 'credential-missing' }
}
