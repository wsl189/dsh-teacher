/**
 * Models settings section. Use-case selectors consume live configured model
 * routes; service access groups product presets by supplier while each access
 * plan retains its own settings profile and credential. Other installed and
 * hand-declared providers remain available below the preset workspace. Every
 * mutation writes through the wire and provider removal requires confirmation.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this package's SlotMap merge (the three Models child slots).
import type {} from './slot-contract.ts'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { deriveKeyRef, messageOf, protocolChoices, providerUsable } from './store.ts'
import type { ModelsSettingsStore, ModelsWire, ProviderRow } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import { PRESET_PROVIDER_IDS, PROVIDER_SUPPLIERS } from './provider-presets.ts'
import type { ProviderAccessPreset, ProviderSupplierPreset } from './provider-presets.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: ModelsSettingsStore['store']
  }
  /** Wire faces the editor writes through. */
  api: ModelsWire
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** The child slots this section declares and dispatches (see ./slot-contract.ts). */
type ModelsChildSlots =
  | 'settings.models.specialized-model'
  | 'settings.models.provider-card'
  | 'settings.models.footer'

/** The child-slot dispatch function the renderer binds for the section. */
type ModelsRenderSlot = PropsRenderSlots<ModelsChildSlots>['renderSlot']

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call) plus the child-slot
 * dispatch seat. The seat is required: the renderer binds it at the render
 * call itself — unlike the inject face it is never absent at runtime — and a
 * direct render that forgets it fails to compile instead of mounting nothing.
 */
export type ModelsSectionProps = Partial<InjectFace<ModelsSectionInjected>> & PropsRenderSlots<ModelsChildSlots>

type ModelsSectionFace = InjectFace<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

interface ToolModelSelection {
  provider: string
  model: string
}

type UsageSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UsageModelGroup {
  id: string
  name: string
  models: readonly { id: string; name: string }[]
}

interface UsageModelCardProps {
  id: string
  mark: string
  tone: 'conversation' | 'tool' | 'image' | 'speech'
  title: string
  description: string
  selectCopy: string
  unavailableCopy: string
  groups: readonly UsageModelGroup[]
  selected: string
  selectedAvailable: boolean
  status: UsageSaveStatus
  statusCopy: Partial<Record<Exclude<UsageSaveStatus, 'idle'>, string>>
  disabled: boolean
  onChange: (value: string) => void
}

function toolModelValue(selection: ToolModelSelection): string {
  return JSON.stringify([selection.provider, selection.model])
}

function parseToolModelValue(value: string): ToolModelSelection | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
      ? { provider: parsed[0], model: parsed[1] }
      : undefined
  } catch {
    return undefined
  }
}

function configuredToolModel(value: unknown): ToolModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const settings = value as { provider?: unknown; model?: unknown; toolProvider?: unknown; toolModel?: unknown }
  if (typeof settings.toolProvider === 'string' && typeof settings.toolModel === 'string') {
    return { provider: settings.toolProvider, model: settings.toolModel }
  }
  return typeof settings.provider === 'string' && typeof settings.model === 'string'
    ? { provider: settings.provider, model: settings.model }
    : undefined
}

/** The default conversation route stored by `agent-default-model`. */
function configuredDefaultModel(value: unknown): ToolModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const settings = value as { provider?: unknown; model?: unknown }
  return typeof settings.provider === 'string' && typeof settings.model === 'string'
    ? { provider: settings.provider, model: settings.model }
    : undefined
}

/** One paired provider/model value from the use-case settings section. */
function configuredUseCaseModel(
  value: unknown,
  providerKey: 'imageProvider' | 'speechProvider',
  modelKey: 'imageModel' | 'speechModel',
): ToolModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const settings = value as Record<string, unknown>
  return typeof settings[providerKey] === 'string' && typeof settings[modelKey] === 'string'
    ? { provider: settings[providerKey], model: settings[modelKey] }
    : undefined
}

/** Render one direct model assignment in the unified use-case grid. */
function UsageModelCard(props: UsageModelCardProps): ReactNode {
  const labelId = `settings-${props.id}-model-label`
  const optionCount = props.groups.reduce((count, group) => count + group.models.length, 0)
  const statusCopy = props.status === 'idle' ? undefined : props.statusCopy[props.status]
  return (
    <section className={styles['usageCard']} data-tone={props.tone}>
      <header className={styles['usageCardHead']}>
        <span className={styles['usageMark']} aria-hidden="true">{props.mark}</span>
        <span className={styles['usageIdentity']}>
          <span id={labelId} className={styles['usageTitle']}>{props.title}</span>
          <span className={styles['usageDescription']}>{props.description}</span>
        </span>
      </header>
      <select
        className={`${styles['usageSelect']} ${styles['selectInput']}`}
        aria-labelledby={labelId}
        value={props.selectedAvailable ? props.selected : ''}
        disabled={props.disabled || optionCount === 0}
        onChange={(event) => { props.onChange(event.target.value) }}
      >
        {optionCount === 0 ? <option value="">{props.unavailableCopy}</option> : null}
        {optionCount > 0 && !props.selectedAvailable ? <option value="">{props.selectCopy}</option> : null}
        {props.groups.map(group => (
          <optgroup key={group.id} label={group.name}>
            {group.models.map(model => (
              <option key={model.id} value={toolModelValue({ provider: group.id, model: model.id })}>
                {model.name === model.id ? model.id : `${model.name} (${model.id})`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {statusCopy === undefined
        ? null
        : (
          <p
            className={`${styles['usageStatus']} ${props.status === 'error' ? styles['usageStatusError'] : ''}`}
            role={props.status === 'error' ? 'alert' : 'status'}
          >
            {statusCopy}
          </p>
        )}
    </section>
  )
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'schema' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
  connectionPreset?: ProviderAccessPreset
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, connectionPreset, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true || connectionPreset?.declared === true ? { declared: true } : {}}
      {...connectionPreset === undefined ? {} : { connectionPreset }}
      {...props}
    />
  )
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<ModelsWire, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset(target.credentialRef)
      if (!credential.ok) return credential.error.message
    }
    const response = await api.settings.mutate(
      target.settingsNs,
      [{ op: 'unset', path: [...target.settingsPath] }],
      undefined,
    )
    if (!response.ok) return response.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

/**
 * The provider-card seat's credential fact: the reference this page would use
 * for the row — the profile's `apiKeyEnv`, or the page's derived
 * `<ROUTE>_API_KEY` while the profile names none — confirmed configured. The
 * derived half is what keeps the seat consistent with the editor on the
 * add-provider draft, whose dormant row names no reference yet.
 */
function keyConfiguredOf(row: ProviderRow): boolean {
  return row.apiKeyEnv !== undefined
    ? row.credential?.configured === true
    : row.derivedCredential?.configured === true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Only declared routes may expose route-owned fields.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Address one product preset whether or not its route has been configured yet. */
function presetTargetOf(
  access: ProviderAccessPreset,
  row: ProviderRow | undefined,
  displayName: string,
): EditorTarget {
  const stored = row === undefined ? undefined : targetOf(row)
  return {
    provider: access.provider,
    displayName: stored?.displayName ?? displayName,
    settingsNs: access.settingsNs,
    settingsPath: access.settingsPath,
    ...stored?.credentialRef === undefined ? {} : { credentialRef: stored.credentialRef },
    ...access.declared === true || row?.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, schema, t, renderSlot } = props
  if (
    controller === undefined || useSnapshot === undefined || api === undefined
    || schema === undefined || t === undefined
  ) return null
  return <Loaded injected={{ controller, useSnapshot, api, schema, t }} renderSlot={renderSlot} />
}

function Loaded({ injected, renderSlot }: { injected: ModelsSectionFace; renderSlot: ModelsRenderSlot }): ReactNode {
  const { controller, api, schema, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [activePanel, setActivePanel] = useState<'usage' | 'access'>('access')
  const [selectedSupplierId, setSelectedSupplierId] = useState<ProviderSupplierPreset['id']>('deepseek')
  const [selectedAccessProvider, setSelectedAccessProvider] = useState('deepseek-official')
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())
  const [toolModelStatus, setToolModelStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [toolModelFailure, setToolModelFailure] = useState<string | undefined>(undefined)
  const [defaultModelStatus, setDefaultModelStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [defaultModelFailure, setDefaultModelFailure] = useState<string | undefined>(undefined)
  const [imageModelStatus, setImageModelStatus] = useState<UsageSaveStatus>('idle')
  const [imageModelFailure, setImageModelFailure] = useState<string | undefined>(undefined)
  const [speechModelStatus, setSpeechModelStatus] = useState<UsageSaveStatus>('idle')
  const [speechModelFailure, setSpeechModelFailure] = useState<string | undefined>(undefined)

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(false)
    setDeclaring(false)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter(row => row.configured)
  const presetRows = new Map(state.rows
    .filter(row => PRESET_PROVIDER_IDS.has(row.entry.provider))
    .map(row => [row.entry.provider, row] as const))
  const selectedSupplier = PROVIDER_SUPPLIERS.find(supplier => supplier.id === selectedSupplierId)
    ?? PROVIDER_SUPPLIERS[0]
  const selectedAccess = selectedSupplier.access.find(access => access.provider === selectedAccessProvider)
    ?? selectedSupplier.access[0]
  const selectedPresetRow = presetRows.get(selectedAccess.provider)
  const selectedAccessConfigured = selectedPresetRow?.configured === true
  const selectedAccessUsable = selectedPresetRow !== undefined && providerUsable(selectedPresetRow)
  const selectedTarget = presetTargetOf(
    selectedAccess,
    selectedPresetRow,
    `${t(selectedSupplier.nameKey)} · ${t(selectedAccess.labelKey)}`,
  )
  const selectedNamespace = state.namespaces.get(selectedAccess.settingsNs)
  const selectedAccessOpen = !adding && editing?.provider === selectedAccess.provider
  const selectedAccessSetup = selectedPresetRow !== undefined && selectedAccessConfigured
    && needsSetup(selectedPresetRow, anyUsable) && !dismissedSetup.has(selectedAccess.provider)
  const selectedEditorVisible = selectedAccessOpen || selectedAccessSetup
  const selectedCredentialConfigured = selectedPresetRow?.credential?.configured === true
  const selectedCredentialMissing = selectedPresetRow !== undefined && !selectedCredentialConfigured
    && selectedPresetRow.apiKeyEnv !== undefined && selectedPresetRow.credential?.configured === false
  const otherConfigured = configured.filter(row => !PRESET_PROVIDER_IDS.has(row.entry.provider))
  const addable = state.rows.filter(row => (
    !row.configured && row.entry.settingsNs !== '' && !PRESET_PROVIDER_IDS.has(row.entry.provider)
  ))
  const addTarget = adding ? editing : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
  // The draft's directory row, for the card extension seat. A refresh can drop
  // the row mid-draft (the route was adopted or withdrawn elsewhere); the
  // draft card stays while the seat simply has no row to dispatch.
  const addRow = addTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === addTarget.provider)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'), schema)
  const defaultModelNamespace = state.namespaces.get('agent-default-model')
  const defaultModel = configuredDefaultModel(defaultModelNamespace?.value)
  const toolModel = configuredToolModel(defaultModelNamespace?.value)
  const imageModel = configuredUseCaseModel(defaultModelNamespace?.value, 'imageProvider', 'imageModel')
  const speechModel = configuredUseCaseModel(defaultModelNamespace?.value, 'speechProvider', 'speechModel')
  const configuredModelGroups = state.modelGroups.filter(group => state.rows.some(row => (
    row.entry.provider === group.id && providerUsable(row)
  )))
  const availableToolModels = configuredModelGroups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    providerName: group.name,
    model: model.id,
    modelName: model.name,
  })))
  const capabilityGroups = (capability: 'image' | 'speech'): UsageModelGroup[] =>
    PROVIDER_SUPPLIERS.flatMap(supplier => supplier.access.flatMap((access) => {
      const row = presetRows.get(access.provider)
      if (row === undefined || !providerUsable(row)) return []
      const route = access.requestTypes.find(candidate => candidate.id === capability)
      if (route?.models === undefined || route.models.length === 0) return []
      return [{
        id: access.provider,
        name: `${t(supplier.nameKey)} · ${t(access.labelKey)}`,
        models: route.models,
      }]
    }))
  const imageModelGroups = capabilityGroups('image')
  const speechModelGroups = capabilityGroups('speech')
  const mediaModelAvailable = (groups: readonly UsageModelGroup[], selection: ToolModelSelection | undefined): boolean =>
    selection !== undefined && groups.some(group => group.id === selection.provider
      && group.models.some(model => model.id === selection.model))
  const selectedToolModel = toolModel === undefined ? '' : toolModelValue(toolModel)
  const selectedToolModelAvailable = availableToolModels.some(item => toolModelValue(item) === selectedToolModel)
  const selectedDefaultModel = defaultModel === undefined ? '' : toolModelValue(defaultModel)
  const selectedDefaultModelAvailable = availableToolModels.some(item => toolModelValue(item) === selectedDefaultModel)
  const selectedImageModel = imageModel === undefined ? '' : toolModelValue(imageModel)
  const selectedImageModelAvailable = mediaModelAvailable(imageModelGroups, imageModel)
  const selectedSpeechModel = speechModel === undefined ? '' : toolModelValue(speechModel)
  const selectedSpeechModelAvailable = mediaModelAvailable(speechModelGroups, speechModel)
  const saveDefaultModel = (value: string): void => {
    const selection = parseToolModelValue(value)
    if (selection === undefined || defaultModelNamespace === undefined) return
    setDefaultModelStatus('saving')
    setDefaultModelFailure(undefined)
    void api.settings.mutate(
      'agent-default-model',
      [
        { op: 'set', path: ['provider'], value: selection.provider },
        { op: 'set', path: ['model'], value: selection.model },
        { op: 'unset', path: ['reasoningEffort'] },
      ],
      defaultModelNamespace.revision,
    ).then(async (response) => {
      if (!response.ok) throw new Error(response.error.message)
      await controller.load()
      setDefaultModelStatus('saved')
    }).catch((error: unknown) => {
      setDefaultModelFailure(messageOf(error))
      setDefaultModelStatus('error')
    })
  }
  const saveToolModel = (value: string): void => {
    const selection = parseToolModelValue(value)
    if (selection === undefined || defaultModelNamespace === undefined) return
    setToolModelStatus('saving')
    setToolModelFailure(undefined)
    void api.settings.mutate(
      'agent-default-model',
      [
        { op: 'set', path: ['toolProvider'], value: selection.provider },
        { op: 'set', path: ['toolModel'], value: selection.model },
      ],
      defaultModelNamespace.revision,
    ).then(async (response) => {
      if (!response.ok) throw new Error(response.error.message)
      await controller.load()
      setToolModelStatus('saved')
    }).catch((error: unknown) => {
      setToolModelFailure(messageOf(error))
      setToolModelStatus('error')
    })
  }
  const saveCapabilityModel = (
    value: string,
    keys: readonly ['imageProvider', 'imageModel'] | readonly ['speechProvider', 'speechModel'],
    setStatus: (status: UsageSaveStatus) => void,
    setFailure: (failure: string | undefined) => void,
  ): void => {
    const selection = parseToolModelValue(value)
    if (selection === undefined || defaultModelNamespace === undefined) return
    setStatus('saving')
    setFailure(undefined)
    void api.settings.mutate(
      'agent-default-model',
      [
        { op: 'set', path: [keys[0]], value: selection.provider },
        { op: 'set', path: [keys[1]], value: selection.model },
      ],
      defaultModelNamespace.revision,
    ).then(async (response) => {
      if (!response.ok) throw new Error(response.error.message)
      await controller.load()
      setStatus('saved')
    }).catch((error: unknown) => {
      setFailure(messageOf(error))
      setStatus('error')
    })
  }
  const usageSaving = defaultModelStatus === 'saving' || toolModelStatus === 'saving'
    || imageModelStatus === 'saving' || speechModelStatus === 'saving'

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      <div className={styles['panelTabs']} role="tablist" aria-label={t('title')}>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'usage'}
          className={activePanel === 'usage' ? styles['panelTabActive'] : styles['panelTab']}
          onClick={() => { setActivePanel('usage') }}
        >
          {t('usageTab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'access'}
          className={activePanel === 'access' ? styles['panelTabActive'] : styles['panelTab']}
          onClick={() => { setActivePanel('access') }}
        >
          {t('serviceAccessTab')}
        </button>
      </div>
      <div className={styles['panelBody']} hidden={activePanel !== 'usage'}>
        <p className={styles['panelIntro']}>{t('usageIntro')}</p>
        <div className={styles['usageGrid']}>
          <UsageModelCard
            id="default-conversation"
            mark="◇"
            tone="conversation"
            title={t('defaultModelTitle')}
            description={t('defaultModelDescription')}
            selectCopy={t('defaultModelSelect')}
            unavailableCopy={state.modelCatalogError === null ? t('toolModelUnavailable') : t('toolModelCatalogFailed')}
            groups={configuredModelGroups}
            selected={selectedDefaultModel}
            selectedAvailable={selectedDefaultModelAvailable}
            status={defaultModelStatus}
            statusCopy={{
              saving: t('defaultModelSaving'),
              saved: t('defaultModelSaved'),
              error: `${t('defaultModelSaveFailed')}: ${defaultModelFailure ?? ''}`,
            }}
            disabled={!state.writable || usageSaving || defaultModelNamespace === undefined}
            onChange={saveDefaultModel}
          />
          <UsageModelCard
            id="tool"
            mark="⌁"
            tone="tool"
            title={t('toolModelTitle')}
            description={t('toolModelDescription')}
            selectCopy={t('toolModelSelect')}
            unavailableCopy={state.modelCatalogError === null ? t('toolModelUnavailable') : t('toolModelCatalogFailed')}
            groups={configuredModelGroups}
            selected={selectedToolModel}
            selectedAvailable={selectedToolModelAvailable}
            status={toolModelStatus}
            statusCopy={{
              saving: t('toolModelSaving'),
              saved: t('toolModelSaved'),
              error: `${t('toolModelSaveFailed')}: ${toolModelFailure ?? ''}`,
            }}
            disabled={!state.writable || usageSaving || defaultModelNamespace === undefined}
            onChange={saveToolModel}
          />
          <UsageModelCard
            id="image-generation"
            mark="▧"
            tone="image"
            title={t('imageModelTitle')}
            description={t('imageModelDescription')}
            selectCopy={t('imageModelSelect')}
            unavailableCopy={t('imageModelUnavailable')}
            groups={imageModelGroups}
            selected={selectedImageModel}
            selectedAvailable={selectedImageModelAvailable}
            status={imageModelStatus}
            statusCopy={{
              saving: t('imageModelSaving'),
              saved: t('imageModelSaved'),
              error: `${t('imageModelSaveFailed')}: ${imageModelFailure ?? ''}`,
            }}
            disabled={!state.writable || usageSaving || defaultModelNamespace === undefined}
            onChange={(value) => {
              saveCapabilityModel(
                value,
                ['imageProvider', 'imageModel'],
                setImageModelStatus,
                setImageModelFailure,
              )
            }}
          />
          <UsageModelCard
            id="speech-recognition"
            mark="◉"
            tone="speech"
            title={t('speechModelTitle')}
            description={t('speechModelDescription')}
            selectCopy={t('speechModelSelect')}
            unavailableCopy={t('speechModelUnavailable')}
            groups={speechModelGroups}
            selected={selectedSpeechModel}
            selectedAvailable={selectedSpeechModelAvailable}
            status={speechModelStatus}
            statusCopy={{
              saving: t('speechModelSaving'),
              saved: t('speechModelSaved'),
              error: `${t('speechModelSaveFailed')}: ${speechModelFailure ?? ''}`,
            }}
            disabled={!state.writable || usageSaving || defaultModelNamespace === undefined}
            onChange={(value) => {
              saveCapabilityModel(
                value,
                ['speechProvider', 'speechModel'],
                setSpeechModelStatus,
                setSpeechModelFailure,
              )
            }}
          />
        </div>
      </div>
      <div className={styles['panelBody']} hidden={activePanel !== 'access'}>
        <p className={styles['panelIntro']}>{t('serviceAccessIntro')}</p>
        {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
        {savedIdentity === undefined
          ? null
          : (
            <p className={styles['savedNotice']} role="status" aria-live="polite">
              {providerCopy(t('savedProvider'), savedIdentity)}
            </p>
          )}
        <section className={styles['presetDirectory']} aria-label={t('providerPresetsTitle')}>
          <div className={styles['accessWorkspace']}>
            <aside className={styles['supplierRail']} aria-label={t('supplierListLabel')}>
              <span className={styles['supplierRailTitle']}>{t('supplierListLabel')}</span>
              <div className={styles['supplierList']}>
                {PROVIDER_SUPPLIERS.map((supplier: ProviderSupplierPreset) => {
                  const usableCount = supplier.access.filter((access) => {
                    const row = presetRows.get(access.provider)
                    return row !== undefined && providerUsable(row)
                  }).length
                  const selected = supplier.id === selectedSupplier.id
                  return (
                    <button
                      key={supplier.id}
                      type="button"
                      aria-pressed={selected}
                      className={selected ? styles['supplierButtonActive'] : styles['supplierButton']}
                      onClick={() => {
                        setSelectedSupplierId(supplier.id)
                        setSelectedAccessProvider(supplier.access[0].provider)
                        setSavedTarget(undefined)
                        setEditing(undefined)
                        setAdding(false)
                        setDeclaring(false)
                      }}
                    >
                      <span className={styles['supplierMark']} aria-hidden="true">{supplier.shortLabel}</span>
                      <span className={styles['supplierIdentity']}>
                        <span className={styles['supplierName']}>{t(supplier.nameKey)}</span>
                        <span className={styles['supplierSummary']}>{t(supplier.summaryKey)}</span>
                      </span>
                      <span
                        className={usableCount > 0 ? styles['supplierConfiguredDot'] : styles['supplierEmptyDot']}
                        aria-hidden="true"
                      />
                    </button>
                  )
                })}
              </div>
            </aside>
            <article className={styles['supplierWorkspace']}>
              <header className={styles['supplierHead']}>
                <span className={styles['supplierMark']} aria-hidden="true">{selectedSupplier.shortLabel}</span>
                <span className={styles['supplierIdentity']}>
                  <span className={styles['supplierName']}>{t(selectedSupplier.nameKey)}</span>
                  <span className={styles['supplierSummary']}>{t(selectedSupplier.summaryKey)}</span>
                </span>
                <span className={styles['officialTag']}>{t('officialPreset')}</span>
              </header>
              <ul className={styles['accessList']}>
                <li className={styles['accessCard']}>
                  <div className={styles['accessChooser']}>
                    <label className={styles['field']}>
                      <span className={styles['fieldLabel']}>{t('accessMethod')}</span>
                      <select
                        className={`${styles['input']} ${styles['selectInput']}`}
                        aria-label={t('accessMethod')}
                        value={selectedAccess.provider}
                        onChange={(event) => {
                          setSelectedAccessProvider(event.target.value)
                          setSavedTarget(undefined)
                          setEditing(undefined)
                          setAdding(false)
                          setDeclaring(false)
                        }}
                      >
                        {selectedSupplier.access.map(access => (
                          <option key={access.provider} value={access.provider}>{t(access.labelKey)}</option>
                        ))}
                      </select>
                    </label>
                    <div className={styles['accessHead']}>
                      <span className={styles['accessIdentity']}>
                        <span className={styles['hiddenLabel']}>{t(selectedSupplier.nameKey)}</span>
                        <span className={selectedAccessUsable ? styles['accessConfigured'] : styles['accessMissing']}>
                          {selectedAccessUsable ? t('accessReady') : t('accessNeedsSetup')}
                        </span>
                        {selectedAccessSetup
                          ? null
                          : selectedCredentialConfigured
                            ? (
                              <span
                                className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                                role="img"
                                aria-label={t('credentialConfigured')}
                                title={t('credentialConfigured')}
                              />
                            )
                            : selectedCredentialMissing
                              ? (
                                <span
                                  className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                                  role="img"
                                  aria-label={t('credentialMissing')}
                                  title={t('credentialMissing')}
                                />
                              )
                              : null}
                      </span>
                      <span className={styles['rowActions']}>
                        <button
                          type="button"
                          className={styles['secondaryButton']}
                          aria-label={providerCopy(
                            selectedAccessUsable ? t('editProvider') : t('configureAccess'),
                            selectedTarget,
                          )}
                          disabled={selectedNamespace === undefined || !state.writable}
                          onClick={() => {
                            setSavedTarget(undefined)
                            setDeclaring(false)
                            setAdding(false)
                            setEditing(selectedAccessOpen ? undefined : selectedTarget)
                          }}
                        >
                          {selectedAccessUsable ? t('edit') : t('configure')}
                        </button>
                        {selectedPresetRow?.removable === true
                          ? (
                            <button
                              type="button"
                              className={styles['dangerButton']}
                              aria-label={providerCopy(t('removeProvider'), selectedTarget)}
                              disabled={!state.writable}
                              onClick={() => {
                                setSavedTarget(undefined)
                                setDeleteFailure(undefined)
                                setDeleteTarget(selectedTarget)
                              }}
                            >
                              {t('remove')}
                            </button>
                          )
                          : null}
                      </span>
                    </div>
                  </div>
                  {selectedAccess.noticeKey === undefined || !selectedEditorVisible
                    ? null
                    : <p className={styles['planNotice']}>{t(selectedAccess.noticeKey)}</p>}
                  {selectedPresetRow === undefined || (!selectedAccessConfigured && !selectedEditorVisible)
                    ? null
                    : renderSlot(
                      'settings.models.provider-card',
                      {
                        provider: selectedPresetRow.entry,
                        configured: selectedPresetRow.configured,
                        keyConfigured: keyConfiguredOf(selectedPresetRow),
                      },
                      { entryKey: selectedPresetRow.entry.settingsNs },
                    )}
                  {selectedEditorVisible && selectedNamespace !== undefined
                    ? renderProviderEditor({
                      target: selectedTarget,
                      connectionPreset: selectedAccess,
                      namespace: selectedNamespace,
                      schema,
                      api,
                      t,
                      readOnly: !state.writable,
                      onClose: (changed) => {
                        if (selectedAccessSetup) {
                          if (selectedAccessOpen) setEditing(undefined)
                          closeSetup(changed, selectedTarget)
                        } else closeEditor(changed, selectedTarget)
                      },
                    })
                    : null}
                </li>
              </ul>
            </article>
          </div>
        </section>
        {otherConfigured.length === 0 ? null : (
          <h3 className={styles['otherProvidersTitle']}>{t('otherProvidersTitle')}</h3>
        )}
        <ul className={styles['rows']}>
          {otherConfigured.map((row) => {
            const target = targetOf(row)
            const namespace = state.namespaces.get(target.settingsNs)
            /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
            if (namespace === undefined) return null
            if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
              return (
                <li key={row.entry.provider} className={styles['setupCard']}>
                  {renderProviderEditor({
                    target,
                    namespace,
                    schema,
                    api,
                    t,
                    readOnly: !state.writable,
                    onClose: (changed) => { closeSetup(changed, target) },
                  })}
                  {renderSlot(
                    'settings.models.provider-card',
                    { provider: row.entry, configured: row.configured, keyConfigured: keyConfiguredOf(row) },
                    { entryKey: row.entry.settingsNs },
                  )}
                </li>
              )
            }
            const open = !adding && editing?.provider === row.entry.provider
            const credentialConfigured = row.credential?.configured === true
            const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
            return (
              <li key={row.entry.provider} className={styles['rowCard']}>
                <div className={styles['rowHead']}>
                  <span className={styles['rowIdentity']}>
                    <span className={styles['rowName']}>{row.entry.displayName}</span>
                    {/* Only the adapter can tell a hand-declared route from a
                      shipped one it also has a stored profile for, so the tag
                      follows its answer and stays off when it gives none. */}
                    {row.entry.declared === true
                      ? <span className={styles['rowTag']}>{t('customTag')}</span>
                      : null}
                    {credentialConfigured
                      ? (
                        <span
                          className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                          role="img"
                          aria-label={t('credentialConfigured')}
                          title={t('credentialConfigured')}
                        />
                      )
                      : credentialMissing
                        ? (
                          <span
                            className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                            role="img"
                            aria-label={t('credentialMissing')}
                            title={t('credentialMissing')}
                          />
                        )
                        : null}
                  </span>
                  <span className={styles['rowActions']}>
                    <button
                      type="button"
                      className={styles['secondaryButton']}
                      aria-label={providerCopy(t('editProvider'), target)}
                      onClick={() => {
                        setSavedTarget(undefined)
                        // One card at a time: leaving `declaring` set would show
                        // the create card beside this editor, and closing either
                        // one discards the other's draft.
                        setDeclaring(false)
                        setAdding(false)
                        setEditing(open ? undefined : target)
                      }}
                    >
                      {t('edit')}
                    </button>
                    {row.removable
                      ? (
                        <button
                          type="button"
                          className={styles['dangerButton']}
                          aria-label={providerCopy(t('removeProvider'), target)}
                          disabled={!state.writable}
                          onClick={() => {
                            setSavedTarget(undefined)
                            setDeleteFailure(undefined)
                            setDeleteTarget(target)
                          }}
                        >
                          {t('remove')}
                        </button>
                      )
                      : null}
                  </span>
                </div>
                {renderSlot(
                  'settings.models.provider-card',
                  { provider: row.entry, configured: row.configured, keyConfigured: keyConfiguredOf(row) },
                  { entryKey: row.entry.settingsNs },
                )}
                {open
                  ? renderProviderEditor({
                    target,
                    namespace,
                    schema,
                    api,
                    t,
                    readOnly: !state.writable,
                    onClose: (changed) => { closeEditor(changed, target) },
                  })
                  : null}
              </li>
            )
          })}
        </ul>
        <div className={styles['addBlock']}>
          {addTarget !== undefined && addNamespace !== undefined
            ? (
              <div className={styles['addCard']}>
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('provider')}</span>
                  <select
                    className={`${styles['input']} ${styles['selectInput']}`}
                    value={addTarget.provider}
                    aria-label={t('provider')}
                    onChange={(event) => {
                      const row = addable.find(candidate => candidate.entry.provider === event.target.value)
                      /* v8 ignore next -- the select only lists addable rows */
                      if (row === undefined) return
                      setEditing(targetOf(row))
                    }}
                  >
                    {addable.map(row => (
                      <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>
                    ))}
                  </select>
                </div>
                <ProviderEditor
                  key={addTarget.provider}
                  provider={addTarget.provider}
                  displayName={addTarget.displayName}
                  hideTitle
                  namespace={addNamespace}
                  schema={schema}
                  settingsPath={addTarget.settingsPath}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => { closeEditor(changed, addTarget) }}
                />
                {addRow === undefined
                  ? null
                  : renderSlot(
                    'settings.models.provider-card',
                    { provider: addRow.entry, configured: addRow.configured, keyConfigured: keyConfiguredOf(addRow) },
                    { entryKey: addRow.entry.settingsNs },
                  )}
              </div>
            )
            : declaring
              ? (
                <div className={styles['addCard']}>
                  <CustomProviderCard
                    taken={[...state.rows.map(row => row.entry.provider), ...PRESET_PROVIDER_IDS]}
                    protocols={protocols}
                    /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                    revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                    api={api}
                    t={t}
                    readOnly={!state.writable}
                    onClose={(changed) => {
                      setDeclaring(false)
                      if (changed) void controller.load()
                    }}
                  />
                </div>
              )
              : (
              // One row for the two ways to gain a provider: adopt one the
              // adapter already knows, or declare one it does not. Side by side
              // and equal-width so they read as siblings and line up with the
              // rows above, rather than two pills of different lengths.
                <div className={styles['addActions']}>
                  <button
                    type="button"
                    className={styles['addButton']}
                    disabled={addable.length === 0 || !state.writable}
                    onClick={() => {
                      const first = addable[0]
                      /* v8 ignore next -- the button is disabled while nothing is addable */
                      if (first === undefined) return
                      setSavedTarget(undefined)
                      setDeclaring(false)
                      setAdding(true)
                      setEditing(targetOf(first))
                    }}
                  >
                    <IconPlusOutline16 size={14} />
                    {t('add')}
                  </button>
                  <button
                    type="button"
                    className={styles['addButton']}
                    disabled={protocols.length === 0 || !state.writable}
                    onClick={() => {
                      setSavedTarget(undefined)
                      setAdding(false)
                      setEditing(undefined)
                      setDeclaring(true)
                    }}
                  >
                    <IconPlusOutline16 size={14} />
                    {t('customAdd')}
                  </button>
                </div>
              )}
        </div>
        <div className={styles['specializedAccess']}>
          {renderSlot('settings.models.specialized-model', {})}
        </div>
        {renderSlot('settings.models.footer', {})}
      </div>
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
