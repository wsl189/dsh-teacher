import { useEffect } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerAttachmentsProps, DraftDocument } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  BetterSidebarService, SessionScope, TabComponentProps,
} from 'dsh-better-sidebar/client/service'
import { DocumentPreview, type DocumentPreviewSource } from './DocumentPreview.tsx'

const DOCUMENT_TAB_TYPE = 'dsh:uploaded-document'

function tabId(sessionId: SessionId, documentId: DraftDocument['id']): string {
  return `${DOCUMENT_TAB_TYPE}:${encodeURIComponent(sessionId)}:${encodeURIComponent(documentId)}`
}

/** Runtime bridge from composer document cards to transient better-sidebar tabs. */
export interface DocumentSidebarController {
  /** Open or focus the tab backed by one browser-held file. */
  open(
    sessionId: SessionId,
    document: DraftDocument,
    file: File,
    t: ComposerAttachmentsProps['t'],
  ): void
  /** Close one document's tab before its browser file is released. */
  close(sessionId: SessionId, documentId: DraftDocument['id']): void
  /** Close tabs whose document rows have left one session's composer. */
  reconcile(sessionId: SessionId, documents: readonly DraftDocument[]): void
  /** Remove the tab type and close every tab whose source this controller owns. */
  dispose(): void
}

/**
 * Register the hidden uploaded-document tab type against one sidebar service.
 * @param sidebar - better-sidebar registry and targeted-open service.
 * @returns the controller owned by the calling Cordis fiber.
 */
export function createDocumentSidebarController(sidebar: BetterSidebarService): DocumentSidebarController {
  const sources = new Map<string, DocumentPreviewSource & { readonly sessionId: SessionId }>()

  function PreviewTab({ scope, tab }: TabComponentProps) {
    const source = sources.get(tab.id)
    useEffect(() => {
      if (source === undefined) sidebar.closeTab(tab.id, scope)
    }, [scope, source, tab.id])
    return source === undefined ? null : <DocumentPreview {...source} />
  }

  const unregister = sidebar.registerTab({
    id: DOCUMENT_TAB_TYPE,
    title: 'Uploaded document',
    hidden: true,
    dedupeKey: tab => tab.id,
    onClose: (tab) => { sources.delete(tab.id) },
    component: PreviewTab,
  })

  const close = (sessionId: SessionId, documentId: DraftDocument['id']): void => {
    const id = tabId(sessionId, documentId)
    sources.delete(id)
    sidebar.closeTab(id, { sessionId })
  }

  return {
    open: (sessionId, document, file, t) => {
      const id = tabId(sessionId, document.id)
      sources.set(id, { sessionId, document, file, t })
      sidebar.openTab({
        type: DOCUMENT_TAB_TYPE,
        id,
        title: document.name,
        path: document.name,
        meta: { documentId: document.id },
      }, { sessionId })
    },
    close,
    reconcile: (sessionId, documents) => {
      const live = new Set(documents.map(document => document.id))
      const moved = [...sources.values()].filter(source =>
        source.sessionId !== sessionId && live.has(source.document.id))
      for (const source of moved) close(source.sessionId, source.document.id)
      const stale = [...sources.entries()].filter(([, source]) =>
        source.sessionId === sessionId && !live.has(source.document.id))
      for (const [, source] of stale) close(sessionId, source.document.id)
    },
    dispose: () => {
      const owned = [...sources.entries()]
      sources.clear()
      for (const [id, source] of owned) {
        const scope: SessionScope = { sessionId: source.sessionId }
        sidebar.closeTab(id, scope)
      }
      unregister()
    },
  }
}
