// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps, DraftDocument,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ComposerAttachments, type ComposerAttachmentsInjected,
} from '../src/client/ComposerAttachments.tsx'
import type { DocumentSidebarController } from '../src/client/document-sidebar.tsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加文件夹或图片',
    'image.dropTitle': '将文件夹或图片拖到此处',
    'document.pending': '待发送文件',
    'document.extracting': 'MinerU 识别中…',
    'document.ready': '已识别',
    'document.readyTruncated': '已识别（内容已截断）',
    'document.failed': '识别失败',
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `文件夹仅添加路径；图片最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  if (key === 'document.remove') {
    const name = params?.name
    return `移除文件 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'document.openPreview') {
    const name = params?.name
    return `在右侧栏预览文件 ${typeof name === 'string' ? name : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function props(
  overrides: Partial<ComposerAttachmentsOwnerProps & ComposerAttachmentsInjected> & { sessionId?: SessionId } = {},
): ComposerAttachmentsProps & ComposerAttachmentsInjected {
  return {
    attachments: [],
    documents: [],
    canAcceptDrop: true,
    canRemoveDocuments: true,
    onAddImages: () => {},
    onAddDirectories: () => {},
    onRemoveImage: () => {},
    resolveDocumentFile: () => undefined,
    onRemoveDocument: () => {},
    documentSidebar: () => undefined,
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps & ComposerAttachmentsInjected
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({
      onAddImages,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const image = attachment('dropped').file
    const dataTransfer = { types: ['Files'], files: [image], items: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('将文件夹或图片拖到此处')
    expect(view.getByRole('status').textContent).toContain('文件夹仅添加路径；图片最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes directory paths without enumerating their contents and keeps mixed images separate', () => {
    const onAddDirectories = vi.fn()
    const onAddImages = vi.fn()
    const createReader = vi.fn()
    render(<ComposerAttachments {...props({ onAddDirectories, onAddImages })} />)
    const image = attachment('mixed').file
    const dataTransfer = {
      types: ['Files'],
      files: [image],
      items: [
        {
          kind: 'file',
          getAsFile: () => null,
          webkitGetAsEntry: () => ({
            isDirectory: true,
            name: 'design notes',
            fullPath: '/workspace/design notes',
            createReader,
          }),
        },
        {
          kind: 'file',
          getAsFile: () => image,
          webkitGetAsEntry: () => ({ isDirectory: false, name: image.name, fullPath: `/${image.name}` }),
        },
      ],
      dropEffect: 'none',
    }

    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddDirectories).toHaveBeenCalledWith(['workspace/design notes'])
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(createReader).not.toHaveBeenCalled()
  })

  it('prefers a native dropped directory path when the client exposes one', () => {
    const onAddDirectories = vi.fn()
    render(<ComposerAttachments {...props({ onAddDirectories })} />)
    const directory = new File([], 'source')
    Object.defineProperty(directory, 'path', { value: 'C:\\work\\source' })
    fireEvent.drop(document.body, {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [{
          kind: 'file',
          getAsFile: () => directory,
          webkitGetAsEntry: () => ({ isDirectory: true, name: 'source', fullPath: '/source' }),
        }],
      },
    })
    expect(onAddDirectories).toHaveBeenCalledWith(['C:/work/source'])
  })

  it('drops unusable entries and falls back to a directory entry name', () => {
    const onAddDirectories = vi.fn()
    const onAddImages = vi.fn()
    render(<ComposerAttachments {...props({ onAddDirectories, onAddImages })} />)
    const image = attachment('entry-without-metadata').file
    const emptyNativePath = new File([], 'named folder')
    Object.defineProperty(emptyNativePath, 'path', { value: '' })
    fireEvent.drop(document.body, {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [
          { kind: 'string' },
          {
            kind: 'file',
            getAsFile: () => emptyNativePath,
            webkitGetAsEntry: () => ({ isDirectory: true, name: 'named folder' }),
          },
          {
            kind: 'file',
            getAsFile: () => null,
            webkitGetAsEntry: () => ({ isDirectory: true, name: 'empty', fullPath: '///' }),
          },
          {
            kind: 'file',
            getAsFile: () => null,
            webkitGetAsEntry: () => ({ isDirectory: false, name: 'missing' }),
          },
          {
            kind: 'file',
            getAsFile: () => image,
            webkitGetAsEntry: () => null,
          },
        ],
      },
    })

    expect(onAddDirectories).toHaveBeenCalledWith(['named folder'])
    expect(onAddImages).toHaveBeenCalledWith([image])
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddImages = vi.fn()
    const onAddDirectories = vi.fn()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages, onAddDirectories })} />)
    const image = attachment('blocked').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加文件夹或图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).not.toHaveBeenCalled()
    expect(onAddDirectories).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveImage = vi.fn()
    const image = attachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveImage })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveImage).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveImage })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = attachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })

  it('opens uploaded documents in the sidebar and closes their tabs before removal', () => {
    const document: DraftDocument = {
      id: 'document-1' as DraftDocument['id'],
      name: 'lesson.docx',
      status: 'extracting',
    }
    const file = new File([Uint8Array.of(1)], document.name)
    const open = vi.fn()
    const close = vi.fn()
    const reconcile = vi.fn()
    const sidebar: DocumentSidebarController = {
      open,
      close,
      reconcile,
      dispose: vi.fn(),
    }
    const onRemoveDocument = vi.fn()
    const sessionId = 'session-1' as SessionId
    const view = render(<ComposerAttachments {...props({
      sessionId,
      documents: [document],
      resolveDocumentFile: () => file,
      onRemoveDocument,
      documentSidebar: () => sidebar,
    })} />)

    fireEvent.click(view.getByRole('button', { name: '在右侧栏预览文件 lesson.docx' }))
    expect(open).toHaveBeenCalledWith(sessionId, document, file, t)
    fireEvent.click(view.getByRole('button', { name: '移除文件 lesson.docx' }))
    expect(close).toHaveBeenCalledWith(sessionId, document.id)
    expect(onRemoveDocument).toHaveBeenCalledWith(document.id)
    expect(reconcile).toHaveBeenCalledWith(sessionId, [document])
  })

  it('renders every document state and keeps cards static without a complete sidebar target', () => {
    const documents: DraftDocument[] = [
      { id: 'extracting' as DraftDocument['id'], name: 'extracting.pdf', status: 'extracting' },
      { id: 'failed' as DraftDocument['id'], name: 'failed.pdf', status: 'error', error: 'OCR failed' },
      { id: 'ready' as DraftDocument['id'], name: 'ready.pdf', status: 'ready' },
      { id: 'truncated' as DraftDocument['id'], name: 'truncated.pdf', status: 'ready', truncated: true },
    ]
    const open = vi.fn()
    const close = vi.fn()
    const sidebar: DocumentSidebarController = {
      open,
      close,
      reconcile: vi.fn(),
      dispose: vi.fn(),
    }
    const onRemoveDocument = vi.fn()
    const view = render(<ComposerAttachments {...props({
      documents,
      documentSidebar: () => sidebar,
      onRemoveDocument,
    })} />)

    expect(view.getByText('MinerU 识别中…')).toBeTruthy()
    expect(view.getByText('识别失败')).toBeTruthy()
    expect(view.getByText('已识别')).toBeTruthy()
    expect(view.getByText('已识别（内容已截断）')).toBeTruthy()
    expect(view.queryByRole('button', { name: '在右侧栏预览文件 ready.pdf' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '移除文件 ready.pdf' }))
    expect(close).not.toHaveBeenCalled()
    expect(onRemoveDocument).toHaveBeenCalledWith(documents[2]?.id)

    const sessionId = 'static-session' as SessionId
    view.rerender(<ComposerAttachments {...props({
      sessionId,
      documents: [documents[2]!],
      resolveDocumentFile: () => undefined,
      documentSidebar: () => sidebar,
      onRemoveDocument,
    })} />)
    fireEvent.click(view.getByRole('button', { name: '在右侧栏预览文件 ready.pdf' }))
    expect(open).not.toHaveBeenCalled()

    view.rerender(<ComposerAttachments {...props({
      sessionId,
      documents: [documents[2]!],
      documentSidebar: () => undefined,
      onRemoveDocument,
    })} />)
    fireEvent.click(view.getByRole('button', { name: '移除文件 ready.pdf' }))
    expect(onRemoveDocument).toHaveBeenCalledTimes(2)
  })
})
