/** Deterministic external-model responses for the assembled collection proofreading flow. */

import {
  LlmAdapter, ToolCallId, type GenerateOptions, type LlmModelInfo,
  type LlmProviderInfo, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Scripted model seam; the real child owns prompts, attachments, and structured-output execution. */
export class ExampleCorrectionAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  fail = false

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Example proofreading fixture' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'proofreader', name: 'Proofreader', inputModalities: ['text', 'image'] }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Proofreader', inputModalities: ['text', 'image'], contextWindow: 128_000 })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.fail) throw new Error('Proofreading fixture provider failed')
    const content = options.messages.flatMap(message => message.content)
    const input = content.find(block => block.type === 'text' && (block.text.includes('"mineruMarkdown":') || block.text.includes('"documentText":')))
    if (input?.type !== 'text' || content.every(block => block.type !== 'image')) {
      throw new Error('Proofreading requires both MinerU text and original page images')
    }
    if (options.tools?.length !== 1 || options.tools[0]?.name !== 'structured_output') {
      throw new Error('The proofreading child must expose only its structured result tool')
    }
    const evidence = JSON.parse(input.text.slice(input.text.indexOf('\n') + 1)) as { mineruMarkdown: string } | { documentText: string; paragraphs: { index: number; text: string }[] }
    const result = 'documentText' in evidence
      ? { headings: evidence.paragraphs.flatMap(({ index, text }) => text.startsWith('【题 4】') ? [{ paragraph: index, prefix: text.slice(0, text.indexOf('已知')) }] : []) }
      : { markdown: evidence.mineruMarkdown.replaceAll('点0', '点 O').replaceAll('$a\\cdot b:c$', '\\(a:b:c\\)') }
    const id = ToolCallId(`proofread-${String(this.requests.length)}`)
    const args = JSON.stringify(result)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'structured_output', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'structured_output', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
