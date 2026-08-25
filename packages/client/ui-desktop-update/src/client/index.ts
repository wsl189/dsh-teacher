/**
 * Desktop update action, browser half: when Electron exposes its isolated
 * updater bridge, occupy `sidebar.update` with the GitHub Releases state and
 * actions. Ordinary browser deployments register no occupant.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { DesktopUpdateSource } from './source.ts'
import { UpdateButton, type UpdateButtonInjected } from './UpdateButton.tsx'
import { en, zh, type DesktopUpdateKey } from './locales.ts'

export type { DesktopUpdateBridge, DesktopUpdateState } from './bridge.ts'
export { isDesktopUpdateState } from './bridge.ts'
export { DesktopUpdateSource } from './source.ts'
export type { DesktopUpdateKey } from './locales.ts'
export type { UpdateButtonInjected, UpdateButtonProps } from './UpdateButton.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop update action copy. */
    'desktop-update': DesktopUpdateKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-update'

/** Required services: the target slot registry and locale registry. */
export const inject = ['slots', 'locale']

/**
 * Register the optional desktop update action and bind its preload source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-update: dictionaries')
  const bridge = window.dshDesktopUpdate
  if (bridge === undefined) return

  const source = new DesktopUpdateSource(bridge)
  ctx.effect(() => () => { source.dispose() }, 'ui-desktop-update: preload subscription')
  const injected = (): UpdateButtonInjected => ({
    hooks: { update: source },
    download: source.download,
    install: source.install,
  })
  ctx.slots.inject('sidebar.update', () => ctx.slots.register({
    name: 'sidebar.update',
    locale: NS,
    inject: injected,
  }, UpdateButton))
}
