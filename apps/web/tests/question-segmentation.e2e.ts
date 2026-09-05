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
import type { TeacherQuestionCropReviewRequest, TeacherQuestionLayoutElementId } from '@deepseek-ai/dsh-host-teacher-workbench/types'
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
  malformedCropReviews = false
  recoverMalformedCropReviews = false
  malformedReviewCalls = 0
  malformedReviewRecoveryCalls = 0
  localRepairFixture = false
  exhaustLocalRepairs = false
  failedLocalRepairCalls = 0
  partialClassificationFixture = false
  failFirstBoundaryGroup = false
  private readonly partialReviewTools = new Map<string, number>()
  private readonly boundaryTools: string[] = []

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
    const reviewFindings = options.tools?.find(tool => tool.name.startsWith('submit_question_crop_findings_'))?.name
    if (reviewFindings !== undefined) {
      if (this.failCropReviews) throw new Error('simulated crop-review provider failure')
      const promptText = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'text' && block.text.includes('"visualAttention"'))
      if (promptText?.type !== 'text') throw new Error('crop-review metadata is missing')
      const metadata = JSON.parse(promptText.text.slice(promptText.text.lastIndexOf('\n') + 1)) as {
        readonly reviewSheetIds: readonly string[]
        readonly visualAttention: readonly { readonly cropId: string }[]
        readonly sourceImageSampling: readonly { readonly elementId: string; readonly sampledByCropIds: readonly string[] }[]
        readonly preliminaryQuestions: readonly { readonly cropId: string }[]
      }
      const attachedReviewSheets = options.messages.flatMap(message => message.content)
        .filter(block => block.type === 'image')
      if (attachedReviewSheets.length !== metadata.reviewSheetIds.length) {
        throw new Error('compact review sheets are not attached to the initial request')
      }
      if (this.malformedCropReviews || this.recoverMalformedCropReviews) {
        const cropId = metadata.preliminaryQuestions[0]?.cropId
        const shouldRecover = this.recoverMalformedCropReviews && this.malformedReviewRecoveryCalls === 2
        this.malformedReviewCalls += 1
        if (this.recoverMalformedCropReviews) this.malformedReviewRecoveryCalls += 1
        if (!shouldRecover) {
          yield * toolCall(reviewFindings, {
            verifiedCrops: [], findings: [{ cropId, repairIntents: [], issue: 'footer' }],
          }, this.requests.length)
          return
        }
      }
      if (this.localRepairFixture || this.exhaustLocalRepairs) {
        yield * toolCall(reviewFindings, {
          verifiedCrops: JSON.stringify([{
            cropId: 'crop-p0e0', answerDemand: 'Calculate the area.', evidence: 'The learner prompt is visible.',
            topmostVisibleContent: 'Question 1.', bottommostVisibleContent: 'The response.',
            leftmostVisibleContent: 'Question number.', rightmostVisibleContent: 'Response before padding.', requiredVisuals: 'none',
          }]),
          findings: JSON.stringify([{
            cropId: 'crop-p0e0', repairIntents: JSON.stringify(['trim-bottom']),
            issue: 'Unrelated teaching notes follow the completed learner task.',
            insideCropEvidence: 'After subpart (1), the discussion heading and explanatory paragraph are visible below the response; keep the question condition.',
          }]),
        }, this.requests.length)
        return
      }
      const partialStep = this.partialReviewTools.get(reviewFindings) ?? 0
      if (this.partialClassificationFixture) this.partialReviewTools.set(reviewFindings, partialStep + 1)
      const classified = this.partialClassificationFixture
        ? partialStep > 0 ? metadata.preliminaryQuestions.slice(-1) : metadata.preliminaryQuestions.slice(0, -1)
        : metadata.preliminaryQuestions
      const classification = {
        imageChecks: metadata.sourceImageSampling.flatMap(image => image.sampledByCropIds.filter(cropId => (
          classified.some(question => question.cropId === cropId)
        )).map(cropId => ({ cropId, elementId: image.elementId, role: 'required-content', evidence: 'The fixture diagram is part of the learner prompt.' }))),
        verifiedCrops: classified.map(question => ({
          cropId: question.cropId,
          answerDemand: 'Produce the response requested by the visible learner prompt.',
          evidence: 'The rendered crop visibly contains a learner prompt and response requirement.',
          topmostVisibleContent: 'The printed question head.',
          bottommostVisibleContent: 'The final response line or figure edge.',
          leftmostVisibleContent: 'The printed head and learner text.',
          rightmostVisibleContent: 'The final formula or figure before blank padding.',
          requiredVisuals: 'The figures retained within the source annotation are visible in the crop.',
        })),
        attentionChecks: metadata.visualAttention.filter(attention => (
          classified.some(question => question.cropId === attention.cropId)
        )).map(attention => ({
          cropId: attention.cropId,
          evidence: 'The annotated source region and rendered cyan crop frame show complete owned content.',
        })),
        findings: [],
      }
      const partialArguments = partialStep < 2
        ? { verifiedCrops: classification.verifiedCrops }
        : partialStep === 2
          ? { attentionChecks: metadata.visualAttention.map(({ cropId }) => ({
            cropId, evidence: 'The source and crop edges resolve every listed warning.',
          })) }
          : { imageChecks: metadata.sourceImageSampling.flatMap(image => image.sampledByCropIds.map(cropId => ({
            cropId, elementId: image.elementId, role: 'required-content', evidence: 'The fixture diagram is part of the learner prompt.',
          }))) }
      yield * toolCall(reviewFindings, this.partialClassificationFixture ? partialArguments : classification, this.requests.length)
      return
    }
    const localRepair = options.tools?.find(tool => tool.name.startsWith('repair_question_crops_'))?.name
    if (localRepair !== undefined) {
      const contextTool = options.tools?.find(tool => tool.name.startsWith('question_review_context_'))?.name
      if (contextTool === undefined) throw new Error('local repair context tool is missing')
      expect(options.tools?.map(tool => tool.name).sort()).toEqual([contextTool, localRepair].sort())
      const contextText = options.messages.flatMap(message => message.content).flatMap(block => (
        block.type === 'tool-result' ? block.content.filter(item => item.type === 'text').map(item => item.text) : []
      )).findLast(text => text.startsWith('{') && text.includes('"targetId"'))
      if (contextText === undefined) {
        yield * toolCall(contextTool, { targetId: 'crop-p0e0', chunk: 0 }, this.requests.length)
        return
      }
      const context = JSON.parse(contextText) as {
        readonly targetId: string
        readonly totalChunks: number
        readonly currentQuestion: { readonly regions: readonly { readonly pageId: string; readonly excludedAreas: readonly unknown[] }[] }
        readonly elements: readonly { readonly elementId: string; readonly text: string }[]
      }
      expect(context.totalChunks).toBe(1)
      expect(context.elements.some(element => element.text === 'Discussion for teachers')).toBe(true)
      if (this.exhaustLocalRepairs) {
        this.failedLocalRepairCalls += 1
        yield * toolCall(localRepair, {
          repairs: [{ cropId: context.targetId, retainedImageElementIds: ['p0e2'] }],
        }, this.requests.length)
        return
      }
      if ((context.currentQuestion.regions[0]?.excludedAreas.length ?? 0) > 0) {
        yield * toolCall(localRepair, { repairs: [{ cropId: context.targetId, outsideBoundaryElementIds: ['p1e0'] }] }, this.requests.length)
        return
      }
      yield * toolCall(localRepair, { repairs: [{
        cropId: context.targetId,
        pageId: context.currentQuestion.regions[0]?.pageId,
        bottom: 165,
        outsideBoundaryElementIds: ['p0e2', 'p1e0'],
        excludedElementIds: ['p0e4', 'p0e5'],
      }, {
        cropId: context.targetId,
        pageId: context.currentQuestion.regions[1]?.pageId,
        bottom: 290,
      }] }, this.requests.length)
      return
    }
    const submit = options.tools?.find(tool => tool.name.startsWith('submit_question_boundaries_')
      || tool.name.startsWith('correct_question_boundaries_'))?.name
    if (submit === undefined) throw new Error('question boundary submission tool is missing')
    const serializedMessages = JSON.stringify(options.messages)
    const boundaryPrompt = options.messages.flatMap(message => message.content)
      .find(block => block.type === 'text' && block.text.includes('"semanticHints"'))
    if (boundaryPrompt?.type !== 'text') throw new Error('question boundary metadata is missing')
    const boundaryMetadata = JSON.parse(boundaryPrompt.text.slice(boundaryPrompt.text.lastIndexOf('\n') + 1)) as {
      readonly corePageIndexes: readonly number[]
      readonly semanticHints: { readonly protectedQuestionHeadIds: readonly string[] }
    }
    if (this.failFirstBoundaryGroup
      && serializedMessages.includes('boundary-isolation.pdf')
      && boundaryMetadata.corePageIndexes[0] === 0) {
      throw new Error('simulated recoverable boundary provider failure')
    }
    const questions = boundaryMetadata.semanticHints.protectedQuestionHeadIds
      .map(headElementId => ({ headElementId }))
    if (serializedMessages.includes('boundary-isolation.pdf')) {
      yield * toolCall(submit, {
        headConvention: 'Each numbered calculation prompt is an independent question.',
        questions: [{ headElementId: `p${String(boundaryMetadata.corePageIndexes[0])}e0` }],
      }, this.requests.length)
      return
    }
    if (JSON.stringify(options.messages).includes('theory-tables.pdf')) {
      const recovering = JSON.stringify(options.messages).includes('Retained recovery state:')
      yield * toolCall(submit, recovering
        ? {
          clearStopBeforeElementId: true,
          corrections: [
            { elementId: 'p0e0', role: 'question' },
            { elementId: 'p0e3', role: 'question', additionalElementIds: ['p0e4'] },
          ],
        }
        : {
          headConvention: 'Theory tables are outside blocks; each independent example has one head.',
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e3'] }, { headElementId: 'p0e3' }],
          stopBeforeElementId: 'not-a-source-element',
          outsideBoundaryElementIds: ['p0e1', 'p0e2', 'p0e3'],
        }, this.requests.length)
      return
    }
    if (JSON.stringify(options.messages).includes('双栏等宽试卷.pdf')) {
      yield * toolCall(submit, {
        headConvention: 'Score-bearing Arabic labels start one independent question in each printed column.',
        questions,
      }, this.requests.length)
      return
    }
    if (JSON.stringify(options.messages).includes('interleaved-labels.pdf')) {
      const recovering = JSON.stringify(options.messages).includes('cannot be separate questions')
      yield * toolCall(submit, recovering ? {
        corrections: [{ elementId: 'p0e2', role: 'question' }, { elementId: 'p0e5', role: 'content' }],
      } : {
        questions: [
          { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
          { headElementId: 'p0e2', stopBeforeElementId: 'p0e5' },
          { headElementId: 'p0e5' },
        ],
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
        { type: 'text' as const, text: '［［题3］（练习 B 第 2 题变式）', bbox: [40, 370, 600, 405] as const },
        { type: 'text' as const, text: '［（1）解关于实数 x 的不等式：x^2-a<0；（2）解下列方程：x^2=a', bbox: [60, 430, 500, 465] as const },
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
    adapter.failFirstBoundaryGroup = true
    const boundaryIsolation = await scaffold.ctx.teacherWorkbench.segmentQuestions({
      parentSessionId: parent.agent.id,
      fileName: 'boundary-isolation.pdf',
      padding: 8,
      pages: [0, 1].map(pageIndex => ({
        pageIndex,
        width: 600,
        height: 800,
        elements: [{
          type: 'text' as const,
          text: `${String(pageIndex + 1)}. Calculate the requested value.`,
          bbox: [30, 40, 520, 90] as const,
        }],
      })),
    })
    adapter.failFirstBoundaryGroup = false
    if (!boundaryIsolation.ok) throw new Error(boundaryIsolation.error.message)
    expect(boundaryIsolation).toMatchObject({
      ok: true,
      value: {
        groupCount: 2,
        groups: [{ groupIndex: 0 }, { groupIndex: 1 }],
        questions: [{ headPageIndex: 1, groupIndex: 1 }],
      },
    })
    const interleavedResult = await scaffold.ctx.teacherWorkbench.segmentQuestions({
      parentSessionId: parent.agent.id, fileName: 'interleaved-labels.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 840, height: 600, elements: [
        { type: 'text', text: '1.(15分)', bbox: [30, 17, 80, 31] },
        { type: 'text', text: '(1) 求证直线平行于平面', bbox: [45, 65, 240, 80] },
        { type: 'text', text: '2.(17分)', bbox: [440, 16, 490, 30] },
        { type: 'text', text: '(1) 当 a=1 时，', bbox: [455, 57, 580, 69] },
        { type: 'text', text: '(2) 求多面体的体积', bbox: [60, 95, 260, 110] },
        { type: 'text', text: '已知函数 f(x)=a ln x', bbox: [455, 33, 620, 51] },
        { type: 'text', text: '求函数的最大值', bbox: [470, 72, 680, 100] },
        { type: 'image', text: '', bbox: [310, 115, 410, 190] },
      ] }],
    })
    if (!interleavedResult.ok) throw new Error(interleavedResult.error.message)
    expect(interleavedResult.value.questions).toHaveLength(2)
    expect(interleavedResult.value.questions[0]?.regions[0]?.bottom).toBe(195)
    expect(interleavedResult.value.questions[1]?.regions[0]?.top).toBe(16)
    const reviewRequest = {
      parentSessionId: parent.agent.id,
      reasoningEnabled: true,
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
    adapter.partialClassificationFixture = true
    const partialReview = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(reviewRequest)
    adapter.partialClassificationFixture = false
    expect(partialReview).toMatchObject({ ok: true, value: { decision: 'accepted', affectedQuestionIds: [] } })
    adapter.failCropReviews = true
    const degradedReview = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(reviewRequest)
    adapter.failCropReviews = false
    expect(degradedReview).toMatchObject({
      ok: false,
      error: { code: 'model-failed' },
    })
    adapter.malformedCropReviews = true
    const malformedReview = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(reviewRequest)
    adapter.malformedCropReviews = false
    expect(malformedReview).toMatchObject({ ok: false, error: { code: 'invalid-output' } })
    expect(adapter.malformedReviewCalls).toBe(12)
    adapter.recoverMalformedCropReviews = true
    const recoveredReview = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(reviewRequest)
    adapter.recoverMalformedCropReviews = false
    expect(recoveredReview).toMatchObject({ ok: true, value: { decision: 'accepted' } })
    expect(adapter.malformedReviewCalls).toBe(15)
    expect(adapter.malformedReviewRecoveryCalls).toBe(3)
    adapter.localRepairFixture = true
    const localRepairRequest: TeacherQuestionCropReviewRequest = {
      parentSessionId: parent.agent.id,
      reasoningEnabled: true,
      fileName: 'mixed-content.pdf', groupIndex: 0, corePageIndexes: [0, 1], recutAttempt: 1,
      reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Calculate the area.', bbox: [20, 20, 540, 60] },
        { type: 'text', text: '(1) Show your working.', bbox: [20, 100, 540, 150] },
        { type: 'text', text: 'Discussion for teachers', bbox: [20, 300, 540, 330] },
        { type: 'text', text: 'An explanation of teaching methods.', bbox: [20, 620, 540, 650] },
        { type: 'image', text: '', bbox: [360, 155, 390, 160] },
        { type: 'image', text: 'Publisher icon', bbox: [360, 160, 410, 164] },
      ] }, { pageIndex: 1, width: 600, height: 800, elements: [
        { type: 'text', text: 'Functions and graphs', bbox: [20, 300, 540, 330] },
      ] }],
      pagePreviews: [0, 1].map(pageIndex => ({ pageIndex, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL })),
      questions: [{
        sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{ pageIndex: 0, left: 16, top: 16, right: 544, rightLimit: 600, bottom: 654,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }, {
          pageIndex: 1, left: 16, top: 296, right: 544, rightLimit: 600, bottom: 334,
          excludedAreas: [], pageWidth: 600, pageHeight: 800,
        }],
      }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }
    adapter.exhaustLocalRepairs = true
    const exhaustedLocalRepair = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(localRepairRequest)
    adapter.exhaustLocalRepairs = false
    if (!exhaustedLocalRepair.ok) throw new Error(exhaustedLocalRepair.error.message)
    expect(exhaustedLocalRepair).toMatchObject({
      ok: true,
      value: {
        decision: 'unresolved',
        affectedQuestionIds: ['p0e0'],
        questions: localRepairRequest.questions,
      },
    })
    expect(adapter.failedLocalRepairCalls).toBe(12)
    const localRepair = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops(localRepairRequest)
    if (!localRepair.ok) throw new Error(localRepair.error.message)
    expect(localRepair.value.decision).toBe('revised')
    expect(localRepair.value.questions[0]?.regions).toHaveLength(1)
    expect(localRepair.value.questions[0]?.regions[0]?.bottom).toBe(165)
    expect(localRepair.value.questions[0]?.regions[0]?.excludedAreas).toEqual([[360, 155, 390, 160], [360, 160, 410, 164]])
    const repairedQuestion = localRepair.value.questions[0]
    const reportRegion = localRepairRequest.questions[0]?.regions[1]
    if (repairedQuestion === undefined || reportRegion === undefined) throw new Error('cumulative repair fixture is incomplete')
    const cumulativeRepair = await scaffold.ctx.teacherWorkbench.reviewQuestionCrops({
      ...localRepairRequest,
      questions: [{ ...repairedQuestion, regions: [...repairedQuestion.regions, reportRegion] }],
    })
    adapter.localRepairFixture = false
    if (!cumulativeRepair.ok) throw new Error(cumulativeRepair.error.message)
    expect(cumulativeRepair.value.questions[0]?.regions).toEqual(repairedQuestion.regions)
    const tableResult = await scaffold.ctx.teacherWorkbench.segmentQuestions({
      fileName: 'theory-tables.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. Calculate x when 2x = 4.', bbox: [40, 40, 500, 70] },
          { type: 'table', text: 'Methods for solving inequalities', bbox: [40, 120, 540, 150] },
          { type: 'table', text: '', bbox: [40, 160, 540, 300] },
          { type: 'text', text: '2. Find the area of the triangle below.', bbox: [40, 340, 500, 370] },
          { type: 'image', text: '', bbox: [100, 600, 350, 710] },
        ],
      }],
    })
    if (!tableResult.ok) throw new Error(tableResult.error.message)
    expect(tableResult.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e3'])
    expect(tableResult.value.questions[0]?.regions[0]?.bottom).toBeLessThan(120)
    expect(tableResult.value.questions[1]?.regions.at(-1)?.bottom).toBeGreaterThanOrEqual(710)
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
        cropLocalRepair: adapter.requests.some(request => request.tools?.some(tool => tool.name.startsWith('repair_question_crops_'))),
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
      semanticChildrenRequireToolCalls: {
        boundary: adapter.requests
          .filter(request => request.tools?.some(tool => tool.name.startsWith('submit_question_boundaries_')))
          .every(request => request.toolChoice === 'required'),
        review: adapter.requests
          .filter(request => request.tools?.some(tool => tool.name.startsWith('submit_question_crop_findings_')))
          .every(request => request.toolChoice === 'required'),
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
      boundaryRecoveryRetainsDraftAndDiagnostic: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('Retained recovery state:')
          && JSON.stringify(request.messages).includes('rejectedDraft')
          && JSON.stringify(request.messages).includes('lastRejection')
          && JSON.stringify(request.messages).includes('REJECTED')
      )),
      boundaryRejectsCrossQuestionHeadOwnership: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('claims another selected question head')
      )),
      boundaryRecoveryOnlyAllowsCorrections: adapter.requests.some(request => (
        request.tools?.some(tool => tool.name.startsWith('correct_question_boundaries_')) === true
          && request.tools.every(tool => !tool.name.startsWith('submit_question_boundaries_'))
      )),
      recoverableBoundaryFailureKeepsLaterGroups: boundaryIsolation,
      boundaryEvidenceLabelsPageScope: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('\\"scope\\":\\"core\\"')
          && JSON.stringify(request.messages).includes('\\"scope\\":\\"context\\"')
      )),
      cropReviewSplitsCombinedQuestions: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('one crop incorrectly combines several independent questions')
          && JSON.stringify(request.messages).includes('A collective demand covering several separately labelled problems never verifies a crop')
      )),
      compactReviewRejectsOptionalResourceBlocks: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('The complete set of review sheets is attached')
          && JSON.stringify(request.messages).includes('A QR code, publisher resource label, or optional dynamic-demo block is furniture')
      )),
      cropReviewPreservesSourceOverlaysWithoutExcusingMissingContent: adapter.requests
        .filter(request => request.tools?.some(tool => tool.name.startsWith('submit_question_crop_findings_')))
        .every(request => JSON.stringify(request.messages).includes('Question cutting preserves source pixels')
          && JSON.stringify(request.messages).includes('never erase learner pixels')
          && JSON.stringify(request.messages).includes('Missing learner pixels, wrong ownership, and neighboring content remain cutting defects')),
      cropReviewSeparatesOutputFromUnsampledSourceImages: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('sourceImageSampling')
          && JSON.stringify(request.messages).includes('Only ACTUAL CROP sheets show output pixels')
      )),
      cropReviewPreservesCompleteReferenceAppendices: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('Supplied reference formulas and data are learner input')
          && JSON.stringify(request.messages).includes('including continuations below the first formula')
      )),
      cropReviewDistinguishesImageEncodedTextFromIllustrations: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('questionHeadForCropIds')
          && JSON.stringify(request.messages).includes('OCR image boxes can contain pure question text')
          && JSON.stringify(request.messages).includes('Image roles are your visual decisions, not Host-detected defects')
      )),
      cropReviewReturnsExactToolNameAfterMisspelledSuffix: adapter.requests.some(request => (
        request.tools?.some(tool => tool.name.startsWith('submit_question_crop_findings_')
          && JSON.stringify(request.messages).includes(`Copy an exact allowed name: ${tool.name}`))
      )),
      cropReviewContinuesIncompleteClassificationWithoutRejection: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('INCOMPLETE')
          && JSON.stringify(request.messages).includes('requires imageChecks for sampled image')
      )),
      ocrOnlyProtectedHeadsRequireVisualRemoval: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('protectedQuestionHeadIds stay questions in this OCR-only pass')
      )),
      cropReviewSeparatesCoreAndContext: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('annotated CORE source-page review sheet containing page-1')
          && JSON.stringify(request.messages).includes('annotated CONTEXT ONLY source-page review sheet containing page-2')
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
          && schema.includes('verifiedCropIds')
          && schema.includes('verifiedCrops')
          && schema.includes('answerDemand')
          && schema.includes('attentionChecks')
          && schema.includes('findings')
          && !schema.includes('finalize')
          && JSON.stringify(request.messages).includes('Put each complete crop ID exactly once in verifiedCropIds')
      }),
      cropLocalRepairUsesFlatCropDecisions: adapter.requests.some((request) => {
        const tool = request.tools?.find(tool => tool.name.startsWith('repair_question_crops_'))
        const schema = JSON.stringify(tool)
        return tool !== undefined && schema.includes('repairs') && schema.includes('pageId')
          && !schema.includes('verticalRegionEdits') && !schema.includes('headElementId')
      }),
      halfEmptySpread: {
        maxQuestionWidthRatio: laneResult.value.maxQuestionWidthRatio,
        questionSourceHeadIds: laneResult.value.questions.map(question => question.sourceHeadId),
        questionRegion: halfEmptyQuestion?.regions[0],
      },
      result,
      review,
      partialReview,
      recoveredReview,
      incompleteReviewRetainsUnacceptedDraft: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('Valid classifications are retained as an unaccepted draft')
      )),
      degradedReview,
      malformedReview,
      malformedReviewCalls: adapter.malformedReviewCalls,
      exhaustedLocalRepair,
      failedLocalRepairCalls: adapter.failedLocalRepairCalls,
      localRepair,
      learnerLandmarkDoesNotBlockLocalRepair: localRepair.value.decision === 'revised'
        && localRepair.value.questions[0]?.regions[0]?.bottom === 165,
      defectWinsOverContradictoryVerification: localRepair.value.decision === 'revised',
      jsonEncodedReviewArraysRetainStrictRepairValidation: localRepair.value.decision === 'revised',
      explicitGeometryRetainsVisualBlockExclusions: localRepair.value.questions[0]?.regions[0]?.excludedAreas.length === 2,
      laterRepairsPreserveEarlierCropPixels: cumulativeRepair.value.decision === 'revised',
      cumulativeRepair,
      tableResult,
      interleavedResult,
      detachedLabelAndStemRejected: adapter.requests.some(request => (
        JSON.stringify(request.messages).includes('head p0e2 and its following stem p0e5 cannot be separate questions')
      )),
    }
    await compareOrRefreshGolden(RESULT_EXPECTED, JSON.stringify(evidence, null, 2), MODE)
  }, 30_000)
})
