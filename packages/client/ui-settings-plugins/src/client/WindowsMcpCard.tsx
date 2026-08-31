/** Opt-in control for the Windows desktop automation runtime. */

import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WindowsMcpCardFace } from './windows-mcp-card-controller.ts'
import type {} from './slot-contract.ts'
import { PluginCard } from './PluginCard.tsx'
import css from './WindowsMcpCard.module.css'

/** Props the renderer binds for the Windows MCP card. */
export type WindowsMcpCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WindowsMcpCardFace>

/**
 * Render runtime availability, the explicit opt-in, and its approval warning.
 * @param props - locale copy, card snapshot, and staged toggle actions.
 * @returns the Windows MCP settings card, or nothing while its namespace is unavailable.
 */
export function WindowsMcpCard(props: WindowsMcpCardProps) {
  const { t } = props
  const state = props.useWindowsMcpCard(snapshot => snapshot)
  const cannotEnable = !state.runtimeAvailable && !state.enabled
  const disabled = !state.writable || state.saving || cannotEnable
  return (
    <PluginCard
      t={t}
      titleKey="windowsMcpTitle"
      descriptionKey="windowsMcpDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.permission}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('windowsMcpToggle')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            aria-label={t('windowsMcpToggle')}
            className={clsx(css.switch, state.enabled && css.switchOn)}
            disabled={disabled}
            onClick={props.toggleEnabled}
          >
            <span className={css.thumb} />
          </button>
        </div>
        <p className={state.runtimeAvailable ? css.ready : css.unavailable} role="status">
          {t(state.runtimeAvailable ? 'windowsMcpRuntimeReady' : 'windowsMcpRuntimeUnavailable')}
        </p>
        <p className={css.hint}>{t(state.enabled ? 'windowsMcpEnabledHint' : 'windowsMcpDisabledHint')}</p>
        <p className={css.warning}>{t('windowsMcpApprovalWarning')}</p>
      </div>
    </PluginCard>
  )
}
