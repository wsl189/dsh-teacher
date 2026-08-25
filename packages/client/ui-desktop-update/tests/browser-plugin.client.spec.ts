// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { UpdateButton } from '../src/client/UpdateButton.tsx'
import type { DesktopUpdateBridge } from '../src/client/bridge.ts'
import { apply as nodeApply } from '../src/index.ts'

const bridge: DesktopUpdateBridge = {
  getState: () => ({ status: 'available', version: '1.2.0' }),
  subscribe: vi.fn(() => 1),
  unsubscribe: vi.fn(),
  download: vi.fn(() => Promise.resolve()),
  install: vi.fn(() => Promise.resolve()),
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
    expect(b.slots.entries('sidebar.update')[0]?.component).toBe(UpdateButton)
    await fiber.dispose()
    expect(b.slots.entries('sidebar.update')).toHaveLength(0)
  })
})
