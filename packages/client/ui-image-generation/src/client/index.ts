/** Browser plugin for independent generated-image result Conversation Nodes. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ImageGenerationResultNode } from './ImageGenerationResultNode.tsx'
import {
  IMAGE_GENERATION_RESULT_KIND, imageGenerationResultDefinition,
} from './image-result-node.ts'

/** Required services for the Conversation Definition, keyed renderer, and shared image copy. */
export const inject = ['uiConversation', 'slots', 'locale']

/** Register the generated-image Definition and keyed Chat renderer. */
export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(imageGenerationResultDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: IMAGE_GENERATION_RESULT_KIND,
    locale: 'conversation',
  }, ImageGenerationResultNode))
}
