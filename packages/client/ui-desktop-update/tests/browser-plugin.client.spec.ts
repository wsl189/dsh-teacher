// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { UpdateButton, type UpdateButtonInjected } from '../src/client/UpdateButton.tsx'
import type { DesktopUpdateBridge } from '../src/client/bridge.ts'
import { apply as nodeApply } from '../src/index.ts'

const download = vi.fn(() => Promise.resolve())
const install = vi.fn(() => Promise.resolve())
const bridge: DesktopUpdateBridge = {
  getState: () => ({ status: 'available', version: '1.2.0' }),
  subscribe: vi.fn(() => 1),
  unsubscribe: vi.fn(),
  download,
  install,
}

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register({
      name: 'root', children: { 'sidebar.update': { kind: 'single', scope: 'root' } },
    } as never, () => null)
  }
  return { ctx, slots }
}

afterEach(() => {
  delete window.dshDesktopUpdate
  vi.clearAllMocks()
})

describe('ui-desktop-update browser apply', () => {
  it('declares its service use and keeps the node half inert', () => {
    expect(inject).toEqual(['slots', 'locale'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('leaves the desktop seat empty in an ordinary browser', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.update')).toHaveLength(0)
  })

  it('registers the action after its owner appears and removes it on teardown', async () => {
    window.dshDesktopUpdate = bridge
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.update')).toHaveLength(0)
    b.slots.register({
      name: 'root', children: { 'sidebar.update': { kind: 'single', scope: 'root' } },
    } as never, () => null)
    await Promise.resolve()
    const entry = b.slots.entries('sidebar.update')[0]
    expect(entry?.component).toBe(UpdateButton)
    const injected = (entry?.inject as unknown as () => UpdateButtonInjected)()
    expect(injected.hooks.update.getSnapshot()).toEqual({ status: 'available', version: '1.2.0' })
    await injected.download()
    await injected.install()
    expect(download).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledOnce()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.update')).toHaveLength(0)
  })
})
