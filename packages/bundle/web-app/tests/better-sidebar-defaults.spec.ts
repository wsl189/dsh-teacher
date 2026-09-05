/** Shipped sidebar preferences keep Tasks opt-in without replacing saved choices. */

import { describe, expect, it } from 'vitest'
import { parsePrefs, SIDEBAR_PREFS_DEFAULTS } from 'dsh-better-sidebar/src/client/prefs.ts'

describe('built-in better-sidebar defaults', () => {
  it('disables Tasks in the initial client preferences', () => {
    expect(SIDEBAR_PREFS_DEFAULTS.tabsEnabled).toEqual({ subagent: false })
  })

  it.each([undefined, {}, { tabsEnabled: {} }, { tabsEnabled: { editor: false, 'custom-tab': true } }])(
    'keeps Tasks disabled when the saved preferences omit its switch: %j',
    (saved) => {
      expect(parsePrefs(saved).tabsEnabled).toEqual({
        subagent: false,
        ...saved?.tabsEnabled,
      })
    },
  )

  it.each([false, true])('preserves an explicit Tasks choice of %s and other tab choices', (enabled) => {
    const tabsEnabled = { subagent: enabled, editor: false, 'custom-tab': true }
    expect(parsePrefs({ tabsEnabled }).tabsEnabled).toEqual(tabsEnabled)
  })
})
