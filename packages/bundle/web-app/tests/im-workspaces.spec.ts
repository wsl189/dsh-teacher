/** Exercise the patched third-party entry loaded by the shipped Web bundle. */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const entry = pathToFileURL(require.resolve('@xmanrui/dsh-im')).href
const { createImHostPlugin } = await import(entry) as {
  createImHostPlugin: (internals: Record<string, (ctx: object, config: Record<string, unknown>) => void>) => {
    apply(ctx: object, config?: Record<string, unknown>): Promise<void>
  }
}

const channels = ['Feishu', 'Weixin', 'Dingtalk', 'Wecom', 'Qq', 'Slack', 'Telegram', 'Discord', 'Whatsapp']

function channelCallbacks() {
  return Object.fromEntries([...channels, 'Office'].map(channel => [
    `apply${channel}`, vi.fn<(ctx: object, config: Record<string, unknown>) => void>(),
  ]))
}

afterEach(() => { vi.unstubAllEnvs() })

describe('bundled IM bot workspace defaults', () => {
  it('passes the system desktop to all nine platforms while leaving Office settings intact', async () => {
    const desktop = join(homedir(), 'OneDrive', '课程资料', '桌面')
    vi.stubEnv('DSH_DESKTOP_DIR', desktop)
    const callbacks = channelCallbacks()
    const office = { enabled: false }
    await createImHostPlugin(callbacks).apply({}, { office })

    for (const channel of channels) {
      expect(callbacks[`apply${channel}`]).toHaveBeenCalledWith({}, { workspace: desktop })
    }
    expect(callbacks.applyOffice).toHaveBeenCalledWith({}, office)
  })

  it('uses the Host home Desktop directory without an Electron-provided path', async () => {
    vi.stubEnv('DSH_DESKTOP_DIR', undefined)
    const callbacks = channelCallbacks()
    await createImHostPlugin(callbacks).apply({})

    for (const channel of channels) {
      expect(callbacks[`apply${channel}`]).toHaveBeenCalledWith({}, { workspace: join(homedir(), 'Desktop') })
    }
  })

  it('preserves explicit platform workspaces and settings without mutating the caller', async () => {
    vi.stubEnv('DSH_DESKTOP_DIR', join(homedir(), 'Desktop'))
    const callbacks = channelCallbacks()
    const configs = Object.freeze(Object.fromEntries(channels.map(channel => [
      channel.toLowerCase(), Object.freeze({ workspace: join(homedir(), channel), agentPreset: 'standard' }),
    ])))
    await createImHostPlugin(callbacks).apply({}, configs)

    for (const channel of channels) {
      expect(callbacks[`apply${channel}`]).toHaveBeenCalledWith({}, configs[channel.toLowerCase()])
    }
  })

  it.each(['', 'relative-desktop'])('rejects a non-absolute desktop path: %j', async (desktop) => {
    vi.stubEnv('DSH_DESKTOP_DIR', desktop)
    const callbacks = channelCallbacks()
    await expect(createImHostPlugin(callbacks).apply({})).rejects.toThrow(
      'DSH_DESKTOP_DIR must be an absolute directory path',
    )
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
  })
})
