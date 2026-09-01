/**
 * Provider editor shared by adapter families. API protocol and the write-only
 * API key sit in the same access-plan section. Product presets couple each
 * protocol to an official base URL and show the complete request URL; generic
 * providers keep request-route and model fields in their advanced disclosure.
 * A product route absent from the installed catalog receives its serviceable
 * seed only when saved. Profile edits use minimal `settings.mutate` path ops,
 * and a typed key is stored through the credential service under the profile's
 * reference rather than copied into `settings.yaml`.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  CredentialInfo, JsonValue, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  DeepSeekModelsEditor, modelDrafts, validateDeepSeekModels,
} from './DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import { joinRequestURL } from './provider-presets.ts'
import type { ProviderAccessPreset, ProviderProtocolPreset } from './provider-presets.ts'
import { deriveKeyRef, messageOf, protocolChoices } from './store.ts'
import type { ModelsWire } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Per-adapter-family curated field sets (unknown namespaces get the hint alone). */
type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

/** The public DeepSeek endpoint shown as the deepseek base-URL placeholder. */
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Props of {@link ProviderEditor}. */
export interface ProviderEditorProps {
  /** Provider route id. */
  provider: string
  /** Display name for the card title. */
  displayName: string
  /** Hide the title row (the add card renders its own provider select). */
  hideTitle?: boolean
  /**
   * Whether the adapter reports this route as hand-declared — absent from its
   * installed catalog. Generic declared routes can edit the display name that
   * their profile owns; product presets keep their product-owned name.
   */
  declared?: boolean
  /** Product-owned supplier/access defaults and official endpoint pairings. */
  connectionPreset?: ProviderAccessPreset
  /** The owning namespace view (schema, layers, secrets). */
  namespace: SettingsNamespaceView
  /** Settings-owned synchronous schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
  /** Wire faces for writes and for interrogating a provider endpoint. */
  api: ModelsWire
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Render only the credential field and actions, without provider settings. */
  credentialOnly?: boolean
  /** Require a newly entered credential before this editor can submit. */
  credentialRequired?: boolean
  /** Give the credential field initial focus when this editor mounts. */
  autoFocusCredential?: boolean
  /** Override the dismiss action copy. */
  cancelLabelKey?: keyof typeof en
  /** Override the idle commit action copy. */
  submitLabelKey?: keyof typeof en
  /** Override the in-flight commit action copy. */
  submitBusyLabelKey?: keyof typeof en
  /** Close the editor; `changed` reports whether an Apply committed. */
  onClose: (changed: boolean) => void
}

/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
  seed: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const subtree = schema.getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) {
    return seed === undefined ? {} : structuredClone(seed)
  }
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value: value as JsonValue })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** The editor layout the owning namespace selects. */
function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/** The credential reference this profile resolves keys through. */
function refFor(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
  provider: string,
): string {
  const profile = schema.getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card.
 */
export function ProviderEditor(props: ProviderEditorProps): ReactNode {
  const { namespace, schema, settingsPath, api, t } = props
  const [draft, setDraft] = useState<Record<string, unknown>>(
    () => draftAt(schema, namespace, settingsPath, props.connectionPreset?.initialProfile),
  )
  const [requestType, setRequestType] = useState(
    () => props.connectionPreset?.requestTypes[0]?.id ?? 'chat',
  )
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialInfo | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // A settings success advances both retry baselines immediately. Keeping the
  // derived fields in the draft prevents a pushed namespace refresh from
  // turning them into deletions when the following credential write is retried.
  const [committedOriginal, setCommittedOriginal] = useState<unknown>(
    () => schema.getPath(namespace.user, settingsPath),
  )
  const [expectedRevision, setExpectedRevision] = useState(() => namespace.revision)
  const root = useMemo(() => schema.rehydrate(namespace.schema), [namespace.schema, schema])
  const node = useMemo(() => schema.nodeAtPath(root, settingsPath), [root, schema, settingsPath])
  const fallback = schema.getPath(namespace.value, settingsPath)
  const disabled = props.readOnly || busy
  const layout = layoutOf(namespace.ns)
  const keyRef = refFor(schema, namespace, settingsPath, props.provider)
  // The same schema read the create card makes, so the choices offered here
  // and there cannot drift apart: both come from the adapter's own `Config`.
  // Only the pi-ai layout has a per-route protocol for the read to find, and
  // it rehydrates the whole section schema, so the other layouts skip it.
  const protocols = useMemo(
    () => layout === 'pi-ai' ? protocolChoices(namespace, schema) : [],
    [layout, namespace, schema],
  )

  useEffect(() => {
    let stale = false
    setKeyState(undefined)
    // The key state is a placeholder hint, not a precondition for editing:
    // neither a business rejection nor a transport failure may reach the
    // browser as an unhandled rejection, so the card simply renders without
    // the "already configured" hint.
    void api.credentials.describe([keyRef]).then(
      (response) => {
        if (stale || !response.ok) return
        setKeyState(response.value[keyRef])
      },
      () => undefined,
    )
    return () => { stale = true }
  }, [api.credentials, keyRef])

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = schema.getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    // A value of nothing but whitespace is cleared, not stored: `stringAt`
    // already reports it as absent, so the field would otherwise render empty
    // while the draft still carried the spaces into `settings.yaml`, where
    // both adapters would accept that non-empty string as a real value.
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined
      ? schema.deletePath(current, [key])
      : schema.setPath(current, [key], value))
  }

  // The model list is validated by the same per-row checker for both families,
  // so a bad row is named by its position rather than by a blanket message.
  const modelFailure = validateDeepSeekModels(schema.getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)
  // What a probe or a write must carry: the typed key with paste whitespace
  // removed. A blank field yields an empty string, which both call sites read
  // as "no key supplied" rather than as a key — that is how a card whose
  // provider already has a stored key is edited without re-entering it.
  const keyValue = keyDraft.trim()
  const credentialRequiredFailure = props.credentialRequired === true
    && keyDraft.length > 0 && keyValue.length === 0
    ? 'keyRequired' as const
    : undefined
  const shownKeyFailure = credentialRequiredFailure ?? keyFailure
  // What the form currently shows, which is what an interrogation must ask:
  // an edited-but-unsaved endpoint, and a key typed but not yet stored.
  const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api')
  const probeBaseURL = stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL')
  const presetProtocols = props.connectionPreset?.protocols ?? []
  const selectedRequestType = props.connectionPreset?.requestTypes.find(candidate => candidate.id === requestType)
    ?? props.connectionPreset?.requestTypes[0]
  const selectedPresetProtocol = presetProtocols.find(candidate => candidate.api === probeApi)
    ?? presetProtocols[0]
  const effectiveApi = probeApi ?? selectedPresetProtocol?.api
  const effectiveBaseURL = probeBaseURL
    ?? selectedPresetProtocol?.baseURL
    ?? (layout === 'deepseek' ? DEEPSEEK_PUBLIC_BASE_URL : undefined)
  const selectedRouteProtocol = selectedRequestType?.protocols?.[0] ?? selectedPresetProtocol
  const routeBaseURL = selectedRequestType?.protocols === undefined
    ? effectiveBaseURL
    : selectedRouteProtocol?.baseURL
  const requestPath = selectedRouteProtocol?.requestPath
    ?? (effectiveApi === 'openai-responses'
      ? '/responses'
      : effectiveApi === 'anthropic-messages' ? '/v1/messages' : '/chat/completions')
  const fullRequestURL = routeBaseURL === undefined ? '' : joinRequestURL(routeBaseURL, requestPath)
  const capabilityRoute = selectedRequestType?.protocols !== undefined
  const probe = {
    settingsNs: namespace.ns,
    // Naming the route lets an adapter that already describes it answer from
    // its own registry — better metadata, no network call, no endpoint needed.
    provider: props.provider,
    ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
    ...probeApi === undefined ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }
  /**
   * The write for this card, or a failure message. Every edit travels as
   * path ops against the STORED section: the draft comes from the redacted
   * descriptor, so a wholesale replace rebuilt from it could delete fields
   * outside the card. Ops name only the fields this card can see.
   */
  const applyOnce = async (): Promise<string | undefined> => {
    const ns = namespace.ns
    // A pi-ai profile names the conventional reference only when this page is
    // about to store a key. Otherwise the provider keeps its native auth path.
    const next = layout === 'pi-ai' && stringAt(draft, 'apiKeyEnv') === undefined
      && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? schema.setPath(draft, ['apiKeyEnv'], keyRef)
      : draft
    if (props.credentialOnly !== true) {
      // The same checker gates the submit button, so a card cannot reach this
      // with a bad row; it stays because the schema check below would refuse
      // the write with a message naming a path instead of the row, and because
      // nothing but this function decides what is written.
      const failure = validateDeepSeekModels(schema.getPath(next, ['models']))
      /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
      if (failure !== undefined) {
        return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`
      }
    }
    /* v8 ignore next -- apply is only reachable from the rendered card, which required a resolved node */
    if (props.credentialOnly !== true && node !== undefined && settingsPath.length === 0) {
      const sectionError = schema.validate(node, next)
      if (sectionError !== undefined) return sectionError
    }
    const materializesNativeProfile = layout === 'pi-ai'
      && fallback === undefined
      && committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = props.credentialOnly === true
      ? []
      : materializesNativeProfile
        ? [{ op: 'set', path: [...settingsPath], value: {} }]
        : pathOps(settingsPath, committedOriginal, next)
    if (ops.length > 0) {
      const response = await api.settings.mutate(ns, ops, expectedRevision)
      if (!response.ok) {
        return response.error.code === 'settings-conflict'
          ? t('conflict')
          : response.error.message
      }
      setCommittedOriginal(schema.getPath(response.value.user, settingsPath))
      setExpectedRevision(response.value.revision)
      setDraft(next)
    }
    if (keyValue.length > 0) {
      const stored = await api.credentials.set(keyRef, keyValue)
      if (!stored.ok) return stored.error.message
    }
    setKeyDraft('')
    return undefined
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const failure = await applyOnce()
      if (failure !== undefined) {
        setFailure(failure)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure (disconnect, a request the host refuses) rejects
      // rather than answering; without this the card would stay busy forever
      // with no error shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  if (node === undefined) {
    // A directory entry addressing a position its schema cannot resolve is a
    // host-side inconsistency; showing it beats a blank card.
    return <p className={styles['error']}>{props.provider}: {props.t('settingsPathUnresolvable')}</p>
  }

  const keyLocked = keyState?.writable === false

  /**
   * The catalog beneath the user layer: what the composition entry pinned, or
   * else the schema default that `resolve` would supply. The effective value
   * cannot answer this — it still carries the stored override until the unset
   * is applied, so reading it would echo that override straight back the
   * moment reset drops it, leaving the rows unchanged until a reload.
   */
  const inheritedModels = (): unknown => {
    const pinned = schema.getPath(namespace.base, [...settingsPath, 'models'])
    return pinned ?? schema.nodeAtPath(root, [...settingsPath, 'models'])?.meta.default
  }

  /**
   * The curated fields of one known adapter family. The family arrives
   * narrowed so the per-family branches below are total: an unknown namespace
   * renders the hint instead and never reaches this body.
   */
  const curatedFields = (family: 'deepseek' | 'pi-ai'): ReactNode => {
    // What a hand-declared route names for itself and nothing else can supply.
    // A whole-section `llm-deepseek` profile is a composition fact with no
    // per-route identity for its schema to carry, hence the family test.
    const ownsIdentity = family === 'pi-ai'
      && props.declared === true
      && props.connectionPreset === undefined
    const customModels = schema.getPath(draft, ['models'])
    const modelsOverridden = schema.hasPath(draft, ['models'])
    const models = modelDrafts(modelsOverridden ? customModels : inheritedModels())
    const defaultContextWindow = schema.getPath(fallback, ['defaultContextWindow'])
    const defaultMaxTokens = schema.getPath(fallback, ['maxTokens'])
    const keyPlaceholder = keyLocked
      ? t('keyEnvLocked')
      : keyState?.configured === true && props.credentialRequired !== true
        ? t('keyStored')
        : family === 'pi-ai' ? t('keyPlaceholderNative') : t('keyPlaceholder')
    const protocolOptions: readonly ProviderProtocolPreset[] = presetProtocols
    const selectProtocol = (api: string): void => {
      const selected = protocolOptions.find(candidate => candidate.api === api)
      if (selected === undefined) {
        setField('api', api.length === 0 ? undefined : api)
        return
      }
      setDraft((current) => {
        if (selected.inherited === true) {
          return schema.deletePath(schema.deletePath(current, ['api']), ['baseURL'])
        }
        return schema.setPath(schema.setPath(current, ['api'], selected.api), ['baseURL'], selected.baseURL)
      })
    }
    /** What both family editors take: the rows, whose layer owns them, and the two writes. */
    const catalogProps = {
      models,
      overridden: modelsOverridden,
      t,
      disabled,
      onChange: (next: Record<string, unknown>[]) => {
        setDraft(current => schema.setPath(current, ['models'], next))
      },
      onReset: () => { setDraft(current => schema.deletePath(current, ['models'])) },
    }
    const routeAndModels = (
      <>
        {ownsIdentity
          ? (
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
              <input
                className={styles['input']}
                type="text"
                value={stringAt(draft, 'displayName') ?? ''}
                placeholder={stringAt(schema.getPath(namespace.base, settingsPath), 'displayName')
                  ?? props.provider}
                aria-label={t('customDisplayName')}
                disabled={disabled}
                onChange={(event) => { setField('displayName', event.target.value) }}
              />
            </div>
          )
          : null}
        <section className={styles['routeSection']}>
          <div className={styles['editorSectionHead']}>
            <span className={styles['editorSectionTitle']}>{t('requestRouteHeading')}</span>
            <span className={styles['editorSectionHint']}>{t('requestRouteHint')}</span>
          </div>
          <div className={styles['routeGrid']}>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('requestType')}</span>
              <select
                className={`${styles['input']} ${styles['selectInput']}`}
                value={selectedRequestType?.id ?? 'chat'}
                aria-label={t('requestType')}
                disabled={disabled || (props.connectionPreset?.requestTypes.length ?? 0) < 2}
                onChange={(event) => { setRequestType(event.target.value as typeof requestType) }}
              >
                {(props.connectionPreset?.requestTypes ?? [{ id: 'chat', labelKey: 'requestTypeChat' as const }])
                  .map(choice => <option key={choice.id} value={choice.id}>{t(choice.labelKey)}</option>)}
              </select>
            </div>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
              <input
                className={styles['input']}
                type="text"
                value={capabilityRoute ? routeBaseURL ?? '' : stringAt(draft, 'baseURL') ?? ''}
                placeholder={family === 'deepseek'
                  ? DEEPSEEK_PUBLIC_BASE_URL
                  : selectedPresetProtocol?.baseURL ?? effectiveBaseURL ?? t('baseUrlDefault')}
                aria-label={t('baseUrl')}
                disabled={disabled || capabilityRoute}
                onChange={(event) => {
                  setField('baseURL', event.target.value === '' ? undefined : event.target.value)
                }}
              />
            </div>
            <div className={`${styles['field']} ${styles['routeFullWidth']}`}>
              <span className={styles['fieldLabel']}>
                {t('fullRequestUrl')}
                <span className={styles['fieldHint']}>{t('readOnlyPreview')}</span>
              </span>
              <input
                className={`${styles['input']} ${styles['endpointPreview']}`}
                type="text"
                value={fullRequestURL}
                aria-label={t('fullRequestUrl')}
                readOnly
              />
            </div>
          </div>
          {selectedRequestType === undefined
            ? null
            : <p className={styles['routeExplanation']}>{t(selectedRequestType.explanationKey)}</p>}
        </section>
        {capabilityRoute
          ? (
            <section className={styles['capabilityCatalog']} aria-label={t('models')}>
              <div className={styles['modelListHead']}>
                <span className={styles['modelCatalogTitle']}>{t('models')}</span>
                <span className={styles['modelCatalogMeta']}>{t(selectedRequestType.labelKey)}</span>
              </div>
              <div className={styles['capabilityModelList']}>
                {(selectedRequestType.models ?? []).map(model => (
                  <div key={model.id} className={styles['capabilityModelRow']}>
                    <span className={styles['capabilityModelName']}>{model.name}</span>
                    <code className={styles['capabilityModelId']}>{model.id}</code>
                  </div>
                ))}
              </div>
            </section>
          )
          : family === 'deepseek'
            ? (
              <DeepSeekModelsEditor
                {...catalogProps}
                defaultContextWindow={typeof defaultContextWindow === 'number'
                  ? defaultContextWindow
                  : undefined}
                defaultMaxTokens={typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined}
              />
            )
            : <ModelListEditor {...catalogProps} probe={probe} probeBlocked={keyFailure} api={api} />}
      </>
    )
    return (
      <>
        <section className={styles['editorSection']}>
          {props.credentialOnly === true
            ? null
            : (
              <div className={styles['editorSectionHead']}>
                <span className={styles['editorSectionTitle']}>{t('connectionHeading')}</span>
                <span className={styles['editorSectionHint']}>{t('connectionHint')}</span>
              </div>
            )}
          <div className={props.credentialOnly === true ? undefined : styles['connectionGrid']}>
            {props.credentialOnly === true
              ? null
              : (
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('customApi')}</span>
                  <select
                    className={`${styles['input']} ${styles['selectInput']}`}
                    value={props.connectionPreset === undefined ? probeApi ?? '' : effectiveApi ?? ''}
                    aria-label={t('customApi')}
                    disabled={disabled || family === 'deepseek'}
                    onChange={(event) => { selectProtocol(event.target.value) }}
                  >
                    {props.connectionPreset === undefined
                      ? <option value="">{t('protocolProviderDefault')}</option>
                      : null}
                    {protocolOptions.length > 0
                      ? protocolOptions.map(choice => (
                        <option key={`${choice.api}:${choice.baseURL}`} value={choice.api}>{t(choice.labelKey)}</option>
                      ))
                      : protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                </div>
              )}
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('keyInput')}</span>
              <input
                className={styles['input']}
                type="password"
                autoComplete="off"
                value={keyDraft}
                placeholder={keyPlaceholder}
                aria-label={t('keyInput')}
                aria-invalid={shownKeyFailure !== undefined}
                required={props.credentialRequired === true}
                autoFocus={props.autoFocusCredential === true}
                disabled={disabled || keyLocked}
                onChange={(event) => { setKeyDraft(event.target.value) }}
              />
              {shownKeyFailure === undefined ? null : <p className={styles['error']}>{t(shownKeyFailure)}</p>}
            </div>
          </div>
        </section>
        {props.credentialOnly === true
          ? null
          : props.connectionPreset === undefined
            ? (
              <details className={styles['customized']}>
                <summary className={styles['customizedSummary']}>{t('customized')}</summary>
                <div className={styles['customizedBody']}>{routeAndModels}</div>
              </details>
            )
            : <div className={styles['presetEditorBody']}>{routeAndModels}</div>}
      </>
    )
  }

  return (
    <div
      className={props.credentialOnly === true ? styles['addBlock'] : styles['editor']}
      {...props.credentialOnly === true ? {} : { 'data-scroll-region': 'provider-editor' }}
    >
      {props.hideTitle === true
        ? null
        : (
          <div className={styles['editorHeader']}>
            <span className={styles['editorTitle']}>{props.displayName}</span>
            {props.provider !== props.displayName
              ? <span className={styles['editorRoute']}>{props.provider}</span>
              : null}
          </div>
        )}
      {layout === 'unknown'
        ? <p className={styles['advancedHint']}>{`${t('advancedHint')} (${namespace.ns})`}</p>
        : curatedFields(layout)}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {props.credentialOnly === true || modelFailure === undefined
        ? null
        : (
          <p className={styles['advancedHint']}>
            {`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}
          </p>
        )}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || layout === 'unknown'
          || (props.credentialOnly !== true && modelFailure !== undefined)
          || shownKeyFailure !== undefined
          || (props.credentialRequired === true && keyValue.length === 0)}
        submitLabelKey={props.submitLabelKey ?? 'apply'}
        submitBusyLabelKey={props.submitBusyLabelKey ?? 'applying'}
        {...props.cancelLabelKey === undefined ? {} : { cancelLabelKey: props.cancelLabelKey }}
        onCancel={() => { props.onClose(false) }}
        onSubmit={() => { void apply() }}
      />
    </div>
  )
}
