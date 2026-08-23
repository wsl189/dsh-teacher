/** Keyless assembled-Web snapshot for semantic PDF question segmentation. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import {
  CallId, LlmAdapter, type GenerateOptions, type LlmModelInfo,
  type LlmProviderInfo, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

const MODE = webSnapshotMode()
const PROVIDER = 'question-segmentation-web-test'
const MODEL = 'layout-reader'
const TEACHER_WORKBENCH_SETTINGS_NAMESPACE = settingsNamespace('teacher-workbench')
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/question-segmentation', import.meta.url))
const RESULT_EXPECTED = join(SNAPSHOT_DIR, 'result.expected.json')

function toolCall(name: string, args: object, ordinal: number): StreamChunk[] {
  const id = CallId(`question-segmentation-${String(ordinal)}`)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Deterministic model seam that follows the run-scoped tools published by the real child loop. */
class QuestionSegmentationAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Question segmentation test' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: MODEL, name: 'Layout reader' }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Layout reader', contextWindow: 128_000 })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const source = options.tools?.find(tool => tool.name.startsWith('question_layout_'))?.name
    const submit = options.tools?.find(tool => tool.name.startsWith('submit_question_boundaries_'))?.name
    const phase = (this.requests.length - 1) % 4
    if (phase === 0 && source !== undefined) {
      yield * toolCall(source, { chunk: 0 }, 1)
      return
    }
    if (phase === 1 && submit !== undefined) {
      yield * toolCall(submit, {
        headConvention: 'Arabic labels followed by punctuation begin independent top-level questions.',
        questions: [
          { headElementId: 'p0e3' },
          { headElementId: 'p0e6' },
        ],
        excludedElementIds: ['p0e2', 'p1e2'],
        endElementId: 'p1e5',
      }, 2)
      return
    }
    if (phase === 2 && submit !== undefined) {
      yield * toolCall(submit, {
        headConvention: 'Arabic punctuation and bracketed 题 labels begin independent top-level questions.',
        questions: [
          { headElementId: 'p0e3' },
          { headElementId: 'p0e6' },
          { headElementId: 'p1e3' },
        ],
        excludedElementIds: ['p0e2', 'p1e2'],
        endElementId: 'p1e5',
      }, 3)
      return
    }
    const token = JSON.stringify(options.messages).match(/validationToken=([0-9a-f-]{36})/u)?.[1]
    if (token === undefined) throw new Error('accepted boundary token is missing from the child history')
    yield * toolCall('structured_output', { validationToken: token }, 4)
  }
}

describe.skipIf(MODE === 'record')('web e2e: semantic question segmentation child', () => {
  let scaffold: WebScaffold
  const adapter = new QuestionSegmentationAdapter()

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter),
      'Question segmentation Web adapter',
    )
    await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: PROVIDER,
      model: MODEL,
      toolProvider: PROVIDER,
      toolModel: MODEL,
    })
    await scaffold.ctx.settings.replace(TEACHER_WORKBENCH_SETTINGS_NAMESPACE, {
      questionSegmentationBatchPages: 1,
    })
  }, 120_000)

  afterAll(async () => {
    await scaffold?.close()
  })

  it('keeps subquestions, figures, and continuations while repairing an omitted tagged head', async () => {
    const parent = await scaffold.ctx.agents.create({
      sessionId: SessionId('question-segmentation-web-e2e'),
      meta: { cwd: scaffold.workspaceCwd },
      agentOptions: { provider: PROVIDER, model: MODEL },
    })
    const result = await scaffold.ctx.teacherWorkbench.segmentQuestions({
      parentSessionId: parent.agent.id,
      fileName: '通用版式数学试卷.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0,
        width: 720,
        height: 1000,
        elements: [
          { type: 'text', text: '数学试卷', bbox: [180, 20, 540, 60] },
          { type: 'text', text: '答题前请填写姓名', bbox: [40, 70, 500, 95] },
          { type: 'text', text: '一、选择题', bbox: [40, 100, 300, 125] },
          { type: 'text', text: '1. 已知函数 f(x)', bbox: [40, 140, 500, 175] },
          { type: 'text', text: '(1) 求定义域；(2) 求最值', bbox: [60, 200, 500, 235] },
          { type: 'image', text: '', bbox: [260, 260, 610, 480] },
          { type: 'text', text: '2．如图，在三角形 ABC 中', bbox: [40, 520, 600, 555] },
          { type: 'image', text: '', bbox: [300, 600, 620, 940] },
        ],
      }, {
        pageIndex: 1,
        width: 720,
        height: 1000,
        elements: [
          { type: 'text', text: '接上页，求角 A', bbox: [45, 60, 500, 95] },
          { type: 'equation', text: 'AB=AC', bbox: [80, 150, 260, 185] },
          { type: 'text', text: '2.1.1 不等式的性质及应用', bbox: [160, 300, 560, 330] },
          { type: 'text', text: '[题3] 已知 a>b>0', bbox: [40, 370, 600, 405] },
          { type: 'text', text: '判断下列不等式', bbox: [60, 430, 500, 465] },
          { type: 'text', text: '数学试卷参考答案及评分标准', bbox: [150, 520, 570, 560] },
          { type: 'text', text: '1. x>0', bbox: [40, 590, 400, 620] },
        ],
      }],
    })
    expect(result).toMatchObject({ ok: true })
    const evidence = {
      modelCalls: adapter.requests.length,
      ordinaryConversationTools: scaffold.ctx.tools.schemas()
        .map(tool => tool.name)
        .filter(name => name.startsWith('teacher_'))
        .sort(),
      questionToolDescription: scaffold.ctx.tools.schemas()
        .find(tool => tool.name === 'teacher_question_workbench')?.description,
      questionImageToolDescription: scaffold.ctx.tools.schemas()
        .find(tool => tool.name === 'teacher_question_image_read')?.description,
      dailyToolDescription: scaffold.ctx.tools.schemas()
        .find(tool => tool.name === 'teacher_daily_management')?.description,
      timetableToolDescription: scaffold.ctx.tools.schemas()
        .find(tool => tool.name === 'teacher_timetable')?.description,
      exposedTools: {
        source: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('question_layout_'))),
        submission: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('submit_question_boundaries_'))),
        structuredOutput: adapter.requests.some(request => request.tools?.some(tool => tool.name === 'structured_output')),
      },
      result,
    }
    await compareOrRefreshGolden(RESULT_EXPECTED, JSON.stringify(evidence, null, 2), MODE)
  }, 30_000)
})
