/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service'
import { ComposerAttachments, type ComposerAttachmentsInjected } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'
import {
  createDocumentSidebarController, type DocumentSidebarController,
} from './document-sidebar.tsx'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  let documentSidebar: DocumentSidebarController | undefined
  ctx.inject(['betterSidebar'], (scope: ClientContext) => {
    const sidebar = scope.get('betterSidebar') as BetterSidebarService
    const controller = createDocumentSidebarController(sidebar)
    documentSidebar = controller
    scope.effect(() => () => {
      controller.dispose()
      documentSidebar = undefined
    }, 'ui-attachment: uploaded document sidebar')
  })
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
    inject: (): ComposerAttachmentsInjected => ({ documentSidebar: () => documentSidebar }),
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
}
