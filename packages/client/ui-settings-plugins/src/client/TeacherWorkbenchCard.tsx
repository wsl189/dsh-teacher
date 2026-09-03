/** Host workspace storage settings. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { TeacherWorkbenchCardFace } from './teacher-workbench-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props bound by the settings plugin-item slot. */
export type TeacherWorkbenchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<TeacherWorkbenchCardFace>

/** Render question-image storage settings. */
export function TeacherWorkbenchCard(props: TeacherWorkbenchCardProps) {
  const { t } = props
  const state = props.useTeacherWorkbenchCard(snapshot => snapshot)
  const common = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: t('invalidNumber'),
    disabled: !state.writable,
  }
  return (
    <PluginCard
      t={t}
      titleKey="teacherWorkbenchTitle"
      descriptionKey="teacherWorkbenchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-teacher-segments-root"
        label={t('teacherSegmentsRoot')}
        hint={t('teacherSegmentsRootHint')}
        {...common}
        {...state.segmentsRoot}
        onEdit={(text) => { props.edit('segmentsRoot', text) }}
        onReset={() => { props.resetField('segmentsRoot') }}
      />
      <ValueField
        id="plugin-config-teacher-students-root"
        label={t('teacherStudentsRoot')}
        hint={t('teacherStudentsRootHint')}
        {...common}
        {...state.studentsRoot}
        onEdit={(text) => { props.edit('studentsRoot', text) }}
        onReset={() => { props.resetField('studentsRoot') }}
      />
      <ValueField
        id="plugin-config-teacher-image-limit"
        label={t('teacherImageLimit')}
        hint={t('teacherImageLimitHint')}
        numeric
        {...common}
        {...state.maxQuestionImageBytes}
        onEdit={(text) => { props.edit('maxQuestionImageBytes', text) }}
        onReset={() => { props.resetField('maxQuestionImageBytes') }}
      />
      <ValueField
        id="plugin-config-teacher-batch-limit"
        label={t('teacherBatchLimit')}
        hint={t('teacherBatchLimitHint')}
        numeric
        {...common}
        {...state.maxQuestionBatchBytes}
        onEdit={(text) => { props.edit('maxQuestionBatchBytes', text) }}
        onReset={() => { props.resetField('maxQuestionBatchBytes') }}
      />
    </PluginCard>
  )
}
