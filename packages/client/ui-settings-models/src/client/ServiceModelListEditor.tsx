/** Editable model ids and names for one image or speech request route. */

import type { ReactNode } from 'react'
import type { ModelServiceModelView, ModelServiceType } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Validation failure for one media model row. */
export interface ServiceModelFailure {
  /** Zero-based row index. */
  index: number
  /** Localized field copy naming the failure. */
  key: 'modelIdRequired' | 'modelIdDuplicate'
}

/**
 * Validate the editable model directory for one exact request route.
 * @param models - drafted model ids and names.
 * @returns the first row failure, or undefined when the directory is valid.
 */
export function serviceModelsFailure(models: readonly ModelServiceModelView[]): ServiceModelFailure | undefined {
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    const id = model.id.trim()
    if (id.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(id)) return { index, key: 'modelIdDuplicate' }
    seen.add(id)
  }
  return undefined
}

/**
 * Normalize editable rows for the settings namespace.
 * @param models - drafted model ids and optional display names.
 * @returns trimmed model entries with an empty optional name omitted.
 */
export function serviceModelSettingsValue(
  models: readonly ModelServiceModelView[],
): { id: string; name?: string }[] {
  return models.map((model) => {
    const name = model.name.trim()
    return { id: model.id.trim(), ...name.length === 0 ? {} : { name } }
  })
}

/** Props of {@link ServiceModelListEditor}. */
export interface ServiceModelListEditorProps {
  /** Fixed type of every row in this directory. */
  type: Extract<ModelServiceType, 'speech' | 'image'>
  /** Drafted model ids and names. */
  models: readonly ModelServiceModelView[]
  /** Replace the drafted directory. */
  onChange: (models: ModelServiceModelView[]) => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control. */
  disabled: boolean
}

/**
 * Render a compact media-model directory for one exact endpoint.
 * @param props - fixed type, drafted models, copy, and update callback.
 * @returns the editable directory.
 */
export function ServiceModelListEditor(props: ServiceModelListEditorProps): ReactNode {
  const { models, onChange, t, disabled } = props
  const patch = (index: number, field: 'id' | 'name', value: string): void => {
    onChange(models.map((model, at) => at === index ? { ...model, [field]: value } : model))
  }
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          <span className={styles['modelCatalogMeta']}>
            {t(props.type === 'speech' ? 'requestTypeSpeechRecognition' : 'requestTypeImageGeneration')}
          </span>
        </div>
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => (
        <div key={index} className={styles['modelEntry']}>
          <div className={styles['modelRow']}>
            <input
              className={styles['input']}
              type="text"
              value={model.id}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, 'id', event.target.value) }}
            />
            <input
              className={styles['input']}
              type="text"
              value={model.name}
              placeholder={t('modelName')}
              aria-label={`${t('modelName')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, 'name', event.target.value) }}
            />
            <span className={styles['modelCatalogMeta']}>
              {t(props.type === 'speech' ? 'requestTypeSpeechRecognition' : 'requestTypeImageGeneration')}
            </span>
            <button
              type="button"
              className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
              aria-label={`${t('removeModel')} ${index + 1}`}
              title={t('removeModel')}
              disabled={disabled}
              onClick={() => { onChange(models.filter((_model, at) => at !== index)) }}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '', name: '' }]) }}
      >
        {t('addModel')}
      </button>
    </section>
  )
}
