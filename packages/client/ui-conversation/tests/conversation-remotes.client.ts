import type { Context } from '@deepseek-ai/cordis'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'

/** Provide the Remote namespaces required to mount Conversation in UI-only tests. */
export function installConversationRemoteStubs(ctx: Context): void {
  const unused = (name: string) => () => Promise.reject(new Error(`${name} must not run in this test`))
  new TestRemote(ctx, {
    ocr: { extract: unused('OCR') },
    speech: { transcribe: unused('speech transcription') },
    teacherWorkbench: { stageSource: unused('workbench staging') },
  })
}
