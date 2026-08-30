import type { UserConfig } from 'tsdown'
import { staticLinked } from '../../client/tsdown.client.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-concurrency'
const ENTRIES = ['lib/types/index.js', 'lib/types/invariant.js'] as const
const browser = staticLinked(PACKAGE_NAME, ENTRIES)

/**
 * Build the isomorphic utility for Host consumers, then replace those files
 * with the browser-static form during the Client pass.
 * @param options - Build-face environment selected by the workspace command.
 * @returns The configs for the selected build face.
 */
export default function config({ env }: Pick<UserConfig, 'env'>): UserConfig[] {
  if (env?.DSH_BUILD_FACE !== 'host') return browser({ env })
  return [{
    name: PACKAGE_NAME,
    entry: [...ENTRIES],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }]
}
