/** Saved connection facts and one representative language-model verification result. */

import type { ReactNode } from 'react'
import type { ConnectionCheck, ModelServiceType } from './store.ts'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

const MODEL_TYPE_LABELS: Record<ModelServiceType, ModelsKey> = {
  chat: 'requestTypeChat', vision: 'requestTypeVision',
  image: 'requestTypeImageGeneration', speech: 'requestTypeSpeechRecognition',
}

/** Presentation inputs derived from the shared settings snapshot. */
export interface ConnectionSummaryProps {
  ready: boolean
  models: readonly { id: string; name: string; type: ModelServiceType }[]
  check: ConnectionCheck | undefined
  capabilities: readonly string[]
  usages: readonly string[]
  t: (key: ModelsKey) => string
  onRetry: () => void
  onUsage: () => void
}

/**
 * Render connection availability and model types without claiming every model was tested.
 * @param props - saved connection facts and explicit navigation/retry actions.
 * @returns a compact summary with the chosen test model identified in its details.
 */
export function ConnectionSummary(props: ConnectionSummaryProps): ReactNode {
  const { models, check, t } = props
  const hasLanguageModel = models.some(model => model.type === 'chat' || model.type === 'vision')
  const status = !props.ready ? 'connectionIncomplete'
    : !hasLanguageModel ? 'connectionConfigured'
      : check?.status === 'checking' ? 'connectionChecking'
        : check?.status === 'failed' ? 'connectionFailed'
          : check?.status === 'passed' ? 'connectionPassed'
            : 'connectionUnverified'
  const checkedModel = models.find(model => model.id === check?.model
    && (model.type === 'chat' || model.type === 'vision'))?.name ?? check?.model
  return (
    <div className={styles['connectionSummary']}>
      <div className={styles['connectionFacts']}>
        <span className={styles['connectionStatus']} data-state={status} aria-live="polite">{t(status)}</span>
        <span>{t('connectionModelCount').replace('{count}', String(models.length))}</span>
        {props.capabilities.length === 0 ? null : <span>{props.capabilities.join(' · ')}</span>}
        {check?.status !== 'failed' ? null : (
          <button type="button" className={styles['summaryLink']} onClick={props.onRetry}>{t('retryVerification')}</button>
        )}
      </div>
      <div className={styles['connectionFacts']}>
        <span>{props.usages.length === 0 ? t('connectionUnused') : t('connectionUsedFor').replace('{uses}', props.usages.join(' · '))}</span>
        <button type="button" className={styles['summaryLink']} onClick={props.onUsage}>{t('assignUsage')}</button>
      </div>
      {check?.status !== 'failed' ? null : (
        <p className={styles['error']} role="alert">{checkedModel}: {check.error}</p>
      )}
      {models.length === 0 ? null : (
        <details className={styles['connectionModels']}>
          <summary>{t('viewConnectionModels')}</summary>
          {checkedModel === undefined ? null : <div>{t('connectionCheckModel').replace('{model}', checkedModel)}</div>}
          <ul>
            {models.map(model => (
              <li key={`${model.type}:${model.id}`}>
                <span>{model.name}</span>
                <span>{t(MODEL_TYPE_LABELS[model.type])}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
