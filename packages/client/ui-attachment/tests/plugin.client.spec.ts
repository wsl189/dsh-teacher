import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import {
  ComposerAttachments, type ComposerAttachmentsInjected,
} from '../src/client/ComposerAttachments.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'

async function bench(sidebar?: BetterSidebarService) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  if (sidebar !== undefined) ctx.provide('betterSidebar', sidebar)
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.message.images': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('attachment plugin', () => {
  it('keeps the host half empty', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('registers both entries and removes them with the plugin fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(inject).toEqual(['slots'])
    expect(ctx.slots.entries('conversation.input.attachments')).toMatchObject([{
      locale: 'conversation',
      component: ComposerAttachments,
    }])
    expect(ctx.slots.entries('conversation.message.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])
    const attachmentEntry = ctx.slots.entries('conversation.input.attachments')[0]!
    const injected = (attachmentEntry.inject as unknown as () => ComposerAttachmentsInjected)()
    expect(injected.documentSidebar()).toBeUndefined()

    await fiber.dispose()

    expect(ctx.slots.entries('conversation.input.attachments')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.message.images')).toHaveLength(0)
  })

  it('publishes and disposes the optional uploaded-document sidebar controller', async () => {
    const unregister = vi.fn()
    const registerTab = vi.fn(() => unregister)
    const sidebar = {
      registerTab,
      closeTab: vi.fn(),
      openTab: vi.fn(),
    } as unknown as BetterSidebarService
    const { ctx, fiber } = await bench(sidebar)
    const attachmentEntry = ctx.slots.entries('conversation.input.attachments')[0]!
    const injected = (attachmentEntry.inject as unknown as () => ComposerAttachmentsInjected)()

    expect(injected.documentSidebar()).toBeDefined()
    expect(registerTab).toHaveBeenCalledOnce()
    await fiber.dispose()
    expect(unregister).toHaveBeenCalledOnce()
    expect(injected.documentSidebar()).toBeUndefined()
  })
})
