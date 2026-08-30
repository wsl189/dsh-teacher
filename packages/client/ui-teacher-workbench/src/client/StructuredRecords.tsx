/** Template libraries and structured records for headteacher work. */

import { useMemo, useState } from 'react'
import { ClipboardList, Copy, FileText, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import type {
  TeacherRecord,
  TeacherRecordStatus,
  TeacherRecordTemplateId,
  TeacherRecordTemplateKind,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchKey } from './locales.ts'
import { EditorModal, FormField, type TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Structured headteacher-record module props. */
export interface StructuredRecordsProps {
  /** Headteacher record family. */
  kind: Extract<TeacherRecordTemplateKind, 'class' | 'talk' | 'summary'>
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
}

type TemplateDraft = { id?: TeacherRecordTemplateId; name: string; scene: string; fields: string }
type RecordDraft = {
  id?: TeacherRecord['id']
  templateId: TeacherRecordTemplateId
  title: string
  dueDate: string
  status: TeacherRecordStatus
  values: Record<string, string>
}

const DETAILS = {
  class: {
    title: 'module.classRecords',
    description: 'structured.classDescription',
    Icon: ClipboardList,
  },
  talk: {
    title: 'module.talkRecords',
    description: 'structured.talkDescription',
    Icon: MessageCircle,
  },
  summary: {
    title: 'module.classSummary',
    description: 'structured.summaryDescription',
    Icon: FileText,
  },
} as const satisfies Record<StructuredRecordsProps['kind'], {
  title: TeacherWorkbenchKey
  description: TeacherWorkbenchKey
  Icon: typeof FileText
}>

/**
 * Render one of the three shared headteacher record workspaces.
 * @param props - selected family, durable state, and commands.
 * @returns the record table and reusable template library.
 */
export function StructuredRecords({ kind, state, commands, t }: StructuredRecordsProps) {
  const detail = DETAILS[kind]
  const DetailIcon = detail.Icon
  const templates = useMemo(() => state.templates.filter(template => template.kind === kind), [kind, state.templates])
  const templateIds = useMemo(() => new Set(templates.map(template => template.id)), [templates])
  const records = useMemo(
    () => state.records.filter(record => templateIds.has(record.templateId)).sort((a, b) => b.updatedAt - a.updatedAt),
    [state.records, templateIds],
  )
  const templateById = new Map(templates.map(template => [template.id, template]))
  const [tab, setTab] = useState<'records' | 'templates'>('records')
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null)
  const [recordDraft, setRecordDraft] = useState<RecordDraft | null>(null)

  const editRecord = (record?: TeacherRecord, preferredTemplateId?: TeacherRecordTemplateId): void => {
    const templateId = record?.templateId ?? preferredTemplateId ?? templates[0]?.id
    if (templateId === undefined) {
      setTab('templates')
      return
    }
    setRecordDraft(record === undefined
      ? { templateId, title: '', dueDate: new Date().toISOString().slice(0, 10), status: 'active', values: {} }
      : {
        id: record.id,
        templateId: record.templateId,
        title: record.title,
        dueDate: record.dueDate,
        status: record.status,
        values: { ...record.values },
      })
  }
  const selectedTemplate = recordDraft === null ? undefined : templateById.get(recordDraft.templateId)
  const saveTemplate = (): void => {
    if (templateDraft === null) return
    void commands.saveTemplate({
      ...templateDraft,
      kind,
      fields: templateDraft.fields.split('\n').map(value => value.trim()).filter(Boolean),
    }).then((result) => { if (result.ok) setTemplateDraft(null) })
  }

  return (
    <div className={css.structuredRecords}>
      <header className={css.recordHero}>
        <span><DetailIcon size={22} /></span>
        <div><h2>{t(detail.title)}</h2><p>{t(detail.description)}</p></div>
        <div>
          <button type="button" className={css.buttonPrimary} onClick={() => { editRecord() }}><Plus size={16} />{t('structured.newRecord')}</button>
          <button type="button" className={css.buttonSecondary} onClick={() => { setTab('templates') }}>{t('structured.useTemplate')}</button>
        </div>
      </header>
      <div className={css.recordTabs}>
        <button type="button" className={tab === 'records' ? css.recordTabActive : undefined} onClick={() => { setTab('records') }}>{t('structured.myRecords')} <span>{records.length}</span></button>
        <button type="button" className={tab === 'templates' ? css.recordTabActive : undefined} onClick={() => { setTab('templates') }}>{t('structured.templateLibrary')} <span>{templates.length}</span></button>
      </div>

      {tab === 'records' && (
        records.length === 0
          ? <div className={css.workspaceEmpty}><FileText size={28} /><h3>{t('structured.emptyTitle')}</h3><p>{t('structured.emptyDescription')}</p><button type="button" className={css.buttonPrimary} onClick={() => { editRecord() }}><Plus size={16} />{t('structured.createFirst')}</button></div>
          : <div className={css.recordTable}>
            <div className={css.recordTableHead}><span>{t('record.title')}</span><span>{t('record.template')}</span><span>{t('structured.followupDate')}</span><span>{t('status')}</span><span>{t('structured.actions')}</span></div>
            {records.map(record => (
              <div key={record.id} className={css.recordTableRow}>
                <button type="button" onClick={() => { editRecord(record) }}>{record.title}</button>
                <span>{templateById.get(record.templateId)?.name ?? t('structured.customRecord')}</span>
                <span>{record.dueDate || t('structured.unset')}</span>
                <button type="button" className={record.status === 'done' ? css.statusDone : css.statusActive} onClick={() => { void commands.toggleRecord(record.id) }}>{t(record.status === 'done' ? 'done' : 'active')}</button>
                <span><button type="button" aria-label={t('structured.editNamed', { name: record.title })} onClick={() => { editRecord(record) }}><Pencil size={15} /></button><button type="button" aria-label={t('structured.deleteNamed', { name: record.title })} onClick={() => { void commands.deleteRecord(record.id) }}><Trash2 size={15} /></button></span>
              </div>
            ))}
          </div>
      )}

      {tab === 'templates' && (
        <section className={css.templateLibrary}>
          <div className={css.sectionCommand}>
            <div><h3>{t('structured.libraryTitle')}</h3><p>{t('structured.libraryDescription')}</p></div>
            <button type="button" className={css.buttonPrimary} onClick={() => { setTemplateDraft({ name: '', scene: '', fields: '' }) }}><Plus size={16} />{t('structured.newTemplate')}</button>
          </div>
          <div className={css.richTemplateGrid}>
            {templates.map(template => (
              <article key={template.id}>
                <div><span><FileText size={18} /></span><small>{t('structured.fieldCount', { count: template.fields.length })}</small></div>
                <h3>{template.name}</h3>
                <p>{template.scene}</p>
                <div className={css.templateFieldPreview}>
                  {template.fields.slice(0, 3).map(field => <span key={field}>{field}</span>)}
                  {template.fields.length > 3 && <em>+{template.fields.length - 3}</em>}
                </div>
                <footer>
                  <button type="button" className={css.buttonPrimary} onClick={() => { editRecord(undefined, template.id) }}><Plus size={15} />{t('structured.useTemplate')}</button>
                  <button type="button" onClick={() => { setTemplateDraft({ ...template, fields: template.fields.join('\n') }) }}><Pencil size={15} />{t('edit')}</button>
                  <button type="button" aria-label={t('structured.copyNamed', { name: template.name })} onClick={() => {
                    void commands.saveTemplate({ kind, name: `${template.name}${t('structured.copySuffix')}`, scene: template.scene, fields: [...template.fields] })
                  }}><Copy size={15} /></button>
                  <button type="button" aria-label={t('structured.deleteNamed', { name: template.name })} onClick={() => { void commands.deleteTemplate(template.id) }}><Trash2 size={15} /></button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {recordDraft !== null && (
        <EditorModal open title={recordDraft.id === undefined ? t('structured.newRecord') : t('record.edit')} closeLabel={t('close')} cancelLabel={t('cancel')} saveLabel={t('structured.saveRecord')} onClose={() => { setRecordDraft(null) }} onSave={() => {
          void commands.saveRecord(recordDraft).then((result) => { if (result.ok) setRecordDraft(null) })
        }} valid={recordDraft.title.trim() !== '' && selectedTemplate !== undefined}>
          <>
            <FormField label={t('structured.useTemplate')} wide><select value={recordDraft.templateId} onChange={(event) => { setRecordDraft({ ...recordDraft, templateId: event.target.value as TeacherRecordTemplateId, values: {} }) }}>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></FormField>
            <FormField label={t('record.title')} wide><input value={recordDraft.title} onChange={(event) => { setRecordDraft({ ...recordDraft, title: event.target.value }) }} /></FormField>
            <FormField label={t('structured.followupDate')}><input type="date" value={recordDraft.dueDate} onChange={(event) => { setRecordDraft({ ...recordDraft, dueDate: event.target.value }) }} /></FormField>
            <FormField label={t('status')}><select value={recordDraft.status} onChange={(event) => { setRecordDraft({ ...recordDraft, status: event.target.value as TeacherRecordStatus }) }}><option value="active">{t('active')}</option><option value="done">{t('done')}</option></select></FormField>
            {selectedTemplate?.fields.map(field => <FormField key={field} label={field} wide><textarea rows={3} value={recordDraft.values[field] ?? ''} onChange={(event) => { setRecordDraft({ ...recordDraft, values: { ...recordDraft.values, [field]: event.target.value } }) }} /></FormField>)}
          </>
        </EditorModal>
      )}

      {templateDraft !== null && (
        <EditorModal open title={templateDraft.id === undefined ? t('structured.newTemplate') : t('record.editTemplate')} closeLabel={t('close')} cancelLabel={t('cancel')} saveLabel={t('structured.saveTemplate')} onClose={() => { setTemplateDraft(null) }} onSave={saveTemplate} valid={templateDraft.name.trim() !== '' && templateDraft.fields.trim() !== ''}>
          <>
            <FormField label={t('structured.templateName')} wide><input value={templateDraft.name} onChange={(event) => { setTemplateDraft({ ...templateDraft, name: event.target.value }) }} /></FormField>
            <FormField label={t('structured.templateScene')} wide><textarea rows={2} value={templateDraft.scene} onChange={(event) => { setTemplateDraft({ ...templateDraft, scene: event.target.value }) }} /></FormField>
            <FormField label={t('structured.templateFields')} wide><textarea rows={8} value={templateDraft.fields} onChange={(event) => { setTemplateDraft({ ...templateDraft, fields: event.target.value }) }} /></FormField>
          </>
        </EditorModal>
      )}
    </div>
  )
}
