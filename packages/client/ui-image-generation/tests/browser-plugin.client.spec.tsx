// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { zh as conversationZh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { ImageGenerationResultNode, generatedImageUrl } from '../src/client/ImageGenerationResultNode.tsx'
import { apply, inject } from '../src/client/index.ts'
import { IMAGE_GENERATION_RESULT_KIND } from '../src/client/image-result-node.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const image: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:image'),
  mediaType: 'image/png',
  bytes: 68,
  width: 640,
  height: 320,
  name: 'generated.png',
}

function node(images: readonly ImageAttachmentRef[]) {
  return {
    key: '23:image-generation-result1',
    kind: IMAGE_GENERATION_RESULT_KIND,
    id: '1',
    target: 'chat' as const,
    anchorSeq: 8,
    location: { kind: 'unresolved' as const },
    visibility: 'visible' as const,
    data: { turn: 1, images },
  }
}

function props(images: readonly ImageAttachmentRef[]) {
  return {
    node: node(images),
    t: makeTranslate(conversationZh),
  } as unknown as Parameters<typeof ImageGenerationResultNode>[0]
}

async function bench() {
  const ctx = new Context()
  const sessions = {
    binding: () => undefined,
  }
  const definitions = new UiConversation(ctx, sessions as never).events
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    definitions: () => definitions.entries(),
    entry: () => ctx.slots.entries('conversation.chat.node')[0],
  }
}

describe('generated-image result renderer', () => {
  it('loads through the bundled loopback route, opens the original, and revokes the URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([Uint8Array.of(1)], { type: 'image/png' })),
    } as Response)
    vi.stubGlobal('fetch', fetch)
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generated')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const view = render(<ImageGenerationResultNode {...props([image])} />)

    expect(view.getByText('图片加载中…')).toBeTruthy()
    await waitFor(() => { expect(view.getByAltText('generated.png')).toBeTruthy() })
    expect(fetch.mock.calls[0]?.[0]).toBe(generatedImageUrl(image))
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(generatedImageUrl(image)).toBe(
      '/api/dsh-imagegen/agent-image?attachment_id=sha256%3Aimage&media_type=image%2Fpng&bytes=68&width=640&height=320',
    )
    const link = view.getByRole('link', { name: 'generated.png，点击查看原图' })
    expect(link.getAttribute('href')).toBe('blob:generated')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('title')).toBe('查看原图')
    expect(link.getAttribute('style')).toContain('width: 520px')
    expect(created).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(revoked).toHaveBeenCalledWith('blob:generated')
  })

  it('retries a failed load and renders multiple unnamed images as tiles', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob([Uint8Array.of(2)], { type: 'image/png' })),
      } as Response)
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retried')
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const unnamed: ImageAttachmentRef = {
      attachmentId: AttachmentId('sha256:unnamed'),
      mediaType: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    }
    const view = render(<ImageGenerationResultNode {...props([image, unnamed])} />)

    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retry)
    await waitFor(() => { expect(view.getByAltText('generated.png')).toBeTruthy() })
    await waitFor(() => { expect(view.getByAltText('图片')).toBeTruthy() })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(view.container.querySelector('[data-image-generation-results]')?.getAttribute('data-count')).toBe('2')
    expect(view.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(2)
  })

  it('surfaces a non-success response as the localized retry control', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const view = render(<ImageGenerationResultNode {...props([image])} />)
    expect(await view.findByRole('button', { name: '图片加载失败，点击重试' })).toBeTruthy()
  })

  it('drops a response whose blob finishes after unmount', async () => {
    let resolveBlob: ((blob: Blob) => void) | undefined
    const blob = new Promise<Blob>((resolve) => { resolveBlob = resolve })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: true,
      blob: () => blob,
    } as Response)
    vi.stubGlobal('fetch', fetch)
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late')
    const view = render(<ImageGenerationResultNode {...props([image])} />)
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    view.unmount()
    resolveBlob?.(new Blob([Uint8Array.of(3)], { type: 'image/png' }))
    await blob
    await Promise.resolve()
    expect(created).not.toHaveBeenCalled()
  })

  it('swallows a fetch rejection caused by unmount abort', async () => {
    let observedAbort: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => { observedAbort = resolve })
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
        observedAbort?.()
      })
    }))
    vi.stubGlobal('fetch', fetch)
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aborted')
    const view = render(<ImageGenerationResultNode {...props([image])} />)
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    view.unmount()
    await aborted
    await Promise.resolve()
    expect(created).not.toHaveBeenCalled()
  })
})

describe('generated-image browser plugin', () => {
  it('registers and disposes the Definition and keyed Chat renderer', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.definitions().map(definition => definition.kind)).toEqual([IMAGE_GENERATION_RESULT_KIND])
    expect(b.entry()?.options).toMatchObject({ key: IMAGE_GENERATION_RESULT_KIND })
    expect(b.entry()?.locale).toBe('conversation')
    await b.fiber.dispose()
    expect(b.definitions()).toHaveLength(0)
    expect(b.entry()).toBeUndefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
