/**
 * Custom provider editor for the four Models settings types. Conversation and
 * vision routes write an LLM profile; speech-recognition and image-generation
 * routes write an exact endpoint and model directory to model-service settings.
 * Credentials remain write-only and are stored through the credential service.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { JsonValue } from '@deepseek-ai/dsh-api-remotes/client'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { validateDeepSeekModels } from './DeepSeekModelsEditor.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import type { ModelDraft } from './ModelListEditor.tsx'
import {
  ServiceModelListEditor,
  serviceModelSettingsValue,
  serviceModelsFailure,
} from './ServiceModelListEditor.tsx'
import { deriveKeyRef, messageOf } from './store.ts'
import type { ModelServiceModelView, ModelServiceProviderView, ModelServiceType } from './store.ts'
import type { ModelsWire } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace a hand-declared provider is written into. */
const NS = 'llm-pi-ai'
const SERVICE_NS = 'model-service-settings'

type CustomModelType = ModelServiceType

const MODEL_TYPES: readonly CustomModelType[] = ['chat', 'vision', 'speech', 'image']

function requestPath(protocol: string): string {
  return protocol === 'openai-responses'
    ? '/responses'
    : protocol === 'anthropic-messages' ? '/v1/messages' : '/chat/completions'
}

function baseURLFromCompleteRequest(value: string, path: string): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return undefined
  const suffix = `/${path.replace(/^\/+/, '')}`
  if (!url.pathname.endsWith(suffix)) return undefined
  return `${url.origin}${url.pathname.slice(0, -suffix.length).replace(/\/+$/u, '')}`
}

function validMediaEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
}

/**
 * A route id usable as a settings key AND as the stem of a credential name.
 * The leading letter is the second half of that: `deriveKeyRef` uppercases the
 * id and replaces every non-alphanumeric run with `_`, and a credential
 * reference is a POSIX shell identifier, which cannot start with a digit. A
 * digit-leading id passes every check this card makes and then fails at the
 * credential seam with a raw regular expression the user cannot act on.
 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Props of {@link CustomProviderCard}. */
export interface CustomProviderCardProps {
  /** Existing media-only provider edited by this card; absence creates a new provider. */
  existing?: ModelServiceProviderView
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Wire protocols the adapter can serve, in the order it reports them. */
  protocols: readonly string[]
  /**
   * Revision of the `llm-pi-ai` user section this card opened at, sent with
   * the create so a route another tab declared meanwhile is a refusal rather
   * than a silent overwrite of its whole profile.
   */
  revision: number
  /** Revision of the typed-route namespace used by media-only providers. */
  serviceRevision: number
  /** Wire faces for the write and for interrogating the endpoint. */
  api: ModelsWire
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render the custom-provider creation card.
 * @param props - existing routes, protocol choices, wire faces, and copy.
 * @returns the creation card.
 */
export function CustomProviderCard(props: CustomProviderCardProps): ReactNode {
  const { taken, protocols, api, t } = props
  const initialType = props.existing?.routes.speech !== undefined
    ? 'speech'
    : props.existing?.routes.image !== undefined ? 'image' : 'chat'
  const initialRoute = props.existing?.routes[initialType]
  // The write is checked against the revision on which this draft was opened.
  const [openedAt] = useState(() => props.revision)
  const [serviceOpenedAt] = useState(() => props.serviceRevision)
  const [route, setRoute] = useState(props.existing?.provider ?? '')
  const [displayName, setDisplayName] = useState(props.existing?.displayName ?? '')
  const [modelType, setModelType] = useState<CustomModelType>(initialType)
  const [fullRequestURL, setFullRequestURL] = useState(initialRoute?.endpoint ?? '')
  const [protocol, setProtocol] = useState(protocols[0] ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<readonly ModelDraft[]>([])
  const [serviceModels, setServiceModels] = useState<readonly ModelServiceModelView[]>(initialRoute?.models ?? [])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /**
   * The profile write landed. Only the key write can still be outstanding, so
   * the fields that describe the provider are settled and the retry path is
   * the credential alone.
   */
  const [committed, setCommitted] = useState(false)
  const [serviceCommitted, setServiceCommitted] = useState(false)
  const disabled = props.readOnly || busy
  /** Everything but the key stops being editable once the provider exists. */
  const profileDisabled = disabled || committed || serviceCommitted

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = props.existing === undefined && taken.includes(route)
  // Rows are checked by the same per-row validator the editor cards use, so a
  // bad row is named by its position here too. Capacities have route-level
  // fallbacks; what a route cannot default is at least one model.
  const mediaType = modelType === 'speech' || modelType === 'image'
  const modelFailure = mediaType ? undefined : validateDeepSeekModels(models)
  const mediaModelFailure = mediaType ? serviceModelsFailure(serviceModels) : undefined
  const keyFailure = apiKeyFailure(keyDraft)
  // The typed key with paste whitespace removed. A blank field yields an empty
  // string, which the create path reads as "no key supplied" — a route may
  // legitimately authenticate through the provider's own ambient discovery.
  const keyValue = keyDraft.trim()
  const endpointValid = mediaType
    ? validMediaEndpoint(fullRequestURL)
    : baseURLFromCompleteRequest(fullRequestURL, requestPath(protocol)) !== undefined
  const probeBaseURL = mediaType
    ? undefined
    : baseURLFromCompleteRequest(fullRequestURL, requestPath(protocol))
  const ready = route.length > 0 && !routeInvalid && !routeTaken && endpointValid
    && (mediaType ? serviceModels.length > 0 && mediaModelFailure === undefined : models.length > 0 && modelFailure === undefined)
    && keyFailure === undefined
  // The one blocked gate worth a line under the form. A satisfied card says
  // nothing at all rather than printing an empty paragraph.
  const hint = failure !== undefined || ready
    // The key field prints its own failure directly beneath itself, so a card
    // blocked only by the key stays silent here rather than answering with the
    // next unmet gate — which is satisfied, and reads as a second, false fault.
    || keyFailure !== undefined
    // Same for the route id, and it must be tested rather than assumed: the
    // fallback arm below reads "no models yet", so an unmet route gate would
    // fall through to it and contradict the filled-in list right above.
    || route.length === 0 || routeInvalid || routeTaken
    ? undefined
    : fullRequestURL.length === 0 || !endpointValid
      ? t('fullRequestUrlInvalid')
      : modelFailure !== undefined
        ? `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
        : mediaModelFailure !== undefined
          ? `${t('model')} ${String(mediaModelFailure.index + 1)}: ${t(mediaModelFailure.key)}`
          : t('customNeedsModels')

  /** Perform the create, returning a failure message or undefined. */
  const createOnce = async (): Promise<string | undefined> => {
    const keyRef = deriveKeyRef(route)
    const storesKey = keyValue.length > 0
    if (!mediaType && !committed) {
      const baseURL = baseURLFromCompleteRequest(fullRequestURL, requestPath(protocol))
      /* v8 ignore next -- the ready gate requires the same parse to succeed */
      if (baseURL === undefined) return t('fullRequestUrlInvalid')
      const profile = {
        ...displayName.length === 0 ? {} : { displayName },
        // The profile names the conventional reference only when this card is
        // about to store a key, matching the editor: a route declared with the
        // key left blank keeps its provider-native auth path (a credential
        // chain, ADC) instead of resolving a reference nothing ever sets.
        ...storesKey ? { apiKeyEnv: keyRef } : {},
        api: protocol,
        baseURL,
        models: models.map(model => ({
          ...model,
          input: modelType === 'vision' ? ['text', 'image'] : ['text'],
        })),
      }
      // `taken` is a snapshot too, so the id check alone cannot see a route
      // declared after this card opened; the revision makes that race a
      // `settings-conflict` instead of a write over the other profile.
      const response = await api.settings.mutate(
        NS,
        [{ op: 'set', path: ['providers', route], value: profile as JsonValue }],
        openedAt,
      )
      if (!response.ok) return response.error.message
      // The provider now exists. A retry after the key write below fails must
      // not re-run this mutate: the revision it holds is the one this write
      // just superseded, so the Host would answer `settings-conflict` and the
      // key could never be stored from this card at all.
      setCommitted(true)
    }
    if (mediaType && !serviceCommitted) {
      const serviceProfile = {
        ...displayName.length === 0 ? {} : { displayName },
        apiKeyEnv: keyRef,
        routes: {
          [modelType]: {
            endpoint: fullRequestURL.trim(),
            protocol: modelType === 'speech' ? 'openai-audio-transcriptions' : 'openai-images',
            models: serviceModelSettingsValue(serviceModels),
          },
        },
      }
      const response = await api.settings.mutate(SERVICE_NS, props.existing === undefined
        ? [{ op: 'set', path: ['providers', route], value: serviceProfile as JsonValue }]
        : [
          { op: 'set', path: ['providers', route, 'displayName'], value: displayName || route },
          { op: 'set', path: ['providers', route, 'apiKeyEnv'], value: keyRef },
          {
            op: 'set',
            path: ['providers', route, 'routes', modelType],
            value: serviceProfile.routes[modelType] as JsonValue,
          },
        ], serviceOpenedAt)
      if (!response.ok) return response.error.message
      setServiceCommitted(true)
    }
    if (storesKey) {
      const stored = await api.credentials.set(keyRef, keyValue)
      // The profile landed; saying the key did not is the only honest report,
      // and the retry above now goes straight back to this write.
      if (!stored.ok) return stored.error.message
    }
    return undefined
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await createOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure rejects rather than answering; without this the
      // card would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['editorHeader']}>
        <span className={styles['editorTitle']}>{t(props.existing === undefined ? 'customTitle' : 'editCustomTitle')}</span>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customRoute')}</span>
        <input
          className={styles['input']}
          type="text"
          value={route}
          placeholder="acme-gateway"
          aria-label={t('customRoute')}
          disabled={profileDisabled || props.existing !== undefined}
          onChange={(event) => { setRoute(event.target.value) }}
        />
      </div>
      {/* A rejected id reads as a fault, not as guidance — the same split the
          key field below already makes between its failure and its hint. */}
      {props.existing !== undefined
        ? null
        : routeInvalid || routeTaken
          ? <p className={styles['error']}>{t(routeInvalid ? 'customRouteInvalid' : 'customRouteTaken')}</p>
          : <p className={styles['advancedHint']}>{t('customRouteHint')}</p>}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={displayName}
          placeholder={route.length === 0 ? t('customDisplayName') : route}
          aria-label={t('customDisplayName')}
          disabled={profileDisabled}
          onChange={(event) => { setDisplayName(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('requestType')}</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={modelType}
          aria-label={t('requestType')}
          disabled={profileDisabled}
          onChange={(event) => {
            const next = event.target.value as CustomModelType
            const existingRoute = props.existing?.routes[next]
            setModelType(next)
            setFullRequestURL(existingRoute?.endpoint ?? '')
            setServiceModels(existingRoute?.models ?? [])
            setModels([])
          }}
        >
          {MODEL_TYPES.map(type => (
            <option key={type} value={type}>
              {t(type === 'chat'
                ? 'requestTypeChat'
                : type === 'vision'
                  ? 'requestTypeVision'
                  : type === 'speech'
                    ? 'requestTypeSpeechRecognition'
                    : 'requestTypeImageGeneration')}
            </option>
          ))}
        </select>
      </div>
      {mediaType
        ? null
        : (
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('customApi')}</span>
            <select
              className={`${styles['input']} ${styles['selectInput']}`}
              value={protocol}
              aria-label={t('customApi')}
              disabled={profileDisabled}
              onChange={(event) => {
                setProtocol(event.target.value)
                setFullRequestURL('')
              }}
            >
              {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </div>
        )}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fullRequestUrl')}</span>
        <input
          className={styles['input']}
          type="text"
          value={fullRequestURL}
          placeholder={mediaType
            ? t('customFullRequestUrlPlaceholder')
            : `https://api.example.com/v1${requestPath(protocol)}`}
          aria-label={t('fullRequestUrl')}
          aria-invalid={fullRequestURL.length > 0 && !endpointValid}
          disabled={profileDisabled}
          onChange={(event) => { setFullRequestURL(event.target.value) }}
        />
        {fullRequestURL.length > 0 && !endpointValid
          ? <p className={styles['error']}>{t('fullRequestUrlInvalid')}</p>
          : null}
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('keyInput')}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={t('keyPlaceholder')}
          aria-label={t('keyInput')}
          disabled={disabled}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {/* A create card has no stored key to keep, so the blank case says
            what a blank field means here instead: this route may authenticate
            through the provider's own ambient discovery or OAuth. */}
        {keyFailure === undefined
          ? null
          : <p className={styles['error']}>{t(keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure)}</p>}
      </div>
      {mediaType
        ? (
          <ServiceModelListEditor
            type={modelType}
            models={serviceModels}
            onChange={setServiceModels}
            t={t}
            disabled={profileDisabled}
          />
        )
        : (
          <ModelListEditor
            models={models}
            onChange={setModels}
            probe={{
              settingsNs: NS,
              ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
              api: protocol,
              ...keyValue.length === 0 ? {} : { apiKey: keyValue },
            }}
            probeBlocked={keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure}
            api={api}
            t={t}
            disabled={profileDisabled}
          />
        )}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {/* Only the gates with something to say render; the route-id gate has its
          own field-level hint, so its blocked state would print an empty line. */}
      {hint === undefined ? null : <p className={styles['advancedHint']}>{hint}</p>}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabelKey={props.existing === undefined ? 'create' : 'apply'}
        submitBusyLabelKey={props.existing === undefined ? 'creating' : 'applying'}
        onCancel={() => { props.onClose(committed || serviceCommitted) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}
