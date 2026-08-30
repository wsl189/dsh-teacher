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
import { EditorModal, FormField, type TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Family-communication module props. */
export interface FamilyCommunicationProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
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
export function FamilyCommunication({ state, commands, t }: FamilyCommunicationProps) {
  const first = state.noticeTemplates[0]
  const [selectedId, setSelectedId] = useState<TeacherNoticeTemplateId | ''>(() => first?.id ?? '')
  const selected = useMemo(
    () => state.noticeTemplates.find(item => item.id === selectedId) ?? state.noticeTemplates[0],
    [selectedId, state.noticeTemplates],
  )
  const [draft, setDraft] = useState<NoticeDraft>(() => ({
    type: first?.name ?? '',
    audience: t('family.defaultAudience'),
    date: '',
    facts: first?.starter ?? '',
    signature: t('family.defaultSignature'),
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
        <span><Megaphone size={15} />{t('module.family')}</span>
        <h2>{t('family.heroTitle')}</h2>
        <p>{t('family.heroDescription')}</p>
      </header>

      <div className={css.communicationLayout}>
        <section className={css.noticeBuilder}>
          <div className={css.sectionCommand}>
            <div><h3>{t('family.templatesTitle')}</h3><p>{t('family.templatesDescription')}</p></div>
            <button type="button" className={css.buttonSecondary} onClick={() => {
              setTemplateDraft({ name: '', icon: 'custom', hint: '', starter: '', custom: true })
            }}><Plus size={15} />{t('family.addTemplate')}</button>
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
                  <button type="button" className={css.noticeTemplateEdit} aria-label={t('family.editTemplateNamed', { name: template.name })} onClick={() => {
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
              <button type="button" onClick={() => { setDraft({ ...draft, facts: selected.starter }) }}>{t('family.restoreTemplate')}</button>
            </div>
          )}
          <div className={css.formGrid}>
            <FormField label={t('family.audience')}><input value={draft.audience} onChange={(event) => { setDraft({ ...draft, audience: event.target.value }) }} /></FormField>
            <FormField label={t('family.importantTime')}><input value={draft.date} placeholder={t('family.timePlaceholder')} onChange={(event) => { setDraft({ ...draft, date: event.target.value }) }} /></FormField>
            <FormField label={t('family.facts')} wide><textarea className={css.noticeFacts} value={draft.facts} onChange={(event) => { setDraft({ ...draft, facts: event.target.value }) }} /></FormField>
            <FormField label={t('family.signature')} wide><input value={draft.signature} onChange={(event) => { setDraft({ ...draft, signature: event.target.value }) }} /></FormField>
          </div>
          <button type="button" className={css.noticeGenerate} onClick={() => { setOutput(generateFamilyNotice(draft, selected, t)) }}>
            <Sparkles size={17} />{t('family.generate')}
          </button>
        </section>

        <section className={css.noticeOutput}>
          <div className={css.sectionCommand}>
            <div><h3>{t('family.previewTitle')}</h3><p>{t('family.previewDescription')}</p></div>
            <div className={css.toolbarActions}>
              <button type="button" className={css.buttonSecondary} disabled={output === ''} onClick={() => { void copyOutput() }}>
                {copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? t('family.copied') : t('family.copy')}
              </button>
              <button type="button" className={css.buttonSecondary} disabled={output === ''} onClick={() => {
                void commands.saveNotice({ title: draft.type, content: output })
              }}><Save size={16} />{t('save')}</button>
            </div>
          </div>
          <div className={css.wechatPreview}>
            <span>{t('family.avatar')}</span>
            <div><strong>{draft.signature || t('family.defaultSignature')}</strong><textarea value={output} placeholder={t('family.outputPlaceholder')} onChange={(event) => { setOutput(event.target.value) }} /></div>
          </div>
          <div className={css.noticeQuality}><ShieldCheck size={15} />{t('family.quality')}</div>
          <div className={css.savedNotices}>
            <h3>{t('family.savedTitle')}</h3>
            {state.notices.length === 0
              ? <p>{t('family.savedEmpty')}</p>
              : [...state.notices].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map(notice => (
                <div key={notice.id}>
                  <button type="button" onClick={() => { setOutput(notice.content) }}><strong>{notice.title}</strong><small>{new Date(notice.createdAt).toLocaleDateString()}</small></button>
                  <button type="button" onClick={() => { void commands.deleteNotice(notice.id) }}>{t('delete')}</button>
                </div>
              ))}
          </div>
        </section>
      </div>

      {templateDraft !== null && (
        <EditorModal
          open
          title={templateDraft.id === undefined ? t('family.addTemplateTitle') : t('family.editTemplateTitle')}
          closeLabel={t('close')}
          cancelLabel={t('cancel')}
          saveLabel={t('family.saveTemplate')}
          onClose={() => { setTemplateDraft(null) }}
          onSave={saveTemplate}
          valid={templateDraft.name.trim() !== '' && templateDraft.starter.trim() !== ''}
        >
          <>
            <FormField label={t('family.templateName')} wide><input maxLength={10} value={templateDraft.name} placeholder={t('family.templateNamePlaceholder')} onChange={(event) => { setTemplateDraft({ ...templateDraft, name: event.target.value }) }} /></FormField>
            <FormField label={t('family.templateScene')} wide><input value={templateDraft.hint} placeholder={t('family.templateScenePlaceholder')} onChange={(event) => { setTemplateDraft({ ...templateDraft, hint: event.target.value }) }} /></FormField>
            <FormField label={t('family.templateStructure')} wide><textarea rows={8} value={templateDraft.starter} onChange={(event) => { setTemplateDraft({ ...templateDraft, starter: event.target.value }) }} /></FormField>
            {templateDraft.id !== undefined && templateDraft.custom && (
              <button type="button" className={css.buttonDanger} onClick={() => {
                void commands.deleteNoticeTemplate(templateDraft.id as TeacherNoticeTemplateId).then((result) => {
                  if (result.ok) setTemplateDraft(null)
                })
              }}>{t('family.deleteTemplate')}</button>
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
 * @param t - workbench namespace translator.
 * @returns a complete message that remains editable before copying or saving.
 */
export function generateFamilyNotice(
  draft: NoticeDraft,
  template: TeacherNoticeTemplate | undefined,
  t: TeacherWorkbenchTranslate,
): string {
  const time = draft.date === '' ? '' : t('family.noticeTime', { date: draft.date })
  return t('family.noticeDraft', {
    type: draft.type,
    audience: draft.audience || t('family.defaultAudience'),
    facts: draft.facts.trim() || template?.starter || t('family.noticeMissingFacts'),
    time,
    signature: draft.signature || t('family.defaultSignature'),
    date: new Date().toLocaleDateString(),
  })
}
