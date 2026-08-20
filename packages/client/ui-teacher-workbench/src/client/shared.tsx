/** Shared presentational atoms for workbench modules. */

import type { ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchKey } from './locales.ts'
import css from './TeacherWorkbench.module.css'

/** Workbench namespace translator. */
export type TeacherWorkbenchTranslate = Translate<TeacherWorkbenchKey>

/** Labelled form-control wrapper. */
export function FormField(props: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={props.wide ? css.fieldWide : css.field}>
      <span className={css.fieldLabel}>{props.label}</span>
      {props.children}
    </label>
  )
}

/** Standard workbench editor dialog. */
export function EditorModal(props: {
  open: boolean
  title: string
  closeLabel: string
  onClose: () => void
  onSave: () => void
  saveLabel: string
  cancelLabel: string
  valid?: boolean
  children: ReactNode
}) {
  return (
    <Modal
      open={props.open}
      title={props.title}
      closeLabel={props.closeLabel}
      onClose={props.onClose}
      className={css.editorDialog as string}
      footer={(
        <>
          <button type="button" className={css.buttonSecondary} onClick={props.onClose}>{props.cancelLabel}</button>
          <button type="button" className={css.buttonPrimary} disabled={props.valid === false} onClick={props.onSave}>{props.saveLabel}</button>
        </>
      )}
    >
      <div className={css.formGrid}>{props.children}</div>
    </Modal>
  )
}

/** Compact icon-only command button with an accessible label and tooltip. */
export function IconAction(props: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={props.danger ? css.iconActionDanger : css.iconAction}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** Ask for destructive-action confirmation using localized copy. */
export function confirmDelete(t: TeacherWorkbenchTranslate): boolean {
  return window.confirm(t('confirm.delete'))
}

/** Format a numeric metric without trailing zero noise. */
export function formatMetric(value: number, suffix = ''): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`
}
