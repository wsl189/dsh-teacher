/** Desktop update status and actions rendered beside Settings. */

import { useEffect, useRef, useState } from 'react'
import {
  IconDownloadOutline16, IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateKey } from './locales.ts'
import type { DesktopUpdateState } from './bridge.ts'
import type { DesktopUpdateSource } from './source.ts'
import css from './UpdateButton.module.css'

/** Business face supplied by the desktop-update slot registration. */
export interface UpdateButtonInjected {
  hooks: {
    /** Desktop updater state bound by the slot renderer as useUpdate. */
    update: DesktopUpdateSource
  }
  /** Start or retry the installer download. */
  download: () => Promise<void>
  /** Restart into the downloaded installer. */
  install: () => Promise<void>
}

/** Full component props for the sidebar's desktop-update seat. */
export type UpdateButtonProps = PropsRuntime<'sidebar.update'>
  & InjectFace<UpdateButtonInjected>
  & PropsLocale<'desktop-update'>

type ActionUpdateState = Exclude<DesktopUpdateState, { status: 'checking' | 'up-to-date' }>

/** Human-readable button projection for one actionable update state. */
function buttonView(
  state: ActionUpdateState,
  t: (key: DesktopUpdateKey, params?: Record<string, unknown>) => string,
): { label: string; aria: string; disabled: boolean; install: boolean; percent?: number } {
  switch (state.status) {
    case 'available':
      return {
        label: t('action.available'),
        aria: t('aria.available', { version: state.version }),
        disabled: false,
        install: false,
      }
    case 'downloading': {
      const percent = Math.max(0, Math.min(100, Math.round(state.percent)))
      return {
        label: `${t('action.downloading')} ${String(percent)}%`,
        aria: t('aria.downloading', { version: state.version, percent }),
        disabled: true,
        install: false,
        percent,
      }
    }
    case 'downloaded':
      return {
        label: t('action.install'),
        aria: t('aria.install', { version: state.version }),
        disabled: false,
        install: true,
      }
    case 'error':
      return {
        label: t('action.retry'),
        aria: t('aria.retry', { version: state.version }),
        disabled: false,
        install: false,
      }
    /* v8 ignore next 3 -- DesktopUpdateState is closed and every actionable variant is handled above. */
    default:
      state satisfies never
      throw new Error('unreachable desktop update state')
  }
}

/**
 * Render the installed version or the action for a newer desktop release.
 * @param props - slot owner state, bound updater source, actions, and locale.
 * @returns the current-version status, an update button, or null while checking.
 */
export function UpdateButton({ wide, useUpdate, download, install, t }: UpdateButtonProps) {
  const state = useUpdate(value => value)
  const [invoking, setInvoking] = useState(false)
  const [actionFailure, setActionFailure] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { setActionFailure(undefined) }, [state])
  if (state.status === 'checking') return null
  if (state.status === 'up-to-date') {
    if (!wide) return null
    const aria = t('aria.current', { version: state.version })
    return (
      <span
        className={`${css.entry} ${css.current} ${css.wide}`}
        data-desktop-update-status={state.status}
        role="status"
        aria-label={aria}
        title={aria}
      >
        <span className={css.label}>{t('status.current', { version: state.version })}</span>
      </span>
    )
  }

  const view = buttonView(state, t)

  const invoke = (): void => {
    /* v8 ignore next -- the HTML button is disabled for both conditions, so React cannot dispatch this handler while either is true. */
    if (view.disabled || invoking) return
    setInvoking(true)
    setActionFailure(undefined)
    const action = view.install ? install : download
    void action().catch((error: unknown) => {
      if (!mounted.current) return
      setActionFailure(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (mounted.current) setInvoking(false)
    })
  }

  return (
    <button
      type="button"
      className={`${css.entry} ${css.action} ${wide ? css.wide : css.rail}`}
      data-desktop-update-status={state.status}
      aria-label={view.aria}
      title={actionFailure ?? (state.status === 'error' ? state.message : view.aria)}
      disabled={view.disabled || invoking}
      onClick={invoke}
    >
      {view.install || state.status === 'error'
        ? <IconRefreshOutline16 size={wide ? 16 : 18} />
        : <IconDownloadOutline16 size={wide ? 16 : 18} />}
      {wide && <span className={css.label}>{view.label}</span>}
      {view.percent !== undefined && <span className={css.progress} style={{ width: `${String(view.percent)}%` }} />}
    </button>
  )
}
