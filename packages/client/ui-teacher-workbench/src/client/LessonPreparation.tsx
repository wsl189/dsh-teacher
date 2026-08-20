/** Daily lesson-preparation resources and observation-template management. */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  TeacherLessonResource,
  TeacherLessonResourceCategory,
  TeacherRecordTemplate,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconEditOutline16,
  IconLinkOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { confirmDelete, EditorModal, FormField, IconAction } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

/** Lesson-preparation module props. */
export interface LessonPreparationProps {
  /** Current durable state. */
  state: TeacherWorkbenchState
  /** Durable mutation commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
}

type ResourceDraft = {
  id?: TeacherLessonResource['id']
  category: TeacherLessonResourceCategory
  name: string
  url: string
  description: string
}

type TemplateDraft = {
  id?: TeacherRecordTemplate['id']
  name: string
  scene: string
  fields: string
}

const CATEGORIES: readonly TeacherLessonResourceCategory[] = ['resource', 'observation', 'publicLesson']

/**
 * Render links grouped by teaching task plus reusable observation templates.
 * @param props - durable state, commands, and copy.
 * @returns lesson-preparation interface.
 */
export function LessonPreparation({ state, commands, t }: LessonPreparationProps) {
  const [category, setCategory] = useState<TeacherLessonResourceCategory>('resource')
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft | null>(null)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null)
  const resources = useMemo(
    () => state.resources.filter(item => item.category === category),
    [category, state.resources],
  )
  const templates = state.templates.filter(item => item.kind === 'observation')
  const saveResource = (draft: ResourceDraft): void => {
    void commands.saveResource(draft).then((result) => { if (result.ok) setResourceDraft(null) })
  }
  const saveTemplate = (draft: TemplateDraft): void => {
    void commands.saveTemplate({
      ...draft,
      kind: 'observation',
      fields: draft.fields.split('\n').map(field => field.trim()).filter(Boolean),
    }).then((result) => { if (result.ok) setTemplateDraft(null) })
  }

  return (
    <div className={css.module}>
      <div className={css.moduleToolbar}>
        <div className={css.segmented} role="tablist" aria-label={t('module.lesson')}>
          {CATEGORIES.map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={category === id}
              className={clsx(css.segment, category === id && css.segmentActive)}
              onClick={() => { setCategory(id) }}
            >
              {t(`lesson.${id}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={css.buttonPrimary}
          onClick={() => { setResourceDraft({ category, name: '', url: '', description: '' }) }}
        >
          <IconPlusOutline16 />
          {t('lesson.addResource')}
        </button>
      </div>

      <div className={css.resourceGrid}>
        {resources.length === 0 && <div className={css.emptyState}>{t('empty')}</div>}
        {resources.map(resource => (
          <article key={resource.id} className={css.resourceCard}>
            <div className={css.cardBody}>
              <div className={css.cardTitle}>{resource.name}</div>
              <div className={css.cardDescription}>{resource.description || resource.url}</div>
            </div>
            <div className={css.cardActions}>
              <a
                className={css.iconAction}
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t('lesson.openLink')}
                title={t('lesson.openLink')}
              >
                <IconLinkOutline16 />
              </a>
              <IconAction
                label={t('edit')}
                onClick={() => { setResourceDraft({ ...resource }) }}
              >
                <IconEditOutline16 />
              </IconAction>
              <IconAction
                label={t('delete')}
                danger
                onClick={() => { if (confirmDelete(t)) void commands.deleteResource(resource.id) }}
              >
                <IconTrashOutline16 />
              </IconAction>
            </div>
          </article>
        ))}
      </div>

      {category === 'observation' && (
        <section className={css.moduleSection}>
          <div className={css.sectionHeader}>
            <h3>{t('lesson.templates')}</h3>
            <button
              type="button"
              className={css.buttonSecondary}
              onClick={() => { setTemplateDraft({ name: '', scene: '', fields: '' }) }}
            >
              <IconPlusOutline16 />
              {t('lesson.addTemplate')}
            </button>
          </div>
          <div className={css.templateList}>
            {templates.map(template => (
              <div key={template.id} className={css.templateRow}>
                <div className={css.rowMain}>
                  <div className={css.rowTitle}>{template.name}</div>
                  <div className={css.rowDescription}>{template.scene || template.fields.join(' · ')}</div>
                </div>
                <div className={css.rowActions}>
                  <IconAction
                    label={t('edit')}
                    onClick={() => { setTemplateDraft({ ...template, fields: template.fields.join('\n') }) }}
                  >
                    <IconEditOutline16 />
                  </IconAction>
                  <IconAction
                    label={t('delete')}
                    danger
                    onClick={() => { if (confirmDelete(t)) void commands.deleteTemplate(template.id) }}
                  >
                    <IconTrashOutline16 />
                  </IconAction>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {resourceDraft !== null && (
        <EditorModal
          open
          title={t(resourceDraft.id === undefined ? 'lesson.addResource' : 'lesson.editResource')}
          closeLabel={t('close')}
          saveLabel={t('save')}
          cancelLabel={t('cancel')}
          onClose={() => { setResourceDraft(null) }}
          onSave={() => { saveResource(resourceDraft) }}
          valid={resourceDraft.name.trim() !== '' && /^https?:\/\//.test(resourceDraft.url)}
        >
          <>
            <FormField label={t('name')} wide>
              <input
                value={resourceDraft.name}
                onChange={(event) => { setResourceDraft({ ...resourceDraft, name: event.target.value }) }}
              />
            </FormField>
            <FormField label={t('lesson.url')} wide>
              <input
                type="url"
                value={resourceDraft.url}
                onChange={(event) => { setResourceDraft({ ...resourceDraft, url: event.target.value }) }}
              />
            </FormField>
            <FormField label={t('description')} wide>
              <textarea
                rows={3}
                value={resourceDraft.description}
                onChange={(event) => { setResourceDraft({ ...resourceDraft, description: event.target.value }) }}
              />
            </FormField>
          </>
        </EditorModal>
      )}

      {templateDraft !== null && (
        <EditorModal
          open
          title={t(templateDraft.id === undefined ? 'lesson.addTemplate' : 'lesson.editTemplate')}
          closeLabel={t('close')}
          saveLabel={t('save')}
          cancelLabel={t('cancel')}
          onClose={() => { setTemplateDraft(null) }}
          onSave={() => { saveTemplate(templateDraft) }}
          valid={templateDraft.name.trim() !== '' && templateDraft.fields.trim() !== ''}
        >
          <>
            <FormField label={t('name')} wide>
              <input
                value={templateDraft.name}
                onChange={(event) => { setTemplateDraft({ ...templateDraft, name: event.target.value }) }}
              />
            </FormField>
            <FormField label={t('template.scene')} wide>
              <input
                value={templateDraft.scene}
                onChange={(event) => { setTemplateDraft({ ...templateDraft, scene: event.target.value }) }}
              />
            </FormField>
            <FormField label={t('template.fields')} wide>
              <textarea
                rows={6}
                value={templateDraft.fields}
                onChange={(event) => { setTemplateDraft({ ...templateDraft, fields: event.target.value }) }}
              />
            </FormField>
          </>
        </EditorModal>
      )}
    </div>
  )
}
