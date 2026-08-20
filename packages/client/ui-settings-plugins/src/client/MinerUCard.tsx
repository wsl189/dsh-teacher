/** MinerU document-extraction provider settings. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { MinerUCardFace } from './mineru-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the MinerU card. */
export type MinerUCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<MinerUCardFace>

const BACKEND_OPTIONS = [
  ['pipeline', 'mineruBackendPipeline'],
  ['vlm-engine', 'mineruBackendVlm'],
  ['hybrid-engine', 'mineruBackendHybrid'],
] as const

const EFFORT_OPTIONS = [
  ['medium', 'mineruEffortMedium'],
  ['high', 'mineruEffortHigh'],
] as const

const LANGUAGE_OPTIONS = [
  ['ch', 'mineruLanguageChinese'],
  ['ch_server', 'mineruLanguageChineseServer'],
  ['korean', 'mineruLanguageKorean'],
  ['ta', 'mineruLanguageTamil'],
  ['te', 'mineruLanguageTelugu'],
  ['ka', 'mineruLanguageKannada'],
  ['th', 'mineruLanguageThai'],
  ['el', 'mineruLanguageGreek'],
  ['arabic', 'mineruLanguageArabic'],
  ['east_slavic', 'mineruLanguageEastSlavic'],
  ['cyrillic', 'mineruLanguageCyrillic'],
  ['devanagari', 'mineruLanguageDevanagari'],
] as const

/**
 * Render the MinerU provider card.
 * @param props - locale copy, card snapshot, and staged form actions.
 * @returns the provider card.
 */
export function MinerUCard(props: MinerUCardProps) {
  const { t } = props
  const state = props.useMinerUCard(snapshot => snapshot)
  const disabled = !state.writable
  const common = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: t('invalidNumber'),
    disabled,
  }
  return (
    <PluginCard
      t={t}
      titleKey="mineruTitle"
      descriptionKey="mineruDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-mineru-endpoint"
        label={t('mineruEndpoint')}
        hint={t('mineruEndpointHint')}
        {...common}
        {...state.endpoint}
        onEdit={(text) => { props.edit('endpoint', text) }}
        onReset={() => { props.resetField('endpoint') }}
      />
      <SelectField
        id="plugin-config-mineru-backend"
        label={t('mineruBackend')}
        hint={t('mineruBackendHint')}
        options={BACKEND_OPTIONS.map(([value, label]) => ({ value, label: t(label) }))}
        {...common}
        {...state.backend}
        onEdit={(text) => { props.edit('backend', text) }}
        onReset={() => { props.resetField('backend') }}
      />
      <SelectField
        id="plugin-config-mineru-effort"
        label={t('mineruEffort')}
        hint={t('mineruEffortHint')}
        options={EFFORT_OPTIONS.map(([value, label]) => ({ value, label: t(label) }))}
        {...common}
        {...state.effort}
        onEdit={(text) => { props.edit('effort', text) }}
        onReset={() => { props.resetField('effort') }}
      />
      <SelectField
        id="plugin-config-mineru-language"
        label={t('mineruLanguage')}
        hint={t('mineruLanguageHint')}
        options={LANGUAGE_OPTIONS.map(([value, label]) => ({ value, label: t(label) }))}
        {...common}
        {...state.language}
        onEdit={(text) => { props.edit('language', text) }}
        onReset={() => { props.resetField('language') }}
      />
      <ValueField
        id="plugin-config-mineru-timeout"
        label={t('mineruTimeoutMs')}
        hint={t('mineruTimeoutMsHint')}
        numeric
        {...common}
        {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      <ValueField
        id="plugin-config-mineru-max-file"
        label={t('mineruMaxFileBytes')}
        hint={t('mineruMaxFileBytesHint')}
        numeric
        {...common}
        {...state.maxFileBytes}
        onEdit={(text) => { props.edit('maxFileBytes', text) }}
        onReset={() => { props.resetField('maxFileBytes') }}
      />
      <ValueField
        id="plugin-config-mineru-max-output"
        label={t('mineruMaxOutputCharacters')}
        hint={t('mineruMaxOutputCharactersHint')}
        numeric
        {...common}
        {...state.maxOutputCharacters}
        onEdit={(text) => { props.edit('maxOutputCharacters', text) }}
        onReset={() => { props.resetField('maxOutputCharacters') }}
      />
      <ValueField
        id="plugin-config-mineru-max-response"
        label={t('mineruMaxResponseBytes')}
        hint={t('mineruMaxResponseBytesHint')}
        numeric
        {...common}
        {...state.maxResponseBytes}
        onEdit={(text) => { props.edit('maxResponseBytes', text) }}
        onReset={() => { props.resetField('maxResponseBytes') }}
      />
    </PluginCard>
  )
}
