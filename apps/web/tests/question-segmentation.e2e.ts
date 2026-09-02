/** Keyless assembled-Web test for semantic PDF question segmentation. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import {
  ToolCallId, LlmAdapter, type GenerateOptions, type LlmModelInfo,
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
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function toolCall(name: string, args: object, ordinal: number): StreamChunk[] {
  const id = ToolCallId(`question-segmentation-${String(ordinal)}`)
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
  failCropReviews = false
  private readonly boundaryTools: string[] = []
  private readonly reviewPhases = new Map<string, number>()

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Question segmentation test' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: MODEL, name: 'Layout reader', inputModalities: ['text', 'image'] }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: 'Layout reader', contextWindow: 128_000, inputModalities: ['text', 'image'],
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const reviewSheet = options.tools?.find(tool => tool.name.startsWith('question_review_sheet_'))?.name
    const reviewFindings = options.tools?.find(tool => tool.name.startsWith('submit_question_crop_findings_'))?.name
    if (reviewSheet !== undefined && reviewFindings !== undefined) {
      if (this.failCropReviews) throw new Error('simulated crop-review provider failure')
      const phase = this.reviewPhases.get(reviewFindings) ?? 0
      this.reviewPhases.set(reviewFindings, phase + 1)
      const promptText = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'text' && block.text.includes('"visualAttention"'))
      if (promptText?.type !== 'text') throw new Error('crop-review metadata is missing')
      const metadata = JSON.parse(promptText.text.slice(promptText.text.lastIndexOf('\n') + 1)) as {
        readonly reviewSheetIds: readonly string[]
        readonly visualAttention: readonly { readonly cropId: string }[]
        readonly preliminaryQuestions: readonly { readonly cropId: string }[]
      }
      if (phase === 0) {
        yield * toolCall(reviewSheet, { ids: metadata.reviewSheetIds }, this.requests.length)
        return
      }
      yield * toolCall(reviewFindings, {
        verifiedCrops: metadata.preliminaryQuestions.map(question => ({
          cropId: question.cropId,
          answerDemand: 'Produce the response requested by the visible learner prompt.',
          evidence: 'The rendered crop visibly contains a learner prompt and response requirement.',
        })),
        attentionChecks: metadata.visualAttention.map(attention => ({
          cropId: attention.cropId,
          evidence: 'The annotated source region and rendered cyan crop frame show complete owned content.',
        })),
        findings: [],
      }, this.requests.length)
      return
    }
    const submit = options.tools?.find(tool => tool.name.startsWith('submit_question_boundaries_'))?.name
    if (submit === undefined) throw new Error('question boundary submission tool is missing')
    const boundaryPrompt = options.messages.flatMap(message => message.content)
      .find(block => block.type === 'text' && block.text.includes('"semanticHints"'))
    if (boundaryPrompt?.type !== 'text') throw new Error('question boundary metadata is missing')
    const boundaryMetadata = JSON.parse(boundaryPrompt.text.slice(boundaryPrompt.text.lastIndexOf('\n') + 1)) as {
      readonly semanticHints: { readonly protectedQuestionHeadIds: readonly string[] }
    }
    const questions = boundaryMetadata.semanticHints.protectedQuestionHeadIds
      .map(headElementId => ({ headElementId }))
    if (JSON.stringify(options.messages).includes('双栏等宽试卷.pdf')) {
      yield * toolCall(submit, {
        headConvention: 'Score-bearing Arabic labels start one independent question in each printed column.',
        questions,
      }, this.requests.length)
      return
    }
    if (!this.boundaryTools.includes(submit)) this.boundaryTools.push(submit)
    const groupIndex = this.boundaryTools.indexOf(submit)
    yield * toolCall(submit, groupIndex === 0
      ? {
        headConvention: 'Arabic punctuation begins independent top-level questions on the core page.',
        questions,
        nonQuestionHeadElementIds: ['p0e2'],
        stopBeforeElementId: 'p1e2',
      }
      : {
        headConvention: 'Bracketed 题 labels begin independent top-level questions on the core page.',
        questions,
        nonQuestionHeadElementIds: ['p1e2'],
        stopBeforeElementId: 'p1e5',
      }, this.requests.length)
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
      questionSegmentationBatchCandidates: 20,
      questionSegmentationConcurrency: 1,
      questionSegmentationInlineEvidence: true,
      questionSegmentationAgentTimeoutMs: 20_000,
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
    const pages = [{
      pageIndex: 0,
      width: 720,
      height: 1000,
      elements: [
        { type: 'text' as const, text: '数学试卷', bbox: [180, 20, 540, 60] as const },
        { type: 'text' as const, text: '答题前请填写姓名', bbox: [40, 70, 500, 95] as const },
        { type: 'text' as const, text: '一、选择题', bbox: [40, 100, 300, 125] as const },
        { type: 'text' as const, text: '1. 已知函数 f(x)', bbox: [40, 140, 500, 175] as const },
        { type: 'text' as const, text: '(1) 求定义域；(2) 求最值', bbox: [60, 200, 500, 235] as const },
        { type: 'image' as const, text: '', bbox: [260, 260, 610, 480] as const },
        { type: 'text' as const, text: '2．如图，在三角形 ABC 中', bbox: [40, 520, 600, 555] as const },
        { type: 'image' as const, text: '', bbox: [300, 600, 620, 940] as const },
      ],
    }, {
      pageIndex: 1,
      width: 720,
      height: 1000,
      elements: [
        { type: 'text' as const, text: '接上页，求角 A', bbox: [45, 60, 500, 95] as const },
        { type: 'equation' as const, text: 'AB=AC', bbox: [80, 150, 260, 185] as const },
        { type: 'text' as const, text: '2.1.1 不等式的性质及应用', bbox: [160, 300, 560, 330] as const },
        { type: 'text' as const, text: '[题3] 已知 a>b>0', bbox: [40, 370, 600, 405] as const },
        { type: 'text' as const, text: '判断下列不等式', bbox: [60, 430, 500, 465] as const },
        { type: 'text' as const, text: '数学试卷参考答案及评分标准', bbox: [150, 520, 570, 560] as const },
        { type: 'text' as const, text: '1. x>0', bbox: [40, 590, 400, 620] as const },
      ],
    }]
    const pagePreviews = pages.map(page => ({
      pageIndex: page.pageIndex,
      mediaType: 'image/png' as const,
      width: 1,
      height: 1,
      contentBase64: PIXEL,
    }))
    const result = await scaffold.ctx.teacherWorkbench.segmentQuestions({
      parentSessionId: parent.agent.id,
      fileName: '通用版式数学试卷.pdf',
      padding: 10,
      pages,
      pagePreviews,
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({ ok: true })
    const reviewRequest = {
      parentSessionId: parent.agent.id,
      fileName: '通用版式数学试卷.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: result.value.questions
        .filter(question => question.groupIndex === 0)
        .map(question => question.sourceHeadId),
      pages,
      pagePreviews,
      questions: result.value.questions.filter(question => question.groupIndex === 0),
      crops: result.value.questions
        .filter(question => question.groupIndex === 0)
        .map(question => ({
          questionNo: question.questionNo,
          fileName: `第${String(question.questionNo)}题.png`,
          mediaType: 'image/png' as const,
          width: 1,
          height: 1,
          contentBase64: PIXEL,
        })),
      padding: 10,
    }
    const review = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(reviewRequest)
    if (!review.ok) throw new Error(review.error.message)
    expect(review).toMatchObject({ ok: true, value: { decision: 'accepted', affectedQuestionIds: [] } })
    adapter.failCropReviews = true
    const degradedReview = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(reviewRequest)
    adapter.failCropReviews = false
    if (!degradedReview.ok) throw new Error(degradedReview.error.message)
    expect(degradedReview).toMatchObject({
      ok: true,
      value: { decision: 'unresolved', affectedQuestionIds: reviewRequest.reviewQuestionIds },
    })
    const lanePages = [{
      pageIndex: 0,
      width: 841,
      height: 595,
      elements: [
        { type: 'text' as const, text: '17.(15分)', bbox: [30, 20, 70, 35] as const },
        { type: 'text' as const, text: '证明左栏结论', bbox: [45, 40, 400, 70] as const },
        { type: 'text' as const, text: '18. 函数奇偶性常用结论', bbox: [440, 20, 650, 35] as const },
        { type: 'text' as const, text: '奇函数图象关于原点对称', bbox: [455, 40, 800, 70] as const },
      ],
    }, {
      pageIndex: 1,
      width: 841,
      height: 595,
      elements: [
        { type: 'text' as const, text: '19.(17分)', bbox: [27, 20, 72, 35] as const },
        { type: 'text' as const, text: '证明左栏末题结论', bbox: [39, 40, 345, 90] as const },
      ],
    }]
    const laneResult = await scaffold.ctx.teacherWorkbench.segmentQuestions({
      parentSessionId: parent.agent.id,
      fileName: '双栏等宽试卷.pdf',
      padding: 10,
      pages: lanePages,
      pagePreviews: lanePages.map(page => ({
        pageIndex: page.pageIndex,
        mediaType: 'image/png' as const,
        width: 1,
        height: 1,
        contentBase64: PIXEL,
      })),
    })
    if (!laneResult.ok) throw new Error(laneResult.error.message)
    const halfEmptyQuestion = laneResult.value.questions.find(question => question.headPageIndex === 1)
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
        pagePreview: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('question_page_preview_'))),
        submission: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('submit_question_boundaries_'))),
        cropReviewPage: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('question_review_page_'))),
        cropReviewCrop: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('question_review_crop_'))),
        cropReviewFindings: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('submit_question_crop_findings_'))),
        cropReviewRevision: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('revise_question_boundaries_'))),
        structuredOutput: adapter.requests.some(request => request.tools?.some(tool => tool.name === 'structured_output')),
      },
      compactOutputTokenBudgets: {
        boundary: [...new Set(adapter.requests
          .filter(request => request.tools?.some(tool => tool.name.startsWith('submit_question_boundaries_')))
          .map(request => request.maxTokens))],
        review: [...new Set(adapter.requests
          .filter(request => request.tools?.some(tool => tool.name.startsWith('submit_question_crop_findings_')))
          .map(request => request.maxTokens))],
      },
      boundaryUsesCompleteDraft: adapter.requests.some((request) => {
        const submission = request.tools?.find(tool => tool.name.startsWith('submit_question_boundaries_'))
        const schema = JSON.stringify(submission)
        return submission !== undefined
          && schema.includes('questions')
          && !schema.includes('questionOverrides')
          && JSON.stringify(request.messages).includes('questions must be the complete ordered list')
      }),
      boundaryHintsAreNonAuthoritative: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('submit a genuine head even when it is absent from possibleQuestionHeadIds')
      )),
      cropReviewSplitsCombinedQuestions: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('one crop incorrectly combines several independent questions')
          && JSON.stringify(request.messages).includes('collective answerDemand')
      )),
      cropReviewPromptMentionsWhitePadding: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('permitted white right padding')
      )),
      cropReviewPromptRequiresVisualEvidence: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('magenta rectangle')
          && JSON.stringify(request.messages).includes('blue dashed line')
          && JSON.stringify(request.messages).includes('visualAttention')
      )),
      cropReviewPromptRejectsMaskedLaneEvidence: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('gray vertical band')
          && JSON.stringify(request.messages).includes('Masked pixels are unavailable evidence')
      )),
      cropReviewUsesOneCompleteClassification: adapter.requests.some((request) => {
        const findings = request.tools?.find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const schema = JSON.stringify(findings)
        return findings !== undefined
          && schema.includes('verifiedCrops')
          && schema.includes('answerDemand')
          && schema.includes('attentionChecks')
          && schema.includes('findings')
          && !schema.includes('finalize')
          && JSON.stringify(request.messages).includes('listing every complete crop in verifiedCrops')
      }),
      halfEmptySpread: {
        maxQuestionWidthRatio: laneResult.value.maxQuestionWidthRatio,
        questionSourceHeadIds: laneResult.value.questions.map(question => question.sourceHeadId),
        questionRegion: halfEmptyQuestion?.regions[0],
      },
      result,
      review,
      degradedReview,
    }
    await compareOrRefreshGolden(RESULT_EXPECTED, JSON.stringify(evidence, null, 2), MODE)
  }, 30_000)
})
