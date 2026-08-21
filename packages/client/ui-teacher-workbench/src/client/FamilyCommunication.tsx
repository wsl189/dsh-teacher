/** Template-driven family-notice drafting and saved-message reuse. */

import { useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  Clipboard,
  FileCheck2,
  GraduationCap,
  Megaphone,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react'
import type {
  TeacherNoticeTemplate,
  TeacherNoticeTemplateId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherNoticeTemplateInput } from './controller.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { EditorModal, FormField } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Family-communication module props. */
export interface FamilyCommunicationProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
}

type NoticeDraft = {
  type: string
  audience: string
  date: string
  facts: string
  signature: string
}

const ICONS = {
  calendar: CalendarDays,
  safety: ShieldCheck,
  study: GraduationCap,
  activity: Users,
  payment: WalletCards,
  meeting: Users,
  material: FileCheck2,
  custom: Megaphone,
} as const

/**
 * Render family-notice templates, editable generation, copy, and saved drafts.
 * @param props - durable workbench state and commands.
 * @returns the family-communication workbench.
 */
export function FamilyCommunication({ state, commands }: FamilyCommunicationProps) {
  const first = state.noticeTemplates[0]
  const [selectedId, setSelectedId] = useState<TeacherNoticeTemplateId | ''>(() => first?.id ?? '')
  const selected = useMemo(
    () => state.noticeTemplates.find(item => item.id === selectedId) ?? state.noticeTemplates[0],
    [selectedId, state.noticeTemplates],
  )
  const [draft, setDraft] = useState<NoticeDraft>(() => ({
    type: first?.name ?? '',
    audience: '各位家长',
    date: '',
    facts: first?.starter ?? '',
    signature: '班主任',
  }))
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)
  const [templateDraft, setTemplateDraft] = useState<TeacherNoticeTemplateInput | null>(null)

  const selectTemplate = (template: TeacherNoticeTemplate): void => {
    const previousDefault = state.noticeTemplates.some(item => item.starter === draft.facts)
    setSelectedId(template.id)
    setDraft(current => ({
      ...current,
      type: template.name,
      facts: current.facts.trim() === '' || previousDefault ? template.starter : current.facts,
    }))
  }
  const copyOutput = async (): Promise<void> => {
    if (output === '') return
    try {
      await navigator.clipboard.writeText(output)
    } catch {
      return
    }
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1_500)
  }
  const saveTemplate = (): void => {
    if (templateDraft === null) return
    void commands.saveNoticeTemplate(templateDraft).then((result) => {
      if (!result.ok) return
      setDraft(current => ({ ...current, type: templateDraft.name, facts: templateDraft.starter }))
      setTemplateDraft(null)
    })
  }

  return (
    <div className={css.communicationView}>
      <header className={css.featureHero}>
        <span><Megaphone size={15} />家校沟通</span>
        <h2>班级通知工作台</h2>
        <p>选择学校常用场景，补齐关键事实，生成可编辑的微信群消息；最终由老师确认后发送。</p>
      </header>

      <div className={css.communicationLayout}>
        <section className={css.noticeBuilder}>
          <div className={css.sectionCommand}>
            <div><h3>选择通知模板</h3><p>点击后自动带出学校常用的信息结构。</p></div>
            <button type="button" className={css.buttonSecondary} onClick={() => {
              setTemplateDraft({ name: '', icon: 'custom', hint: '', starter: '', custom: true })
            }}><Plus size={15} />新增模板</button>
          </div>
          <div className={css.noticeTemplateGrid}>
            {state.noticeTemplates.map((template) => {
              const Icon = ICONS[template.icon]
              return (
                <article key={template.id} className={selected?.id === template.id ? css.noticeTemplateActive : css.noticeTemplateCard}>
                  <button type="button" className={css.noticeTemplateSelect} onClick={() => { selectTemplate(template) }}>
                    <span><Icon size={17} /></span>
                    <strong>{template.name}</strong>
                    <small>{template.hint}</small>
                  </button>
                  <button type="button" className={css.noticeTemplateEdit} aria-label={`编辑模板 ${template.name}`} onClick={() => {
                    setTemplateDraft({ ...template })
                  }}><Pencil size={13} /></button>
                </article>
              )
            })}
          </div>
          {selected !== undefined && (
            <div className={css.noticeTemplateTip}>
              <Sparkles size={15} />
              <span><strong>{selected.name}</strong>{selected.hint}</span>
              <button type="button" onClick={() => { setDraft({ ...draft, facts: selected.starter }) }}>恢复模板结构</button>
            </div>
          )}
          <div className={css.formGrid}>
            <FormField label="称呼"><input value={draft.audience} onChange={(event) => { setDraft({ ...draft, audience: event.target.value }) }} /></FormField>
            <FormField label="重点时间（可选）"><input value={draft.date} placeholder="例如：9月30日 16:30" onChange={(event) => { setDraft({ ...draft, date: event.target.value }) }} /></FormField>
            <FormField label="关键信息清单" wide><textarea className={css.noticeFacts} value={draft.facts} onChange={(event) => { setDraft({ ...draft, facts: event.target.value }) }} /></FormField>
            <FormField label="署名" wide><input value={draft.signature} onChange={(event) => { setDraft({ ...draft, signature: event.target.value }) }} /></FormField>
          </div>
          <button type="button" className={css.noticeGenerate} onClick={() => { setOutput(generateFamilyNotice(draft, selected)) }}>
            <Sparkles size={17} />生成可编辑初稿
          </button>
        </section>

        <section className={css.noticeOutput}>
          <div className={css.sectionCommand}>
            <div><h3>微信群消息预览</h3><p>表情、重点信息和行动要求已分层，可继续直接修改。</p></div>
            <div className={css.toolbarActions}>
              <button type="button" className={css.buttonSecondary} disabled={output === ''} onClick={() => { void copyOutput() }}>
                {copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? '已复制' : '复制'}
              </button>
              <button type="button" className={css.buttonSecondary} disabled={output === ''} onClick={() => {
                void commands.saveNotice({ title: draft.type, content: output })
              }}><Save size={16} />保存</button>
            </div>
          </div>
          <div className={css.wechatPreview}>
            <span>班</span>
            <div><strong>{draft.signature || '班主任'}</strong><textarea value={output} placeholder="左侧核对信息后，点击“生成可编辑初稿”" onChange={(event) => { setOutput(event.target.value) }} /></div>
          </div>
          <div className={css.noticeQuality}><ShieldCheck size={15} />发送前建议再次核对时间、金额、对象和隐私信息；工作台不会自动发送。</div>
          <div className={css.savedNotices}>
            <h3>已保存通知</h3>
            {state.notices.length === 0
              ? <p>还没有保存的通知，生成后可留作下次复用。</p>
              : [...state.notices].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map(notice => (
                <div key={notice.id}>
                  <button type="button" onClick={() => { setOutput(notice.content) }}><strong>{notice.title}</strong><small>{new Date(notice.createdAt).toLocaleDateString('zh-CN')}</small></button>
                  <button type="button" onClick={() => { void commands.deleteNotice(notice.id) }}>删除</button>
                </div>
              ))}
          </div>
        </section>
      </div>

      {templateDraft !== null && (
        <EditorModal
          open
          title={templateDraft.id === undefined ? '新增通知模板' : '编辑通知模板'}
          closeLabel="关闭"
          cancelLabel="取消"
          saveLabel="保存模板"
          onClose={() => { setTemplateDraft(null) }}
          onSave={saveTemplate}
          valid={templateDraft.name.trim() !== '' && templateDraft.starter.trim() !== ''}
        >
          <>
            <FormField label="模板名称" wide><input maxLength={10} value={templateDraft.name} placeholder="例如：考试提醒" onChange={(event) => { setTemplateDraft({ ...templateDraft, name: event.target.value }) }} /></FormField>
            <FormField label="适用场景" wide><input value={templateDraft.hint} placeholder="一句话说明什么时候使用" onChange={(event) => { setTemplateDraft({ ...templateDraft, hint: event.target.value }) }} /></FormField>
            <FormField label="信息结构" wide><textarea rows={8} value={templateDraft.starter} onChange={(event) => { setTemplateDraft({ ...templateDraft, starter: event.target.value }) }} /></FormField>
            {templateDraft.id !== undefined && templateDraft.custom && (
              <button type="button" className={css.buttonDanger} onClick={() => {
                void commands.deleteNoticeTemplate(templateDraft.id as TeacherNoticeTemplateId).then((result) => {
                  if (result.ok) setTemplateDraft(null)
                })
              }}>删除模板</button>
            )}
          </>
        </EditorModal>
      )}
    </div>
  )
}

/**
 * Build the complete editable family notice from teacher-confirmed facts.
 * @param draft - current notice fields.
 * @param template - selected information structure.
 * @returns a complete message that remains editable before copying or saving.
 */
export function generateFamilyNotice(draft: NoticeDraft, template?: TeacherNoticeTemplate): string {
  const time = draft.date === '' ? '' : `\n\n⏰ 重点时间：${draft.date}`
  return `📣 【${draft.type}】\n\n${draft.audience || '各位家长'}，大家好！\n\n${draft.facts.trim() || template?.starter || '请补充本次通知的具体安排。'}${time}\n\n✅ 请您协助\n1️⃣ 和孩子一起核对以上安排，避免遗漏。\n2️⃣ 如有请假、健康或其他特殊情况，请单独联系老师。\n3️⃣ 收到后请按班级约定反馈，感谢理解与配合！\n\n🌿 温馨提示：涉及学生隐私的信息请勿直接发在班级群内。\n\n—— ${draft.signature || '班主任'}\n${new Date().toLocaleDateString('zh-CN')}`
}
