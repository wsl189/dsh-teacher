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
 * No runtime invariant: the private service owns workbench and example records;
 * domain schemas validate their references and source/Word status on reopen.
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
