/** Template-driven teaching-record CRUD and lifecycle tracking. */

import { useMemo, useState } from 'react'
import type {
  TeacherRecord,
  TeacherRecordStatus,
  TeacherRecordTemplate,
  TeacherRecordTemplateId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { confirmDelete, EditorModal, FormField, IconAction } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Teaching-record module props. */
export interface TeachingRecordsProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
}

type TemplateDraft = {
  id?: TeacherRecordTemplateId
  name: string
  scene: string
  fields: string
}

type RecordDraft = {
  id?: TeacherRecord['id']
  templateId: TeacherRecordTemplateId
  title: string
  dueDate: string
  status: TeacherRecordStatus
  values: Record<string, string>
}

/**
 * Render reusable template management plus dynamic teaching records.
 * @param props - durable state, commands, and copy.
 * @returns teaching-record interface.
 */
export function TeachingRecords({ state, commands, t }: TeachingRecordsProps) {
  const templates = useMemo(
    () => state.templates.filter(template => template.kind === 'teaching'),
    [state.templates],
  )
  const [templateFilter, setTemplateFilter] = useState<TeacherRecordTemplateId | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<TeacherRecordStatus | 'all'>('all')
  const [managing, setManaging] = useState(false)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null)
  const [recordDraft, setRecordDraft] = useState<RecordDraft | null>(null)
  const templateById = new Map(templates.map(template => [template.id, template]))
  const records = state.records
    .filter(record => templateById.has(record.templateId))
    .filter(record => templateFilter === 'all' || record.templateId === templateFilter)
    .filter(record => statusFilter === 'all' || record.status === statusFilter)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  const beginRecord = (record?: TeacherRecord): void => {
    const templateId = record?.templateId ?? templates[0]?.id
    if (templateId === undefined) {
      setManaging(true)
      return
    }
    setRecordDraft(record === undefined
      ? {
        templateId,
        title: '',
        dueDate: new Date().toISOString().slice(0, 10),
        status: 'active',
        values: {},
      }
      : {
        id: record.id,
        templateId: record.templateId,
        title: record.title,
        dueDate: record.dueDate,
        status: record.status,
        values: { ...record.values },
      })
  }
  const saveTemplate = (draft: TemplateDraft): void => {
    void commands.saveTemplate({
      ...draft,
      kind: 'teaching',
      fields: draft.fields.split('\n').map(field => field.trim()).filter(Boolean),
    }).then((result) => { if (result.ok) setTemplateDraft(null) })
  }
  const saveRecord = (draft: RecordDraft): void => {
    void commands.saveRecord(draft).then((result) => { if (result.ok) setRecordDraft(null) })
  }
  const selectedTemplate = recordDraft === null ? undefined : templateById.get(recordDraft.templateId)

  return (
    <div className={css.module}>
      <div className={css.moduleToolbar}>
        <div className={css.inlineControls}>
          <select className={css.select} aria-label={t('record.template')} value={templateFilter} onChange={(event) => { setTemplateFilter(event.target.value as TeacherRecordTemplateId | 'all') }}>
            <option value="all">{t('all')}</option>
            {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <select className={css.select} aria-label={t('status')} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as TeacherRecordStatus | 'all') }}>
            <option value="all">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="done">{t('done')}</option>
          </select>
        </div>
        <div className={css.toolbarActions}>
          <button type="button" className={css.buttonSecondary} onClick={() => { setManaging(true) }}>{t('record.manageTemplates')}</button>
          <button type="button" className={css.buttonPrimary} onClick={() => { beginRecord() }}>
            <IconPlusOutline16 />
            {t('record.add')}
          </button>
        </div>
      </div>

      <div className={css.recordList}>
        {records.length === 0 && <div className={css.emptyState}>{t('empty')}</div>}
        {records.map(record => (
          <article key={record.id} className={css.recordCard}>
            <label className={css.recordCheck} title={t('record.toggleDone')}>
              <input
                type="checkbox"
                aria-label={t('record.toggleDone')}
                checked={record.status === 'done'}
                onChange={() => { void commands.toggleRecord(record.id) }}
              />
              <span />
            </label>
            <div className={css.cardBody}>
              <div className={css.cardTitle}>{record.title}</div>
              <div className={css.recordMeta}>
                <span>{(templateById.get(record.templateId) as TeacherRecordTemplate).name}</span>
                <span>{record.dueDate || '—'}</span>
                <span className={record.status === 'done' ? css.statusDone : css.statusActive}>{t(record.status)}</span>
              </div>
              <div className={css.recordPreview}>
                {Object.entries(record.values).filter(([, value]) => value.trim() !== '').slice(0, 2).map(([field, value]) => (
                  <span key={field}><strong>{field}</strong> {value}</span>
                ))}
              </div>
            </div>
            <div className={css.cardActions}>
              <IconAction label={t('edit')} onClick={() => { beginRecord(record) }}><IconEditOutline16 /></IconAction>
              <IconAction
                label={t('delete')}
                danger
                onClick={() => { if (confirmDelete(t)) void commands.deleteRecord(record.id) }}
              >
                <IconTrashOutline16 />
              </IconAction>
            </div>
          </article>
        ))}
      </div>

      {recordDraft !== null && (
        <EditorModal
          open
          title={t(recordDraft.id === undefined ? 'record.add' : 'record.edit')}
          closeLabel={t('close')}
          saveLabel={t('save')}
          cancelLabel={t('cancel')}
          onClose={() => { setRecordDraft(null) }}
          onSave={() => { saveRecord(recordDraft) }}
          valid={recordDraft.title.trim() !== '' && selectedTemplate !== undefined}
        >
          <>
            <FormField label={t('record.template')} wide>
              <select
                value={recordDraft.templateId}
                onChange={(event) => {
                  setRecordDraft({ ...recordDraft, templateId: event.target.value as TeacherRecordTemplateId, values: {} })
                }}
              >
                {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </FormField>
            <FormField label={t('record.title')} wide>
              <input
                value={recordDraft.title}
                onChange={(event) => { setRecordDraft({ ...recordDraft, title: event.target.value }) }}
              />
            </FormField>
            <FormField label={t('record.dueDate')}>
              <input
                type="date"
                value={recordDraft.dueDate}
                onChange={(event) => { setRecordDraft({ ...recordDraft, dueDate: event.target.value }) }}
              />
            </FormField>
            <FormField label={t('status')}>
              <select
                value={recordDraft.status}
                onChange={(event) => {
                  setRecordDraft({ ...recordDraft, status: event.target.value as TeacherRecordStatus })
                }}
              >
                <option value="active">{t('active')}</option>
                <option value="done">{t('done')}</option>
              </select>
            </FormField>
            {selectedTemplate?.fields.map(field => (
              <FormField key={field} label={field} wide>
                <textarea rows={3} value={recordDraft.values[field] ?? ''} onChange={(event) => { setRecordDraft({ ...recordDraft, values: { ...recordDraft.values, [field]: event.target.value } }) }} />
              </FormField>
            ))}
          </>
        </EditorModal>
      )}

      {templateDraft !== null && (
        <EditorModal
          open
          title={t(templateDraft.id === undefined ? 'record.addTemplate' : 'record.editTemplate')}
          closeLabel={t('close')}
          saveLabel={t('save')}
          cancelLabel={t('cancel')}
          onClose={() => { setTemplateDraft(null) }}
          onSave={() => { saveTemplate(templateDraft) }}
          valid={templateDraft.name.trim() !== '' && templateDraft.fields.trim() !== ''}
        >
          <>
            <FormField label={t('name')} wide><input value={templateDraft.name} onChange={(event) => { setTemplateDraft({ ...templateDraft, name: event.target.value }) }} /></FormField>
            <FormField label={t('template.scene')} wide><input value={templateDraft.scene} onChange={(event) => { setTemplateDraft({ ...templateDraft, scene: event.target.value }) }} /></FormField>
            <FormField label={t('template.fields')} wide><textarea rows={7} value={templateDraft.fields} onChange={(event) => { setTemplateDraft({ ...templateDraft, fields: event.target.value }) }} /></FormField>
          </>
        </EditorModal>
      )}

      {managing && (
        <EditorModal
          open
          title={t('record.templates')}
          closeLabel={t('close')}
          saveLabel={t('record.addTemplate')}
          cancelLabel={t('close')}
          onClose={() => { setManaging(false) }}
          onSave={() => { setTemplateDraft({ name: '', scene: '', fields: '' }) }}
        >
          <div className={css.templateList}>
            {templates.map(template => (
              <TemplateManagementRow
                key={template.id}
                template={template}
                t={t}
                edit={() => { setTemplateDraft({ ...template, fields: template.fields.join('\n') }) }}
                remove={() => { if (confirmDelete(t)) void commands.deleteTemplate(template.id) }}
              />
            ))}
          </div>
        </EditorModal>
      )}
    </div>
  )
}

function TemplateManagementRow({ template, t, edit, remove }: {
  template: TeacherRecordTemplate
  t: TeacherWorkbenchTranslate
  edit: () => void
  remove: () => void
}) {
  return (
    <div className={css.templateRow}>
      <div className={css.rowMain}><div className={css.rowTitle}>{template.name}</div><div className={css.rowDescription}>{template.scene || template.fields.join(' · ')}</div></div>
      <div className={css.rowActions}>
        <IconAction label={t('edit')} onClick={edit}><IconEditOutline16 /></IconAction>
        <IconAction label={t('delete')} danger onClick={remove}><IconTrashOutline16 /></IconAction>
      </div>
    </div>
  )
}
