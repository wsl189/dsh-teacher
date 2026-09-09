/** Shared token-budget choices for native and catalog-backed model editors. */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

const CAPACITIES = {
  contextWindow: [32_000, 64_000, 128_000, 256_000, 512_000, 1_000_000],
  maxTokens: [8_000, 16_000, 32_000, 64_000],
} as const

/**
 * Format decimal token counts without rounding provider-supplied values.
 * @param value - exact token count.
 * @returns a K/M label when divisible, otherwise the exact count.
 */
export function formatCapacity(value: number): string {
  if (Number.isInteger(value) && value > 0) {
    if (value % 1_000_000 === 0) return `${String(value / 1_000_000)}M`
    if (value % 1_000 === 0) return `${String(value / 1_000)}K`
  }
  return String(value)
}

/** Props of {@link CapacitySelect}. */
export interface CapacitySelectProps {
  /** Model setting whose choices are displayed. */
  field: keyof typeof CAPACITIES
  /** Explicit count; undefined inherits the model or provider default. */
  value: number | undefined
  /** Known inherited count, when the adapter publishes it to this editor. */
  defaultValue?: number | undefined
  /** Localized field name including the model row number. */
  label: string
  /** Disable changes during saves and in read-only deployments. */
  disabled: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Store the selected count or remove its override. */
  onChange: (value: number | undefined) => void
}

/**
 * Offer fixed budgets while retaining an existing count outside those choices.
 * @param props - the model count, inheritance, and localized labels.
 * @returns the capacity selector.
 */
export function CapacitySelect(props: CapacitySelectProps): ReactNode {
  const choices: readonly number[] = CAPACITIES[props.field]
  const current = props.value
  return (
    <select
      className={`${styles['input']} ${styles['selectInput']}`}
      value={current ?? ''}
      aria-label={props.label}
      disabled={props.disabled}
      onChange={(event) => {
        props.onChange(event.target.value === '' ? undefined : Number(event.target.value))
      }}
    >
      <option value="">
        {props.defaultValue === undefined
          ? props.t('capacityDefault')
          : props.t('capacityDefaultValue').replace('{value}', formatCapacity(props.defaultValue))}
      </option>
      {current !== undefined && !choices.includes(current)
        ? <option value={current}>{props.t('capacityCurrentValue').replace('{value}', formatCapacity(current))}</option>
        : null}
      {choices.map(value => <option key={value} value={value}>{formatCapacity(value)}</option>)}
    </select>
  )
}
