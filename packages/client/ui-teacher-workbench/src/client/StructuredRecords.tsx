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
import { EditorModal, FormField } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Structured headteacher-record module props. */
export interface StructuredRecordsProps {
  /** Headteacher record family. */
  kind: Extract<TeacherRecordTemplateKind, 'class' | 'talk' | 'summary'>
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
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
    title: '班级记录',
    description: '记录班级事项，不伪装成学校学生管理系统。',
    Icon: ClipboardList,
  },
  talk: {
    title: '谈话记录',
    description: '快速记下事实、沟通要点与下次跟进时间。',
    Icon: MessageCircle,
  },
  summary: {
    title: '班级总结',
    description: '从已有事实形成周报和阶段总结，不编造活动。',
    Icon: FileText,
  },
} as const

/**
 * Render one of the three shared headteacher record workspaces.
 * @param props - selected family, durable state, and commands.
 * @returns the record table and reusable template library.
 */
export function StructuredRecords({ kind, state, commands }: StructuredRecordsProps) {
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
        <div><h2>{detail.title}</h2><p>{detail.description}</p></div>
        <div>
          <button type="button" className={css.buttonPrimary} onClick={() => { editRecord() }}><Plus size={16} />新建记录</button>
          <button type="button" className={css.buttonSecondary} onClick={() => { setTab('templates') }}>使用模板</button>
        </div>
      </header>
      <div className={css.recordTabs}>
        <button type="button" className={tab === 'records' ? css.recordTabActive : undefined} onClick={() => { setTab('records') }}>我的记录 <span>{records.length}</span></button>
        <button type="button" className={tab === 'templates' ? css.recordTabActive : undefined} onClick={() => { setTab('templates') }}>模板库 <span>{templates.length}</span></button>
      </div>

      {tab === 'records' && (
        records.length === 0
          ? <div className={css.workspaceEmpty}><FileText size={28} /><h3>还没有工作记录</h3><p>从一个模板开始，填写后会成为可继续编辑的个人资料。</p><button type="button" className={css.buttonPrimary} onClick={() => { editRecord() }}><Plus size={16} />新建第一条记录</button></div>
          : <div className={css.recordTable}>
            <div className={css.recordTableHead}><span>标题</span><span>模板</span><span>跟进日期</span><span>状态</span><span>操作</span></div>
            {records.map(record => (
              <div key={record.id} className={css.recordTableRow}>
                <button type="button" onClick={() => { editRecord(record) }}>{record.title}</button>
                <span>{templateById.get(record.templateId)?.name ?? '自定义记录'}</span>
                <span>{record.dueDate || '未设置'}</span>
                <button type="button" className={record.status === 'done' ? css.statusDone : css.statusActive} onClick={() => { void commands.toggleRecord(record.id) }}>{record.status === 'done' ? '已完成' : '进行中'}</button>
                <span><button type="button" aria-label={`编辑 ${record.title}`} onClick={() => { editRecord(record) }}><Pencil size={15} /></button><button type="button" aria-label={`删除 ${record.title}`} onClick={() => { void commands.deleteRecord(record.id) }}><Trash2 size={15} /></button></span>
              </div>
            ))}
          </div>
      )}

      {tab === 'templates' && (
        <section className={css.templateLibrary}>
          <div className={css.sectionCommand}>
            <div><h3>学校实务模板</h3><p>先看适用场景和记录结构，再一键使用；所有模板仍可编辑、复制或删除。</p></div>
            <button type="button" className={css.buttonPrimary} onClick={() => { setTemplateDraft({ name: '', scene: '', fields: '' }) }}><Plus size={16} />新建模板</button>
          </div>
          <div className={css.richTemplateGrid}>
            {templates.map(template => (
              <article key={template.id}>
                <div><span><FileText size={18} /></span><small>{template.fields.length} 项结构</small></div>
                <h3>{template.name}</h3>
                <p>{template.scene}</p>
                <div className={css.templateFieldPreview}>
                  {template.fields.slice(0, 3).map(field => <span key={field}>{field}</span>)}
                  {template.fields.length > 3 && <em>+{template.fields.length - 3}</em>}
                </div>
                <footer>
                  <button type="button" className={css.buttonPrimary} onClick={() => { editRecord(undefined, template.id) }}><Plus size={15} />使用模板</button>
                  <button type="button" onClick={() => { setTemplateDraft({ ...template, fields: template.fields.join('\n') }) }}><Pencil size={15} />编辑</button>
                  <button type="button" aria-label={`复制 ${template.name}`} onClick={() => {
                    void commands.saveTemplate({ kind, name: `${template.name}（副本）`, scene: template.scene, fields: [...template.fields] })
                  }}><Copy size={15} /></button>
                  <button type="button" aria-label={`删除 ${template.name}`} onClick={() => { void commands.deleteTemplate(template.id) }}><Trash2 size={15} /></button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {recordDraft !== null && (
        <EditorModal open title={recordDraft.id === undefined ? '新建记录' : '编辑记录'} closeLabel="关闭" cancelLabel="取消" saveLabel="保存记录" onClose={() => { setRecordDraft(null) }} onSave={() => {
          void commands.saveRecord(recordDraft).then((result) => { if (result.ok) setRecordDraft(null) })
        }} valid={recordDraft.title.trim() !== '' && selectedTemplate !== undefined}>
          <>
            <FormField label="使用模板" wide><select value={recordDraft.templateId} onChange={(event) => { setRecordDraft({ ...recordDraft, templateId: event.target.value as TeacherRecordTemplateId, values: {} }) }}>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></FormField>
            <FormField label="标题" wide><input value={recordDraft.title} onChange={(event) => { setRecordDraft({ ...recordDraft, title: event.target.value }) }} /></FormField>
            <FormField label="跟进日期"><input type="date" value={recordDraft.dueDate} onChange={(event) => { setRecordDraft({ ...recordDraft, dueDate: event.target.value }) }} /></FormField>
            <FormField label="状态"><select value={recordDraft.status} onChange={(event) => { setRecordDraft({ ...recordDraft, status: event.target.value as TeacherRecordStatus }) }}><option value="active">进行中</option><option value="done">已完成</option></select></FormField>
            {selectedTemplate?.fields.map(field => <FormField key={field} label={field} wide><textarea rows={3} value={recordDraft.values[field] ?? ''} onChange={(event) => { setRecordDraft({ ...recordDraft, values: { ...recordDraft.values, [field]: event.target.value } }) }} /></FormField>)}
          </>
        </EditorModal>
      )}

      {templateDraft !== null && (
        <EditorModal open title={templateDraft.id === undefined ? '新建模板' : '编辑模板'} closeLabel="关闭" cancelLabel="取消" saveLabel="保存模板" onClose={() => { setTemplateDraft(null) }} onSave={saveTemplate} valid={templateDraft.name.trim() !== '' && templateDraft.fields.trim() !== ''}>
          <>
            <FormField label="模板名称" wide><input value={templateDraft.name} onChange={(event) => { setTemplateDraft({ ...templateDraft, name: event.target.value }) }} /></FormField>
            <FormField label="适用场景" wide><textarea rows={2} value={templateDraft.scene} onChange={(event) => { setTemplateDraft({ ...templateDraft, scene: event.target.value }) }} /></FormField>
            <FormField label="记录结构（每行一项）" wide><textarea rows={8} value={templateDraft.fields} onChange={(event) => { setTemplateDraft({ ...templateDraft, fields: event.target.value }) }} /></FormField>
          </>
        </EditorModal>
      )}
    </div>
  )
}
