// @vitest-environment jsdom
/** ToolCallTree-owned root/subcall markers and selection projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolGroupProps, ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallGroup, ToolCallTree } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

function props(
  block: ToolResultNode,
  selectedCallId?: string,
  description?: HostDescription,
): ToolTreeProps {
  const snapshot = {} as ConversationSnapshot
  const useSession = ((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((_key: string, _owner: object, options?: { fallback?: React.ReactNode }) =>
    options?.fallback ?? null) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedCallId,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostDescription: (selector => selector(description)) as ToolTreeProps['useHostDescription'],
    t,
  } as unknown as ToolTreeProps
}

function groupProps(blocks: readonly ToolResultNode[]): ToolGroupProps {
  const nodes = blocks.map(block => ({
    key: `tool:${block.callId}`,
    kind: 'tool-call' as const,
    id: block.callId,
    target: 'chat' as const,
    anchorSeq: block.seq,
    location: { kind: 'session' as const },
    visibility: 'visible' as const,
    data: { root: block },
  }))
  const byKey = new Map(nodes.map(node => [node.key, node]))
  const snapshot = {
    chat: {
      nodes: {
        get: (key: string) => byKey.get(key),
        values: () => nodes,
      },
    },
  } as unknown as ConversationSnapshot
  const useSession = ((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as ToolGroupProps['useSession']
  const renderSlot = ((_key: string, _owner: object, options?: { fallback?: React.ReactNode }) =>
    options?.fallback ?? null) as unknown as ToolGroupProps['renderSlot']
  return {
    useSession,
    renderSlot,
    nodeKeys: nodes.map(node => node.key),
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostDescription: (selector => selector(undefined)) as ToolGroupProps['useHostDescription'],
    t,
  } as unknown as ToolGroupProps
}

describe('ToolCallTree', () => {
  it('owns the root marker, generic fallback, and selected state for a window-truncated call', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block, 'w1')} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(row?.getAttribute('data-selected')).toBe('true')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('recursively renders a selected leaf without selecting its ancestors', () => {
    const leaf = root('parent:code:1:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    const child = {
      ...root('parent:code:1', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [leaf],
    }
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [child],
    }
    const view = render(<ToolCallTree {...props(block, leaf.callId)} />)
    const nests = view.container.querySelectorAll('[data-subcalls]')
    expect(nests[0]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent"]'))
    expect(nests[1]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent:code:1"]'))
    expect(view.container.querySelector('[data-chat-call-id="parent"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1:code:1"]')?.getAttribute('data-selected')).toBe('true')
    expect(nests).toHaveLength(2)
  })

  it('abbreviates a POSIX home path in the generic tool summary', () => {
    const block = root('w1', { name: 'read', argsRaw: '{"path":"/h/docs/a.ts"}' })
    const view = render(<ToolCallTree {...props(block, 'w1', {
      version: '0', cwd: '/tmp', attachedSessions: 0, home: '/h', canOpenPath: false,
    })} />)
    expect(view.getByText('~/docs/a.ts')).toBeTruthy()
  })
})

describe('ToolCallGroup', () => {
  it('summarizes repeated domain actions in one row and expands the original calls', () => {
    const blocks = Array.from({ length: 10 }, (_, index) => index % 2 === 0
      ? root(`edit-${index}`, {
        name: 'teacher_question_workbench.erase_image_regions', argsRaw: '{}',
      })
      : root(`read-${index}`, {
        name: 'teacher_question_image_read.batch', argsRaw: '{}',
      }))
    const view = render(<ToolCallGroup {...groupProps(blocks)} />)
    const disclosure = view.getByRole('button', { name: '编辑了文件 ×5、读取了内容 ×5' })
    expect(view.container.querySelectorAll('[data-chat-call-id]')).toHaveLength(0)
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelectorAll('[data-chat-call-id]')).toHaveLength(10)
  })

  it('collapses recursive Code Dispatch work even when it has one root', () => {
    const child = root('root:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    const block = { ...root('root', { name: 'run_code', argsRaw: '{"code":"return 1"}' }), subCalls: [child] }
    const view = render(<ToolCallGroup {...groupProps([block])} />)
    expect(view.getByRole('button', { name: '运行了代码、读取了内容' })).toBeTruthy()
  })
})
