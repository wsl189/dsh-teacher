/** General-settings row for teacher identity, daily management, and score analysis. */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TEACHER_WORKBENCH_SETTINGS,
  type TeacherWorkbenchSettings,
} from '../settings.ts'
import type { TeacherWorkbenchSettingsInjected } from './contracts.ts'
import css from './TeacherWorkbench.module.css'

/** Full settings-row props. */
export type TeacherWorkbenchSettingsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'teacherWorkbench'>
  & InjectFace<TeacherWorkbenchSettingsInjected>

/**
 * Render the dsh settings fields consumed by workbench modules.
 * @param props - settings scope hook, write callback, and copy.
 * @returns one General settings row.
 */
export function TeacherWorkbenchSettingsRow({ useTeacherSettings, setSetting, t }: TeacherWorkbenchSettingsRowProps) {
  const snapshot = useTeacherSettings(value => value)
  const [draft, setDraft] = useState<TeacherWorkbenchSettings>(
    snapshot.value ?? DEFAULT_TEACHER_WORKBENCH_SETTINGS,
  )
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const staged = useRef(new Map<keyof TeacherWorkbenchSettings, string | number>())
  useEffect(() => {
    const stored = snapshot.value
    if (stored === undefined) return
    setDraft(() => {
      const next = { ...stored }
      for (const [field, value] of staged.current) {
        if (stored[field] === value) staged.current.delete(field)
        else Object.assign(next, { [field]: value })
      }
      return next
    })
  }, [snapshot.revision, snapshot.value])
  const disabled = snapshot.status !== 'ready' || !snapshot.writable
  type TextField = 'academicYear' | 'teacherName' | 'schoolName' | 'defaultSubject' | 'weatherLocation'
  const setText = (field: TextField, value: string): void => {
    staged.current.set(field, value)
    setDraft(current => ({ ...current, [field]: value }))
  }
  type NumberField = 'scoreFullMark' | 'excellentScore' | 'passScore' | 'questionRenderScale' | 'questionCropPadding'
  const setNumber = (field: NumberField, value: string): void => {
    if (value === '') return
    const parsed = Number(value)
    staged.current.set(field, parsed)
    setDraft(current => ({ ...current, [field]: parsed }))
  }
  const persist = (field: keyof TeacherWorkbenchSettings, value: string | number): void => {
    const settle = (): void => {
      if (staged.current.get(field) !== value) return
      staged.current.delete(field)
      const stored = snapshotRef.current.value
      if (stored === undefined || stored[field] === value) return
      setDraft(current => ({ ...current, [field]: stored[field] }))
    }
    void setSetting(field, value).then(settle, settle)
  }
  const persistText = (field: TextField, value: string): void => {
    const normalized = value.trim()
    setText(field, normalized)
    persist(field, normalized)
  }
  const persistNumber = (field: NumberField, value: string): void => {
    const parsed = Number(value)
    staged.current.set(field, parsed)
    persist(field, parsed)
  }

  return (
    <div className={css.settingsGroup}>
      <div className={css.settingsHead}>
        <div className={css.settingsTitle}>{t('settings.title')}</div>
        <div className={css.settingsDescription}>{t('settings.description')}</div>
      </div>
      <div className={css.settingsSections}>
        <section className={css.settingsSection} aria-label={t('settings.identityGroup')}>
          <h3 className={css.settingsSectionTitle}>{t('settings.identityGroup')}</h3>
          <div className={css.settingsFields}>
            <label><span>{t('settings.academicYear')}</span><input disabled={disabled} value={draft.academicYear} onChange={(event) => { setText('academicYear', event.target.value) }} onBlur={(event) => { persistText('academicYear', event.currentTarget.value) }} placeholder="2026" /></label>
            <label><span>{t('settings.teacherName')}</span><input disabled={disabled} value={draft.teacherName} onChange={(event) => { setText('teacherName', event.target.value) }} onBlur={(event) => { persistText('teacherName', event.currentTarget.value) }} /></label>
            <label><span>{t('settings.schoolName')}</span><input disabled={disabled} value={draft.schoolName} onChange={(event) => { setText('schoolName', event.target.value) }} onBlur={(event) => { persistText('schoolName', event.currentTarget.value) }} /></label>
            <label><span>{t('settings.defaultSubject')}</span><input disabled={disabled} value={draft.defaultSubject} onChange={(event) => { setText('defaultSubject', event.target.value) }} onBlur={(event) => { persistText('defaultSubject', event.currentTarget.value) }} /></label>
            <label><span>{t('settings.weatherLocation')}</span><input disabled={disabled} maxLength={80} value={draft.weatherLocation} onChange={(event) => { setText('weatherLocation', event.target.value) }} onBlur={(event) => { persistText('weatherLocation', event.currentTarget.value) }} /></label>
          </div>
        </section>
        <section className={css.settingsSection} aria-label={t('settings.scoreGroup')}>
          <h3 className={css.settingsSectionTitle}>{t('settings.scoreGroup')}</h3>
          <div className={css.settingsFields}>
            <label><span>{t('settings.fullMark')}</span><input type="number" min="1" max="1000" disabled={disabled} value={draft.scoreFullMark} onChange={(event) => { setNumber('scoreFullMark', event.target.value) }} onBlur={(event) => { persistNumber('scoreFullMark', event.currentTarget.value) }} /></label>
            <label><span>{t('settings.excellent')}</span><input type="number" min="0" max={draft.scoreFullMark} disabled={disabled} value={draft.excellentScore} onChange={(event) => { setNumber('excellentScore', event.target.value) }} onBlur={(event) => { persistNumber('excellentScore', event.currentTarget.value) }} /></label>
            <label><span>{t('settings.pass')}</span><input type="number" min="0" max={draft.excellentScore} disabled={disabled} value={draft.passScore} onChange={(event) => { setNumber('passScore', event.target.value) }} onBlur={(event) => { persistNumber('passScore', event.currentTarget.value) }} /></label>
          </div>
        </section>
        <section className={css.settingsSection} aria-label={t('settings.questionCuttingGroup')}>
          <h3 className={css.settingsSectionTitle}>{t('settings.questionCuttingGroup')}</h3>
          <p className={css.settingsSectionDescription}>{t('settings.questionCuttingDescription')}</p>
          <div className={css.settingsFields}>
            <label><span>{t('settings.questionRenderScale')}</span><input type="number" min="1" max="4" step="0.25" disabled={disabled} value={draft.questionRenderScale} onChange={(event) => { setNumber('questionRenderScale', event.target.value) }} onBlur={(event) => { persistNumber('questionRenderScale', event.currentTarget.value) }} /></label>
            <label><span>{t('settings.questionCropPadding')}</span><input type="number" min="0" max="100" step="1" disabled={disabled} value={draft.questionCropPadding} onChange={(event) => { setNumber('questionCropPadding', event.target.value) }} onBlur={(event) => { persistNumber('questionCropPadding', event.currentTarget.value) }} /></label>
          </div>
        </section>
      </div>
    </div>
  )
}
