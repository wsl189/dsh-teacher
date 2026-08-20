import { describe, expect, it } from 'vitest'
import { clientBundle } from '../../tsdown.client.ts'

describe('shared Client bundle preset', () => {
  it('inlines dynamic imports because the plugin loader registers only lib/client.js', () => {
    const select = clientBundle('@fixture/client-bundle', ['lib/types/index.js'])
    const configs = select({ env: { DSH_BUILD_FACE: 'client' } })
    const client = configs.at(-1)
    expect(client?.outputOptions).toMatchObject({ codeSplitting: false })
  })
})
