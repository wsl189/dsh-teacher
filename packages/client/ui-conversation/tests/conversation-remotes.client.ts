import type { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'

/**
 * Provide the Remote namespaces required to mount Conversation in UI-only tests.
 * @param remote - the runtime's existing Remote double.
 */
export function installConversationRemoteStubs(remote: TestRemote): void {
  const unused = (name: string) => () => Promise.reject(new Error(`${name} must not run in this test`))
  remote.provideNamespaces({
    ocr: { extract: unused('OCR') },
    speech: { transcribe: unused('speech transcription') },
    teacherWorkbench: { stageSource: unused('workbench staging') },
  })
}
