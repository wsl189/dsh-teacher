/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-desktop-update`.
 * @module @deepseek-ai/dsh-client-ui-desktop-update/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-desktop-update'

/** Cordis companion plugin name. */
export const name = 'client-ui-desktop-update-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the optional preload bridge is browser-local, while
 * slot registration, state publication, actions, and teardown are covered by
 * this package's component and browser-plugin tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
