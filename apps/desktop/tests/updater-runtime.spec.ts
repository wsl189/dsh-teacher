import { describe, expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => Object.freeze({ token: 'auto-updater' }))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: updater },
}))

import { autoUpdater } from '../src/updater-runtime.ts'

describe('electron-updater runtime adapter', () => {
  it('loads the updater from the CommonJS default export', () => {
    expect(autoUpdater).toBe(updater)
  })
})
