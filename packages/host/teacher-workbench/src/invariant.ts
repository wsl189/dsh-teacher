/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-teacher-workbench/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-teacher-workbench'

/** Cordis companion plugin name. */
export const name = 'host-teacher-workbench-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: one private service owns the singleton and the domain
 * schema validates its complete document whenever the medium is reopened.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['teacherWorkbench'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
