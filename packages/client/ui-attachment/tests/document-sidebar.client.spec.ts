// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerAttachmentsProps, DraftDocument } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  BetterSidebarService, SidebarTab, TabComponentProps, TabDescriptor,
} from 'dsh-better-sidebar/client/service'

vi.mock('../src/client/DocumentPreview.tsx', () => ({
  DocumentPreview: (props: { document: { name: string } }) => props.document.name,
}))

import { createDocumentSidebarController } from '../src/client/document-sidebar.tsx'

afterEach(cleanup)

const t = ((key: string) => key) as ComposerAttachmentsProps['t']

function document(id: string, name = `${id}.pptx`): DraftDocument {
  return { id: id as DraftDocument['id'], name, status: 'ready' }
}

function createSidebarBench(): {
  sidebar: BetterSidebarService
  descriptor: () => TabDescriptor
  openTab: ReturnType<typeof vi.fn>
  closeTab: ReturnType<typeof vi.fn>
  unregister: ReturnType<typeof vi.fn>
} {
  let registered: TabDescriptor | undefined
  const unregister = vi.fn()
  const openTab = vi.fn()
  const closeTab = vi.fn()
  const sidebar = {
    registerTab: vi.fn((next: TabDescriptor) => {
      registered = next
      return unregister
    }),
    openTab,
    closeTab,
  } as unknown as BetterSidebarService
  return {
    sidebar,
    descriptor: () => {
      if (registered === undefined) throw new Error('tab was not registered')
      return registered
    },
    openTab,
    closeTab,
    unregister,
  }
}

function tabProps(tab: SidebarTab, sessionId: SessionId): TabComponentProps {
  return {
    scope: { sessionId },
    tab,
    visible: true,
  } as unknown as TabComponentProps
}

describe('uploaded document sidebar controller', () => {
  it('opens the hidden tab, renders its source, and self-closes after source release', async () => {
    const bench = createSidebarBench()
    const controller = createDocumentSidebarController(bench.sidebar, 'Uploaded document')
    const descriptor = bench.descriptor()
    const sessionId = 'session/one' as SessionId
    const source = document('document:one', 'lesson.pptx')
    const file = new File([Uint8Array.of(1)], source.name)

    expect(descriptor).toMatchObject({ id: 'dsh:uploaded-document', hidden: true })
    controller.open(sessionId, source, file, t)
    const opened = bench.openTab.mock.calls[0]?.[0] as SidebarTab
    expect(opened).toEqual({
      type: 'dsh:uploaded-document',
      id: 'dsh:uploaded-document:session%2Fone:document%3Aone',
      title: 'lesson.pptx',
      path: 'lesson.pptx',
      meta: { documentId: source.id },
    })
    expect(bench.openTab.mock.calls[0]?.[1]).toEqual({ sessionId })
    expect(descriptor.dedupeKey?.(opened)).toBe(opened.id)

    const view = render(createElement(descriptor.component, tabProps(opened, sessionId)))
    expect(view.getByText('lesson.pptx')).toBeTruthy()
    descriptor.onClose?.(opened, { sessionId })
    view.rerender(createElement(descriptor.component, tabProps(opened, sessionId)))
    await waitFor(() => { expect(bench.closeTab).toHaveBeenCalledWith(opened.id, { sessionId }) })

    const restored = { ...opened, id: `${opened.id}:restored` }
    render(createElement(descriptor.component, tabProps(restored, sessionId)))
    await waitFor(() => { expect(bench.closeTab).toHaveBeenCalledWith(restored.id, { sessionId }) })
    controller.dispose()
    expect(bench.unregister).toHaveBeenCalledOnce()
  })

  it('reconciles moved and stale documents, closes direct targets, and disposes remaining sources', () => {
    const bench = createSidebarBench()
    const controller = createDocumentSidebarController(bench.sidebar, 'Uploaded document')
    const firstSession = 'session-one' as SessionId
    const secondSession = 'session-two' as SessionId
    const kept = document('kept')
    const stale = document('stale')
    const moved = document('moved')
    const direct = document('direct')
    for (const source of [kept, stale, direct]) {
      controller.open(firstSession, source, new File([], source.name), t)
    }
    controller.open(secondSession, moved, new File([], moved.name), t)

    controller.close(firstSession, direct.id)
    expect(bench.closeTab).toHaveBeenCalledWith(
      'dsh:uploaded-document:session-one:direct', { sessionId: firstSession },
    )
    controller.reconcile(firstSession, [kept, moved])
    expect(bench.closeTab).toHaveBeenCalledWith(
      'dsh:uploaded-document:session-two:moved', { sessionId: secondSession },
    )
    expect(bench.closeTab).toHaveBeenCalledWith(
      'dsh:uploaded-document:session-one:stale', { sessionId: firstSession },
    )

    controller.dispose()
    expect(bench.closeTab).toHaveBeenCalledWith(
      'dsh:uploaded-document:session-one:kept', { sessionId: firstSession },
    )
    expect(bench.unregister).toHaveBeenCalledOnce()
  })
})
