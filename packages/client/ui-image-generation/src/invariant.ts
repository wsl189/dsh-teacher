/** Package-owned invariant companion for the generated-image result UI plugin. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-image-generation'

/** Cordis companion plugin name. */
export const name = 'client-ui-image-generation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser plugin contributes one effect-owned
 * Conversation Definition and keyed renderer; its plugin spec proves disposal,
 * while the image provider owns the attachment route and result metadata.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
