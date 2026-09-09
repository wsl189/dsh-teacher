/**
 * Curated editor for the direct DeepSeek adapter's advisory model catalog.
 * The settings layer replaces `models` as one array, so the parent supplies
 * the effective inherited rows until the first edit materializes a user
 * override; reset removes that override instead of copying defaults into it.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconPlusOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CapacitySelect } from './CapacitySelect.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One catalog entry kept structurally open so hidden or future fields survive an edit. */
export type DeepSeekModelDraft = Record<string, unknown>

/** The catalog fields this editor writes. */
type CatalogField = 'id' | 'name' | 'contextWindow' | 'maxTokens'

/** The two token budgets behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/** A localized validation failure for one user-owned model array. */
export interface DeepSeekModelsValidationFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid'
  | 'modelMaxTokensInvalid'
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value: unknown): DeepSeekModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as DeepSeekModelDraft
      : {})
}

/**
 * Validate adapter constraints that the serialized schema cannot express.
 * @param value - user-owned `models` value, or undefined while inherited.
 * @returns the first invalid row, or undefined when the adapter will accept it.
 */
export function validateDeepSeekModels(value: unknown): DeepSeekModelsValidationFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    // Compared trimmed: surrounding whitespace is a paste artifact the adapter
    // would never match, and an untrimmed compare lets `model ` slip past the
    // duplicate check against its own twin.
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}

/** Props of {@link DeepSeekModelsEditor}. */
export interface DeepSeekModelsEditorProps {
  /** Effective rows: inherited until the parent materializes an override. */
  models: readonly DeepSeekModelDraft[]
  /** Whether the user layer currently owns the whole array. */
  overridden: boolean
  /** Fallback context capacity used when a row omits its exact value. */
  defaultContextWindow: number | undefined
  /** Fallback output cap used when a row omits its exact value. */
  defaultMaxTokens: number | undefined
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every mutation. */
  disabled: boolean
  /** Replace the user-owned array after one visible edit. */
  onChange: (models: DeepSeekModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance. */
  onReset: () => void
}

/**
 * Render the direct DeepSeek adapter's model catalog: id and display name on
 * each row, capacities behind the row's own disclosure.
 * @param props - effective rows plus the array-level override actions.
 * @returns the catalog editor.
 */
export function DeepSeekModelsEditor(props: DeepSeekModelsEditorProps): ReactNode {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  const update = (index: number, key: CatalogField, value: unknown): void => {
    const next = props.models.map((model, at) => {
      const copy = { ...model }
      if (at !== index) return copy
      if (value === undefined) Reflect.deleteProperty(copy, key)
      else copy[key] = value
      return copy
    })
    props.onChange(next)
  }

  const remove = (index: number): void => {
    setExpanded((current) => {
      const next = new Set<number>()
      for (const at of current) {
        if (at === index) continue
        next.add(at > index ? at - 1 : at)
      }
      return next
    })
    props.onChange(props.models.filter((_model, at) => at !== index).map(model => ({ ...model })))
  }

  const reset = (): void => {
    setExpanded(new Set())
    props.onReset()
  }

  const toggle = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  /** One capacity field of one row, rendered inside the row's disclosure. */
  const capacityField = (
    model: DeepSeekModelDraft,
    index: number,
    field: CapacityField,
    fallback: number | undefined,
  ): ReactNode => (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')}</span>
      <CapacitySelect
        field={field}
        value={typeof model[field] === 'number' ? model[field] : undefined}
        defaultValue={fallback}
        label={`${props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')} ${String(index + 1)}`}
        disabled={props.disabled}
        t={props.t}
        onChange={(value) => { update(index, field, value) }}
      />
    </label>
  )

  return (
    <section className={styles['modelCatalog']} aria-label={props.t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{props.t('models')}</span>
          <span className={styles['modelCatalogMeta']}>
            {props.overridden ? props.t('modelsCustomized') : props.t('modelsInherited')}
          </span>
        </div>
        {props.overridden
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={props.disabled}
              onClick={reset}
            >
              {props.t('resetModels')}
            </button>
          )
          : null}
      </div>
      {props.models.length === 0
        ? <p className={styles['modelEmpty']}>{props.t('modelsEmpty')}</p>
        : (
          <div className={styles['modelList']}>
            {props.models.map((model, index) => (
              <div className={styles['modelEntry']} key={index}>
                <div className={styles['modelRow']}>
                  <input
                    className={styles['input']}
                    type="text"
                    value={typeof model['id'] === 'string' ? model['id'] : ''}
                    placeholder={props.t('modelId')}
                    aria-label={`${props.t('modelId')} ${String(index + 1)}`}
                    disabled={props.disabled}
                    onChange={(event) => { update(index, 'id', event.target.value) }}
                    onBlur={(event) => {
                      // Settle a pasted id rather than trimming per keystroke,
                      // which would stop the user typing an interior space.
                      const trimmed = event.target.value.trim()
                      if (trimmed !== event.target.value) update(index, 'id', trimmed)
                    }}
                  />
                  <input
                    className={styles['input']}
                    type="text"
                    value={typeof model['name'] === 'string' ? model['name'] : ''}
                    placeholder={props.t('modelName')}
                    aria-label={`${props.t('modelName')} ${String(index + 1)}`}
                    disabled={props.disabled}
                    onChange={(event) => {
                      update(index, 'name', event.target.value === '' ? undefined : event.target.value)
                    }}
                  />
                  <button
                    type="button"
                    className={styles['iconButton']}
                    aria-label={`${props.t('modelAdvanced')} ${String(index + 1)}`}
                    aria-expanded={expanded.has(index)}
                    title={props.t('modelAdvanced')}
                    onClick={() => { toggle(index) }}
                  >
                    {expanded.has(index) ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                  </button>
                  <button
                    type="button"
                    className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                    aria-label={`${props.t('removeModel')} ${String(index + 1)}`}
                    title={props.t('removeModel')}
                    disabled={props.disabled}
                    onClick={() => { remove(index) }}
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                </div>
                {expanded.has(index)
                  ? (
                    <div className={styles['modelAdvanced']}>
                      {capacityField(model, index, 'contextWindow', props.defaultContextWindow)}
                      {capacityField(model, index, 'maxTokens', props.defaultMaxTokens)}
                    </div>
                  )
                  : null}
              </div>
            ))}
          </div>
        )}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={props.disabled}
        onClick={() => { props.onChange([...props.models.map(model => ({ ...model })), { id: '' }]) }}
      >
        <IconPlusOutline16 size={14} />
        {props.t('addModel')}
      </button>
    </section>
  )
}
