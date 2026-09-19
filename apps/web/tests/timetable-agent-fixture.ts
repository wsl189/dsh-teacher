/** Scripted model responses for complete timetable child loops in the assembled Web app. */

import {
  LlmAdapter, ToolCallId, type GenerateOptions, type LlmModelInfo,
  type LlmProviderInfo, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The external model seam; source inspection and validated submission execute in the real child. */
export class TimetableAgentAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  notTimetable = false

  constructor(
    private readonly entries: () => readonly object[],
    private readonly images = false,
    private readonly beforeResponse?: () => Promise<void>,
  ) { super() }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Timetable fixture' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'timetable', name: 'Timetable' }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: 'Timetable', contextWindow: 500_000,
      inputModalities: this.images ? ['text', 'image'] : ['text'],
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    await this.beforeResponse?.()
    const results = options.messages.flatMap(message => message.content)
      .filter(block => block.type === 'tool-result')
    const resultText = results.flatMap(result => result.content).filter(block => block.type === 'text')
      .map(block => block.text).join('\n')
    const responses = resultText.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as {
      regions?: { region: number; pages: number }[]
      region?: number
      page?: number
      validationToken?: string
      batchId?: string
      error?: string
    })
    const failure = responses.find(value => value.error !== undefined)
    if (failure !== undefined) throw new Error(`Timetable fixture: ${failure.error}`)
    const token = responses.find(value => value.validationToken !== undefined)?.validationToken
    const index = responses.find(value => value.regions !== undefined)?.regions
    const unread = index?.flatMap(region => Array.from({ length: region.pages }, (_, page) => ({ region: region.region, page })))
      .find(page => !responses.some(value => value.region === page.region && value.page === page.page))
    const hasBatch = responses.some(value => value.batchId !== undefined)
    const source = options.tools?.find(tool => tool.name.startsWith('timetable_source_'))?.name
    const draft = options.tools?.find(tool => tool.name.startsWith('timetable_draft_'))?.name
    const image = options.tools?.find(tool => tool.name.startsWith('timetable_image_'))?.name
    const inspectImage = image !== undefined && !results.some(result => result.content.some(block => block.type === 'image'))
    const name = token !== undefined ? 'structured_output' : index === undefined || unread !== undefined ? source : inspectImage ? image : draft
    if (name === undefined) throw new Error('The timetable child omitted its source or draft tool')
    const args = JSON.stringify(token !== undefined ? { validationToken: token }
      : index === undefined ? { mode: 'inspect' }
        : unread !== undefined ? { mode: 'read', ...unread }
          : inspectImage ? { index: 0 }
            : this.notTimetable ? { action: 'not-timetable' }
              : hasBatch ? { action: 'finish', expectedTotal: this.entries().length }
                : { action: 'submit', items: this.entries() })
    const id = ToolCallId(`timetable-${String(this.requests.length)}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** Model interpretation of the two-period, two-class grade fixture. */
export const smallGradeEntries = [
  ['数学', '张三'], ['语文', '李四'], ['英语', '王五'], ['物理', '赵六'],
  ['英语', '王五'], ['数学', '张三'], ['语文', '李四'], ['生物', '钱七'],
].map(([subject, teacherName], index) => ({
  grade: '高三', className: `高三（${String(index % 2 + 1)}）班`, kind: 'lesson',
  period: Math.floor(index / 4) + 1, weekday: Math.floor(index % 4 / 2) + 1, subject, teacherName,
}))

/** Model interpretation of separate study tables and their subject qualifiers. */
export const studyEntries = [
  ['早读', '王俊茹'], ['早读', '蔡晓瑜'], ['英语', '江海莲'], ['英语', '王勇'],
  ['晚自习', '江海莲'], ['晚自习', '蔡晓瑜'], ['晚自习', '王俊茹'], ['晚自习', '王勇'],
].map(([subject, teacherName], index) => ({
  grade: '高二', className: `高二${String(index % 2 + 1)}班`, kind: index < 4 ? 'morningStudy' : 'eveningStudy',
  period: 1, weekday: Math.floor(index % 4 / 2) + 1, subject, teacherName,
}))
