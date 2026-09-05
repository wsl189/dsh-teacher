/** Question-segmentation agent orchestration and Host boundary validation. */

import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type ToolDefinition, type ToolGuard } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  reviewQuestionCropsWithAgent,
  segmentQuestionsWithAgent,
  type TeacherQuestionSegmentationAgentConfig,
} from '../src/question-segmentation-agent.ts'
import { QUESTION_SEGMENTATION_SKILL } from '../src/question-segmentation-skill.ts'
import type { TeacherQuestionLayoutElementId, TeacherQuestionSegmentRequest } from '../src/types.ts'

const CONFIG: TeacherQuestionSegmentationAgentConfig = {
  maxQuestionLayoutPages: 10,
  maxQuestionLayoutElements: 100,
  maxQuestionSourceChunkCharacters: 18_000,
  maxQuestionCompactBoundaryCharacters: 12_000,
  questionSegmentationInlineEvidence: false,
  maxQuestionCompactBoundaryOutputTokens: 32_768,
  maxQuestionCompactReviewOutputTokens: 32_768,
  maxSegmentedQuestions: 20,
  maxQuestionBoundarySubmissions: 3,
  maxQuestionBoundaryAgentRuns: 2,
  maxQuestionRejectedToolCalls: 3,
  maxQuestionAutoOwnedGapRatio: 0.18,
  minQuestionRepeatedImagePages: 3,
  questionRepeatedImagePositionToleranceRatio: 0.015,
  maxQuestionVisionImagesPerToolCall: 4,
  questionSegmentationReasoningEnabled: true,
  questionSegmentationAgentTimeoutMs: 0,
}

function request(): TeacherQuestionSegmentRequest {
  return {
    parentSessionId: SessionId('parent'),
    fileName: '数学试卷.pdf',
    padding: 10,
    pages: [{
      pageIndex: 0,
      width: 720,
      height: 1000,
      elements: [
        { type: 'text', text: '数学试卷', bbox: [180, 20, 540, 60] },
        { type: 'text', text: '1. 答题前填写姓名', bbox: [40, 70, 500, 95] },
        { type: 'text', text: '1. 已知函数 f(x)', bbox: [40, 100, 500, 135] },
        { type: 'text', text: '(1) 求定义域', bbox: [60, 160, 400, 190] },
        { type: 'image', text: '', bbox: [260, 220, 610, 520] },
        { type: 'text', text: '(2) 证明结论', bbox: [60, 530, 430, 560] },
        { type: 'text', text: '2．如图，在三角形 ABC 中', bbox: [40, 600, 600, 635] },
        { type: 'image', text: '', bbox: [300, 670, 620, 940] },
      ],
    }, {
      pageIndex: 1,
      width: 720,
      height: 1000,
      elements: [
        { type: 'text', text: '接上页，求角 A', bbox: [45, 60, 500, 95] },
        { type: 'equation', text: 'AB=AC', bbox: [80, 150, 260, 185] },
        { type: 'text', text: '数学试卷', bbox: [180, 350, 540, 380] },
        { type: 'text', text: '数学试卷参考答案及评分标准', bbox: [180, 400, 540, 440] },
        { type: 'text', text: '1. x>0', bbox: [40, 470, 400, 500] },
      ],
    }],
  }
}

function provideTools(ctx: Context): Map<string, ToolDefinition> {
  const registered = new Map<string, ToolDefinition>()
  ctx.provide('tools', {
    register(tool: ToolDefinition) {
      registered.set(tool.name, tool)
      return () => registered.delete(tool.name)
    },
    guard(_guard: ToolGuard) {
      return () => {}
    },
  } as never)
  return registered
}

function provideModelInfo(ctx: Context, inputModalities: readonly ('text' | 'image')[] = ['text']): void {
  ctx.provide('llm', {
    resolveModelInfo: () => Promise.resolve({
      provider: 'p', id: 'm', name: 'm',
      inputModalities,
      reasoning: {
        efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }],
        defaultEffort: 'high',
      },
    }),
  } as never)
}

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const VERIFIED_CROP_EDGES = {
  topmostVisibleContent: 'the printed question head',
  bottommostVisibleContent: 'the final required answer line',
  leftmostVisibleContent: 'the printed question number at the left edge',
  rightmostVisibleContent: 'the final owned formula before blank padding',
  requiredVisuals: 'none',
} as const
const VERIFIED_VISUAL_CHECK = {
  ...VERIFIED_CROP_EDGES,
  attentionEvidence: 'every listed geometry warning was checked against the source and crop pixels',
} as const
const concludeTurn = vi.fn()
const TOOL_CONTEXT = { concludeTurn } as never

function provideAttachments(
  ctx: Context,
  inspectSource?: (source: { readonly data: Uint8Array; readonly name: string }) => void | Promise<void>,
): void {
  let id = 0
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 10_000_000,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 20_000_000,
      maxImagePixels: 10_000_000,
      maxImageDimension: 10_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
    },
    saveImage: async (source: { readonly data: Uint8Array; readonly name: string }) => {
      await inspectSource?.(source)
      return {
        attachmentId: `image-${String(++id)}` as never,
        mediaType: 'image/png' as const,
        bytes: 1,
        width: 1,
        height: 1,
      }
    },
  } as never)
}

function provideBoundaryPreviewFixture(ctx: Context, registered: Map<string, ToolDefinition>, pageIndexes = [0]) {
  provideModelInfo(ctx, ['text', 'image'])
  provideAttachments(ctx)
  return {
    pagePreviews: pageIndexes.map(pageIndex => ({
      pageIndex, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL,
    })),
    async inspect() {
      const preview = [...registered.values()].find(tool => tool.name.startsWith('question_page_preview_'))
      if (preview === undefined) throw new Error('boundary preview tool missing')
      await preview.execute({ ids: pageIndexes.map(index => `page-${String(index + 1)}`) }, TOOL_CONTEXT)
    },
  }
}

async function segmentWithInlineDefaults(
  layout: TeacherQuestionSegmentRequest,
  inspectPrompt?: (text: string) => void,
) {
  const ctx = new Context()
  const registered = provideTools(ctx)
  ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
  ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
  provideModelInfo(ctx)
  ctx.provide('subagents', {
    start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
      const promptText = startRequest.prompt[0]?.text ?? ''
      inspectPrompt?.(promptText)
      const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
        readonly semanticHints: {
          readonly possibleQuestionHeadIds: readonly string[]
          readonly protectedQuestionHeadIds: readonly string[]
        }
      }
      const protectedIds = new Set(metadata.semanticHints.protectedQuestionHeadIds)
      const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
      if (submit === undefined) throw new Error('boundary submission tool was not registered')
      expect(submit.parameters).toHaveProperty('properties.questions')
      expect(submit.parameters).not.toHaveProperty('properties.questionOverrides')
      const accepted = String(await submit.execute({
        headConvention: 'Visible top-level labels with an answer demand begin independent questions.',
        questions: metadata.semanticHints.protectedQuestionHeadIds.map(headElementId => ({ headElementId })),
        nonQuestionHeadElementIds: metadata.semanticHints.possibleQuestionHeadIds
          .filter(id => !protectedIds.has(id)),
      }, TOOL_CONTEXT))
      if (!accepted.startsWith('ACCEPTED')) throw new Error(`draft was not accepted: ${accepted}`)
      return {
        id: SessionId('inline-child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
        dispose: () => Promise.resolve(),
      }
    },
  } as never)
  const result = await segmentQuestionsWithAgent(ctx, layout, {
    ...CONFIG,
    questionSegmentationInlineEvidence: true,
  })
  await ctx.fiber.dispose()
  return result
}

describe('segmentQuestionsWithAgent', () => {
  it('owns only core-page heads while retaining continuation evidence from an adjacent page', async () => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('Only heads on corePageIndexes belong to this run')
        expect(startRequest.prompt[0]?.text).toContain('"corePageIndexes":[0]')
        expect(startRequest.prompt[0]?.text).toContain('"possibleQuestionHeadIds":["p0e0"]')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Arabic item labels begin independent questions.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p1e1' }],
        }, TOOL_CONTEXT)).resolves.toContain('belongs to an adjacent context page')
        const accepted = String(await submit.execute({
          headConvention: 'Arabic item labels begin independent questions.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p1e0' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '跨页试卷.pdf',
      corePageIndexes: [0],
      padding: 10,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 已知函数 f(x)', bbox: [30, 500, 420, 530] },
          { type: 'text', text: '求 f(x) 的最值，并说明理由', bbox: [45, 550, 430, 580] },
        ],
      }, {
        pageIndex: 1, width: 600, height: 800,
        elements: [
          { type: 'text', text: '其中所有真命题的编号是\nA. ①②  B. ①③  C. ②④  D. ③④', bbox: [40, 20, 360, 50] },
          { type: 'text', text: '2. 已知数列 {a_n}', bbox: [30, 100, 400, 130] },
          { type: 'text', text: '求通项公式', bbox: [45, 150, 300, 180] },
        ],
      }],
    }, CONFIG)

    expect(result.ok && result.value.questions).toHaveLength(1)
    expect(result.ok && result.value.questions[0]?.headPageIndex).toBe(0)
    expect(result.ok && result.value.questions[0]?.regions.map(region => region.pageIndex)).toEqual([0, 1])
    expect(result.ok && result.value.questions[0]?.regions[1]).toMatchObject({ top: 20, bottom: 60 })
    expect(concludeTurn).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('retains page-leading continuation options before multiple next-page questions', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '跨页选项试卷.pdf', padding: 6,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '[题1（多选）] 下列说法正确的是（ ）', bbox: [40, 700, 550, 730] },
          { type: 'text', text: 'A. 第一个说法', bbox: [50, 745, 530, 770] },
        ],
      }, {
        pageIndex: 1, width: 600, height: 800,
        elements: [
          { type: 'text', text: 'B. 第二个说法', bbox: [50, 30, 530, 55] },
          { type: 'text', text: 'C. 第三个说法', bbox: [50, 65, 530, 90] },
          { type: 'text', text: 'D. 第四个说法', bbox: [50, 100, 530, 125] },
          { type: 'text', text: '[题2]（教材例题变式）', bbox: [40, 145, 550, 170] },
          { type: 'text', text: '[题2变式1] 已知函数 f(x)，求最小值', bbox: [40, 185, 550, 215] },
          { type: 'text', text: '写出完整过程', bbox: [50, 230, 530, 255] },
          { type: 'text', text: '[题3] 已知数列，求通项公式', bbox: [40, 300, 550, 330] },
          { type: 'text', text: '写出完整过程', bbox: [50, 345, 530, 370] },
        ],
      }],
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual([
      'p0e0', 'p1e4', 'p1e6',
    ])
    expect(result.ok && result.value.questions[0]?.regions.map(region => region.pageIndex)).toEqual([0, 1])
    expect(result.ok && result.value.questions[0]?.regions[1]).toMatchObject({ top: 30, bottom: 131 })
    expect(result.ok && result.value.questions[1]?.regions[0]?.top).toBeGreaterThanOrEqual(179)
  })

  it('allows repeated evidence reads without spending rejection budget or duplicating preview attachments', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    const saved = vi.fn()
    provideAttachments(ctx, saved)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly persona: string }) => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const preview = [...registered.values()].find(tool => tool.name.startsWith('question_page_preview_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || preview === undefined || submit === undefined) throw new Error('missing tools')
        expect(startRequest.persona).toContain('Never narrate analysis')
        const evidence = await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        expect(JSON.parse(String(evidence)) as unknown).toMatchObject({ pages: [{ pageIndex: 0, scope: 'core' }] })
        const image = await preview.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        for (let attempt = 0; attempt <= CONFIG.maxQuestionRejectedToolCalls; attempt += 1) {
          await expect(source.execute({ chunk: 0 }, TOOL_CONTEXT)).resolves.toEqual(evidence)
          await expect(preview.execute({ ids: ['page-1'] }, TOOL_CONTEXT)).resolves.toEqual(image)
        }
        await expect(submit.execute({ questions: [{ headElementId: 'p0e0' }] }, TOOL_CONTEXT))
          .resolves.toContain('ACCEPTED')
        return {
          id: SessionId('reread-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    await expect(segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'reread.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Calculate 2 + 3.', bbox: [20, 20, 400, 50] },
      ] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, CONFIG)).resolves.toMatchObject({ ok: true, value: { questions: [{ sourceHeadId: 'p0e0' }] } })
    expect(saved).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it.each([18_000, 600])('delivers complete compact OCR independently of the source-chunk size (%s)', async (chunkCharacters) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    const start = vi.fn(async (_mode: string, startRequest: {
      readonly prompt: readonly { readonly type: string; readonly text?: string }[]
      readonly toolFilter: { readonly allow: readonly string[] }
      readonly persona: string
      readonly agentOptions?: { readonly maxTokens?: number; readonly reasoningEffort?: string; readonly toolChoice?: string }
    }) => {
      expect(startRequest.prompt[0]?.text).toContain('"inlineSource"')
      expect(startRequest.prompt[0]?.text).toContain('Complete compact OCR evidence')
      expect(startRequest.prompt[0]?.text).toContain('questions must be the complete ordered list')
      expect(startRequest.prompt[0]?.text).toContain('"unprotectedQuestionHeadIds":["p0e1"]')
      expect(startRequest.prompt[0]?.text).toContain('excludedElementIds is unavailable in this OCR-only pass')
      const promptText = startRequest.prompt[0]?.text ?? ''
      const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
        readonly inlineSource: unknown
      }
      expect(JSON.stringify(metadata.inlineSource).length).toBeLessThanOrEqual(12_000)
      expect(startRequest.prompt.filter(block => block.type === 'image')).toHaveLength(0)
      expect(startRequest.toolFilter.allow.some(name => name.startsWith('question_layout_'))).toBe(false)
      expect(startRequest.toolFilter.allow.some(name => name.startsWith('question_page_preview_'))).toBe(false)
      expect(startRequest.agentOptions).toMatchObject({ maxTokens: 32_768, reasoningEffort: 'high', toolChoice: 'required' })
      const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
      if (submit === undefined) throw new Error('boundary submission tool was not registered')
      expect(startRequest.persona).toContain(`The only callable tool in this run is ${submit.name}`)
      await expect(submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [
          { headElementId: 'p0e2' },
          { headElementId: 'p0e6' },
          { headElementId: 'p1e0', additionalElementIds: ['p0e0'] },
        ],
        nonQuestionHeadElementIds: ['p0e1'],
      }, TOOL_CONTEXT)).resolves.toContain('precedes its question head')
      await expect(submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [{ headElementId: 'p1e3' }],
        excludedElementIds: ['p0e1'],
        stopBeforeElementId: 'p1e2',
      }, TOOL_CONTEXT)).resolves.toContain('excludedElementIds is unavailable in the compact boundary pass')
      await expect(submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [],
        stopBeforeElementId: 'p1e2',
      }, TOOL_CONTEXT)).resolves.toContain('possible question-head candidates require an explicit decision')
      await expect(submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
        nonQuestionHeadElementIds: ['p0e1'],
        stopBeforeElementId: 'p1e2',
      }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
      return {
        id: SessionId('inline-child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
        dispose: () => Promise.resolve(),
      }
    })
    ctx.provide('subagents', { start } as never)
    const source = request()
    const result = await segmentQuestionsWithAgent(ctx, {
      ...source,
      pagePreviews: source.pages.map(page => ({
        pageIndex: page.pageIndex,
        mediaType: 'image/png' as const,
        width: 1,
        height: 1,
        contentBase64: PIXEL,
      })),
    }, { ...CONFIG, questionSegmentationInlineEvidence: true, maxQuestionRejectedToolCalls: 4,
      maxQuestionSourceChunkCharacters: chunkCharacters })

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({
      ok: true,
      value: { questions: [{ sourceHeadId: 'p0e2' }, { sourceHeadId: 'p0e6' }] },
    })
    expect(start).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it.each([2, 3])('denies child-local tools and counts %i forbidden calls against the shared budget', async (deniedCalls) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let escapedCalls = 0
    for (const name of ['subagent', 'write', 'read_image']) {
      ctx.tools.register(defineTool({
        name,
        description: 'Test-only unrestricted tool.',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute() {
          escapedCalls += 1
          return Promise.resolve('escaped')
        },
      }))
    }
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    const cancel = vi.fn()
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: {
        readonly agentOptions?: object
        readonly toolFilter: { readonly allow: readonly string[] }
      }) => {
        const child = { options: startRequest.agentOptions, cancel } as never
        for (const name of ['subagent', 'write', 'read_image'].slice(0, deniedCalls)) {
          const denied = await ctx.tools.execute({
            callId: ToolCallId(`denied-${name}`),
            name,
            arguments: {},
            agent: child,
            signal: new AbortController().signal,
          })
          expect(denied.content).toEqual([{
            type: 'text',
            text: `Error: internal question processing can only call run-specific tools; "${name}" is unavailable. Copy an exact allowed name: ${startRequest.toolFilter.allow.join(', ')}`,
          }])
        }
        const submitName = startRequest.toolFilter.allow.find(name => name.startsWith('submit_question_boundaries_'))
        if (submitName === undefined) throw new Error('guarded submission tool was not registered')
        const submitted = await ctx.tools.execute({
          callId: ToolCallId('allowed-submit'),
          name: submitName,
          arguments: {
            headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
            questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
            nonQuestionHeadElementIds: ['p0e1'],
            stopBeforeElementId: 'p1e2',
          },
          agent: child,
          signal: new AbortController().signal,
        })
        const submittedContent = submitted.content[0]
        if (submittedContent?.type !== 'text') throw new Error('submission returned no text result')
        expect(submittedContent.text).toContain(deniedCalls === 3 ? 'REJECTION_BUDGET_EXHAUSTED' : 'ACCEPTED')
        return {
          id: SessionId('guarded-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      questionSegmentationInlineEvidence: true,
      maxQuestionBoundaryAgentRuns: 1,
    })

    expect(result).toMatchObject(deniedCalls === 3
      ? { ok: false, error: { code: 'invalid-output' } }
      : { ok: true, value: { questions: [{ sourceHeadId: 'p0e2' }, { sourceHeadId: 'p0e6' }] } })
    expect(cancel).toHaveBeenCalledTimes(deniedCalls === 3 ? 1 : 0)
    expect(escapedCalls).toBe(0)
    await ctx.fiber.dispose()
  })

  it('accepts a complete Agent draft with unrecognized heads absent from Host hints', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        const promptText = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
          readonly semanticHints: { readonly possibleQuestionHeadIds: readonly string[] }
        }
        expect(metadata.semanticHints.possibleQuestionHeadIds).toEqual([])
        expect(promptText).toContain('submit a genuine head even when it is absent from possibleQuestionHeadIds')
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        const accepted = String(await submit.execute({
          headConvention: 'Each lettered Task label followed by its own demand starts a question.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2' },
            { headElementId: 'p0e4' },
          ],
        }, TOOL_CONTEXT))
        if (!accepted.startsWith('ACCEPTED')) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('agent-owned-heads-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '教材习题改编.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: 'Task A', bbox: [30, 30, 540, 55] },
          { type: 'text', text: '求函数的最小值，并写出过程。', bbox: [40, 65, 540, 95] },
          { type: 'text', text: 'Task B', bbox: [30, 150, 540, 175] },
          { type: 'text', text: '证明直线与平面垂直。', bbox: [40, 185, 540, 215] },
          { type: 'text', text: 'Task C', bbox: [30, 270, 540, 295] },
          { type: 'text', text: '计算该事件的概率。', bbox: [40, 305, 540, 335] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual([
      'p0e0', 'p0e2', 'p0e4',
    ])
    await ctx.fiber.dispose()
  })

  it('uses the bounded source tool when complete OCR exceeds the inline character limit', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: {
        readonly prompt: readonly { readonly text?: string }[]
        readonly toolFilter: { readonly allow: readonly string[] }
      }) => {
        expect(startRequest.prompt[0]?.text).not.toContain('"inlineSource"')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('boundary tools were not registered')
        expect(startRequest.toolFilter.allow).toContain(source.name)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Numbered learner demands begin independent questions.',
          questions: [{ headElementId: 'p0e0' }],
        }, TOOL_CONTEXT))
        if (!accepted.startsWith('ACCEPTED')) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('complete-source-tool-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '长题干.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{
          type: 'text',
          text: `1. 求函数的值。${'完整条件'.repeat(3_100)}`,
          bbox: [30, 30, 570, 760],
        }],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0'])
    await ctx.fiber.dispose()
  })

  it('keeps chunked OCR-only classification independent of image decisions while requiring every source chunk', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('excludedElementIds is unavailable in this OCR-only pass')
        expect(startRequest.prompt[0]?.text).not.toContain('"inlineSource"')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('boundary tools missing')
        expect(submit.parameters).not.toHaveProperty('properties.excludedElementIds')
        const first = JSON.parse(String(await source.execute({ chunk: 0 }, TOOL_CONTEXT))) as { totalChunks: number }
        expect(first.totalChunks).toBeGreaterThan(1)
        await expect(submit.execute({ questions: [{ headElementId: 'p0e0' }] }, TOOL_CONTEXT))
          .resolves.toContain('inspect every source chunk')
        for (let chunk = 1; chunk < first.totalChunks; chunk += 1) await source.execute({ chunk }, TOOL_CONTEXT)
        await expect(submit.execute({ questions: [{ headElementId: 'p0e0' }] }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return {
          id: SessionId('chunked-ocr-only'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'diagrams.pdf', padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Find the area of the diagram below.', bbox: [30, 30, 540, 65] },
        { type: 'text', text: 'Show all your working.', bbox: [30, 70, 540, 95] },
        { type: 'image', text: '', bbox: [100, 100, 300, 230] },
      ] }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true,
      maxQuestionSourceChunkCharacters: 250, maxQuestionCompactBoundaryCharacters: 100 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions[0]?.regions.at(-1)?.bottom).toBeGreaterThanOrEqual(230)
    await ctx.fiber.dispose()
  })

  it('omits unusable compact stops while preserving explicit candidate decisions', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        const accepted = String(await submit.execute({
          headConvention: 'Answer-producing numbered stems begin independent questions.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e0' },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e5' },
          ],
          nonQuestionHeadElementIds: ['p0e1'],
        }, TOOL_CONTEXT))
        expect(accepted).toContain('ACCEPTED')
        return {
          id: SessionId('compact-default-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '紧凑默认值.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数的定义域', bbox: [20, 20, 400, 45] },
          { type: 'text', text: '1. 定义域是自变量的取值集合', bbox: [20, 60, 450, 85] },
          { type: 'text', text: '2. 证明函数是奇函数', bbox: [20, 120, 400, 145] },
          { type: 'text', text: '写出完整过程', bbox: [40, 160, 300, 185] },
          { type: 'text', text: '(3) 比较两个结果并说明理由', bbox: [40, 200, 350, 225] },
          { type: 'text', text: '由此得到题目要求的最终结论', bbox: [40, 235, 350, 255] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ top: 20, bottom: 90 }] },
          { sourceHeadId: 'p0e2', regions: [{ top: 115, bottom: 260 }] },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('rejects a previous-question page prefix attached to the first core-page head', async () => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Numbered answer-producing stems begin independent questions.',
          questions: [{ headElementId: 'p0e2', additionalElementIds: ['p0e0', 'p0e1'] }],
        }, TOOL_CONTEXT)).resolves.toContain('is preceding text in question')
        const accepted = String(await submit.execute({
          headConvention: 'Numbered answer-producing stems begin independent questions.',
          questions: [{ headElementId: 'p0e2' }],
        }, TOOL_CONTEXT))
        expect(accepted).toContain('ACCEPTED')
        return {
          id: SessionId('prefix-guard-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '跨页续题.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 877,
        elements: [
          { type: 'text', text: '其中所有真命题的编号是（ ）', bbox: [53, 68, 282, 79] },
          { type: 'text', text: 'A.①③ B.②④ C.①②③ D.①③④', bbox: [51, 82, 258, 94] },
          { type: 'text', text: '3. 如图，已知平面 α∥平面 β，求面积', bbox: [43, 96, 281, 110] },
          { type: 'image', text: '', bbox: [120, 158, 215, 270] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [{
          sourceHeadId: 'p0e2',
          regions: [{ top: 95, bottom: 274 }],
        }],
      },
    })
    expect(concludeTurn).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('rejects an answer-block image attached to the following question', async () => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Example labels with answer-producing stems begin independent questions.',
          questions: [{ headElementId: 'p0e4', additionalElementIds: ['p0e3'] }],
        }, TOOL_CONTEXT)).resolves.toContain('belongs to an answer or explanation block before the question head')
        const accepted = String(await submit.execute({
          headConvention: 'Example labels with answer-producing stems begin independent questions.',
          questions: [{ headElementId: 'p0e4' }],
        }, TOOL_CONTEXT))
        expect(accepted).toContain('ACCEPTED')
        return {
          id: SessionId('answer-image-guard-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '例题讲义.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 877,
        elements: [
          { type: 'text', text: '【答案】C', bbox: [39, 120, 100, 132] },
          { type: 'text', text: '【解析】由空间余弦定理可得', bbox: [40, 140, 268, 154] },
          { type: 'text', text: '所以所成角的余弦值为 2/3', bbox: [40, 160, 268, 174] },
          { type: 'image', text: '', bbox: [176, 180, 267, 265] },
          { type: 'text', text: '例5 如图，求异面直线所成角的范围（ ）', bbox: [32, 280, 268, 296] },
          { type: 'image', text: '', bbox: [72, 310, 235, 390] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [{
          sourceHeadId: 'p0e4',
          regions: [{ top: 276, bottom: 394 }],
        }],
      },
    })
    expect(concludeTurn).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('rejects answer-demand fragments promoted from inside a protected question', async () => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Numbered answer-producing stems begin independent questions.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2' },
            { headElementId: 'p0e3' },
          ],
        }, TOOL_CONTEXT)).resolves.toContain('is inside protected question p0e0')
        const accepted = String(await submit.execute({
          headConvention: 'Numbered answer-producing stems begin independent questions.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e3' }],
        }, TOOL_CONTEXT))
        expect(accepted).toContain('ACCEPTED')
        return {
          id: SessionId('fragment-guard-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '双栏练习.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 877,
        elements: [
          { type: 'text', text: '2. 已知空间四边形，求异面直线所成角（ ）', bbox: [41, 267, 278, 280] },
          { type: 'text', text: '条件与图形如下', bbox: [50, 290, 278, 304] },
          { type: 'text', text: 'A. π/3 B. π/6 C. π/4 D. π/2', bbox: [48, 320, 238, 340] },
          { type: 'text', text: '3. 若异面直线夹角为 80°，求直线条数', bbox: [41, 370, 277, 385] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e3'])
    expect(concludeTurn).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it.each(['[[题 7]]', '［ ［题 7］］', '【【例 7】】'])('keeps context heads with repeated OCR delimiters outside the preceding crop (%s)', async (label) => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'delimiters.pdf', padding: 4,
      corePageIndexes: [0],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{ type: 'text', text: '1. 选择正确答案（ ）', bbox: [30, 700, 540, 730] }],
      }, {
        pageIndex: 1, width: 600, height: 800,
        elements: [
          { type: 'text', text: 'C. 4 D. 5', bbox: [30, 30, 540, 60] },
          { type: 'text', text: `${label} 计算下面式子的值（ ）`, bbox: [30, 120, 540, 150] },
          { type: 'text', text: 'A. 1 B. 2', bbox: [30, 170, 540, 200] },
        ],
      }],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]?.regions).toHaveLength(2)
    expect(result.value.questions[0]?.regions[1]?.bottom).toBeGreaterThanOrEqual(60)
    expect(result.value.questions[0]?.regions[1]?.bottom).toBeLessThan(120)
  })

  it.each(['题 1', '例', '引例', '示例 1', '变式 1'])('rejects stolen heads and empty citation crops (%s)', async (citationLabel) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary tool missing')
        await expect(submit.execute({
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e1'] }, { headElementId: 'p0e1' }],
        }, TOOL_CONTEXT)).resolves.toContain('claims another selected question head p0e1')
        await expect(submit.execute({
          corrections: [{ elementId: 'p0e0', role: 'question' }],
        }, TOOL_CONTEXT)).resolves.toContain('only a citation label without question content')
        await expect(submit.execute({
          corrections: [{ elementId: 'p0e0', role: 'content' }],
        }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return {
          id: SessionId('head-ownership-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'head-ownership.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: `［［${citationLabel}］（2024 版 P10）`, bbox: [30, 30, 540, 50] },
          { type: 'text', text: '［［题 1 变式 1］已知函数的定义域是 [0, 1]，', bbox: [30, 60, 540, 80] },
          { type: 'text', text: '求 f(2x) 的定义域。', bbox: [30, 90, 540, 110] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]?.sourceHeadId).toBe('p0e1')
    expect(result.value.questions[0]?.regions[0]).toMatchObject({ top: 56, bottom: 114 })
    await ctx.fiber.dispose()
  })

  it('classifies numbered fact headings as theory instead of question candidates', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '知识梳理.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 基本事实', bbox: [20, 20, 300, 45] },
          { type: 'text', text: '三角形两边之和大于第三边', bbox: [40, 60, 450, 85] },
          { type: 'text', text: '2. 已知三角形三边，求周长', bbox: [20, 120, 450, 145] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e2"]')
      expect(prompt).toContain('"possibleSectionHeadingIds":["p0e0"]')
    })

    expect(result).toMatchObject({
      ok: true,
      value: { questions: [{ sourceHeadId: 'p0e2' }] },
    })
  })

  it('splits multiline OCR blocks into stable independent question heads', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '合并文本块.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{
          type: 'text',
          text: '1. 第一题\n求第一题的值\n2.\n求第二题的值\n3．第三题\n证明第三题结论',
          bbox: [40, 100, 540, 400],
        }],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e0","p0e0-s1","p0e0-s2"]')
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ bottom: 200 }] },
          { sourceHeadId: 'p0e0-s1', regions: [{ top: 200, bottom: 300 }] },
          { sourceHeadId: 'p0e0-s2', regions: [{ top: 300 }] },
        ],
      },
    })
  })

  it('suppresses numbered solution steps until a tagged problem or section begins', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '例题解析.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '例1 已知函数 f(x)，求最值', bbox: [40, 30, 540, 60] },
          { type: 'text', text: '写出完整计算过程', bbox: [50, 70, 530, 100] },
          { type: 'text', text: '【解】', bbox: [40, 120, 100, 145] },
          { type: 'text', text: '1. 先求导数', bbox: [50, 155, 530, 180] },
          { type: 'text', text: '2. 再判断单调性', bbox: [50, 190, 530, 215] },
          { type: 'text', text: '例2 已知数列，求通项', bbox: [40, 250, 540, 280] },
          { type: 'text', text: '说明推导过程', bbox: [50, 290, 530, 320] },
          { type: 'text', text: '题型3 参数范围', bbox: [160, 360, 440, 390] },
          { type: 'text', text: '1. 已知不等式恒成立，求参数范围', bbox: [40, 420, 540, 450] },
          { type: 'text', text: '写出完整解答', bbox: [50, 460, 530, 490] },
          { type: 'text', text: '【解】先移项并讨论参数', bbox: [40, 510, 530, 540] },
          { type: 'text', text: '1. 先求判别式', bbox: [50, 550, 530, 580] },
          { type: 'text', text: '习题演练', bbox: [200, 610, 400, 640] },
          { type: 'text', text: '2. 已知数列，求前 n 项和', bbox: [40, 670, 540, 700] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e0","p0e5","p0e8","p0e13"]')
      expect(prompt).not.toContain('"possibleQuestionHeadIds":["p0e0","p0e3"')
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { sourceHeadId: 'p0e0' },
          { sourceHeadId: 'p0e5' },
          { sourceHeadId: 'p0e8' },
          { sourceHeadId: 'p0e13' },
        ],
      },
    })
    expect(result.ok && result.value.questions[0]?.regions[0]?.bottom).toBeLessThanOrEqual(120)
    expect(result.ok && result.value.questions[1]?.regions[0]?.bottom).toBeLessThanOrEqual(360)
  })

  it('treats numbered textbook definitions, methods, and theorems as section boundaries', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '方法讲义.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 线面角的定义', bbox: [40, 30, 540, 60] },
          { type: 'text', text: '2. 求异面直线所成角方法：', bbox: [40, 90, 540, 120] },
          { type: 'text', text: '3. 对角线向量定理：1. 空间对角线定理：', bbox: [40, 150, 540, 180] },
          { type: 'text', text: '4. 线面角的求法', bbox: [40, 210, 540, 240] },
          { type: 'text', text: '例1 已知四棱锥 P-ABCD', bbox: [40, 300, 540, 330] },
          { type: 'text', text: '证明 PA 垂直于底面 ABCD', bbox: [50, 345, 530, 375] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e4"]')
      expect(prompt).toContain('"possibleSectionHeadingIds":["p0e0","p0e1","p0e2","p0e3"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e4'])
  })

  it('excludes numbered conclusions and combined definition-application headings from learner questions', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '微专题讲义.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 1_240, height: 831,
        elements: [
          { type: 'text', text: '1. 函数奇偶性定义', bbox: [45, 35, 570, 60] },
          { type: 'text', text: '若定义域关于原点对称，则可讨论函数的奇偶性。', bbox: [55, 70, 570, 100] },
          { type: 'text', text: '2. 函数奇偶性常用结论', bbox: [45, 120, 570, 145] },
          { type: 'equation', text: 'f(-x)=f(x)', bbox: [70, 155, 300, 180] },
          { type: 'text', text: '3. 函数对称性定义及应用', bbox: [650, 35, 1_170, 60] },
          { type: 'text', text: '函数图象关于直线 x=a 对称时有对应关系。', bbox: [660, 70, 1_170, 100] },
          { type: 'text', text: '例1 已知函数 f(x) 为奇函数', bbox: [650, 150, 1_170, 175] },
          { type: 'text', text: '求 f(-2) 的值', bbox: [660, 185, 1_170, 210] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e6"]')
      expect(prompt).toContain('"possibleSectionHeadingIds":["p0e0","p0e2","p0e4"]')
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e6"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e6'])
  })

  it('uses a non-question numbered lane as the safe edge of a horizontal spread', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '横向拼版讲义.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 1_240, height: 831,
        elements: [
          { type: 'text', text: '1. 已知函数 f(x)', bbox: [45, 35, 570, 60] },
          { type: 'text', text: '求函数的最大值', bbox: [55, 75, 570, 105] },
          { type: 'text', text: '2. 函数对称性常用结论', bbox: [650, 420, 1_170, 445] },
          { type: 'equation', text: 'f(2a-x)=f(x)', bbox: [670, 460, 1_050, 490] },
        ],
      }],
    })

    expect(result.ok && result.value.questions).toHaveLength(1)
    expect(result.ok && result.value.questions[0]?.regions[0]).toMatchObject({
      left: 35,
      right: 580,
      rightLimit: 650,
    })
  })

  it('treats a numbered definition statement as theory instead of a question', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '概念讲义.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          {
            type: 'text',
            text: '1. 直线与平面垂直：直线 l 与平面 α 内的任意一条直线都垂直，就说直线 l 与平面 α 互相垂直',
            bbox: [40, 30, 540, 90],
          },
          { type: 'text', text: '例1 已知直线 l 与平面 α', bbox: [40, 140, 540, 170] },
          { type: 'text', text: '证明 l 垂直于平面 α', bbox: [50, 185, 530, 215] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e1"]')
      expect(prompt).toContain('"possibleSectionHeadingIds":["p0e0"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e1'])
  })

  it('recognizes a numbered definition whose defining phrase is in the next OCR element', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '分行概念讲义.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          {
            type: 'text',
            text: '1. 直线与平面垂直：直线 l 与平面 α 内的任意一条直线都垂',
            bbox: [40, 30, 540, 60],
          },
          { type: 'text', text: '直，就说直线 l 与平面 α 互相垂直', bbox: [50, 65, 530, 90] },
          { type: 'text', text: '例1 已知直线 l 与平面 α，证明 l 垂直于平面 α', bbox: [40, 140, 540, 170] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e2"]')
      expect(prompt).toContain('"possibleSectionHeadingIds":["p0e0"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e2'])
  })

  it('defaults ambiguous numbered prose without an answer demand to non-question content', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '理论与练习.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 直线与平面垂直. 直线 l 与平面 α 内任意直线都垂直', bbox: [40, 30, 540, 60] },
          { type: 'text', text: '这是该位置关系的文字说明。', bbox: [50, 70, 530, 95] },
          { type: 'text', text: '2. 已知直线 l 与平面 α', bbox: [40, 130, 540, 160] },
          { type: 'text', text: '证明 l 垂直于平面 α', bbox: [50, 175, 530, 205] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e0","p0e2"]')
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e2"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e2'])
  })

  it('does not promote procedural subpoints inside reference summaries as learner questions', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '知识梳理与练习.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '知识梳理', bbox: [230, 20, 370, 50] },
          { type: 'text', text: '△ 规律小结', bbox: [40, 70, 180, 95] },
          { type: 'text', text: '函数的奇偶性、周期性、对称性的关系：', bbox: [50, 105, 500, 130] },
          { type: 'text', text: '(1)如果奇函数满足给定等式，则函数图象关于直线', bbox: [50, 140, 540, 165] },
          { type: 'text', text: 'x=a 对称，且是周期函数。', bbox: [50, 175, 500, 200] },
          { type: 'text', text: '△ 技法小结', bbox: [40, 230, 180, 255] },
          { type: 'text', text: '求函数切线相关问题的方法：', bbox: [50, 265, 500, 290] },
          { type: 'text', text: '(1)解决切线问题时，利用导数求得切线斜率', bbox: [50, 300, 540, 325] },
          { type: 'text', text: '再利用点斜式求得切线方程。', bbox: [50, 335, 500, 360] },
          { type: 'text', text: '巩固练习', bbox: [40, 400, 180, 425] },
          { type: 'text', text: '(1) 求函数 f(x)=x² 在 x=1 处的切线方程', bbox: [50, 440, 540, 465] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e10"]')
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e10"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e10'])
  })

  it('protects a proof demand that begins with 求证 in a neighboring column', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '双栏求证题.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 566, height: 878,
        elements: [
          { type: 'text', text: '4. 已知四面体满足下列条件，则（ ）', bbox: [38, 72, 274, 82] },
          { type: 'text', text: 'A. 条件一 B. 条件二', bbox: [46, 90, 274, 110] },
          { type: 'text', text: '5. 已知正方体 ABCD-A₁B₁C₁', bbox: [37, 206, 275, 219] },
          { type: 'text', text: '求证：GF 垂直于平面 FBE', bbox: [45, 353, 210, 365] },
          { type: 'text', text: '6. 如图，在三棱锥 P-ABC 中', bbox: [289, 71, 509, 82] },
          { type: 'image', text: '', bbox: [368, 87, 454, 198] },
          { type: 'text', text: '(1)求证：平面 PBC 垂直于平面 PAB', bbox: [297, 203, 510, 213] },
          { type: 'text', text: '(2)求证：PC 垂直于平面 AMN', bbox: [295, 216, 510, 230] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0","p0e2","p0e4"]')
    })

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e2', 'p0e4'])
    expect(result.value.questions[1]?.regions.every(region => region.right < 289)).toBe(true)
    expect(result.value.questions[2]?.regions.every(region => region.left >= 285)).toBe(true)
  })

  it('protects a proof marker joined to preceding OCR text', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '粘连证明题.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 883,
        elements: [
          { type: 'text', text: '8. (2025·全国二卷节选)如图，在四边形 ABCD 中', bbox: [293, 68, 423, 78] },
          { type: 'text', text: '将四边形沿 EF 翻折，使得二面角为60°证明：A′B∥平面 CD′F', bbox: [302, 155, 530, 183] },
          { type: 'image', text: '', bbox: [429, 68, 530, 156] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0'])
  })

  it('treats numbered direction labels as sections and protects answer blanks lost by OCR', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '方向与填空题.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '方向3：垂直关系的综合应用', bbox: [40, 30, 540, 60] },
          { type: 'text', text: '3. 若异面直线 a、b 所成的角为 80°', bbox: [40, 90, 540, 120] },
          { type: 'text', text: '则满足条件的直线有且仅有条.', bbox: [50, 135, 530, 165] },
          { type: 'text', text: '4. 如图，在三棱锥 A-BCD 中', bbox: [40, 210, 540, 240] },
          { type: 'text', text: '则异面直线 AN、CM 所成角的余弦值是', bbox: [50, 255, 530, 285] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleSectionHeadingIds":["p0e0"]')
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e1","p0e3"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e1', 'p0e3'])
  })

  it('protects questions stored as OCR other blocks and fill blanks reduced to punctuation', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '扫描题型混排.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 1_240, height: 831,
        elements: [
          {
            type: 'other',
            text: '4. 如图，直角三角形依次拼接，数列前 2024 项倒数和的整数部分是（ ）',
            bbox: [47, 393, 580, 443],
          },
          { type: 'image', text: '', bbox: [259, 451, 381, 549] },
          { type: 'text', text: 'A.87 B.88 C.89 D.90', bbox: [59, 557, 486, 573] },
          {
            type: 'text',
            text: '8. 如下表给出一个数阵，每行、每列的数均构成等差数列',
            bbox: [636, 38, 1_163, 52],
          },
          { type: 'table', text: '', bbox: [793, 79, 1_020, 176] },
          { type: 'text', text: '表格中 a₃,₄ 的值为，2023 在该数阵中共出现 次.', bbox: [646, 178, 1_007, 201] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e0","p0e3"]')
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0","p0e3"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e3'])
  })

  it('protects OCR-lost answer blanks and an equation demand on the following line', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '省略答题线与跨行公式.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 1_240, height: 831,
        elements: [
          { type: 'text', text: '6. 设随机变量 ξ 的分布列满足条件，则 a 的值为', bbox: [46, 725, 432, 752] },
          { type: 'text', text: '7. 下列结论正确的是（ ）', bbox: [46, 762, 577, 780] },
          { type: 'text', text: '9. 已知随机变量 X 服从正态分布，且 P(2<X≤2.5)=0.36，则', bbox: [662, 210, 1_197, 227] },
          { type: 'equation', text: 'P(X>2.5)=', bbox: [675, 229, 749, 242] },
          { type: 'text', text: '10. 下列说法正确的是（ ）', bbox: [664, 250, 1_195, 261] },
          { type: 'text', text: '11. 已知等差数列，则前 10 项的和为', bbox: [664, 300, 1_195, 320] },
          { type: 'text', text: '12. 给出四个结论，其中正确结论的序号是', bbox: [664, 350, 1_195, 370] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0","p0e1","p0e2","p0e4","p0e5","p0e6"]')
      expect(prompt).toContain('"unprotectedQuestionHeadIds":[]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual([
      'p0e0', 'p0e1', 'p0e2', 'p0e4', 'p0e5', 'p0e6',
    ])
  })

  it('protects answer demands that end in 长为 or 大小是', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '省略答题横线.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 883,
        elements: [
          { type: 'text', text: '5. 空间四边形 ABCD 中，M、N 分别为中点', bbox: [41, 619, 278, 630] },
          { type: 'text', text: '若异面直线 AB 和 CD 所成的角为 60°', bbox: [51, 637, 274, 648] },
          { type: 'text', text: '则线段 MN 的长为', bbox: [51, 657, 128, 667] },
          { type: 'text', text: '6. 空间四边形 ABCD 中，E、F 分别为中点', bbox: [41, 675, 278, 685] },
          { type: 'text', text: '则异面直线 EF 和 AB 所成角', bbox: [51, 713, 277, 722] },
          { type: 'text', text: '的大小是', bbox: [50, 731, 90, 742] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0","p0e3"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e3'])
  })

  it('protects an answer demand split across adjacent Chinese OCR lines', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '跨行填空题.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 883,
        elements: [
          { type: 'text', text: '14. 已知数列满足给定条件', bbox: [31, 661, 480, 684] },
          { type: 'text', text: '若 λ 大于所有部分和，则实数 λ 的取值范', bbox: [47, 691, 480, 705] },
          { type: 'text', text: '围为', bbox: [45, 711, 74, 727] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0'])
  })

  it('protects a diagram-choice demand whose answer marks are image-only', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '图形选项题.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 565, height: 883,
        elements: [
          { type: 'text', text: '2. 已知正三棱柱 ABC-A₁B₁C₁，则（ ）', bbox: [298, 493, 537, 520] },
          { type: 'text', text: 'A. AD⊥A₁C  B. BC⊥平面 AA₁D', bbox: [306, 523, 530, 550] },
          { type: 'text', text: '3. 已知下面四个图都是正方体，A、B 为顶点，E、F 分', bbox: [298, 581, 534, 590] },
          { type: 'text', text: '别是所在棱的中点，则满足直线 AB⊥EF 的图形有', bbox: [308, 594, 508, 605] },
          { type: 'image', text: '', bbox: [321, 632, 408, 711] },
          { type: 'image', text: 'A', bbox: [362, 715, 371, 726] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0","p0e2"]')
    })

    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e2'])
  })

  it('stops before a document title that immediately introduces an answer key', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '试题与答案.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 595, height: 841,
        elements: [
          { type: 'text', text: '19.（17分）', bbox: [58, 306, 122, 325] },
          { type: 'text', text: '求随机变量 X 的数学期望与方差', bbox: [60, 358, 533, 373] },
          { type: 'text', text: '附：超几何分布的期望与方差公式', bbox: [87, 578, 428, 615] },
        ],
      }, {
        pageIndex: 1, width: 595, height: 841,
        elements: [
          { type: 'text', text: '某市 2026 届高三年级五月供题', bbox: [137, 38, 456, 60] },
          { type: 'text', text: '数学试卷参考答案及评分标准', bbox: [152, 66, 441, 88] },
          { type: 'text', text: '1. A  2. B  3. C', bbox: [75, 155, 353, 174] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleAnswerHeadingIds":["p1e0","p1e1"]')
    })

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]?.regions.map(region => region.pageIndex)).toEqual([0])
  })

  it('stops a cross-column worked example at its printed answer heading', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '跨栏例题.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 840, height: 600,
        elements: [
          { type: 'text', text: '例1 已知四棱锥 P-ABCD', bbox: [20, 500, 390, 525] },
          { type: 'text', text: '证明 PA 垂直于底面 ABCD', bbox: [440, 20, 810, 50] },
          { type: 'text', text: '【解】连接对角线 AC', bbox: [440, 70, 810, 95] },
          { type: 'text', text: '由勾股定理可得结论', bbox: [450, 110, 800, 140] },
          { type: 'text', text: '例2 求函数最小值', bbox: [440, 180, 810, 205] },
        ],
      }],
    })

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions[0]?.regions
      .filter(region => region.left > 400)
      .every(region => region.bottom <= 70)).toBe(true)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e4'])
  })

  it('rejects explicit attachments that cross an answer or explanation boundary', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Worked examples begin at a visible response demand.',
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e3'] }],
        }, TOOL_CONTEXT)).resolves.toContain('claims p0e3 across semantic boundary p0e2')
        const accepted = String(await submit.execute({
          headConvention: 'Worked examples begin at a visible response demand.',
          questions: [{ headElementId: 'p0e0' }],
        }, TOOL_CONTEXT))
        if (!accepted.startsWith('ACCEPTED')) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('semantic-stop-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '例题解析.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '例1 如图，求三棱锥的体积', bbox: [30, 30, 540, 60] },
          { type: 'image', text: '', bbox: [200, 80, 400, 220] },
          { type: 'text', text: '【答案】体积为 3', bbox: [30, 250, 540, 280] },
          { type: 'image', text: '', bbox: [180, 310, 420, 520] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    expect(result.ok && result.value.questions).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('replaces stale image attachments when correcting an element decision without rewriting other heads', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e1'] }, { headElementId: 'p0e2' }],
          retainedImageElementIds: ['p0e1'],
        }, TOOL_CONTEXT)).resolves.toContain('must not also assign the same image through additionalElementIds')
        await expect(submit.execute({
          corrections: [{ elementId: 'p0e1', role: 'retained-image' }],
        }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return {
          id: SessionId('image-decision-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'image-decisions.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. Calculate the area of the diagram.', bbox: [30, 30, 540, 60] },
          { type: 'image', text: '', bbox: [200, 80, 400, 220] },
          { type: 'text', text: '2. Solve x + 3 = 8.', bbox: [30, 250, 540, 280] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e2'])
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeGreaterThanOrEqual(220)
    await ctx.fiber.dispose()
  })

  it.each([false, true])('requires delivered previews before discarding protected learner candidates (caller previews: %s)', async (callerPreviews) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('"protectedQuestionHeadIds":["p0e1","p0e3"]')
        expect(startRequest.prompt[0]?.text).toContain('"unprotectedQuestionHeadIds":[]')
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Numbered theory and exercises are distinguished by a visible answer demand.',
          questions: [],
          nonQuestionHeadElementIds: ['p0e0', 'p0e1', 'p0e3'],
        }, TOOL_CONTEXT)).resolves.toContain('an OCR-only draft cannot discard a protected task')
        await expect(submit.execute({
          headConvention: 'Numbered theory and exercises are distinguished by a visible answer demand.',
          corrections: [{ elementId: 'p0e1', role: 'outside' }, { elementId: 'p0e3', role: 'outside' }],
        }, TOOL_CONTEXT)).resolves.toContain('cannot discard protected learner head p0e1 from an OCR-only draft')
        const accepted = String(await submit.execute({
          corrections: [{ elementId: 'p0e1', role: 'question' }, { elementId: 'p0e3', role: 'question' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('protected-head-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '理论与习题混排.pdf', padding: 8,
      ...(callerPreviews ? { pagePreviews: [{
        pageIndex: 0, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL,
      }] } : {}),
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 直线与平面垂直的定义', bbox: [40, 30, 540, 60] },
          { type: 'text', text: '2. 如图，在正方体中取动点 P', bbox: [40, 100, 540, 130] },
          { type: 'text', text: '线段 AP 的最小值为（ ）', bbox: [50, 140, 530, 170] },
          { type: 'text', text: '例3 已知函数 f(x)', bbox: [40, 220, 540, 250] },
          { type: 'text', text: '证明 f(x) 为奇函数', bbox: [50, 260, 530, 290] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e1', 'p0e3'])
    await ctx.fiber.dispose()
  })

  it.each(['关于实数 x 的不等式', '关于参数 a 的方程', '下列不等式'])('keeps OCR-prefixed subparts with their cited parent when asked to solve %s', async (subject) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('"protectedQuestionHeadIds":["p0e0"]')
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('submission tool missing')
        await expect(submit.execute({ questions: [{ headElementId: 'p0e1' }, { headElementId: 'p0e2' }],
          nonQuestionHeadElementIds: ['p0e0'],
        }, TOOL_CONTEXT)).resolves.toContain('inside protected question p0e0')
        await expect(submit.execute({ questions: [], nonQuestionHeadElementIds: ['p0e0'] }, TOOL_CONTEXT))
          .resolves.toContain('an OCR-only draft cannot discard a protected task')
        await expect(submit.execute({ questions: [{ headElementId: 'p0e0' }] }, TOOL_CONTEXT))
          .resolves.toContain('ACCEPTED')
        return { id: SessionId('qualified-solve'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'cited-subparts.pdf', padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '［［题 3］（练习 B 第 2 题变式）', bbox: [20, 30, 540, 60] },
        { type: 'text', text: `［（1）解${subject}：x^2 - a < 0`, bbox: [20, 80, 540, 110] },
        { type: 'text', text: `【［（2）解${subject}：x^2 + a < 0`, bbox: [20, 130, 540, 160] },
      ] }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0'])
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeGreaterThanOrEqual(160)
    await ctx.fiber.dispose()
  })

  it.each(['clear', 'replace'])('can %s a rejected final stop without replacing valid question decisions', async (operation) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        const correct = [...registered.values()].find(tool => tool.name.startsWith('correct_question_boundaries_'))
        if (submit === undefined || correct === undefined) throw new Error('boundary tools missing')
        await expect(correct.execute({ corrections: [], clearStopBeforeElementId: true }, TOOL_CONTEXT))
          .resolves.toContain('no complete draft exists')
        await expect(submit.execute({ questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e2' }],
          stopBeforeElementId: 'end-of-document',
        }, TOOL_CONTEXT)).resolves.toContain('clearStopBeforeElementId: true')
        await expect(correct.execute({ corrections: [] }, TOOL_CONTEXT)).resolves.toContain('at least one decision')
        await expect(correct.execute({ corrections: [], clearStopBeforeElementId: true, stopBeforeElementId: 'p0e3' }, TOOL_CONTEXT))
          .resolves.toContain('never both')
        await expect(correct.execute({ corrections: [], stopBeforeElementId: 'p0e0' }, TOOL_CONTEXT))
          .resolves.toContain('must follow the final question head')
        await expect(correct.execute({ corrections: [],
          ...(operation === 'clear' ? { clearStopBeforeElementId: true } : { stopBeforeElementId: 'p0e3' }),
        }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return { id: SessionId('final-stop-correction'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'retained-final-stop.pdf', padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. 求函数的定义域', bbox: [20, 30, 540, 60] },
        { type: 'text', text: '写出完整过程', bbox: [20, 80, 540, 110] },
        { type: 'text', text: '2. 计算 2 + 3', bbox: [20, 200, 540, 230] },
        { type: 'text', text: '参考答案', bbox: [20, 300, 540, 330] },
      ] }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true, maxQuestionRejectedToolCalls: 10 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e2'])
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeGreaterThanOrEqual(110)
    expect(result.value.questions[1]?.regions[0]?.bottom).toBeLessThan(300)
    await ctx.fiber.dispose()
  })

  it('lets complete-source semantics reject a numbered summary that resembles an answer demand', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('protectedQuestionHeadIds stay questions in this OCR-only pass')
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Only inspected semantic elements can begin outside blocks.',
          questions: [],
          nonQuestionHeadElementIds: ['p0e0'],
          outsideBoundaryElementIds: ['missing'],
        }, TOOL_CONTEXT)).resolves.toContain('outsideBoundaryElementIds[0] is not present in the inspected source')
        await expect(submit.execute({
          headConvention: 'Each candidate receives one semantic classification.',
          questions: [],
          nonQuestionHeadElementIds: ['p0e0'],
          outsideBoundaryElementIds: ['p0e0'],
        }, TOOL_CONTEXT)).resolves.toContain('must not also classify the same element as an outside boundary')
        const accepted = String(await submit.execute({
          headConvention: 'Numbered summary statements without a learner response belong to no question.',
          questions: [],
          outsideBoundaryElementIds: ['p0e0'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('summary-boundary-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '函数知识总结.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 二次函数的最大值为顶点纵坐标。', bbox: [40, 80, 540, 110] },
          { type: 'text', text: '这是本节知识总结，不要求学生作答。', bbox: [50, 120, 530, 150] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toEqual([])
    await ctx.fiber.dispose()
  })

  it.each(['', 'Methods for solving inequalities'])('accepts outside theory tables and attachments after an earlier outside block (text=%s)', async (tableText) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Examples and variants with their own answer demands are separate tasks.',
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e5'] }, { headElementId: 'p0e3' }],
          outsideBoundaryElementIds: ['p0e1', 'p0e2'],
        }, TOOL_CONTEXT)).resolves.toContain('across semantic boundary p0e1')
        const accepted = String(await submit.execute({
          headConvention: 'Examples and variants with their own answer demands are separate tasks.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e3', additionalElementIds: ['p0e5'] }],
          outsideBoundaryElementIds: ['p0e1', 'p0e2'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('outside-table-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'theory-tables.pdf', padding: 4,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. Calculate x when 2x = 4.', bbox: [40, 40, 500, 70] },
          { type: 'table', text: tableText, bbox: [40, 120, 540, 200] },
          { type: 'table', text: '', bbox: [40, 210, 540, 300] },
          { type: 'text', text: '2. Find the area of the triangle below.', bbox: [40, 340, 500, 370] },
          { type: 'text', text: 'Give the exact area.', bbox: [40, 380, 500, 410] },
          { type: 'image', text: '', bbox: [100, 600, 350, 710] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e3'])
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeLessThan(120)
    expect(result.value.questions[1]?.regions.at(-1)?.bottom).toBeGreaterThanOrEqual(710)
    await ctx.fiber.dispose()
  })

  it('keeps an image question head out of automatic retained-image decisions', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          headConvention: 'Image-only task.', corrections: [{ elementId: 'p0e0', role: 'question' }],
        }, TOOL_CONTEXT)).resolves.toContain('no complete draft exists')
        const accepted = String(await submit.execute({
          headConvention: 'Image-only task.', questions: [{ headElementId: 'p0e0' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('image-head-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'image-task.pdf', padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'image', text: '', bbox: [40, 50, 500, 180] },
      ] }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    expect(result).toMatchObject({ ok: true, value: { questions: [{ sourceHeadId: 'p0e0' }] } })
    await ctx.fiber.dispose()
  })

  it('does not let one page-spanning OCR image join multiple default questions', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '背景层.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'image', text: '', bbox: [0, 0, 600, 800] },
          { type: 'text', text: '1. 求函数的定义域', bbox: [40, 80, 540, 110] },
          { type: 'text', text: '写出计算过程', bbox: [50, 120, 530, 150] },
          { type: 'text', text: '2. 证明数列单调', bbox: [40, 300, 540, 330] },
          { type: 'text', text: '写出证明过程', bbox: [50, 340, 530, 370] },
        ],
      }],
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { sourceHeadId: 'p0e1' },
          { sourceHeadId: 'p0e3' },
        ],
      },
    })
    expect(result.ok && result.value.questions[0]?.regions[0]?.top).toBeGreaterThan(0)
    expect(result.ok && result.value.questions[0]?.regions[0]?.bottom).toBeLessThan(300)
    expect(result.ok && result.value.questions[1]?.regions[0]?.bottom).toBeLessThan(800)
  })

  it('removes repeated-position image furniture while retaining a unique diagram', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '重复水印.pdf', padding: 8,
      pages: Array.from({ length: 3 }, (_, pageIndex) => ({
        pageIndex,
        width: 600,
        height: 800,
        elements: [
          { type: 'text' as const, text: `${String(pageIndex + 1)}. 完成该页独立问题`, bbox: [40, 50, 540, 80] as const },
          { type: 'text' as const, text: '写出完整解答过程', bbox: [50, 90, 530, 120] as const },
          ...(pageIndex === 0
            ? [{ type: 'image' as const, text: '', bbox: [200, 150, 400, 250] as const }]
            : []),
          { type: 'image' as const, text: '', bbox: [220, 500, 380, 550] as const },
          { type: 'text' as const, text: '出版标识', bbox: [240, 554, 360, 562] as const },
        ],
      })),
    })

    expect(result.ok && result.value.questions).toHaveLength(3)
    expect(result.ok && result.value.questions[0]?.regions[0]?.bottom).toBeGreaterThanOrEqual(250)
    expect(result.ok && result.value.questions.every(question => (
      (question.regions[0]?.bottom ?? 800) < 500
    ))).toBe(true)
  })

  it('splits independently answerable variant and example labels', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: '变式题组.pdf', padding: 6,
      pages: [{
        pageIndex: 0,
        width: 600,
        height: 900,
        elements: [
          { type: 'text', text: '[题4变式1] 已知函数 f(x)，则最小值为（ ）', bbox: [40, 40, 550, 75] },
          { type: 'text', text: 'A. 1  B. 2  C. 3  D. 4', bbox: [50, 85, 530, 115] },
          { type: 'text', text: '[变式2（多选）] 已知函数 g(x)，则正确的是（ ）', bbox: [40, 150, 550, 185] },
          { type: 'text', text: 'A. 单调  B. 有界  C. 奇函数  D. 偶函数', bbox: [50, 195, 540, 225] },
          { type: 'text', text: '题4变式3（填空）已知 a>0，则 a 的取值范围为______', bbox: [40, 260, 550, 295] },
          { type: 'text', text: '[例题4] 求函数 h(x) 的定义域，并写出过程。', bbox: [40, 340, 550, 375] },
          { type: 'text', text: '[题1变式3] 已知函数图象，则 f(x) 的解析式为', bbox: [40, 420, 550, 455] },
          { type: 'text', text: '[题2] 已知 M(x)=max{f(x),g(x)}，则 M(x)≤2 的解集为', bbox: [40, 500, 550, 535] },
          { type: 'text', text: '[题4] 分别求满足下列条件的实数 a 的取值范围：', bbox: [40, 580, 550, 615] },
          { type: 'text', text: '（1）命题 p 为真；（2）命题 q 为假。', bbox: [50, 625, 540, 655] },
          { type: 'text', text: '[引例变式2] 已知函数关于点对称，则 b=（ ）', bbox: [40, 665, 550, 695] },
          { type: 'text', text: '引例变式3（单对称推周期）若 f(x+2)=-f(x)，则 f(23)=（ ）', bbox: [40, 705, 550, 735] },
          { type: 'text', text: '[题8变式1] 已知函数，则单调递增区间为，值域为', bbox: [40, 745, 550, 775] },
          { type: 'text', text: '[引例变式4] 若函数 f(x) 为偶函数，', bbox: [40, 795, 550, 820] },
          { type: 'text', text: '则 f(2025)=.', bbox: [50, 830, 540, 855] },
        ],
      }],
    }, (prompt) => {
      expect(prompt).toContain('"possibleQuestionHeadIds":["p0e0","p0e2","p0e4","p0e5","p0e6","p0e7","p0e8","p0e10","p0e11","p0e12","p0e13"]')
      expect(prompt).toContain('"protectedQuestionHeadIds":["p0e0","p0e2","p0e4","p0e5","p0e6","p0e7","p0e8","p0e10","p0e11","p0e12","p0e13"]')
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { sourceHeadId: 'p0e0' },
          { sourceHeadId: 'p0e2' },
          { sourceHeadId: 'p0e4' },
          { sourceHeadId: 'p0e5' },
          { sourceHeadId: 'p0e6' },
          { sourceHeadId: 'p0e7' },
          { sourceHeadId: 'p0e8' },
          { sourceHeadId: 'p0e10' },
          { sourceHeadId: 'p0e11' },
          { sourceHeadId: 'p0e12' },
          { sourceHeadId: 'p0e13' },
        ],
      },
    })
  })

  it('starts one fresh recovery child when the first child invents a validation token', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    let attempts = 0
    const childSignals: AbortSignal[] = []
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: {
        readonly prompt: readonly { readonly text?: string }[]
        readonly signal: AbortSignal
      }) => {
        attempts += 1
        childSignals.push(startRequest.signal)
        if (attempts === 1) {
          return {
            id: SessionId('child-1'), localAgent: undefined,
            result: Promise.resolve({
              stopReason: 'completed' as const,
              output: [],
              structured: { validationToken: 'invented' },
            }),
            dispose: () => Promise.resolve(),
          }
        }
        expect(startRequest.prompt[0]?.text).toContain('previous child ended without a Host-accepted boundary result')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          outsideBoundaryElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child-2'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toMatchObject({ ok: true })
    expect(attempts).toBe(2)
    expect(new Set(childSignals).size).toBe(2)
    await ctx.fiber.dispose()
  })

  it('rejects a possible question head that the agent silently omits', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e2', stopBeforeElementId: 'p0e6' }],
          nonQuestionHeadElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT)).resolves.toContain('possible question-head candidates require an explicit decision: p0e6')
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          nonQuestionHeadElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toMatchObject({
      ok: true,
      value: { questions: [{ sourceHeadId: 'p0e2' }, { sourceHeadId: 'p0e6' }] },
    })
    await ctx.fiber.dispose()
  })

  it('accepts a visually confirmed zero-question theory group without inventing a numbered task', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('answer-obligation test')
        expect(startRequest.prompt[0]?.text).toContain('may validly contain zero questions')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const preview = [...registered.values()].find(tool => tool.name.startsWith('question_page_preview_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || preview === undefined || submit === undefined) {
          throw new Error('segmentation tools were not registered')
        }
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await preview.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Only an instruction that asks the learner for a response starts a question.',
          questions: [],
          nonQuestionHeadElementIds: ['p0e2', 'p0e4'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '知识梳理.pdf', padding: 5,
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      pages: [{
        pageIndex: 0, width: 1_247, height: 834,
        elements: [
          { type: 'text', text: '知识梳理', bbox: [255, 77, 365, 102] },
          { type: 'text', text: '专题一 集合与常用逻辑用语', bbox: [47, 120, 234, 138] },
          { type: 'text', text: '1. 判断两集合的基本关系一般有两种方法：', bbox: [72, 160, 299, 173] },
          { type: 'text', text: '一是化简集合；二是用列举法或 Venn 图法表示集合。', bbox: [71, 177, 576, 208] },
          { type: 'text', text: '2. 全称量词命题与存在量词命题真假的判断方法：', bbox: [72, 213, 337, 227] },
          { type: 'table', text: '', bbox: [75, 231, 545, 336] },
        ],
      }],
    }, CONFIG)

    expect(result).toEqual({ ok: true, value: { questions: [] } })
    await ctx.fiber.dispose()
  })

  it('keeps an explicit question end hard after double-column owner reassignment', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('A title, paper preamble, summary, answer block, footer, or other transition')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises in each column.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e3' },
          ],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '双栏讲义.pdf',
      padding: 5,
      pages: [{
        pageIndex: 0, width: 840, height: 600,
        elements: [
          { type: 'text', text: '1. 左栏题目', bbox: [20, 20, 390, 45] },
          { type: 'text', text: '左栏题目正文', bbox: [30, 60, 380, 100] },
          { type: 'text', text: '专题原理与答案讲解', bbox: [20, 220, 390, 260] },
          { type: 'text', text: '2. 右栏题目', bbox: [440, 20, 810, 45] },
          { type: 'text', text: '右栏题目正文', bbox: [450, 60, 800, 100] },
        ],
      }],
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions[0]?.regions[0]?.bottom).toBe(105)
    await ctx.fiber.dispose()
  })

  it('lets one question stop before an internal non-question span instead of owning through the next head', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const preview = [...registered.values()].find(tool => tool.name.startsWith('question_page_preview_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || preview === undefined || submit === undefined) {
          throw new Error('segmentation tools were not registered')
        }
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await preview.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e4' },
          ],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '讲义.pdf',
      padding: 5,
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '写出完整过程', bbox: [30, 30, 300, 40] },
          { type: 'text', text: '微专题 奇偶性', bbox: [150, 60, 450, 80] },
          { type: 'text', text: '基本原理与例题解析', bbox: [20, 90, 580, 180] },
          { type: 'text', text: '2. 已知函数为奇函数', bbox: [20, 210, 400, 225] },
          { type: 'text', text: '求参数取值', bbox: [30, 240, 300, 255] },
        ],
      }],
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { regions: [{ top: 10, bottom: 45 }] },
          { regions: [{ top: 205, bottom: 260 }] },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('never lets an overlapping outside element truncate owned question pixels', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        const accepted = String(await submit.execute({
          headConvention: 'The numbered stem begins the question.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e2' }],
          excludedElementIds: ['p0e2'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '横向重叠.pdf',
      pagePreviews: vision.pagePreviews,
      padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 证明下列结论', bbox: [20, 10, 400, 20] },
          { type: 'text', text: '证明：结论成立', bbox: [20, 80, 150, 105] },
          { type: 'image', text: '', bbox: [360, 95, 400, 127] },
        ],
      }],
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [{
          regions: [{
            top: 10,
            bottom: 110,
            excludedAreas: [[360, 95, 400, 127]],
          }],
        }],
      },
    })
    await ctx.fiber.dispose()
  })

  it('keeps an owned diagram complete when a separate section heading overlaps its vertical band', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'The numbered stem begins the question.',
          questions: [{ headElementId: 'p0e0' }],
          retainedImageElementIds: ['p0e1'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '图文错层.pdf',
      padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 根据右图求值', bbox: [20, 10, 300, 20] },
          { type: 'image', text: '', bbox: [320, 30, 380, 90] },
          { type: 'text', text: '二、解答题：写出完整过程', bbox: [20, 85, 300, 100] },
        ],
      }],
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [{
          regions: [{
            top: 10,
            bottom: 95,
            excludedAreas: [[20, 85, 300, 100]],
          }],
        }],
      },
    })
    await ctx.fiber.dispose()
  })

  it('keeps the next selected question head as a hard boundary through an oversized image block', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Each numbered stem begins one question.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e2' }],
          retainedImageElementIds: ['p0e1'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '跨题组合图.pdf',
      padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 根据图象选择答案', bbox: [20, 10, 300, 20] },
          { type: 'image', text: '', bbox: [20, 30, 500, 180] },
          { type: 'text', text: '2. 根据火炬图象选择答案', bbox: [20, 120, 350, 130] },
          { type: 'text', text: 'A. 甲  B. 乙  C. 丙  D. 丁', bbox: [30, 140, 400, 160] },
        ],
      }],
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { regions: [{ top: 10, bottom: 120 }] },
          { regions: [{ top: 115, bottom: 165 }] },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('preserves learner pixels under an excluded source overlay while erasing detached furniture', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        const accepted = String(await submit.execute({
          questions: [{ headElementId: 'p0e0' }],
          excludedElementIds: ['p0e2', 'p0e3'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('source-overlay-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'source-overlay.pdf', padding: 5,
      pagePreviews: vision.pagePreviews,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Calculate the result.', bbox: [20, 20, 300, 40] },
        { type: 'text', text: 'A. 1 B. 2 C. 3 D. 4', bbox: [20, 60, 300, 80] },
        { type: 'image', text: '', bbox: [240, 20, 340, 75] },
        { type: 'image', text: '', bbox: [200, 43, 240, 55] },
      ] }],
    }, CONFIG)
    expect(result).toMatchObject({ ok: true, value: { questions: [{ regions: [{
      top: 20, bottom: 85, excludedAreas: [[200, 43, 240, 55]],
    }] }] } })
    await ctx.fiber.dispose()
  })

  it('requires excluded images to remove their compact captions as one visual block', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        await expect(submit.execute({
          headConvention: 'The numbered stem begins the question.',
          questions: [{ headElementId: 'p0e0' }],
          excludedElementIds: ['p0e1'],
        }, TOOL_CONTEXT)).resolves.toContain('excluded image p0e1 has connected caption element(s) p0e2')
        const accepted = String(await submit.execute({
          headConvention: 'The numbered stem begins the question.',
          questions: [{ headElementId: 'p0e0' }],
          excludedElementIds: ['p0e1', 'p0e2'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '二维码标注.pdf',
      pagePreviews: vision.pagePreviews,
      padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'image', text: '', bbox: [300, 30, 340, 70] },
          { type: 'text', text: '动态演示', bbox: [300, 72, 340, 78] },
        ],
      }],
    }, CONFIG)).resolves.toMatchObject({ ok: true })
    await ctx.fiber.dispose()
  })

  it('uses one shared cut line when adjacent question-head boxes overlap within the crop padding', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Each numbered stem begins one question.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e1' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '紧邻填空题.pdf',
      padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '7. 求集合的交集：____', bbox: [20, 10, 300, 21] },
          { type: 'text', text: '8. 求集合的并集：____', bbox: [20, 20, 300, 35] },
        ],
      }],
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ top: 10, bottom: 20 }] },
          { sourceHeadId: 'p0e1', regions: [{ top: 20, bottom: 40 }] },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('keeps a crop correction local when its evidence also cites the source page', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('next-section title, answer or explanation, footer, decoration')
        expect(startRequest.prompt[0]?.text).toContain('blank white pixels on the right are intentional padding')
        expect(startRequest.prompt[0]?.text).toContain('leftmostVisibleContent, and rightmostVisibleContent')
        expect(startRequest.prompt[0]?.text).toContain('report visible right-edge residue with trim-right')
        expect(startRequest.prompt[0]?.text).toContain('sourceRightLimitEdits may only reduce rightLimit')
        expect(startRequest.prompt[0]?.text).toContain('require their actual dark pixels in the crop')
        expect(startRequest.prompt[0]?.text).toContain('Never infer that a response mark is visible')
        expect(startRequest.prompt[0]?.text).toContain('report only that crop for local correction')
        expect(startRequest.prompt[0]?.text).toContain('This is the complete-group review')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e4'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e4',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求参数取值',
            evidence: 'the second crop starts at question 2 and ends with its final instruction',
          }],
          findings: [{
            cropId: 'crop-p0e0',
            pageId: 'page-1',
            repairIntents: ['trim-bottom'],
            issue: 'unrelated chapter and answer copy follows the first problem',
            evidence: 'the first crop visibly continues beyond its problem into a new heading and answer block',
          }],
        }, TOOL_CONTEXT)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [
            {
              headElementId: 'p0e0',
              stopBeforeElementId: 'p0e2',
              additionalElementIds: ['p0e2'],
            },
            { headElementId: 'p0e4' },
          ],
        }, TOOL_CONTEXT)).resolves.toContain('cannot claim stopBeforeElementId')
        await expect(revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e4', stopBeforeElementId: 'p0e5' },
          ],
        }, TOOL_CONTEXT)).resolves.toContain('crop-only corrections modify uncited question heads: p0e4')
        await expect(revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e2' }],
          nonQuestionHeadElementIds: ['p0e4'],
        }, TOOL_CONTEXT)).resolves.toContain('REJECTED')
        const accepted = String(await revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e2' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const pages = [{
      pageIndex: 0, width: 600, height: 800,
      elements: [
        { type: 'text' as const, text: '1. 求函数定义域', bbox: [20, 10, 300, 20] as const },
        { type: 'text' as const, text: '写出完整过程', bbox: [30, 30, 300, 40] as const },
        { type: 'text' as const, text: '微专题 奇偶性', bbox: [150, 60, 450, 80] as const },
        { type: 'text' as const, text: '【答案】与解析', bbox: [20, 90, 580, 180] as const },
        { type: 'text' as const, text: '2. 已知函数为奇函数', bbox: [20, 210, 400, 225] as const },
        { type: 'text' as const, text: '求参数取值', bbox: [30, 240, 300, 255] as const },
      ],
    }]
    const preliminary = [
      {
        sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
        questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{
          pageIndex: 0, left: 15, top: 5, right: 585, rightLimit: 600, bottom: 185,
          excludedAreas: [], pageWidth: 600, pageHeight: 800,
        }],
      },
      {
        sourceHeadId: 'p0e4' as TeacherQuestionLayoutElementId,
        questionNo: 2, headPageIndex: 0, groupIndex: 0,
        regions: [{
          pageIndex: 0, left: 15, top: 205, right: 405, rightLimit: 600, bottom: 260,
          excludedAreas: [], pageWidth: 600, pageHeight: 800,
        }],
      },
    ]
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '讲义.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: preliminary.map(question => question.sourceHeadId),
      pages,
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: preliminary,
      crops: preliminary.map(question => ({
        questionNo: question.questionNo,
        fileName: `第${String(question.questionNo)}题.png`,
        mediaType: 'image/png' as const,
        width: 1,
        height: 1,
        contentBase64: PIXEL,
      })),
      padding: 5,
    }, { ...CONFIG, maxQuestionRejectedToolCalls: 4 })

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [
          { questionNo: 1, groupIndex: 0, regions: [{ top: 10, bottom: 45 }] },
          { questionNo: 2, groupIndex: 0, regions: [{ top: 205, bottom: 260 }] },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('requires a complete-group repair when a missing question is visible inside another crop', async () => {
    const ctx = new Context()
    let observedRevision = ''
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('set missingQuestionHead to its visible printed head')
        expect(startRequest.prompt[0]?.text).toContain('inside a larger crop that combines several problems')
        expect(startRequest.prompt[0]?.text).toContain('"suggestedUncoveredQuestionHeads":[]')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e2', 'crop-p0e6'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求集合交集',
            evidence: 'question 1 ends after its option row',
          }, {
            cropId: 'crop-p0e6',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求角的大小',
            evidence: 'question 6 ends after its option row',
          }],
          findings: [{
            cropId: 'crop-p0e2',
            pageId: 'page-1',
            repairIntents: ['trim-bottom'],
            issue: 'question 4 crop also contains the next independent question',
            evidence: 'question 5 starts after question 4 options inside crop-p0e2',
          }, {
            pageId: 'page-1',
            missingQuestionHead: '问题甲：已知展开式中系数为 m',
            issue: 'question 5 has no listed crop',
            evidence: 'its full stem and options are visible only inside crop-p0e2',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        await source.execute({ targetId: 'crop-p0e2', chunk: 0 }, TOOL_CONTEXT)
        await source.execute({ targetId: 'page-1', chunk: 0 }, TOOL_CONTEXT)
        await expect(revise.execute({
          headConvention: 'Each numbered answer-producing stem begins one question.',
          questions: [{ headElementId: 'p0e2', stopBeforeElementId: 'p0e4' }],
        }, TOOL_CONTEXT)).resolves.toContain('possible question-head candidates require an explicit decision')
        await expect(revise.execute({
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e4' },
            { headElementId: 'p0e4', stopBeforeElementId: 'p0e6' },
            { headElementId: 'p0e6' },
          ],
          nonQuestionHeadElementIds: ['p0e4'],
        }, TOOL_CONTEXT)).resolves.toContain('must not also be a question head: p0e4')
        const accepted = String(await revise.execute({
          corrections: [{ elementId: 'p0e4', role: 'question', stopBeforeElementId: 'p0e6' }],
        }, TOOL_CONTEXT))
        observedRevision = accepted
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const pages = [{
      pageIndex: 0, width: 600, height: 800,
      elements: [
        { type: 'text' as const, text: '1. 已知集合 A，求 A∩B', bbox: [20, 10, 500, 30] as const },
        { type: 'text' as const, text: 'A. 1  B. 2  C. 3  D. 4', bbox: [30, 35, 500, 70] as const },
        { type: 'text' as const, text: '4. 已知函数 f(x)，求参数', bbox: [20, 100, 500, 120] as const },
        { type: 'text' as const, text: 'A. 1  B. 2  C. 3  D. 4', bbox: [30, 125, 500, 145] as const },
        { type: 'text' as const, text: '问题甲：已知展开式中系数为 m', bbox: [20, 150, 500, 170] as const },
        { type: 'text' as const, text: 'A. 1  B. 2  C. 3  D. 4', bbox: [30, 175, 500, 210] as const },
        { type: 'text' as const, text: '6. 已知抛物线，求圆心角', bbox: [20, 230, 500, 250] as const },
        { type: 'text' as const, text: 'A. π/4  B. π/3  C. π/2  D. π', bbox: [30, 255, 500, 290] as const },
      ],
    }]
    const preliminary = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 505, rightLimit: 600, bottom: 75,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 95, right: 505, rightLimit: 600, bottom: 215,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e6' as TeacherQuestionLayoutElementId,
      questionNo: 3, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 225, right: 505, rightLimit: 600, bottom: 295,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '漏题混入相邻裁图.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: preliminary.map(question => question.sourceHeadId),
      pages,
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: preliminary,
      crops: preliminary.map(question => ({
        questionNo: question.questionNo,
        fileName: `第${String(question.questionNo)}题.png`,
        mediaType: 'image/png' as const,
        width: 1,
        height: 1,
        contentBase64: PIXEL,
      })),
      padding: 5,
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(observedRevision).toContain('ACCEPTED')
    expect(result.value.decision).toBe('revised')
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e2', 'p0e4', 'p0e6'])
    expect(result.value.affectedQuestionIds).toContain('p0e4')
    await ctx.fiber.dispose()
  })

  it('keeps an all-question follow-up crop-local and forbids page-level recovery', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('This is a crop-local recut review')
        expect(startRequest.prompt[0]?.text).toContain('Do not report an unlisted question as missing')
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e2'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求集合交集',
            evidence: 'question 1 ends after its option row',
          }, {
            cropId: 'crop-p0e2',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求集合并集',
            evidence: 'question 2 ends after its option row',
          }],
          findings: [{
            pageId: 'page-1',
            repairIntents: [],
            missingQuestionHead: '2. 求集合并集',
            issue: 'question 2 has no listed crop in this request',
            evidence: 'question 2 is visible below the reviewed crop',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('forbidden during a crop-local recut')
        const accepted = String(await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求集合交集',
            evidence: 'question 1 starts at its printed head and ends after its option row',
          }, {
            cropId: 'crop-p0e2',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求集合并集',
            evidence: 'question 2 starts at its printed head and ends after its option row',
          }],
          findings: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const questions = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 505, rightLimit: 600, bottom: 75,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 95, right: 505, rightLimit: 600, bottom: 165,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '局部重切.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: questions.map(question => question.sourceHeadId),
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求集合交集', bbox: [20, 10, 500, 30] },
          { type: 'text', text: 'A. 1  B. 2  C. 3  D. 4', bbox: [30, 35, 500, 70] },
          { type: 'text', text: '2. 求集合并集', bbox: [20, 100, 500, 120] },
          { type: 'text', text: 'A. 1  B. 2  C. 3  D. 4', bbox: [30, 125, 500, 160] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1,
        contentBase64: PIXEL,
      }, {
        questionNo: 2, fileName: '第2题.png', mediaType: 'image/png', width: 1, height: 1,
        contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toEqual({
      decision: 'accepted',
      affectedQuestionIds: [],
      questions,
    })
    await ctx.fiber.dispose()
  })

  it.each(['text', 'image'] as const)('removes a spurious theory-page crop encoded as %s while preserving the real question in its group', async (headType) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('fill answerDemand with the visible response')
        expect(startRequest.prompt[0]?.text).toContain('one finding containing both cropId and pageId')
        expect(startRequest.prompt[0]?.text).toContain('put that cropId in removedCropIds')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1', 'page-2'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e2', 'crop-p1e0'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p1e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求函数的定义域',
            evidence: 'the stem starts with the given function and ends after the requested domain',
          }],
          findings: [{
            cropId: 'crop-p0e2',
            repairIntents: ['remove-crop'],
            issue: 'the crop is a theory summary rather than an independent problem',
            evidence: 'the page contains only numbered definitions and methods; no independent learner answer demand is visible',
          }, {
            pageId: 'page-1',
            repairIntents: [],
            issue: 'the page contains a spurious detected question that must be removed',
            evidence: 'crop-p0e2 has no learner answer demand',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('pageId-only finding requires missingQuestionHead')
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p1e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求函数的定义域',
            evidence: 'the stem starts with the given function and ends after the requested domain',
          }],
          findings: [{
            cropId: 'crop-p0e2',
            repairIntents: ['remove-crop'],
            issue: 'the crop visibly contains only a theory and method summary without any independent learner answer demand',
          }],
          imageChecks: headType === 'image' ? [{
            cropId: 'crop-p0e2', elementId: 'p0e2', role: 'unrelated',
            evidence: 'The rasterized heading belongs to the removed theory summary, not a retained learner task.',
          }] : [],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await revise.execute({
          headConvention: 'Only answer-producing instructions begin independent questions.',
          questions: [],
          removedCropIds: ['crop-p0e2'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const pages = [{
      pageIndex: 0, width: 600, height: 800,
      elements: [
        { type: 'text' as const, text: '知识梳理', bbox: [220, 30, 380, 60] as const },
        { type: 'text' as const, text: '专题一 集合', bbox: [20, 80, 200, 105] as const },
        { type: headType, text: '1. 解决集合关系问题时，先化简集合，再求得两集合的关系。', bbox: [30, 120, 500, 145] as const },
        { type: 'text' as const, text: '一是化简集合，二是画 Venn 图。', bbox: [30, 160, 500, 190] as const },
      ],
    }, {
      pageIndex: 1, width: 600, height: 800,
      elements: [
        { type: 'text' as const, text: '1. 已知函数 f(x)', bbox: [20, 50, 500, 75] as const },
        { type: 'text' as const, text: '求函数的定义域', bbox: [30, 85, 500, 105] as const },
      ],
    }]
    const preliminary = [{
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 25, right: 585, rightLimit: 600, bottom: 780,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p1e0' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 1, groupIndex: 0,
      regions: [{
        pageIndex: 1, left: 15, top: 45, right: 505, rightLimit: 600, bottom: 110,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '知识梳理与练习.pdf', groupIndex: 0,
      corePageIndexes: [0, 1], recutAttempt: 0,
      reviewQuestionIds: preliminary.map(question => question.sourceHeadId),
      pages,
      pagePreviews: [0, 1].map(pageIndex => ({
        pageIndex, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL,
      })),
      questions: preliminary,
      crops: preliminary.map(question => ({
        questionNo: question.questionNo, fileName: `第${String(question.questionNo)}题.png`,
        mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL,
      })),
      padding: 5,
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.decision).toBe('revised')
    expect(result.value.affectedQuestionIds).toContain('p0e2')
    expect(result.value.questions).toMatchObject([{
      sourceHeadId: 'p1e0', questionNo: 1, groupIndex: 0,
      regions: [{ pageIndex: 1, left: 15, top: 45, right: 505, rightLimit: 600, bottom: 110 }],
    }])
    await ctx.fiber.dispose()
  })

  it('keeps a cited crop local when the reviewer cannot produce changed geometry', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the crop omits visible content',
            evidence: 'the source page visibly continues below the crop',
          }],
        }, TOOL_CONTEXT)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(revise.execute({
          headConvention: 'The first instruction starts the question.',
          questions: [{ headElementId: 'p0e0' }],
        }, TOOL_CONTEXT)).resolves.toContain('changes no rendered crop geometry')
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: {} }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 10, right: 305, rightLimit: 600, bottom: 45,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '单题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '写出完整过程', bbox: [20, 30, 300, 40] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)).resolves.toMatchObject({
      ok: true,
      value: { decision: 'unresolved', affectedQuestionIds: ['p0e0'], questions: [question] },
    })
    expect(runs).toBe(1)
    await ctx.fiber.dispose()
  })

  it('retains only the cited crop as unresolved after repeated repair-context rejections', async () => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (source === undefined || pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-bottom'],
            issue: 'unrelated footer follows the answer blank',
            evidence: 'the rendered crop visibly includes the printed footer below the learner response area',
          }],
        }, TOOL_CONTEXT)
        const evidence = await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        for (let attempt = 0; attempt < CONFIG.maxQuestionRejectedToolCalls + 1; attempt += 1) {
          await expect(source.execute({ chunk: 0 }, TOOL_CONTEXT)).resolves.toEqual(evidence)
        }
        for (let attempt = 0; attempt < CONFIG.maxQuestionRejectedToolCalls; attempt += 1) {
          const repeated = String(await source.execute({ chunk: 999 }, TOOL_CONTEXT))
          if (attempt === CONFIG.maxQuestionRejectedToolCalls - 1) {
            expect(repeated).toContain('REJECTION_BUDGET_EXHAUSTED')
          }
        }
        return {
          id: SessionId('rejection-loop-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 80,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const unaffectedQuestion = {
      sourceHeadId: 'p0e1' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 95, right: 305, rightLimit: 600, bottom: 145,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '重复复核调用.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 40] },
          { type: 'text', text: '2. 求函数值域', bbox: [20, 100, 300, 140] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question, unaffectedQuestion],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1,
        contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)).resolves.toMatchObject({
      ok: true,
      value: {
        decision: 'unresolved',
        affectedQuestionIds: ['p0e0'],
        questions: [question, unaffectedQuestion],
      },
    })
    expect(runs).toBe(1)
    expect(concludeTurn).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('separates semantic errors and exhausts repeated schema diagnostics through the tool runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    const cancel = vi.fn()
    const outcomes: unknown[] = []
    const start = vi.fn(async (_mode: string, startRequest: {
      readonly agentOptions?: object
      readonly toolFilter: { readonly allow: readonly string[] }
    }) => {
      const name = startRequest.toolFilter.allow.find(candidate => candidate.startsWith('submit_question_crop_findings_'))
      if (name === undefined) throw new Error('findings tool was not registered')
      const child = { options: startRequest.agentOptions, cancel } as never
      const invalidCalls = [
        { verifiedCrops: [], findings: [{ cropId: 'crop-p0e0', repairIntents: [], issue: 'footer' }] },
        { verifiedCrops: [], findings: '{}' },
        { verifiedCrops: [], findings: '{}' },
        { verifiedCrops: [], findings: '{}' },
      ]
      for (const [index, arguments_] of invalidCalls.entries()) {
        const result = await ctx.tools.execute({
          callId: ToolCallId(`invalid-review-${String(index)}`),
          name,
          arguments: arguments_,
          agent: child,
          signal: new AbortController().signal,
        })
        outcomes.push({ isError: result.isError, content: result.content })
        expect(cancel).toHaveBeenCalledTimes(index === 3 ? 1 : 0)
      }
      return {
        id: SessionId('malformed-review-child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'cancelled' as const, output: [] }),
        dispose: () => Promise.resolve(),
      }
    })
    ctx.provide('subagents', { start } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 80,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'malformed-review.pdf', groupIndex: 0,
      corePageIndexes: [0], recutAttempt: 0, reviewQuestionIds: [question.sourceHeadId],
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Find the domain of f(x)', bbox: [20, 10, 300, 40] },
      ] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{ questionNo: 1, fileName: 'question.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      padding: 5,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true, maxQuestionBoundaryAgentRuns: 1 })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-output' } })
    expect(start).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith({ kind: 'hook', reason: 'question-processing tool failure budget exhausted' })
    expect(outcomes).toMatchSnapshot()
    await ctx.fiber.dispose()
  })

  it.each(['recovered', 'exhausted'] as const)('retains validated visual draft rows across bounded fresh-child recovery (%s)', async (mode) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async (_mode: string, input: { readonly prompt: readonly { readonly text?: string; readonly type?: string }[] }) => {
        runs += 1
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('missing findings tool')
        const prompt = input.prompt[0]?.text ?? ''
        expect(input.prompt.some(block => block.type === 'image')).toBe(true)
        if (runs === 1) {
          await expect(findings.execute({ verifiedCrops: [{
            cropId: 'crop-p0e0', answerDemand: 'Find the triangle area.', evidence: 'The stem asks for the area.',
            ...VERIFIED_CROP_EDGES, requiredVisuals: 'The triangle below the stem.',
          }] }, TOOL_CONTEXT)).resolves.toMatch(/^INCOMPLETE/)
        } else {
          const metadata = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as {
            readonly recovery: {
              readonly lastRejection: string
              readonly retainedReviewDraft: {
                readonly verifiedCropIds: readonly string[]
                readonly findings: readonly unknown[]
              }
            }
          }
          expect(metadata.recovery.lastRejection).toContain('not a requested crop')
          expect(metadata.recovery.retainedReviewDraft.verifiedCropIds).toEqual(['crop-p0e0'])
          expect(metadata.recovery.retainedReviewDraft.findings).toEqual([])
        }
        if (runs === 2 && mode === 'recovered') {
          await expect(findings.execute({ imageChecks: [{
            cropId: 'crop-p0e0', elementId: 'p0e1', role: 'required-content', evidence: 'The required triangle is visible below the stem.',
          }] }, TOOL_CONTEXT)).resolves.toMatch(/^ACCEPTED/)
        } else {
          for (let call = 0; call < CONFIG.maxQuestionRejectedToolCalls; call += 1) {
            await expect(findings.execute({ findings: [{
              cropId: 'unknown', repairIntents: ['trim-bottom'], issue: 'Unrelated footer.', insideCropEvidence: 'Footer inside crop.',
            }] }, TOOL_CONTEXT)).resolves.toContain('not a requested crop')
          }
        }
        return { id: SessionId(`review-recovery-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'visual-recovery.pdf', groupIndex: 0,
      corePageIndexes: [0], recutAttempt: 0, reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Find the triangle area.', bbox: [40, 40, 400, 70] },
        { type: 'image', text: '', bbox: [100, 80, 300, 150] },
      ] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [{ sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{ pageIndex: 0, left: 35, top: 35, right: 405, rightLimit: 600, bottom: 155,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }] }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    expect(runs).toBe(2)
    expect(result).toMatchObject(mode === 'recovered'
      ? { ok: true, value: { decision: 'accepted' } }
      : { ok: false, error: { code: 'invalid-output' } })
    await ctx.fiber.dispose()
  })

  it('fails immediately when the review child stops with a provider error', async () => {
    const ctx = new Context()
    provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        return {
          id: SessionId(`child-${String(runs)}`),
          localAgent: undefined,
          result: Promise.resolve({
            stopReason: 'error' as const,
            diagnostic: 'provider authentication failed',
            output: [],
          }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 45,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '单题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{ type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 40] }],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'model-failed' },
    })
    if (result.ok) throw new Error('expected crop review to fail')
    expect(result.error.message).toContain('provider authentication failed')
    expect(runs).toBe(1)
    await ctx.fiber.dispose()
  })

  it('adds a cited attachment without replacing or expanding the neighboring question', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the related diagram is absent',
            evidence: 'the source page shows a diagram beside question 1 that the crop omits',
          }],
        }, TOOL_CONTEXT)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e4'] }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const questions = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 405, rightLimit: 600, bottom: 95,
        excludedAreas: [[310, 40, 400, 90] as const], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 95, right: 305, rightLimit: 600, bottom: 135,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '附图题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 如图求值', bbox: [20, 10, 200, 20] },
          { type: 'text', text: '写出完整过程', bbox: [30, 30, 300, 40] },
          { type: 'text', text: '2. 求函数定义域', bbox: [20, 100, 200, 110] },
          { type: 'text', text: '说明理由', bbox: [30, 120, 300, 130] },
          { type: 'image', text: '', bbox: [310, 40, 400, 90] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ left: 15, right: 405, bottom: 95, excludedAreas: [] }] },
          questions[1],
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('rejects a correction that silently drops an image already sampled by the crop', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-bottom'],
            issue: 'the crop has an extra lower strip after its final text',
            evidence: 'the annotated crop visibly extends below the final stem line',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        const context = String(await source.execute({ chunk: 0 }, TOOL_CONTEXT))
        expect(context).toContain('"totalChunks":1')
        expect(context).toContain('"elementId":"p0e8"')
        expect(context).toContain('UNRELATED_MIDDLE_MARKER')
        await expect(revise.execute({
          headConvention: 'The worked-example stem begins one question.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e8' }],
        }, TOOL_CONTEXT)).resolves.toContain('silently drops previously sampled image element(s) p0e8')
        return {
          id: SessionId('image-preservation-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: {} }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 505, rightLimit: 600, bottom: 350,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '题图保护.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '例5 如图，证明直线与平面垂直', bbox: [20, 10, 500, 30] },
          { type: 'text', text: '已知条件一', bbox: [30, 40, 500, 55] },
          { type: 'text', text: '已知条件二', bbox: [30, 70, 500, 85] },
          { type: 'text', text: '已知条件三', bbox: [30, 100, 500, 115] },
          { type: 'text', text: '已知条件四', bbox: [30, 130, 500, 145] },
          { type: 'text', text: 'UNRELATED_MIDDLE_MARKER', bbox: [30, 160, 500, 175] },
          { type: 'text', text: '完成证明', bbox: [30, 190, 500, 205] },
          { type: 'text', text: '图示如下', bbox: [30, 220, 160, 235] },
          { type: 'image', text: '', bbox: [180, 300, 420, 340] },
          { type: 'text', text: '【答案】连接辅助线', bbox: [20, 360, 500, 380] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: { decision: 'unresolved', affectedQuestionIds: ['p0e0'], questions: [question] },
    })
    await ctx.fiber.dispose()
  })

  it.each(['edge', 'erasure'] as const)('keeps a previous %s repair when removing a different source-page slice', async (previousRepair) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const repair = [...registered.values()].find(tool => tool.name.startsWith('repair_question_crops_'))
        if (findings === undefined || source === undefined || repair === undefined) throw new Error('missing review tools')
        if (runs === 1) {
          await expect(findings.execute({ verifiedCrops: [], findings: [{
            cropId: 'crop-p0e0', repairIntents: ['trim-bottom'], issue: 'A later report page is inside the crop.',
            insideCropEvidence: 'The report title and paragraph appear after the complete learner task.',
          }] }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        } else {
          await source.execute({ targetId: 'crop-p0e0', chunk: 0 }, TOOL_CONTEXT)
          await expect(repair.execute({ repairs: [{ cropId: 'crop-p0e0', outsideBoundaryElementIds: ['p1e0'] }] }, TOOL_CONTEXT))
            .resolves.toContain('ACCEPTED')
        }
        return { id: SessionId(`cumulative-repair-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const erased = [350, 120, 400, 150] as const
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'cumulative-repair.pdf', groupIndex: 0, recutAttempt: 1,
      corePageIndexes: [0, 1], reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. 求函数的最大值。', bbox: [20, 20, 500, 60] },
        { type: 'image', text: '', bbox: erased },
      ] }, { pageIndex: 1, width: 600, height: 800, elements: [
        { type: 'text', text: 'Discussion for teachers', bbox: [20, 30, 500, 60] },
        { type: 'text', text: 'An unrelated teaching report.', bbox: [20, 80, 500, 200] },
      ] }],
      questions: [{ sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{ pageIndex: 0, left: 15, top: 15, right: 505, rightLimit: 600,
          bottom: previousRepair === 'edge' ? 80 : 160, excludedAreas: previousRepair === 'erasure' ? [erased] : [],
          pageWidth: 600, pageHeight: 800 },
        { pageIndex: 1, left: 15, top: 25, right: 505, rightLimit: 600, bottom: 205,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }] }],
      pagePreviews: [0, 1].map(pageIndex => ({ pageIndex, mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL })),
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions[0]?.regions).toHaveLength(1)
    expect(result.value.questions[0]?.regions[0]).toMatchObject(previousRepair === 'edge'
      ? { bottom: 80, excludedAreas: [] }
      : { bottom: 155, excludedAreas: [erased] })
    await ctx.fiber.dispose()
  })

  it.each([
    'the answer line below the OCR text is clipped',
    'the crop is missing its answer-demand clause below the recognized stem',
    'the answer-demand clause below the recognized stem is missing',
    'the crop omits the solution set requested after the unfinished inequality',
    'the answer-blank below the recognized stem is cut-off',
  ])('lets visual review repair learner content without treating it as a supplied answer: %s', async (issue) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('verticalRegionEdits')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: `${issue}; the worked solution is missing too`,
            evidence: 'the source prints the worked solution below the learner task',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('must not expand a learner crop to include an answer')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue,
            evidence: 'a drawn answer line remains visible below the crop on the source page',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 105 }] }],
        }, TOOL_CONTEXT)).resolves.toContain('crosses question head p0e2')
        const accepted = String(await revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 80 }] }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const questions = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 45,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 95, right: 305, rightLimit: 600, bottom: 135,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '填空题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: [questions[0]!.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '解集是', bbox: [30, 30, 300, 40] },
          { type: 'text', text: '2. 求参数取值', bbox: [20, 100, 300, 110] },
          { type: 'text', text: '说明理由', bbox: [30, 120, 300, 130] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ left: 15, right: 305, top: 5, bottom: 80 }] },
          questions[1],
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('lets visual review trim source pixels only on the cited crop right edge', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('sourceRightLimitEdits may only reduce rightLimit')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-right'],
            issue: 'a vertical registration strip appears after the question content',
            evidence: 'the crop right edge contains a binding line absent from the question',
          }],
        }, TOOL_CONTEXT)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', sourceRightLimitEdits: [{ pageIndex: 0, rightLimit: 300 }] }],
        }, TOOL_CONTEXT)).resolves.toContain('must retain all owned pixels')
        const accepted = String(await revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', sourceRightLimitEdits: [{ pageIndex: 0, rightLimit: 360 }] }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const questions = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 45,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 95, right: 305, rightLimit: 600, bottom: 135,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '装订栏.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: [questions[0]!.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '解集是', bbox: [30, 30, 300, 40] },
          { type: 'text', text: '2. 求参数取值', bbox: [20, 100, 300, 110] },
          { type: 'text', text: '说明理由', bbox: [30, 120, 300, 130] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ left: 15, right: 305, rightLimit: 360 }] },
          questions[1],
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('enforces directional paired repair for content transferred between adjacent crops', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e2'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: 'question 1 omits its printed answer line',
            evidence: 'the answer line is visible at the top of crop-p0e2 instead of crop-p0e0',
          }, {
            cropId: 'crop-p0e2',
            repairIntents: ['trim-top'],
            issue: 'question 2 starts with question 1 answer line',
            evidence: 'the leading line completes the preceding prompt before question 2 begins',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        await source.execute({ targetId: 'crop-p0e0', chunk: 0 }, TOOL_CONTEXT)
        await source.execute({ targetId: 'crop-p0e2', chunk: 0 }, TOOL_CONTEXT)
        await expect(revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 40 }] }],
        }, TOOL_CONTEXT)).resolves.toContain('trim-bottom direction')
        await expect(revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{
            headElementId: 'p0e0',
            verticalRegionEdits: [{ pageIndex: 0, bottom: 65 }],
          }, {
            headElementId: 'p0e2',
            verticalRegionEdits: [{ pageIndex: 0, top: 65, bottom: 100 }],
          }],
        }, TOOL_CONTEXT)).resolves.toContain('expand-bottom direction')
        const accepted = String(await revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{
            headElementId: 'p0e0',
            verticalRegionEdits: [{ pageIndex: 0, bottom: 65 }],
          }, {
            headElementId: 'p0e2',
            verticalRegionEdits: [{ pageIndex: 0, top: 65 }],
          }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const questions = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 45,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 55, right: 305, rightLimit: 600, bottom: 95,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e4' as TeacherQuestionLayoutElementId,
      questionNo: 3, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 115, right: 305, rightLimit: 600, bottom: 155,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '相邻填空题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: [questions[0]!.sourceHeadId, questions[1]!.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 解集是', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '写在横线上', bbox: [30, 30, 300, 40] },
          { type: 'text', text: '2. 求参数取值', bbox: [20, 70, 300, 80] },
          { type: 'text', text: '说明理由', bbox: [30, 85, 300, 90] },
          { type: 'text', text: '3. 求函数定义域', bbox: [20, 120, 300, 130] },
          { type: 'text', text: '写出过程', bbox: [30, 140, 300, 150] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }, {
        questionNo: 2, fileName: '第2题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, { ...CONFIG, maxQuestionBoundarySubmissions: 5 })

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0', 'p0e2'],
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ top: 5, bottom: 65 }] },
          { sourceHeadId: 'p0e2', regions: [{ top: 65, bottom: 95 }] },
          questions[2],
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('does not treat white output padding as sampled pixels when checking a local vertical recut', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: 'the final answer line is clipped',
            evidence: 'the source shows the line below the current crop edge in the left column',
          }],
        }, TOOL_CONTEXT)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await revise.execute({
          headConvention: 'Each column contains an independent question.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 105 }] }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const questions = [{
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 45,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }, {
      sourceHeadId: 'p0e2' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 395, top: 95, right: 555, rightLimit: 600, bottom: 135,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }]

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '双栏填空题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: [questions[0]!.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '解集是', bbox: [30, 30, 300, 40] },
          { type: 'text', text: '2. 求参数取值', bbox: [400, 100, 550, 110] },
          { type: 'text', text: '说明理由', bbox: [410, 120, 550, 130] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [
          { sourceHeadId: 'p0e0', regions: [{ right: 305, rightLimit: 600, bottom: 105 }] },
          questions[1],
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('applies a coordinate-only recut to the existing final-question region', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-top'],
            issue: 'the crop has unrelated pixels above its head',
            evidence: 'the crop begins above the visible question head',
          }],
        }, TOOL_CONTEXT)
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await revise.execute({
          headConvention: 'The current final question keeps its existing semantic boundary.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, top: 8 }] }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 400, bottom: 60,
        excludedAreas: [[250, 40, 300, 55] as const], pageWidth: 600, pageHeight: 800,
      }],
    }

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '组尾题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [20, 10, 300, 20] },
          { type: 'text', text: '写出完整过程', bbox: [20, 30, 300, 40] },
        ],
      }, {
        pageIndex: 1, width: 600, height: 800,
        elements: [{ type: 'text', text: '2. 下一组问题', bbox: [20, 10, 300, 20] }],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [{
          sourceHeadId: 'p0e0',
          regions: [{
            pageIndex: 0, left: 15, top: 8, right: 305, rightLimit: 400, bottom: 60,
            excludedAreas: [[250, 40, 300, 55]],
          }],
        }],
      },
    })
    await ctx.fiber.dispose()
  })

  it('requires source-page comparison before accepting visually valid crops', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('visualAttention')
        expect(startRequest.prompt[0]?.text).toContain('concatenates source regions')
        expect(startRequest.prompt[0]?.text).toContain('are erased from this crop')
        expect(startRequest.prompt[0]?.text).toContain('extend beyond the sampled crop bounds')
        expect(startRequest.prompt[0]?.text).toContain('printed page numbers, and running headers or footers')
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求函数定义域',
            evidence: 'question stem through final line is visible',
          }],
          findings: [],
        }, TOOL_CONTEXT))
          .resolves.toContain('inspect every requested source-page preview and question crop')
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '',
            evidence: 'complete visible crop',
          }],
          findings: [],
        }, TOOL_CONTEXT)).resolves.toContain('answerDemand must identify the visible response')
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: '求函数定义域',
            evidence: 'question stem through final line is visible',
            topmostVisibleContent: 'the printed question head',
            bottommostVisibleContent: 'the final required answer line',
            leftmostVisibleContent: 'the printed question number at the left edge',
            rightmostVisibleContent: 'the complete source diagram before blank padding',
            requiredVisuals: 'the source diagram is visible at the right of the crop',
          }],
          findings: [],
        }, TOOL_CONTEXT)).resolves.toContain('has visualAttention flags')
        await expect(findings.execute({ verifiedCrops: [], findings: [] }, TOOL_CONTEXT))
          .resolves.toContain('every requested crop requires a verified or defective classification: crop-p0e0')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-bottom', 'expand-bottom'],
            issue: 'the crop visibly contains unrelated pixels and omits the final line',
            evidence: 'the source and crop visibly disagree at the bottom edge',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('must not expand and trim the same crop edge')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: 'the stem and options are complete but the answer is missing',
            evidence: 'the source answer and explanation are not included in the crop',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('must not expand a learner crop to include an answer')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the crop might omit a continuation',
            evidence: 'the initial visual comparison appeared ambiguous',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('must report a visibly confirmed defect')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: '需确认裁剪下方是否还有答题横线',
            evidence: '目前没有在框外确认到对应像素',
            outsideCropEvidence: '需检查框外来源区域',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('must report a visibly confirmed defect')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the crop omits a visible continuation',
            evidence: 'the source page visibly continues below the crop',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        const rejectedRetraction = String(await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: '求函数定义域',
            evidence: 'question stem through final line is visible',
          }],
          findings: [],
        }, TOOL_CONTEXT))
        expect(rejectedRetraction).toContain('recorded visual defects cannot be replaced or withdrawn')
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: {} }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 10, top: 10, right: 500, rightLimit: 600, bottom: 100,
        excludedAreas: [[400, 40, 450, 90] as const], pageWidth: 600, pageHeight: 800,
      }, {
        pageIndex: 0, left: 10, top: 740, right: 200, rightLimit: 600, bottom: 798,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '单题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [10, 10, 500, 100] },
          { type: 'image', text: '', bbox: [400, 40, 450, 90] },
          { type: 'image', text: '', bbox: [5, 735, 205, 799] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, { ...CONFIG, maxQuestionBoundarySubmissions: 4, maxQuestionRejectedToolCalls: 10 })

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({
      ok: true,
      value: { decision: 'unresolved', affectedQuestionIds: ['p0e0'], questions: [question] },
    })
    await ctx.fiber.dispose()
  })

  it('does not flag a same-page column wrap as a vertical gap', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).not.toContain('concatenates source regions')
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        const accepted = String(await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: 'complete both requested proofs',
            evidence: 'the stem continues from the lower left column into both subparts at the top of the right column',
          }],
          findings: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 20, top: 680, right: 280, rightLimit: 300, bottom: 820,
        excludedAreas: [], pageWidth: 600, pageHeight: 840,
      }, {
        pageIndex: 0, left: 310, top: 40, right: 570, rightLimit: 600, bottom: 120,
        excludedAreas: [], pageWidth: 600, pageHeight: 840,
      }],
    }

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '双栏跨栏题.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 840,
        elements: [
          { type: 'text', text: '例5 证明下列结论', bbox: [20, 680, 280, 700] },
          { type: 'text', text: '(1) 证明结论一；(2) 证明结论二', bbox: [310, 40, 570, 80] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 4,
    }, CONFIG)).resolves.toMatchObject({
      ok: true,
      value: { decision: 'accepted', affectedQuestionIds: [], questions: [question] },
    })
    await ctx.fiber.dispose()
  })

  it('starts a fresh crop-review child after an invented final token', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let attempts = 0
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        attempts += 1
        if (attempts === 1) {
          return {
            id: SessionId('child-1'), localAgent: undefined,
            result: Promise.resolve({
              stopReason: 'completed' as const,
              output: [],
              structured: { validationToken: 'invented' },
            }),
            dispose: () => Promise.resolve(),
          }
        }
        expect(startRequest.prompt[0]?.text).toContain('previous crop-review child ended without a Host-accepted result')
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        await crops.execute({ ids: ['crop-p0e0'] }, TOOL_CONTEXT)
        const accepted = String(await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            ...VERIFIED_VISUAL_CHECK,
            answerDemand: 'complete the requested calculation',
            evidence: 'the complete stem and final instruction are both visible',
          }],
          findings: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child-2'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 10, top: 10, right: 500, rightLimit: 600, bottom: 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '恢复复查.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{ type: 'text', text: '1. 求函数定义域', bbox: [10, 10, 500, 100] }],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)).resolves.toMatchObject({
      ok: true,
      value: { decision: 'accepted', affectedQuestionIds: [], questions: [question] },
    })
    expect(attempts).toBe(2)
    await ctx.fiber.dispose()
  })

  it.each(['required-content', 'source-overlay'] as const)('reviews only the requested annotated crop and explicitly classifies its sampled image as %s', async (imageRole) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    const reviewSheetHeights = new Map<string, number>()
    let reviewPageSheet: Buffer | undefined
    provideAttachments(ctx, async (source) => {
      if (!source.name.startsWith('review-')) return
      const metadata = await sharp(source.data).metadata()
      reviewSheetHeights.set(source.name.slice(0, -4), metadata.height ?? 0)
      if (source.name === 'review-page-sheet-1.png') reviewPageSheet = Buffer.from(source.data)
    })
    const wideCrop = await sharp({
      create: { width: 100, height: 10, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    const sourcePage = await sharp({
      create: { width: 600, height: 800, channels: 3, background: '#000000' },
    }).png().toBuffer()
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 310, top: 10, right: 590, rightLimit: 600, bottom: 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const contextQuestion = {
      sourceHeadId: 'p0e1' as TeacherQuestionLayoutElementId,
      questionNo: 2, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 10, top: 120, right: 290, rightLimit: 300, bottom: 210,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const start = vi.fn(async (_mode: string, startRequest: {
      readonly prompt: readonly { readonly type: string; readonly text?: string }[]
      readonly toolFilter: { readonly allow: readonly string[] }
      readonly persona: string
      readonly agentOptions?: { readonly maxTokens?: number; readonly toolChoice?: string }
    }) => {
      expect(startRequest.prompt[0]?.text).toContain('magenta rectangle')
      expect(startRequest.prompt[0]?.text).toContain('cyan frame')
      expect(startRequest.prompt[0]?.text).toContain('verifiedCrops')
      expect(startRequest.prompt[0]?.text).toContain('Put each complete crop ID exactly once in verifiedCropIds')
      expect(startRequest.prompt[0]?.text).toContain('it never proves that the crop is one learner question')
      const promptText = startRequest.prompt[0]?.text ?? ''
      const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
        readonly fullGroupCoverage: boolean
        readonly cropLocalLaneMask: boolean
        readonly reviewSheetIds: readonly string[]
        readonly sourceImageSampling: readonly { readonly elementId: string; readonly sampledByCropIds: readonly string[] }[]
        readonly preliminaryQuestions: readonly { readonly cropId: string }[]
      }
      expect(metadata.fullGroupCoverage).toBe(false)
      expect(metadata.cropLocalLaneMask).toBe(true)
      expect(metadata.sourceImageSampling.map(({ elementId, sampledByCropIds }) => ({ elementId, sampledByCropIds })))
        .toEqual([
          { elementId: 'p0e2', sampledByCropIds: ['crop-p0e0'] },
          { elementId: 'p0e3', sampledByCropIds: [] },
        ])
      expect(promptText).toContain('An image whose sampledByCropIds omits this crop is not inside that crop')
      expect(promptText).toContain('Masked pixels are unavailable evidence')
      expect(metadata.preliminaryQuestions).toEqual([{ cropId: 'crop-p0e0', questionNo: 1, headText: '1. 求函数定义域', headPageId: 'page-1', regionPageIds: ['page-1'] }])
      expect(metadata.reviewSheetIds).toEqual(['review-page-sheet-1', 'review-crop-sheet-1'])
      expect(startRequest.prompt.filter(block => block.type === 'image')).toHaveLength(2)
      expect(startRequest.persona).toContain('review sheet attached to the initial task')
      expect(startRequest.persona).not.toContain('through the named sheet tool')
      expect([...registered.values()].some(tool => tool.name.startsWith('question_review_sheet_'))).toBe(false)
      expect(startRequest.toolFilter.allow.some(name => name.startsWith('question_review_page_'))).toBe(false)
      expect(startRequest.toolFilter.allow.some(name => name.startsWith('question_review_crop_'))).toBe(false)
      expect(startRequest.agentOptions).toMatchObject({ maxTokens: 32_768, toolChoice: 'required' })
      const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
      if (findings === undefined) throw new Error('crop findings tool was not registered')
      expect(startRequest.toolFilter.allow).toEqual([findings.name])
      expect(findings.parameters).toHaveProperty('properties.verifiedCrops')
      expect(findings.parameters).toHaveProperty('properties.verifiedCropIds.items.type', 'string')
      expect(findings.parameters).toHaveProperty('properties.verifiedCrops.items.properties.answerDemand')
      expect(findings.parameters).toHaveProperty('properties.verifiedCrops.items.properties.evidence')
      expect(findings.parameters.required ?? []).not.toContain('verifiedCrops')
      expect(findings.parameters.required ?? []).not.toContain('findings')
      expect([...registered.values()].some(tool => tool.name.startsWith('question_review_context_'))).toBe(true)
      expect([...registered.values()].some(tool => tool.name.startsWith('revise_question_boundaries_'))).toBe(true)
      await expect(findings.execute({
        verifiedCrops: [],
        findings: [{
          cropId: 'crop-p0e0',
          repairIntents: ['expand-bottom'],
          issue: 'the final line is allegedly absent',
          evidence: 'the source and crop were compared',
          outsideCropEvidence: 'the final line is inside the annotated magenta rectangle',
        }],
      }, TOOL_CONTEXT)).resolves.toContain('pixels inside the annotated crop region')
      await expect(findings.execute({
        verifiedCrops: [],
        findings: [{
          cropId: 'crop-p0e0',
          repairIntents: ['reassign-content'],
          issue: 'the continuation is allegedly missing from the crop',
          evidence: 'a page-binding line was mistaken for a cut edge',
          outsideCropEvidence: 'the alleged continuation is to the right of the binding line',
        }],
      }, TOOL_CONTEXT)).resolves.toContain('owns every OCR element before the next question or section')
      expect([...registered.values()].some(tool => tool.name.startsWith('question_review_context_'))).toBe(true)
      await expect(findings.execute({
        verifiedCrops: [],
        findings: [{
          cropId: 'crop-p0e0',
          repairIntents: ['trim-bottom'],
          issue: 'the crop is already correct',
          evidence: 'the actual output already correctly excludes the answer',
          insideCropEvidence: 'no defective pixels are visible',
        }],
      }, TOOL_CONTEXT)).resolves.toContain('already-correct crop')
      await expect(findings.execute({
        verifiedCrops: [{
          cropId: 'crop-p0e0',
          answerDemand: '求函数定义域',
          evidence: '题干中的“求函数定义域”要求学生给出定义域',
          ...VERIFIED_CROP_EDGES,
        }],
        findings: [{
          pageId: 'page-1',
          repairIntents: [],
          missingQuestionHead: 'Q1 求函数定义域',
          issue: 'Q1 is allegedly missing',
          evidence: 'the annotated page visibly labels this problem Q1',
        }],
      }, TOOL_CONTEXT)).resolves.toContain('forbidden during a crop-local recut')
      await expect(findings.execute({
        verifiedCrops: [{
          cropId: 'crop-p0e0',
          answerDemand: '',
          evidence: '题干中的“求函数定义域”可见',
          ...VERIFIED_CROP_EDGES,
        }],
      }, TOOL_CONTEXT)).resolves.toContain('answerDemand must identify the visible response')
      await expect(findings.execute({
        verifiedCrops: [{
          cropId: 'crop-p0e0',
          answerDemand: '求函数定义域',
          evidence: '',
          ...VERIFIED_CROP_EDGES,
        }],
      }, TOOL_CONTEXT)).resolves.toContain('evidence must name visible task pixels')
      await expect(findings.execute({
        verifiedCrops: [{
          cropId: 'crop-p0e0',
          answerDemand: '求函数定义域',
          evidence: '题干中的“求函数定义域”要求学生给出定义域',
          ...VERIFIED_CROP_EDGES,
          topmostVisibleContent: '',
          bottommostVisibleContent: '',
        }],
      }, TOOL_CONTEXT)).resolves.toContain('requires actual visible evidence for topmostVisibleContent, bottommostVisibleContent')
      await expect(findings.execute({
        verifiedCropIds: ['crop-p0e0'],
        verifiedCrops: [{
          cropId: 'crop-p0e0',
          answerDemand: '求函数定义域',
          evidence: '题干中的“求函数定义域”要求学生给出定义域',
          ...VERIFIED_CROP_EDGES,
        }],
      }, TOOL_CONTEXT)).resolves.toContain('duplicates an earlier verified crop')
      await expect(findings.execute({
        verifiedCropIds: ['crop-p0e0'],
      }, TOOL_CONTEXT)).resolves.toContain('requires imageChecks for sampled image p0e2')
      await expect(findings.execute({
        verifiedCrops: [],
        imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e3', role: 'unrelated', evidence: 'An image below the crop on the source page.' }],
      }, TOOL_CONTEXT)).resolves.toContain('must identify an image actually sampled')
      await expect(findings.execute({
        verifiedCrops: [],
        imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e2', role: imageRole, evidence: 'Visible image pixels overlap the supplied stem in the crop.' }],
      }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
      return {
        id: SessionId('annotated-review-child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
        dispose: () => Promise.resolve(),
      }
    })
    ctx.provide('subagents', { start } as never)

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '标注复核.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 1,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [310, 10, 590, 100] },
          { type: 'text', text: '2. 求函数值域', bbox: [10, 120, 290, 210] },
          { type: 'image', text: '', bbox: [350, 40, 450, 65] },
          { type: 'image', text: '', bbox: [350, 150, 450, 180] },
        ],
      }],
      pagePreviews: [{
        pageIndex: 0,
        mediaType: 'image/png',
        width: 600,
        height: 800,
        contentBase64: sourcePage.toString('base64'),
      }],
      questions: [question, contextQuestion],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 100, height: 10,
        contentBase64: wideCrop.toString('base64'),
      }],
      padding: 5,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true, maxQuestionRejectedToolCalls: 12 })

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({ ok: true, value: { decision: 'accepted', questions: [question, contextQuestion] } })
    expect(start).toHaveBeenCalledOnce()
    expect(reviewSheetHeights.get('review-crop-sheet-1')).toBeLessThan(300)
    expect(reviewSheetHeights.get('review-page-sheet-1')).toBeGreaterThan(reviewSheetHeights.get('review-crop-sheet-1') ?? 0)
    if (reviewPageSheet === undefined) throw new Error('annotated review page sheet was not captured')
    const maskedLane = await sharp(reviewPageSheet)
      .extract({ left: 140, top: 300, width: 180, height: 300 })
      .toBuffer()
    const reviewedLane = await sharp(reviewPageSheet)
      .extract({ left: 470, top: 300, width: 180, height: 300 })
      .toBuffer()
    const maskedMean = (await sharp(maskedLane).stats()).channels[0]?.mean ?? 0
    const reviewedMean = (await sharp(reviewedLane).stats()).channels[0]?.mean ?? 255
    const ownedPixels = await sharp(reviewPageSheet)
      .extract({ left: 470, top: 115, width: 120, height: 30 }).toBuffer()
    const ownedMean = (await sharp(ownedPixels).stats()).channels[0]?.mean ?? 255
    expect(maskedMean).toBeGreaterThan(180)
    expect(reviewedMean).toBeGreaterThan(80)
    expect(reviewedMean).toBeLessThan(120)
    expect(maskedMean - reviewedMean).toBeGreaterThan(100)
    expect(ownedMean).toBeLessThan(20)
    await ctx.fiber.dispose()
  })

  it('rejects missing-question findings from adjacent continuation pages', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    const pageSheets = new Map<string, Buffer>()
    provideAttachments(ctx, (source) => {
      if (source.name.startsWith('review-page-sheet-')) pageSheets.set(source.name, Buffer.from(source.data))
    })
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 10, top: 10, right: 500, rightLimit: 600, bottom: 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly type?: string; readonly text?: string }[] }) => {
        const promptText = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
          readonly corePageIds: readonly string[]
          readonly reviewSheetIds: readonly string[]
        }
        expect(metadata.corePageIds).toEqual(['page-1'])
        expect(metadata.reviewSheetIds).toEqual(['review-page-sheet-1', 'review-page-sheet-2', 'review-crop-sheet-1'])
        expect(JSON.stringify(startRequest.prompt)).toContain('annotated CORE source-page review sheet containing page-1')
        expect(JSON.stringify(startRequest.prompt)).toContain('annotated CONTEXT ONLY source-page review sheet containing page-2')
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('compact review findings tool was not registered')
        expect(startRequest.prompt.filter(block => block.type === 'image')).toHaveLength(metadata.reviewSheetIds.length)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: '求函数定义域',
            evidence: '题干中的“求函数定义域”要求学生给出定义域',
            ...VERIFIED_CROP_EDGES,
          }],
          findings: [{
            pageId: 'page-2',
            repairIntents: [],
            missingQuestionHead: '2. 求函数值域',
            issue: 'the adjacent-page problem has no crop in this group',
            evidence: 'the independent problem is visible outside every magenta box on page 2',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('must cite a core page')
        const accepted = String(await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: '求函数定义域',
            evidence: '题干中的“求函数定义域”要求学生给出定义域',
            ...VERIFIED_CROP_EDGES,
          }],
          findings: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('adjacent-page-review-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '相邻上下文页.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{ type: 'text', text: '1. 求函数定义域', bbox: [10, 10, 500, 100] }],
      }, {
        pageIndex: 1, width: 600, height: 800,
        elements: [{ type: 'text', text: '2. 求函数值域', bbox: [10, 10, 500, 100] }],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }, {
        pageIndex: 1, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 4,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })).resolves.toMatchObject({
      ok: true,
      value: { decision: 'accepted', affectedQuestionIds: [], questions: [question] },
    })
    for (const [name, color] of [
      ['review-page-sheet-1.png', [17, 100, 102]],
      ['review-page-sheet-2.png', [71, 85, 105]],
    ] as const) {
      const sheet = pageSheets.get(name)
      if (sheet === undefined) throw new Error(`missing review sheet: ${name}`)
      expect((await sharp(sheet).metadata()).width).toBe(800)
      const pixel = await sharp(sheet).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
      expect([...pixel]).toEqual(color)
    }
    await ctx.fiber.dispose()
  })

  it('does not recover numbered solutions as missing questions after a document answer heading', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly type?: string; readonly text?: string }[] }) => {
        const promptText = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
          readonly answerSectionPageIds: readonly string[]
          readonly reviewSheetIds: readonly string[]
        }
        expect(metadata.answerSectionPageIds).toEqual(['page-2'])
        expect(promptText).toContain('numbered solution or explanation heads')
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('compact review findings tool was not registered')
        expect(startRequest.prompt.filter(block => block.type === 'image')).toHaveLength(metadata.reviewSheetIds.length)
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            pageId: 'page-2',
            repairIntents: [],
            missingQuestionHead: '17.（15分）解：',
            issue: 'the numbered item allegedly has no crop',
            evidence: 'the answer page visibly starts a worked solution numbered 17',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('document answer-section page')
        const accepted = String(await findings.execute({
          verifiedCrops: [],
          findings: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error('review was not accepted')
        return {
          id: SessionId('answer-section-review-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '试卷与答案.pdf',
      groupIndex: 0,
      corePageIndexes: [1],
      recutAttempt: 0,
      reviewQuestionIds: [],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '五月模拟数学试卷', bbox: [120, 20, 480, 50] },
          { type: 'text', text: '数学试卷参考答案及评分标准', bbox: [120, 60, 480, 90] },
        ],
      }, {
        pageIndex: 1, width: 600, height: 800,
        elements: [
          { type: 'text', text: '17.（15分）解：', bbox: [30, 40, 180, 65] },
          { type: 'text', text: '（1）由已知条件可得结论', bbox: [40, 80, 500, 110] },
        ],
      }],
      pagePreviews: [
        { pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL },
        { pageIndex: 1, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL },
      ],
      questions: [],
      crops: [],
      padding: 5,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })).resolves.toMatchObject({
      ok: true,
      value: { decision: 'accepted', questions: [] },
    })
    await ctx.fiber.dispose()
  })

  it('lets the visual Agent leave a formula-summary page without learner questions', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: {
        readonly prompt: readonly { readonly type?: string; readonly text?: string }[]
        readonly persona: string
      }) => {
        const promptText = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(promptText.slice(promptText.lastIndexOf('\n') + 1)) as {
          readonly suggestedUncoveredQuestionHeads: readonly unknown[]
          readonly reviewSheetIds: readonly string[]
        }
        expect(metadata.suggestedUncoveredQuestionHeads).toEqual([])
        expect(promptText).toContain('non-exhaustive OCR hint, never an allowlist')
        expect(startRequest.persona).toContain('A core page with no independent learner problem needs no page-only finding')
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('compact review findings tool was not registered')
        expect(startRequest.prompt.filter(block => block.type === 'image')).toHaveLength(metadata.reviewSheetIds.length)
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            pageId: 'page-1',
            missingQuestionHead: '专题八 数列',
            issue: 'the page has no missing learner question',
            evidence: 'No magenta crop exists because this formula-summary page has no verified learner answer demand.',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('contradicts missingQuestionHead')
        const accepted = String(await findings.execute({
          verifiedCrops: [],
          findings: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error('review was not accepted')
        return {
          id: SessionId('formula-summary-review-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '高考专题公式汇总.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '专题八 数列', bbox: [40, 30, 300, 60] },
          { type: 'text', text: '1. 等差数列通项公式：a_n=a_1+(n-1)d', bbox: [40, 90, 550, 120] },
          { type: 'text', text: '2. 等比数列通项公式：a_n=a_1q^(n-1)', bbox: [40, 150, 550, 180] },
          { type: 'text', text: '专题九 三角函数', bbox: [40, 230, 300, 260] },
        ],
      }],
      pagePreviews: [
        { pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL },
      ],
      questions: [],
      crops: [],
      padding: 5,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })).resolves.toMatchObject({
      ok: true,
      value: { decision: 'accepted', questions: [] },
    })
    await ctx.fiber.dispose()
  })

  it.each(['f(x) =', 'f(x) = ______.'])('requires explicit table-edge and applicable response-tail inspection (%s)', async (tail) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        const prompt = startRequest.prompt[0]?.text ?? ''
        expect(prompt).toContain('Missing edge pixels require expansion even when every OCR element is owned')
        const metadata = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as {
          readonly visualAttention: readonly { readonly cropId: string; readonly flags: readonly string[] }[]
        }
        const flags = metadata.visualAttention.find(item => item.cropId === 'crop-p0e0')?.flags.join('\n') ?? ''
        expect(flags).toContain('Source table element(s) p0e1')
        expect(flags).toContain('unrelated method or theory-summary table is contamination')
        expect(flags).toContain('final bottom grid line')
        expect(flags.includes('unfinished response')).toBe(tail === 'f(x) =')
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('findings tool missing')
        const verifiedCrops = [{ cropId: 'crop-p0e0', answerDemand: 'Find the function from the table.',
          evidence: 'The table defines the inputs and outputs to use.', ...VERIFIED_CROP_EDGES }]
        await expect(findings.execute({ verifiedCrops, findings: [] }, TOOL_CONTEXT))
          .resolves.toContain('require attentionChecks')
        await expect(findings.execute({ verifiedCrops: [], findings: [], attentionChecks: [{
          cropId: 'crop-p0e0', evidence: '',
        }] }, TOOL_CONTEXT)).resolves.toContain('must resolve every listed geometry warning')
        await expect(findings.execute({ verifiedCrops: [], findings: [], attentionChecks: [{
          cropId: 'crop-p0e0', evidence: 'The crop includes every table row, bottom rule and the dark response line after the final equation.',
        }] }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return { id: SessionId('table-edge-review'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'table-and-response.pdf', groupIndex: 0, recutAttempt: 1,
      corePageIndexes: [0], reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. Find the function from the table.', bbox: [20, 20, 540, 40] },
        { type: 'table', text: 'x | f(x)', bbox: [20, 50, 540, 140] },
        { type: 'text', text: tail, bbox: [20, 200, 540, 220] },
      ] }],
      questions: [{ sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0,
        groupIndex: 0, regions: [{ pageIndex: 0, left: 16, top: 16, right: 544, rightLimit: 600, bottom: 240,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    expect(result).toMatchObject({ ok: true, value: { decision: 'accepted' } })
    await ctx.fiber.dispose()
  })

  it('skips the visual child when reasoning is disabled while retaining a visible response line', async () => {
    const ctx = new Context()
    const start = vi.fn()
    ctx.provide('subagents', { start } as never)
    const source = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 100, height: 2, channels: 3, background: '#000000' } }, left: 40, top: 82 }])
      .png().toBuffer()
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1,
      headPageIndex: 0,
      groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 35, top: 35, right: 405, rightLimit: 600, bottom: 65,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const request = {
      parentSessionId: SessionId('not-live'),
      fileName: 'fast-review.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [{
        type: 'text' as const, text: '1. 求函数的解析式为', bbox: [40, 40, 400, 60] as const,
      }] }],
      pagePreviews: [{
        pageIndex: 0, mediaType: 'image/png' as const, width: 600, height: 800,
        contentBase64: source.toString('base64'),
      }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: 'q.png', mediaType: 'image/png' as const,
        width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 5,
    }
    const config = { ...CONFIG, questionSegmentationReasoningEnabled: false }

    const revised = await reviewQuestionCropsWithAgent(ctx, request, config)
    expect(revised).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [{ regions: [{ bottom: 89 }] }],
      },
    })
    if (!revised.ok) throw new Error(revised.error.message)
    await expect(reviewQuestionCropsWithAgent(ctx, {
      ...request,
      recutAttempt: 1,
      questions: revised.value.questions,
    }, config)).resolves.toMatchObject({ ok: true, value: { decision: 'accepted' } })
    expect(start).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it.each([false, true])('recovers an OCR-free answer line and requires a new crop review (JSON-encoded arrays: %s)', async (encodedArrays) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    const start = vi.fn(async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
      const tool = [...registered.values()].find(item => item.name.startsWith('submit_question_crop_findings_'))
      if (tool === undefined) throw new Error('missing review tool')
      const prompt = startRequest.prompt[0]?.text ?? ''
      expect(prompt).toContain('A QR code, publisher resource label, or optional dynamic-demo block is furniture')
      const arguments_ = {
        verifiedCrops: [{ cropId: 'crop-p0e0', answerDemand: '求解析式', evidence: '求解析式的题干。', ...VERIFIED_CROP_EDGES }],
        attentionChecks: [{ cropId: 'crop-p0e0', evidence: 'The source and crop were inspected.' }],
        findings: [],
      }
      await expect(tool.execute(encodedArrays
        ? Object.fromEntries(Object.entries(arguments_).map(([key, value]) => [key, JSON.stringify(value)]))
        : arguments_, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
      return { id: SessionId('late-response-line'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
    })
    ctx.provide('subagents', { start } as never)
    const source = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 100, height: 2, channels: 3, background: '#000000' } }, left: 40, top: 82 }])
      .png().toBuffer()
    const request = {
      parentSessionId: SessionId('parent'), fileName: 'late-response-line.pdf', groupIndex: 0, corePageIndexes: [0],
      recutAttempt: 0, reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [{
        type: 'text' as const, text: '1. 求函数的解析式为', bbox: [40, 40, 400, 60] as const,
      }] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png' as const, width: 600, height: 800, contentBase64: source.toString('base64') }],
      questions: [{ sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{ pageIndex: 0, left: 35, top: 35, right: 405, rightLimit: 600, bottom: 65,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }] }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png' as const, width: 1, height: 1, contentBase64: PIXEL }],
    }
    const config = { ...CONFIG, questionSegmentationInlineEvidence: true }
    const result = await reviewQuestionCropsWithAgent(ctx, request, config)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toMatchObject({ decision: 'revised', affectedQuestionIds: ['p0e0'], questions: [{ regions: [{ bottom: 89 }] }] })
    await expect(reviewQuestionCropsWithAgent(ctx, { ...request, recutAttempt: 1, questions: result.value.questions }, config))
      .resolves.toMatchObject({ ok: true, value: { decision: 'accepted', affectedQuestionIds: [] } })
    expect(start).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('reports unknown crop references together without retaining a partial finding and keeps review sheets to one row', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    const questions = [0, 1, 2, 3].map(index => ({
      sourceHeadId: `p0e${String(index)}` as TeacherQuestionLayoutElementId,
      questionNo: index + 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 20, top: 40 + index * 100, right: 500, rightLimit: 600, bottom: 80 + index * 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }))
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('missing findings tool')
        const prompt = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as {
          readonly visualAttention: readonly { readonly cropId: string }[]
          readonly reviewSheetIds: readonly string[]
        }
        expect(metadata.reviewSheetIds).toEqual(['review-page-sheet-1', 'review-crop-sheet-1', 'review-crop-sheet-2'])
        const verifiedCrops = questions.map(question => ({
          cropId: `crop-${String(question.sourceHeadId)}`,
          answerDemand: 'Calculate the requested sum.',
          evidence: 'A numbered instruction asks for a sum.',
          ...VERIFIED_CROP_EDGES,
        }))
        const attentionChecks = metadata.visualAttention.map(({ cropId }) => ({
          cropId, evidence: 'The source and crop show the complete instruction.',
        }))
        const rejected = String(await findings.execute({
          verifiedCrops: [...verifiedCrops, ...['unknown-a', 'unknown-b'].map(cropId => ({ ...verifiedCrops[0], cropId }))], attentionChecks,
          findings: verifiedCrops.map(({ cropId }) => ({
            cropId, repairIntents: ['trim-bottom'], issue: 'Publisher footer below the task.',
            insideCropEvidence: 'Publisher footer in the cyan frame.',
          })),
        }, TOOL_CONTEXT))
        for (const cropId of ['unknown-a', 'unknown-b']) expect(rejected).toContain(`${cropId} is not a requested crop`)
        expect(rejected).toContain('No classification from this invalid-reference submission has been retained')
        for (const [index, crop] of verifiedCrops.entries()) {
          const partial = {
            verifiedCrops: [crop],
            attentionChecks: attentionChecks.filter(check => check.cropId === crop.cropId),
          }
          await expect(findings.execute(partial, TOOL_CONTEXT)).resolves.toMatch(
            index === verifiedCrops.length - 1 ? /^ACCEPTED/ : /^INCOMPLETE/,
          )
          if (index === 0) {
            await expect(findings.execute(partial, TOOL_CONTEXT)).resolves.toMatch(/^REJECTED/)
          }
        }
        return {
          id: SessionId('classification-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    await expect(reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'classification.pdf', groupIndex: 0,
      corePageIndexes: [0], recutAttempt: 0, reviewQuestionIds: questions.map(question => question.sourceHeadId),
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: questions.map((question, index) => ({
        type: 'text' as const, text: `${String(question.questionNo)}. Calculate 2 + 3.`,
        bbox: [20, 40 + index * 100, 500, 80 + index * 100] as const,
      })) }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions,
      crops: questions.map(question => ({
        questionNo: question.questionNo, fileName: 'crop.png', mediaType: 'image/png' as const,
        width: 1, height: 1, contentBase64: PIXEL,
      })), padding: 5,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })).resolves.toMatchObject({
      ok: true, value: { decision: 'accepted' },
    })
    await ctx.fiber.dispose()
  })

  it.each(['same-child', 'fresh-child', 'exhausted'] as const)('repairs defects despite contradictory verification and keeps recovery bounded (%s)', async (recoveryMode) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let childRun = 0
    const childSignals: AbortSignal[] = []
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: {
        readonly signal: AbortSignal
        readonly prompt: readonly { readonly type?: string; readonly text?: string }[]
        readonly toolFilter: { readonly allow: readonly string[] }
        readonly agentOptions?: { readonly maxTokens?: number; readonly toolChoice?: string }
      }) => {
        childRun += 1
        childSignals.push(startRequest.signal)
        expect(startRequest.agentOptions).toMatchObject({ maxTokens: 32_768, toolChoice: 'required' })
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('compact review findings tool was not registered')
        expect([...registered.values()].some(tool => tool.name.startsWith('question_review_sheet_'))).toBe(false)
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('repair_question_crops_'))
        if (source === undefined || revise === undefined) throw new Error('compact repair tools were not registered')
        if (childRun >= 2) {
          expect(startRequest.toolFilter.allow).toEqual([source.name, revise.name])
          if (childRun > 2) {
            expect(startRequest.prompt[0]?.text).toContain('"rejectedDraft":')
            expect(startRequest.prompt[0]?.text).toContain('"bottom":40')
            expect(startRequest.prompt[0]?.text).toContain('clips learner-facing OCR')
            expect(startRequest.prompt[0]?.text).toContain('the bottommost dark pixels spell 【答案】')
          }
          await source.execute({ targetId: 'crop-p0e0', chunk: 0 }, TOOL_CONTEXT)
          await expect(revise.execute({
            repairs: [{ cropId: 'crop-p0e0', pageId: 'page-1', bottom: 50 }],
          }, TOOL_CONTEXT)).resolves.toContain('clips learner-facing OCR')
          await expect(revise.execute({
            repairs: [{ cropId: 'crop-p0e0', pageId: 'page-1', bottom: 45 }],
          }, TOOL_CONTEXT)).resolves.toContain('clips learner-facing OCR')
          if ((childRun === 2 && recoveryMode !== 'same-child') || recoveryMode === 'exhausted') {
            await expect(revise.execute({
              repairs: [{ cropId: 'crop-p0e0', pageId: 'page-1', bottom: 40 }],
            }, TOOL_CONTEXT)).resolves.toContain('REJECTION_BUDGET_EXHAUSTED')
            return {
              id: SessionId(`failed-repair-${String(childRun)}`), localAgent: undefined,
              result: Promise.resolve({ stopReason: 'cancelled' as const, output: [] }),
              dispose: () => Promise.resolve(),
            }
          }
          const accepted = String(await revise.execute({
            repairs: [{ cropId: 'crop-p0e0', pageId: 'page-1', bottom: 70 }],
          }, TOOL_CONTEXT))
          const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
          if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
          return {
            id: SessionId('compact-repair-child'), localAgent: undefined,
            result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
            dispose: () => Promise.resolve(),
          }
        }
        expect(startRequest.toolFilter.allow).toEqual([findings.name])
        expect(startRequest.prompt.filter(block => block.type === 'image')).toHaveLength(2)
        await expect(source.execute({ targetId: 'crop-p0e0', chunk: 0 }, TOOL_CONTEXT))
          .resolves.toContain('recorded repair targets')
        await expect(revise.execute({ repairs: [] }, TOOL_CONTEXT))
          .resolves.toContain('record at least one visual defect')
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0', answerDemand: 'Calculate the result.', evidence: 'The learner task is visible.',
            ...VERIFIED_CROP_EDGES,
          }],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-bottom'],
            issue: 'the rendered crop includes the printed answer heading below the question',
            evidence: 'the answer heading is visibly present at the bottom of the actual crop',
            insideCropEvidence: 'the bottommost dark pixels spell 【答案】',
          }],
        }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        return {
          id: SessionId('compact-review-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const question = {
      sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 0, groupIndex: 0,
      regions: [{
        pageIndex: 0, left: 10, top: 10, right: 500, rightLimit: 600, bottom: 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }

    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '答案污染.pdf',
      groupIndex: 0,
      corePageIndexes: [0],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数定义域', bbox: [10, 10, 500, 30] },
          { type: 'text', text: '写出完整过程', bbox: [10, 40, 500, 55] },
          { type: 'text', text: '【答案】x>0', bbox: [10, 80, 500, 90] },
        ],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL,
      }],
      padding: 4,
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    expect(result).toMatchObject(recoveryMode === 'exhausted' ? {
      ok: true,
      value: {
        decision: 'unresolved',
        affectedQuestionIds: ['p0e0'],
        questions: [question],
      },
    } : {
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [{ regions: [{ bottom: 70 }] }],
      },
    })
    expect(childRun).toBe(recoveryMode === 'same-child' ? 2 : 1 + CONFIG.maxQuestionBoundaryAgentRuns)
    expect(new Set(childSignals).size).toBe(childRun)
    await ctx.fiber.dispose()
  })

  it.each([
    'The discussion heading, prose, publisher caption and publisher image are inside the crop.',
    'After subpart (1), the discussion heading and publisher image are inside the crop; keep the supplied question condition.',
  ])('repairs interior contamination without treating learner landmarks as removal targets: %s', async (insideCropEvidence) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly toolFilter: { readonly allow: readonly string[] } }) => {
        runs += 1
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const repair = [...registered.values()].find(tool => tool.name.startsWith('repair_question_crops_'))
        if (findings === undefined || source === undefined || repair === undefined) throw new Error('review tools missing')
        if (runs === 1) {
          await expect(findings.execute({
            verifiedCrops: [],
            imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e5', role: 'source-overlay', evidence: 'Detached publisher illustration below the stem.' }],
          }, TOOL_CONTEXT)).resolves.toContain('cannot classify a detached image as source-overlay')
          await expect(findings.execute({
            verifiedCrops: [{ cropId: 'crop-p0e0', answerDemand: 'Calculate the area.', evidence: 'The stem is complete.', ...VERIFIED_CROP_EDGES }],
            imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e5', role: 'unrelated', evidence: insideCropEvidence }],
          }, TOOL_CONTEXT)).resolves.toContain('Your imageChecks classifies p0e5 in crop-p0e0 as unrelated')
          await expect(findings.execute({
            verifiedCrops: [],
            findings: [{
              cropId: 'crop-p0e0', repairIntents: ['trim-bottom'],
              issue: 'Unrelated teaching discussion and publisher image follow the learner task.',
              insideCropEvidence,
            }],
          }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        } else {
          expect(startRequest.toolFilter.allow).toEqual([source.name, repair.name])
          expect(repair.parameters).not.toHaveProperty('properties.questions')
          const context = String(await source.execute({ targetId: 'crop-p0e0', chunk: 0 }, TOOL_CONTEXT))
          expect(context).toContain('An unrelated teaching discussion')
          expect(context).toContain('"pageId":"page-1"')
          await expect(repair.execute({ repairs: [{ cropId: 'crop-p0e6', pageId: 'page-1', bottom: 900 }] }, TOOL_CONTEXT))
            .resolves.toContain('not a cited crop')
          await expect(repair.execute({ repairs: [{ cropId: 'crop-p0e0', pageId: 'page-99', bottom: 200 }] }, TOOL_CONTEXT))
            .resolves.toContain('exact pageId from context')
          await expect(repair.execute({ repairs: [
            { cropId: 'crop-p0e0', pageId: 'page-1', bottom: 200 },
            { cropId: 'crop-p0e0', pageId: 'page-1', bottom: 210 },
          ] }, TOOL_CONTEXT)).resolves.toContain('duplicate repair row')
          await expect(repair.execute({ repairs: [{ cropId: 'crop-p0e0', remove: true, pageId: 'page-1', bottom: 200 }] }, TOOL_CONTEXT))
            .resolves.toContain('removal cannot be combined')
          await expect(repair.execute({ repairs: [{ cropId: 'crop-p0e0', remove: true }] }, TOOL_CONTEXT))
            .resolves.toContain('requires a crop finding')
          await expect(repair.execute({ repairs: [{
            cropId: 'crop-p0e0', pageId: 'page-1', bottom: 110,
            outsideBoundaryElementIds: ['p0e2'], excludedElementIds: ['p0e4', 'p0e5'],
          }] }, TOOL_CONTEXT)).resolves.toContain('clips learner-facing OCR')
          await expect(repair.execute({ repairs: [{ cropId: 'crop-p0e0', outsideBoundaryElementIds: ['p0e2'] }] }, TOOL_CONTEXT))
            .resolves.toContain('silently drops previously sampled image')
          await expect(repair.execute({ repairs: [{
            cropId: 'crop-p0e0', outsideBoundaryElementIds: ['p0e2'], excludedElementIds: ['p0e4', 'p0e5'],
          }] }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        }
        return {
          id: SessionId(`flat-repair-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const region = { pageIndex: 0, left: 16, top: 16, right: 544, rightLimit: 600, bottom: 760,
      excludedAreas: [], pageWidth: 600, pageHeight: 1000 }
    const untouched = { sourceHeadId: 'p0e6' as TeacherQuestionLayoutElementId, questionNo: 2, headPageIndex: 0,
      groupIndex: 0, regions: [{ ...region, top: 780, bottom: 830 }] }
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'mixed-content.pdf', groupIndex: 0, recutAttempt: 1,
      corePageIndexes: [0], reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 4,
      pages: [{ pageIndex: 0, width: 600, height: 1000, elements: [
        { type: 'text', text: '1. Calculate the area.', bbox: [20, 20, 540, 60] },
        { type: 'text', text: '(1) Show your working.', bbox: [20, 100, 540, 130] },
        { type: 'text', text: 'An unrelated teaching discussion', bbox: [20, 300, 540, 330] },
        { type: 'text', text: 'Explanation of classroom teaching methods.', bbox: [20, 400, 540, 450] },
        { type: 'text', text: 'Publisher resource', bbox: [20, 650, 540, 680] },
        { type: 'image', text: '', bbox: [20, 690, 160, 740] },
        { type: 'text', text: '2. Solve x + 3 = 8.', bbox: [20, 790, 540, 820] },
      ] }],
      questions: [{ sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0,
        groupIndex: 0, regions: [region] }, untouched],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true, maxQuestionRejectedToolCalls: 20 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.decision).toBe('revised')
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeGreaterThanOrEqual(130)
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeLessThan(300)
    expect(result.value.questions[1]).toEqual(untouched)
    await ctx.fiber.dispose()
    expect(registered.size).toBe(0)
  })

  it.each(['trim-top', 'trim-bottom'] as const)('accepts %s that removes an entire outside page slice without accepting invented or expanding coordinates', async (intent) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    const mainPage = intent === 'trim-top' ? 1 : 0
    const outsidePage = 1 - mainPage
    const head = `p${String(mainPage)}e0` as TeacherQuestionLayoutElementId
    const cropId = `crop-${String(head)}`
    const outsideId = `p${String(outsidePage)}e0`
    const pageId = `page-${String(outsidePage + 1)}`
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const repair = [...registered.values()].find(tool => tool.name.startsWith('repair_question_crops_'))
        if (findings === undefined || source === undefined || repair === undefined) throw new Error('review tools missing')
        if (runs === 1) {
          await expect(findings.execute({ verifiedCrops: [], findings: [{
            cropId, repairIntents: [intent], issue: 'Unrelated chapter banner occupies a separate page slice.',
            insideCropEvidence: 'The detached chapter banner is visible beyond the complete question.',
          }] }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        } else {
          await source.execute({ targetId: cropId, chunk: 0 }, TOOL_CONTEXT)
          const decisions = { cropId, outsideBoundaryElementIds: [outsideId] }
          await expect(repair.execute({ repairs: [{ ...decisions, pageId: 'page-3', bottom: 290 }] }, TOOL_CONTEXT))
            .resolves.toContain('has no existing source slice')
          await expect(repair.execute({ repairs: [{ ...decisions, pageId,
            ...(intent === 'trim-top' ? { top: 100 } : { bottom: 400 }),
          }] }, TOOL_CONTEXT)).resolves.toContain('only an in-page trim')
          await expect(repair.execute({ repairs: [{ ...decisions, pageId,
            ...(intent === 'trim-top' ? { top: 1001 } : { bottom: -1 }),
          }] }, TOOL_CONTEXT)).resolves.toContain('only an in-page trim')
          await expect(repair.execute({ repairs: [{ ...decisions, pageId,
            ...(intent === 'trim-top' ? { top: 350 } : { bottom: 290 }),
          }] }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        }
        return { id: SessionId(`whole-slice-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve() }
      },
    } as never)
    const main = { pageIndex: mainPage, left: 16, top: 96, right: 544, rightLimit: 600, bottom: 244,
      excludedAreas: [], pageWidth: 600, pageHeight: 1000 }
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'cross-page-mixed-content.pdf', groupIndex: 0, recutAttempt: 1,
      corePageIndexes: [0, 1, 2], reviewQuestionIds: [head], padding: 4,
      pages: [0, 1, 2].map(pageIndex => ({ pageIndex, width: 600, height: 1000,
        elements: pageIndex === mainPage ? [
          { type: 'text' as const, text: '1. Calculate the area.', bbox: [20, 100, 540, 140] as const },
          { type: 'text' as const, text: 'Show your working.', bbox: [20, 200, 540, 240] as const },
        ] : pageIndex === outsidePage ? [
          { type: 'text' as const, text: 'Functions and graphs', bbox: [20, 293, 540, 342] as const },
        ] : [],
      })),
      questions: [{ sourceHeadId: head, questionNo: 1, headPageIndex: mainPage, groupIndex: 0,
        regions: [main, { ...main, pageIndex: outsidePage, top: 289, bottom: 346 }].sort((a, b) => a.pageIndex - b.pageIndex) }],
      pagePreviews: [0, 1, 2].map(pageIndex => ({ pageIndex, mediaType: 'image/png' as const,
        width: 1, height: 1, contentBase64: PIXEL })),
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true, maxQuestionBoundarySubmissions: 10, maxQuestionRejectedToolCalls: 10 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.decision).toBe('revised')
    expect(result.value.questions[0]?.regions).toEqual([main])
    await ctx.fiber.dispose()
  })

  it.each(['reassign-content', 'trim-bottom'] as const)('honors outside decisions and explicit retention of preceding images during %s without weakening content checks', async (intent) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_context_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (findings === undefined || source === undefined || revise === undefined) throw new Error('review tools missing')
        if (runs === 1) {
          await expect(findings.execute({
            verifiedCrops: [],
            findings: [{
              cropId: 'crop-p0e1', repairIntents: [intent],
              issue: 'An unrelated discussion block is included after the learner question.',
              evidence: 'The rendered crop includes the discussion heading and explanatory paragraph after the required response.',
              insideCropEvidence: 'Discussion heading and explanation below the learner response.',
            }],
          }, TOOL_CONTEXT)).resolves.toContain('DEFECTS_RECORDED')
        } else {
          await source.execute({ targetId: 'crop-p0e1', chunk: 0 }, TOOL_CONTEXT)
          await expect(revise.execute({
            questions: [{ headElementId: 'p0e1', stopBeforeElementId: 'p0e3' }],
          }, TOOL_CONTEXT)).resolves.toContain('clips learner-facing OCR')
          await expect(revise.execute({
            questions: [{ headElementId: 'p0e1', additionalElementIds: ['p0e2'] }],
            outsideBoundaryElementIds: ['p0e3'],
          }, TOOL_CONTEXT)).resolves.toContain('silently drops previously sampled image')
          await expect(revise.execute({
            questions: [{ headElementId: 'p0e1', additionalElementIds: ['p0e2'] }],
            outsideBoundaryElementIds: ['p0e3'],
            retainedImageElementIds: ['p0e0'],
          }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        }
        return {
          id: SessionId(`outside-repair-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'discussion.pdf', groupIndex: 0,
      corePageIndexes: [0], recutAttempt: 0, reviewQuestionIds: ['p0e1' as TeacherQuestionLayoutElementId], padding: 4,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'image', text: '', bbox: [30, 30, 180, 65] },
          { type: 'text', text: '1. Calculate the area.', bbox: [30, 90, 540, 120] },
          { type: 'text', text: 'Show your working.', bbox: [30, 135, 540, 155] },
          { type: 'text', text: 'Discussion for teachers', bbox: [30, 180, 540, 210] },
          { type: 'text', text: 'A discussion of teaching methods.', bbox: [30, 225, 540, 250] },
        ],
      }],
      questions: [{
        sourceHeadId: 'p0e1' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{
          pageIndex: 0, left: 26, top: 26, right: 544, rightLimit: 600, bottom: 254,
          excludedAreas: [], pageWidth: 600, pageHeight: 800,
        }],
      }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.decision).toBe('revised')
    expect(result.value.questions[0]?.regions[0]?.top).toBeLessThanOrEqual(30)
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeGreaterThanOrEqual(155)
    expect(result.value.questions[0]?.regions[0]?.bottom).toBeLessThan(180)
    expect(runs).toBe(2)
    await ctx.fiber.dispose()
  })

  it('applies the disabled-reasoning policy while preserving accepted question content', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    const start = vi.fn(async (_name: string, startRequest: unknown) => {
      const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
      const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
      if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
      const inspected = String(await source.execute({ chunk: 0 }, TOOL_CONTEXT))
      expect(inspected).toContain('"elementId":"p0e4"')
      expect(inspected).toContain('"type":"image"')
      const accepted = String(await submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [
          { headElementId: 'p0e2' },
          { headElementId: 'p0e6' },
        ],
        outsideBoundaryElementIds: ['p0e1'],
        retainedImageElementIds: ['p0e4', 'p0e7'],
        stopBeforeElementId: 'p1e2',
      }, TOOL_CONTEXT))
      const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
      if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
      return {
        id: SessionId('child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
        dispose: vi.fn(() => Promise.resolve()),
        startRequest,
      }
    })
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('subagents', { start } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)

    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      questionSegmentationReasoningEnabled: false,
    })).resolves.toEqual({
      ok: true,
      value: {
        questions: [{
          sourceHeadId: 'p0e2',
          questionNo: 1, headPageIndex: 0, groupIndex: 0,
          regions: [{
            pageIndex: 0, left: 30, top: 98, right: 620, rightLimit: 720, bottom: 570, excludedAreas: [], pageWidth: 720, pageHeight: 1000,
          }],
        }, {
          sourceHeadId: 'p0e6',
          questionNo: 2, headPageIndex: 0, groupIndex: 0,
          regions: [
            {
              pageIndex: 0, left: 30, top: 590, right: 630, rightLimit: 720, bottom: 950,
              excludedAreas: [], pageWidth: 720, pageHeight: 1000,
            },
            {
              pageIndex: 1, left: 35, top: 50, right: 510, rightLimit: 720, bottom: 195,
              excludedAreas: [], pageWidth: 720, pageHeight: 1000,
            },
          ],
        }],
      },
    })
    const options = start.mock.calls[0]?.[1]
    expect(options).toMatchObject({
      parent,
      agentOptions: { provider: 'p', model: 'm', reasoningEffort: 'off' },
      toolFilter: { allow: [
        expect.stringMatching(/^question_layout_[a-f0-9]{12}$/u),
        expect.stringMatching(/^submit_question_boundaries_[a-f0-9]{12}$/u),
      ] },
    })
    expect(options).not.toHaveProperty('outputSchema')
    expect(options).toHaveProperty('persona', QUESTION_SEGMENTATION_SKILL.content)
    const promptText = (options as { prompt: readonly { readonly text?: string }[] }).prompt[0]?.text
    expect(promptText).toContain('"possibleQuestionHeadIds":["p0e1","p0e2","p0e6"]')
    expect(promptText).toContain('"possibleAnswerHeadingIds":["p1e2","p1e3"]')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('A page break does not end a task')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('formula, table, diagram')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain("Infer each source's own visual and textual convention")
    await ctx.fiber.dispose()
  })

  it('does not start a child when the model cannot disable reasoning', async () => {
    const ctx = new Context()
    provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    const start = vi.fn()
    ctx.provide('subagents', { start } as never)
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'thinking-only', reasoningEffort: 'high' }),
    } as never)
    ctx.provide('llm', {
      resolveModelInfo: () => Promise.resolve({
        provider: 'p', id: 'thinking-only', name: 'Thinking only',
        inputModalities: ['text'],
        reasoning: {
          efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
          defaultEffort: 'high',
        },
      }),
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      questionSegmentationReasoningEnabled: false,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'tool model p/thinking-only cannot disable reasoning; enable question-cutting reasoning or select a model that advertises Off',
      },
    })
    expect(start).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects learner-question heads inside a document answer section', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Numbered solution headers are questions.',
          questions: [{ headElementId: 'p1e0' }],
        }, TOOL_CONTEXT)).resolves.toContain('inside a document answer section')
        const accepted = String(await submit.execute({
          headConvention: 'The selected core page contains only worked solutions.',
          questions: [],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error('boundary draft was not accepted')
        return {
          id: SessionId('answer-boundary-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '试卷答案.pdf',
      padding: 4,
      corePageIndexes: [1],
      answerSectionPageIndexes: [1],
      pages: [{
        pageIndex: 0,
        width: 600,
        height: 800,
        elements: [
          { type: 'text', text: '五月模拟数学试卷', bbox: [120, 20, 480, 50] },
          { type: 'text', text: '数学试卷参考答案及评分标准', bbox: [120, 60, 480, 90] },
        ],
      }, {
        pageIndex: 1,
        width: 600,
        height: 800,
        elements: [
          { type: 'text', text: '17.（15分）解：', bbox: [30, 40, 180, 65] },
          { type: 'text', text: '（1）由已知条件可得结论', bbox: [40, 80, 500, 110] },
          { type: 'image', text: '', bbox: [120, 140, 480, 420] },
        ],
      }],
    }, CONFIG)).resolves.toMatchObject({
      ok: true,
      value: { questions: [] },
    })
    await ctx.fiber.dispose()
  })

  it('uses visual order when single-column OCR lists later heads before earlier question content', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Score-bearing Arabic labels begin independent questions in one column.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e3' },
            { headElementId: 'p0e3' },
          ],
          retainedImageElementIds: ['p0e5'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('single-column-visual-order-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '单栏乱序试卷.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 720, height: 800,
        elements: [
          { type: 'text', text: '15.（本题满分 13 分）', bbox: [58, 40, 250, 55] },
          { type: 'text', text: '求线段 CD 的长度', bbox: [73, 60, 400, 75] },
          { type: 'text', text: '16.（本题满分 15 分）', bbox: [45, 100, 250, 115] },
          { type: 'text', text: '17.（本题满分 15 分）', bbox: [40, 500, 250, 515] },
          { type: 'text', text: '如图，证明直线 AB 垂直于平面 BCD', bbox: [60, 140, 560, 180] },
          { type: 'image', text: '', bbox: [300, 210, 500, 400] },
          { type: 'text', text: '已知函数 f(x)，求其单调区间', bbox: [57, 540, 560, 580] },
        ],
      }],
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(3)
    expect(result.value.questions[0]?.regions[0]).toMatchObject({ top: 40, bottom: 85 })
    expect(result.value.questions[1]?.regions[0]).toMatchObject({ top: 90, bottom: 410 })
    expect(result.value.questions[2]?.regions[0]).toMatchObject({ top: 490, bottom: 590 })
    await ctx.fiber.dispose()
  })

  it.each([false, true])('reassigns interleaved columns without truncating content at another column head (explicit stop: %s)', async (explicitStop) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        const accepted = String(await submit.execute({
          headConvention: 'A score-bearing numeric label starts each top-level problem, including OCR-damaged labels.',
          questions: [
            { headElementId: 'p0e0', ...(explicitStop ? { stopBeforeElementId: 'p0e2' } : {}) },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e6' },
            { headElementId: 'p0e8' },
          ],
          excludedElementIds: ['p0e6', 'p0e7', 'p0e10'],
          retainedImageElementIds: ['p0e5'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '双栏试卷.pdf',
      pagePreviews: vision.pagePreviews,
      padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '17.(15分)', bbox: [30, 20, 70, 35] },
          { type: 'text', text: '如图，在多面体中', bbox: [45, 40, 400, 55] },
          { type: 'text', text: '1:.(17分)', bbox: [440, 20, 485, 35] },
          { type: 'text', text: '已知函数 f(x)', bbox: [455, 40, 700, 65] },
          { type: 'text', text: '(2) 求二面角', bbox: [60, 85, 220, 98] },
          { type: 'image', text: '', bbox: [300, 105, 410, 190] },
          { type: 'text', text: '四、解答题', bbox: [438, 210, 700, 225] },
          { type: 'text', text: '本题共2小题，每小题12分', bbox: [438, 228, 700, 238] },
          { type: 'text', text: '19.(17分)', bbox: [440, 240, 485, 255] },
          { type: 'text', text: '证明不等式', bbox: [455, 270, 700, 300] },
          { type: 'image', text: '', bbox: [350, 330, 490, 420] },
        ],
      }],
    }

    await expect(segmentQuestionsWithAgent(ctx, layout, CONFIG)).resolves.toEqual({
      ok: true,
      value: {
        questions: [
          {
            sourceHeadId: 'p0e0',
            questionNo: 1, headPageIndex: 0, groupIndex: 0,
            regions: [{
              pageIndex: 0, left: 20, top: 20, right: 420, rightLimit: 430, bottom: 200,
              excludedAreas: [], pageWidth: 841, pageHeight: 595,
            }],
          },
          {
            sourceHeadId: 'p0e2',
            questionNo: 2, headPageIndex: 0, groupIndex: 0,
            regions: [{
              pageIndex: 0, left: 430, top: 20, right: 710, rightLimit: 841, bottom: 75,
              excludedAreas: [], pageWidth: 841, pageHeight: 595,
            }],
          },
          {
            sourceHeadId: 'p0e8',
            questionNo: 3, headPageIndex: 0, groupIndex: 0,
            regions: [{
              pageIndex: 0, left: 430, top: 239, right: 710, rightLimit: 841, bottom: 310,
              excludedAreas: [], pageWidth: 841, pageHeight: 595,
            }],
          },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it.each([
    ['二、归纳交流，思想提升', true],
    ['三、方法拓展，专题研究', true],
    ['二、已知三边相等，请证明三个内角相等', false],
  ] as const)('distinguishes outline titles from learner instructions (%s)', async (heading, section) => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'outline.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. 求证三角形全等。', bbox: [40, 40, 500, 60] },
        { type: 'text', text: heading, bbox: [40, 90, 500, 110] },
        { type: 'text', text: '根据给出的条件书写证明。', bbox: [40, 120, 500, 140] },
      ] }],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]?.regions[0]?.bottom).toBe(section ? 65 : 145)
  })

  it.each(['text', 'image', 'table'] as const)('recognizes text-bearing %s tasks and continuation blanks without borrowing a sibling demand', async (headType) => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'continued-response.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '一、归纳交流，思想提升', bbox: [40, 20, 500, 40] },
        { type: 'text', text: '(1) 按照上述约定，函数的一般定义如下。', bbox: [40, 60, 500, 80] },
        { type: 'text', text: '该集合称为_。', bbox: [60, 90, 500, 110] },
        { type: 'text', text: '(2) 这种表示方法与字母的选择无关。', bbox: [40, 140, 500, 160] },
        { type: headType, text: '(3) 能否得到相同的函数？为什么？', bbox: [40, 190, 500, 210] },
        { type: 'text', text: '(4) 两个函数的定义域之交为________。', bbox: [40, 240, 500, 260] },
        { type: 'text', text: '二、方法拓展，专题研究', bbox: [40, 290, 500, 310] },
      ] }],
    }, (prompt) => { expect(prompt).toContain('"protectedQuestionHeadIds":["p0e1","p0e4","p0e5"]') })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e1', 'p0e4', 'p0e5'])
    expect(result.value.questions.map(question => question.regions[0]?.bottom)).toEqual([115, 215, 265])
  })

  it('keeps bare figure labels with their question instead of borrowing a following same-number demand', async () => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'figure-labels.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '一、概念梳理', bbox: [40, 20, 500, 40] },
        { type: 'text', text: '(1) 根据图象填空：函数在区间上______。', bbox: [40, 60, 500, 80] },
        { type: 'image', text: '', bbox: [60, 100, 250, 210] },
        { type: 'text', text: '(1)', bbox: [150, 215, 180, 230] },
        { type: 'image', text: '', bbox: [320, 100, 510, 210] },
        { type: 'text', text: '(2)', bbox: [400, 215, 430, 230] },
        { type: 'image', text: '(2) 这两个函数是否相同？为什么？', bbox: [40, 270, 520, 295] },
      ] }],
    }, (prompt) => { expect(prompt).toContain('"protectedQuestionHeadIds":["p0e1","p0e6"]') })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e1', 'p0e6'])
    expect(result.value.questions[0]?.regions[0]?.bottom).toBe(235)
  })

  it.each([
    ['则该材料的折射率为', true],
    ['则该材料的折射率为 1.5。', false],
    ['则该映射的像是', true],
    ['则该映射的像是集合 B。', false],
  ] as const)('protects open conclusion blanks without a subject vocabulary list (%s)', async (tail, isQuestion) => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'open-conclusion.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. 已知条件与对应关系如下。', bbox: [40, 40, 500, 60] },
        { type: 'text', text: tail, bbox: [40, 80, 500, 100] },
      ] }],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(isQuestion ? 1 : 0)
  })

  it.each(['unrelated', 'source-overlay'] as const)('rejects %s for an image-encoded question head before recording a destructive defect', async (wrongRole) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly type: string; readonly text?: string }[] }) => {
        const text = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(text.slice(text.lastIndexOf('\n') + 1)) as {
          readonly sourceImageSampling: readonly {
            readonly elementId: string
            readonly ocrText: string
            readonly questionHeadForCropIds: readonly string[]
          }[]
          readonly visualAttention: readonly { readonly cropId: string }[]
        }
        expect(metadata.sourceImageSampling).toMatchObject([{
          elementId: 'p0e0', ocrText: '(2) 两个函数是否相同？为什么？', questionHeadForCropIds: ['crop-p0e0'],
        }])
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('review findings tool missing')
        await expect(findings.execute({
          findings: [{ cropId: 'crop-p0e0', repairIntents: ['remove-crop'],
            issue: 'The OCR image is allegedly not an independent question.',
            insideCropEvidence: 'The entire rasterized question would be removed.' }],
          imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e0', role: 'unrelated',
            evidence: 'The raster box contains only text.' }],
        }, TOOL_CONTEXT)).resolves.toContain('cannot remove a protected OCR candidate without pixel-backed evidence')
        await expect(findings.execute({
          findings: [{ cropId: 'crop-p0e0', repairIntents: ['reassign-content'],
            issue: 'The OCR image is allegedly a separate publisher block.',
            insideCropEvidence: 'The raster block contains the question sentence.' }],
          imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e0', role: wrongRole, evidence: 'This is an OCR image block.' }],
        }, TOOL_CONTEXT)).resolves.toContain('identifies the question head itself, not a separate illustration')
        await expect(findings.execute({
          verifiedCrops: [{ cropId: 'crop-p0e0', answerDemand: 'Explain whether the functions are equal.',
            evidence: 'The raster text contains the independent why-question.', ...VERIFIED_CROP_EDGES }],
          imageChecks: [{ cropId: 'crop-p0e0', elementId: 'p0e0', role: 'required-content',
            evidence: 'The entire OCR image box is the printed question text; there is no separate illustration.' }],
          attentionChecks: metadata.visualAttention.map(attention => ({
            cropId: attention.cropId, evidence: 'The entire rasterized why-question is visible and forms an independent learner task.',
          })),
        }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return { id: SessionId('image-head-review'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'image-head-review.pdf', groupIndex: 0,
      corePageIndexes: [0], recutAttempt: 0, reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId], padding: 0,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'image', text: '(2) 两个函数是否相同？为什么？', bbox: [40, 60, 500, 80] },
      ] }],
      questions: [{ sourceHeadId: 'p0e0' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{ pageIndex: 0, left: 40, top: 60, right: 500, rightLimit: 500, bottom: 80,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.decision).toBe('accepted')
    await ctx.fiber.dispose()
  })

  it.each([true, false])('distinguishes recognized standalone response heads from unrecognized promotions (recognized: %s)', async (recognized) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly type: string; readonly text?: string }[] }) => {
        const text = startRequest.prompt[0]?.text ?? ''
        const metadata = JSON.parse(text.slice(text.lastIndexOf('\n') + 1)) as {
          readonly visualAttention: readonly { readonly cropId: string; readonly flags: readonly string[] }[]
        }
        const promotionFlags = metadata.visualAttention.flatMap(attention => attention.flags)
          .filter(flag => flag.includes('promoted outside'))
        expect(promotionFlags).toHaveLength(recognized ? 0 : 1)
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (findings === undefined) throw new Error('review findings tool missing')
        await expect(findings.execute({
          verifiedCrops: [{ cropId: 'crop-p0e1', answerDemand: 'Explain the function relationship.', evidence: 'A visible independent why-question.', ...VERIFIED_CROP_EDGES }],
          attentionChecks: metadata.visualAttention.map(attention => ({
            cropId: attention.cropId, evidence: 'The first line asks an independent question rather than continuing a parent task.',
          })),
        }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        return { id: SessionId('standalone-review'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'standalone-review.pdf', groupIndex: 0,
      corePageIndexes: [0], recutAttempt: 0, reviewQuestionIds: ['p0e1' as TeacherQuestionLayoutElementId], padding: 0,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '一、概念梳理', bbox: [40, 20, 500, 40] },
        { type: 'text', text: recognized ? '(2) 两个函数是否相同？为什么？' : '请说明两个函数的关系。', bbox: [40, 60, 500, 80] },
      ] }],
      questions: [{ sourceHeadId: 'p0e1' as TeacherQuestionLayoutElementId, questionNo: 1, headPageIndex: 0, groupIndex: 0,
        regions: [{ pageIndex: 0, left: 40, top: 60, right: 500, rightLimit: 500, bottom: 80,
          excludedAreas: [], pageWidth: 600, pageHeight: 800 }] }],
      pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      crops: [{ questionNo: 1, fileName: 'q.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.decision).toBe('accepted')
    await ctx.fiber.dispose()
  })

  it.each(['text', 'image', 'table'] as const)('stops before a chapter heading encoded as %s without splitting its raster box', async (headingType) => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'chapter-heading.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '1. 求函数的定义域。', bbox: [40, 40, 500, 60] },
        { type: headingType, text: '专题二 函数\n一、基础知识', bbox: [40, 100, 500, 160] },
      ] }],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]?.regions[0]?.bottom).toBe(65)
  })

  it.each(['text', 'table'] as const)('does not absorb the following standalone sibling when OCR labels it as %s', async (siblingType) => {
    const result = await segmentWithInlineDefaults({
      parentSessionId: SessionId('parent'), fileName: 'theory-interrogative.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '3.2.1 函数的单调性', bbox: [150, 20, 450, 40] },
        { type: 'text', text: '(1) 一般地，函数的定义如下。', bbox: [40, 70, 550, 90] },
        { type: 'text', text: '在区间 I 上单调递增。', bbox: [60, 110, 550, 130] },
        { type: 'text', text: '(2) 能否说这个函数在定义域内是减函数？为什么？', bbox: [40, 210, 550, 230] },
        { type: siblingType, text: '［(3) 一般地，极值的定义如下。', bbox: [40, 260, 550, 280] },
        { type: 'text', text: '该点称为极值点。', bbox: [60, 300, 550, 320] },
        { type: 'table', text: '常用方法', bbox: [40, 350, 550, 650] },
      ] }],
    }, (prompt) => { expect(prompt).toContain('"protectedQuestionHeadIds":["p0e3"]') })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]).toMatchObject({ sourceHeadId: 'p0e3', regions: [{ top: 205, bottom: 235 }] })
  })

  it.each(['2.(17分)', '[题2] 已知关于实数 x 的函数'])('keeps an unfinished question prefix with its following stem (%s)', async (prefix) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e5' },
            { headElementId: 'p0e5' },
          ],
        }, TOOL_CONTEXT)).resolves.toContain('head p0e2 and its following stem p0e5 cannot be separate questions')
        const accepted = String(await submit.execute({
          corrections: [
            { elementId: 'p0e2', role: 'question' },
            { elementId: 'p0e5', role: 'content' },
          ],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('detached-label-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'interleaved-score-labels.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 840, height: 600, elements: [
        { type: 'text', text: '1.(15分)', bbox: [30, 17, 80, 31] },
        { type: 'text', text: '(1) 求证直线平行于平面', bbox: [45, 65, 240, 80] },
        { type: 'text', text: prefix, bbox: [440, 16, 490, 30] },
        { type: 'text', text: '(1) 当 a=1 时，', bbox: [455, 57, 580, 69] },
        { type: 'text', text: '(2) 求多面体的体积', bbox: [60, 95, 260, 110] },
        { type: 'text', text: '已知函数 f(x)=a ln x', bbox: [455, 33, 620, 51] },
        { type: 'text', text: '求函数的最大值', bbox: [470, 72, 680, 100] },
        { type: 'image', text: '', bbox: [310, 115, 410, 190] },
      ] }],
    }, CONFIG)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toHaveLength(2)
    expect(result.value.questions[0]?.regions[0]).toMatchObject({ bottom: 195, right: 415 })
    expect(result.value.questions[1]?.regions[0]).toMatchObject({ top: 16, bottom: 105 })
    await ctx.fiber.dispose()
  })

  it('identifies stale attachments that steal the following same-lane question body', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const rejected = String(await submit.execute({ questions: [
          { headElementId: 'p0e0', additionalElementIds: ['p0e2'] },
          { headElementId: 'p0e1' },
        ] }, TOOL_CONTEXT))
        expect(rejected).toContain('question p0e0.additionalElementIds assigns p0e2 away from its automatic same-page owner p0e1')
        expect(rejected).not.toContain('only a citation label')
        const accepted = String(await submit.execute({ corrections: [
          { elementId: 'p0e0', role: 'question' },
        ] }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return { id: SessionId('stale-attachment-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve() }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'question-body-ownership.pdf', padding: 5,
      pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
        { type: 'text', text: '[题1] 求方程的解。', bbox: [30, 20, 550, 45] },
        { type: 'text', text: '[题2] (教材变式)', bbox: [30, 100, 240, 120] },
        { type: 'text', text: '(1) 求函数的最大值。', bbox: [45, 140, 550, 180] },
      ] }],
    }, CONFIG)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions).toMatchObject([
      { sourceHeadId: 'p0e0', regions: [{ bottom: 50 }] },
      { sourceHeadId: 'p0e1', regions: [{ top: 95, bottom: 185 }] },
    ])
    await ctx.fiber.dispose()
  })

  it.each(['thin-line', 'scaled-line', 'no-line', 'thick-block', 'next-block', 'complete-prompt'] as const)(
    'recovers only raster-confirmed response lines after an unfinished OCR prompt (%s)', async (scenario) => {
      const ctx = new Context()
      const registered = provideTools(ctx)
      ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
      ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      provideModelInfo(ctx)
      ctx.provide('subagents', {
        start: async () => {
          const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
          if (submit === undefined) throw new Error('segmentation tool was not registered')
          const accepted = String(await submit.execute({
            questions: [{ headElementId: 'p0e0' }],
            ...(scenario === 'next-block' ? { outsideBoundaryElementIds: ['p0e1'] } : {}),
          }, TOOL_CONTEXT))
          const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
          if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
          return {
            id: SessionId('response-line-child'), localAgent: undefined,
            result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
            dispose: () => Promise.resolve(),
          }
        },
      } as never)
      const scale = scenario === 'scaled-line' ? 2 : 1
      const pixels = await sharp({ create: { width: 600 * scale, height: 800 * scale, channels: 3, background: '#ffffff' } })
        .composite(scenario === 'no-line' ? [] : [{
          input: { create: { width: 100 * scale, height: (scenario === 'thick-block' ? 12 : 2) * scale, channels: 3, background: '#000000' } },
          left: 40 * scale, top: 82 * scale,
        }]).png().toBuffer()
      const result = await segmentQuestionsWithAgent(ctx, {
        parentSessionId: SessionId('parent'), fileName: 'response-lines.pdf', padding: 5,
        pages: [{ pageIndex: 0, width: 600, height: 800, elements: [
          { type: 'text', text: scenario === 'complete-prompt' ? '1. 求函数的解析式。' : '1. 求函数的解析式为', bbox: [40, 40, 400, 60] },
          ...(scenario === 'next-block' ? [{ type: 'text' as const, text: '教学提示', bbox: [40, 78, 400, 90] as const }] : []),
        ] }],
        pagePreviews: [{ pageIndex: 0, mediaType: 'image/png', width: 600 * scale, height: 800 * scale, contentBase64: pixels.toString('base64') }],
      }, { ...CONFIG, questionSegmentationInlineEvidence: true })
      if (!result.ok) throw new Error(result.error.message)
      expect(result.value.questions[0]?.regions[0]?.bottom).toBe(['thin-line', 'scaled-line'].includes(scenario) ? 89 : 65)
      await ctx.fiber.dispose()
    },
  )

  it('uses sibling-page lanes to cap a half-empty spread without clipping full-width content', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Score-bearing Arabic labels start top-level questions in each printed column.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2' },
            { headElementId: 'p1e0' },
            { headElementId: 'p2e0' },
          ],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('sibling-lane-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '双栏与半空页试卷.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '17.(15分)', bbox: [30, 20, 70, 35] },
          { type: 'text', text: '证明左栏结论', bbox: [45, 40, 400, 70] },
          { type: 'text', text: '18.(17分)', bbox: [440, 20, 485, 35] },
          { type: 'text', text: '求右栏函数的最值', bbox: [455, 40, 800, 70] },
        ],
      }, {
        pageIndex: 1, width: 841, height: 595,
        elements: [
          { type: 'text', text: '19.(17分)', bbox: [27, 20, 72, 35] },
          { type: 'text', text: '证明左栏末题结论', bbox: [39, 40, 345, 90] },
        ],
      }, {
        pageIndex: 2, width: 841, height: 595,
        elements: [
          { type: 'text', text: '20.(17分)', bbox: [30, 20, 75, 35] },
          { type: 'text', text: '这道题的已识别内容横跨整页', bbox: [45, 40, 700, 90] },
        ],
      }],
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions[2]?.regions[0]).toMatchObject({
      left: 17,
      right: 355,
      rightLimit: 440,
    })
    expect(result.value.questions[3]?.regions[0]).toMatchObject({
      left: 20,
      right: 710,
      rightLimit: 841,
    })
    await ctx.fiber.dispose()
  })

  it('keeps a head-bearing slice anchored when an explicit claim reaches another column', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Score-bearing Arabic labels start top-level questions in each column.',
          questions: [
            { headElementId: 'p0e0', additionalElementIds: ['p0e5'] },
            { headElementId: 'p0e2', additionalElementIds: ['p0e4'] },
          ],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '交错双栏试卷.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '17.(15分)', bbox: [30, 20, 70, 35] },
          { type: 'text', text: '如图，在多面体中', bbox: [45, 40, 400, 55] },
          { type: 'text', text: '18.(17分)', bbox: [440, 20, 485, 35] },
          { type: 'text', text: '已知函数 f(x)', bbox: [455, 40, 700, 65] },
          { type: 'text', text: '求直线与平面所成角', bbox: [60, 85, 220, 98] },
          { type: 'image', text: '', bbox: [300, 105, 410, 190] },
          { type: 'text', text: '求实数 a 的取值范围', bbox: [455, 110, 700, 125] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions[1]?.regions[0]).toMatchObject({
      left: 430,
      right: 710,
      bottom: 135,
    })
    await ctx.fiber.dispose()
  })

  it('keeps compact OCR continuation content with its geometric owner without explicit reassignment', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('segmentation tool was not registered')
        const accepted = String(await submit.execute({
          headConvention: 'Numbered practice items start questions in each column.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e1' }],
        }, TOOL_CONTEXT))
        if (!accepted.startsWith('ACCEPTED')) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('column-owner-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '双栏练习.pdf', padding: 8,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '6. 求异面直线所成角', bbox: [40, 600, 280, 620] },
          { type: 'text', text: '8. 如图，已知 MN 垂直 MA', bbox: [310, 50, 550, 70] },
          { type: 'image', text: '', bbox: [370, 90, 470, 220] },
          { type: 'text', text: '(1) 求直线 MN 与 PQ 所成的角', bbox: [320, 240, 540, 260] },
        ],
      }],
    }, { ...CONFIG, questionSegmentationInlineEvidence: true })

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.questions[1]?.regions[0]).toMatchObject({ left: 302, top: 42, bottom: 268 })
    await ctx.fiber.dispose()
  })

  it('rejects an attachment reassigned across another question head and publishes a column limit', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Bracketed 题 labels start each top-level question.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2', additionalElementIds: ['p0e1'] },
            { headElementId: 'p0e4' },
          ],
          retainedImageElementIds: ['p0e6'],
        }, TOOL_CONTEXT)).resolves.toContain('assigns p0e1 across the vertical band of p0e0')
        const accepted = String(await submit.execute({
          headConvention: 'Bracketed 题 labels start each top-level question.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2' },
            { headElementId: 'p0e4', additionalElementIds: ['p0e6'] },
          ],
          retainedImageElementIds: ['p0e1'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '双栏附图试卷.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '[题14] 已知几何体', bbox: [20, 20, 300, 60] },
          { type: 'image', text: '', bbox: [310, 20, 400, 80] },
          { type: 'text', text: '[题15] 求概率', bbox: [20, 100, 100, 120] },
          { type: 'text', text: '写出完整过程', bbox: [30, 130, 400, 200] },
          { type: 'text', text: '[题16] 已知函数', bbox: [440, 20, 540, 40] },
          { type: 'text', text: '求函数的解析式', bbox: [450, 50, 800, 150] },
          { type: 'image', text: '', bbox: [730, 60, 810, 140] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions[0]?.regions[0]?.top).toBe(20)
    expect(result.ok && result.value.questions[1]?.regions[0]?.rightLimit).toBe(440)
    expect(result.ok && result.value.questions[2]?.regions[0]).toMatchObject({ right: 820, bottom: 160 })
    await ctx.fiber.dispose()
  })

  it('joins a same-page cross-column continuation as semantic-order slices', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('segmentation tool was not registered')
        const accepted = String(await submit.execute({
          headConvention: 'Arabic labels begin top-level questions; a page-bottom stem may continue at the top of the next column.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e7' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '跨栏续题.pdf',
      padding: 12,
      pages: [{
        pageIndex: 0, width: 1244, height: 831,
        elements: [
          { type: 'text', text: '11. 已知二氧化碳的状态与温度和压强有关', bbox: [75, 733, 605, 748] },
          { type: 'text', text: '如图描述其状态与 T 和 lgP 的关系', bbox: [93, 758, 606, 773] },
          { type: 'text', text: '下列结论中正确的是（ ）', bbox: [94, 781, 605, 797] },
          { type: 'image', text: '', bbox: [867, 43, 1014, 187] },
          { type: 'text', text: 'A. 当 T=220 时处于液态', bbox: [681, 198, 937, 213] },
          { type: 'text', text: 'B. 当 T=270 时处于气态', bbox: [681, 219, 925, 235] },
          { type: 'text', text: '二、选择题：本题共3小题', bbox: [665, 284, 1058, 297] },
          { type: 'text', text: '12. 已知函数 f(x)，则下列选项正确的是（ ）', bbox: [664, 303, 1201, 321] },
          { type: 'text', text: 'A. 命题甲 B. 命题乙 C. 命题丙 D. 命题丁', bbox: [681, 341, 1154, 365] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, {
      ...CONFIG,
      questionSegmentationInlineEvidence: true,
    })
    expect(result.ok && result.value.questions[0]?.regions).toEqual([
      {
        pageIndex: 0, left: 63, top: 721, right: 618, rightLimit: 664, bottom: 797,
        excludedAreas: [], pageWidth: 1244, pageHeight: 831,
      },
      {
        pageIndex: 0, left: 669, top: 43, right: 1026, rightLimit: 1244, bottom: 247,
        excludedAreas: [], pageWidth: 1244, pageHeight: 831,
      },
    ])
    await ctx.fiber.dispose()
  })

  it('does not let a center decoration associated with excluded copy extend the final question', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        const accepted = String(await submit.execute({
          headConvention: 'Arabic labels begin top-level questions.',
          questions: [{ headElementId: 'p0e0' }],
          excludedElementIds: ['p0e2', 'p0e3', 'p0e4'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '末题水印.pdf',
      pagePreviews: vision.pagePreviews,
      padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '19.(17分)', bbox: [46, 19, 90, 32] },
          { type: 'text', text: '证明函数恰有两个极值点', bbox: [60, 33, 408, 105] },
          { type: 'image', text: '', bbox: [351, 331, 521, 406] },
          { type: 'text', text: '支持正版', bbox: [385, 422, 492, 448] },
          { type: 'text', text: '抵制盗印', bbox: [384, 448, 492, 475] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions[0]?.regions[0]).toMatchObject({
      bottom: 115,
      excludedAreas: [],
    })
    await ctx.fiber.dispose()
  })

  it('requires explicit ownership for a detached lower-page element cluster', async () => {
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '末题与页底块.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '18.(17分)', bbox: [450, 5, 500, 18] },
          { type: 'text', text: '证明函数恰有两个极值点', bbox: [460, 30, 810, 217] },
          { type: 'image', text: '', bbox: [345, 330, 519, 405] },
          { type: 'text', text: '支持正版', bbox: [385, 422, 492, 448] },
          { type: 'text', text: '抵制盗印', bbox: [384, 448, 492, 475] },
        ],
      }],
    }
    const run = async (explicit: boolean) => {
      const ctx = new Context()
      const registered = provideTools(ctx)
      ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
      ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      const vision = provideBoundaryPreviewFixture(ctx, registered)
      ctx.provide('subagents', {
        start: async () => {
          const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
          const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
          if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
          await source.execute({ chunk: 0 }, TOOL_CONTEXT)
          await vision.inspect()
          const accepted = String(await submit.execute({
            headConvention: 'The score-bearing label starts the final problem.',
            questions: [{
              headElementId: 'p0e0',
              ...(explicit ? { additionalElementIds: ['p0e2'] } : {}),
            }],
            ...(explicit ? {} : { retainedImageElementIds: ['p0e2'] }),
            excludedElementIds: ['p0e3', 'p0e4'],
          }, TOOL_CONTEXT))
          const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
          if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
          return {
            id: SessionId('child'), localAgent: undefined,
            result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
            dispose: () => Promise.resolve(),
          }
        },
      } as never)
      const result = await segmentQuestionsWithAgent(ctx, { ...layout, pagePreviews: vision.pagePreviews }, CONFIG)
      await ctx.fiber.dispose()
      return result
    }

    const automatic = await run(false)
    expect(automatic.ok && automatic.value.questions[0]?.regions[0]).toMatchObject({
      left: 440,
      right: 820,
      bottom: 227,
    })
    const explicit = await run(true)
    expect(explicit.ok && explicit.value.questions[0]?.regions).toMatchObject([
      { left: 440, right: 820, bottom: 227 },
      { left: 335, right: 529, bottom: 413 },
    ])
  })

  it('accepts numbering restarts after an excluded paper boundary and clips preceding titles', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const questions = [
          { headElementId: 'p0e0' },
          { headElementId: 'p0e2' },
          { headElementId: 'p0e7' },
          { headElementId: 'p0e9' },
        ]
        const accepted = String(await submit.execute({
          headConvention: 'Each paper uses its own Arabic sequence; a new paper title resets the printed labels.',
          questions,
          outsideBoundaryElementIds: ['p0e4'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '合订试卷.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0, width: 720, height: 800,
        elements: [
          { type: 'text', text: '1. 第一套第一题', bbox: [40, 100, 500, 130] },
          { type: 'text', text: '第一题正文', bbox: [50, 150, 400, 180] },
          { type: 'text', text: '2. 第一套第二题', bbox: [40, 200, 500, 230] },
          { type: 'text', text: '第二题正文', bbox: [50, 250, 400, 280] },
          { type: 'text', text: '第二套数学试卷', bbox: [150, 300, 570, 330] },
          { type: 'text', text: '本试卷满分150分', bbox: [150, 340, 570, 365] },
          { type: 'text', text: '一、选择题', bbox: [40, 375, 500, 395] },
          { type: 'text', text: '1. 第二套第一题', bbox: [40, 410, 500, 440] },
          { type: 'text', text: '第一题正文', bbox: [50, 450, 400, 480] },
          { type: 'text', text: '2. 第二套第二题', bbox: [40, 510, 500, 540] },
          { type: 'text', text: '第二题正文', bbox: [50, 550, 400, 580] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions.map(question => question.questionNo)).toEqual([1, 2, 3, 4])
    expect(result.ok && result.value.questions[1]?.regions[0]?.bottom).toBe(290)
    expect(result.ok && result.value.questions[2]?.regions[0]?.top).toBe(403)
    await ctx.fiber.dispose()
  })

  it('does not attach a restarted paper preamble to the preceding final question', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Each paper restarts ordinary Arabic numbering at one.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p1e3' }],
          outsideBoundaryElementIds: ['p1e0'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '连续试卷.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '19.(17分)', bbox: [40, 20, 100, 40] },
          { type: 'text', text: '证明函数结论', bbox: [50, 50, 600, 100] },
        ],
      }, {
        pageIndex: 1, width: 841, height: 595,
        elements: [
          { type: 'text', text: '第二套数学试卷', bbox: [180, 20, 600, 60] },
          { type: 'text', text: '一、选择题', bbox: [40, 210, 600, 230] },
          { type: 'text', text: '本题只有一个正确选项', bbox: [50, 235, 600, 250] },
          { type: 'text', text: '1. 已知集合 A', bbox: [40, 300, 600, 330] },
          { type: 'text', text: '选择正确答案', bbox: [50, 340, 600, 370] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions[0]?.regions).toEqual([{
      pageIndex: 0, left: 30, top: 20, right: 610, rightLimit: 841, bottom: 110,
      excludedAreas: [], pageWidth: 841, pageHeight: 595,
    }])
    expect(result.ok && result.value.questions[1]?.regions[0]?.top).toBe(290)
    await ctx.fiber.dispose()
  })

  it('removes repeated lower-page decorations and their associated images', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered, [0, 1, 2])
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        const accepted = String(await submit.execute({
          headConvention: 'Each page contains one numbered final question.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p1e0', stopBeforeElementId: 'p1e2' },
            { headElementId: 'p2e0', stopBeforeElementId: 'p2e2' },
          ],
          excludedElementIds: ['p0e2', 'p1e2', 'p2e2'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const pages = [0, 1, 2].map((pageIndex): TeacherQuestionSegmentRequest['pages'][number] => ({
      pageIndex, width: 841, height: 595,
      elements: [
        { type: 'text', text: '19.(17分)', bbox: [40, 20, 100, 40] },
        { type: 'text', text: `第${String(pageIndex + 1)}套证明题`, bbox: [50, 50, 600, 100] },
        { type: 'image', text: '', bbox: [350, 320, 520, 405] },
        { type: 'text', text: '支持正版', bbox: [385, 420, 492, 448] },
      ],
    }))

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '重复页底装饰.pdf', padding: 10, pages,
      pagePreviews: vision.pagePreviews,
    }, CONFIG)
    expect(result.ok && result.value.questions.map(question => question.regions[0]?.bottom)).toEqual([110, 110, 110])
    await ctx.fiber.dispose()
  })

  it('uses an agent-inferred convention for local variants and an unnumbered exercise', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Bracketed 题 labels and 变式 labels start separate tasks; after the next chapter title, the first imperative stem starts an unnumbered task.',
          questions: [
            { headElementId: 'p0e1' },
            { headElementId: 'p0e3' },
            { headElementId: 'p0e5' },
            { headElementId: 'p0e8' },
          ],
          outsideBoundaryElementIds: ['p0e0', 'p0e7'],
          retainedImageElementIds: ['p0e9'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '章节练习册.pdf',
      padding: 10,
      pages: [{
        pageIndex: 0, width: 720, height: 900,
        elements: [
          { type: 'text', text: '1.1.1 集合的概念与基本关系', bbox: [160, 20, 560, 55] },
          { type: 'text', text: '[题1（多选)] 下列说法正确的是', bbox: [40, 80, 620, 115] },
          { type: 'text', text: 'A. 甲  B. 乙', bbox: [60, 130, 600, 160] },
          { type: 'text', text: '[题2] 已知集合 A', bbox: [40, 190, 620, 225] },
          { type: 'text', text: '求 A 的补集', bbox: [60, 240, 600, 270] },
          { type: 'text', text: '[题2变式1] 改变条件后求解', bbox: [40, 300, 620, 335] },
          { type: 'text', text: '写出计算过程', bbox: [60, 350, 600, 380] },
          { type: 'text', text: '1.1.2 集合的基本运算', bbox: [160, 420, 560, 455] },
          { type: 'text', text: '观察下图，写出阴影部分表示的集合', bbox: [40, 490, 650, 525] },
          { type: 'image', text: '', bbox: [210, 550, 510, 820] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions.map(question => question.questionNo)).toEqual([1, 2, 3, 4])
    expect(result.ok && result.value.questions.at(-1)?.regions[0]?.top).toBe(480)
    await ctx.fiber.dispose()
  })

  it('uses the agent decision to separate a tagged question after a decimal chapter heading', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        const accepted = String(await submit.execute({
          headConvention: 'Bracketed 题 labels start independent exercises.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
          excludedElementIds: ['p0e2', 'p0e3'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'),
      fileName: '章节练习.pdf',
      pagePreviews: vision.pagePreviews,
      padding: 10,
      pages: [{
        pageIndex: 0, width: 595, height: 841,
        elements: [
          { type: 'text', text: '[题4变式4] 若命题为真', bbox: [58, 527, 535, 560] },
          { type: 'text', text: '则实数 a 的范围为', bbox: [58, 575, 535, 609] },
          { type: 'image', text: '', bbox: [450, 610, 540, 700] },
          { type: 'text', text: '2.1.1 不等式的性质及应用', bbox: [202, 624, 411, 643] },
          { type: 'text', text: '[题1（多选)] 下列不等式成立的是', bbox: [57, 652, 537, 680] },
          { type: 'text', text: 'A. 甲  B. 乙', bbox: [57, 698, 524, 724] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions).toHaveLength(2)
    expect(result.ok && result.value.questions[0]?.regions[0]).toMatchObject({
      bottom: 609,
      excludedAreas: [],
    })
    await ctx.fiber.dispose()
  })

  it('does not impose a numeric sequence when the agent classifies a span as non-question content', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Only the first and final labels are independent tasks; the middle span is an embedded worked example.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
          outsideBoundaryElementIds: ['p0e2'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'), fileName: '连续编号.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 595, height: 841,
        elements: [
          { type: 'text', text: '1. 第一题', bbox: [40, 20, 500, 50] },
          { type: 'text', text: '第一题正文', bbox: [50, 60, 500, 100] },
          { type: 'text', text: '2. 第二题', bbox: [40, 120, 500, 150] },
          { type: 'text', text: '第二题正文', bbox: [50, 160, 500, 200] },
          { type: 'text', text: '3. 第三题', bbox: [40, 220, 500, 250] },
          { type: 'text', text: '第三题正文', bbox: [50, 260, 500, 300] },
        ],
      }],
    }

    await expect(segmentQuestionsWithAgent(ctx, layout, CONFIG)).resolves.toMatchObject({
      ok: true, value: { questions: [{ questionNo: 1 }, { questionNo: 2 }] },
    })
    await ctx.fiber.dispose()
  })

  it('drops a lane-leading page marker instead of stretching the previous column question', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic labels start questions in both columns.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e2' }, { headElementId: 'p0e5' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const layout: TeacherQuestionSegmentRequest = {
      parentSessionId: SessionId('parent'), fileName: '双栏页码.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 841, height: 595,
        elements: [
          { type: 'text', text: '1. 左栏第一题', bbox: [20, 20, 400, 40] },
          { type: 'text', text: '第一题正文', bbox: [30, 50, 400, 120] },
          { type: 'text', text: '2. 左栏第二题', bbox: [20, 200, 400, 220] },
          { type: 'text', text: '第二题正文', bbox: [30, 230, 400, 260] },
          { type: 'text', text: '1', bbox: [790, 5, 800, 15] },
          { type: 'text', text: '3. 右栏第三题', bbox: [440, 20, 800, 40] },
          { type: 'text', text: '第三题正文', bbox: [450, 50, 800, 120] },
        ],
      }],
    }

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions[1]?.regions[0]).toMatchObject({
      left: 10, top: 190, right: 410, bottom: 270,
    })
    await ctx.fiber.dispose()
  })

  it('cancels a stalled boundary child at its deadline without retrying or inferring output', async () => {
    const ctx = new Context()
    provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    const dispose = vi.fn(async () => {})
    const start = vi.fn(async (_mode: string, startRequest: { readonly signal: AbortSignal }) => ({
      id: SessionId('stalled-child'), localAgent: undefined,
      result: new Promise((resolve) => {
        const finish = () => { resolve({ stopReason: 'cancelled', output: [] }) }
        if (startRequest.signal.aborted) finish()
        else startRequest.signal.addEventListener('abort', finish, { once: true })
      }),
      dispose,
    }))
    ctx.provide('subagents', { start } as never)
    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG, questionSegmentationAgentTimeoutMs: 10,
    })).resolves.toMatchObject({ ok: false, error: { code: 'timed-out' } })
    expect(start).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('fails rather than silently guessing boundaries when the child omits an accepted draft', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        if (source === undefined) throw new Error('segmentation source tool was not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({
            stopReason: 'completed', output: [], structured: { validationToken: 'unavailable' },
          }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-output' },
    })
    await ctx.fiber.dispose()
  })

  it('excludes answer-section images but still requires an accepted learner-question draft', async () => {
    const ctx = new Context()
    provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        runs += 1
        expect(startRequest.prompt[0]?.text).toContain('"imageElementIds":[]')
        return {
          id: SessionId(`answer-image-fallback-child-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '题目及答案图.pdf',
      padding: 4,
      corePageIndexes: [0, 1],
      answerSectionPageIndexes: [1],
      pages: [{
        pageIndex: 0,
        width: 600,
        height: 800,
        elements: [
          { type: 'text', text: '1. 求函数 f(x)=x² 的值域', bbox: [30, 40, 500, 75] },
          { type: 'text', text: '写出计算过程。', bbox: [40, 90, 500, 125] },
        ],
      }, {
        pageIndex: 1,
        width: 600,
        height: 800,
        elements: [
          { type: 'text', text: '数学试卷参考答案及解析', bbox: [120, 30, 480, 65] },
          { type: 'text', text: '1. 解：由图可知函数值域。', bbox: [30, 90, 500, 125] },
          { type: 'image', text: '', bbox: [100, 150, 500, 500] },
        ],
      }],
    }, {
      ...CONFIG,
      questionSegmentationInlineEvidence: true,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-output' },
    })
    expect(runs).toBe(CONFIG.maxQuestionBoundaryAgentRuns)
    await ctx.fiber.dispose()
  })

  it.each([true, false])('stops persistent boundary rejections after the configured recovery runs without a fallback (identical=%s)', async (identical) => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        for (let attempt = 0; attempt < CONFIG.maxQuestionRejectedToolCalls; attempt += 1) {
          const repeated = String(await submit.execute({
            headConvention: 'Numbered learner tasks are questions.',
            questions: identical ? [] : [{ headElementId: `unknown-${String(attempt)}` }],
            nonQuestionHeadElementIds: [],
          }, TOOL_CONTEXT))
          if (attempt === CONFIG.maxQuestionRejectedToolCalls - 1) {
            expect(repeated).toContain('REJECTION_BUDGET_EXHAUSTED')
          }
        }
        return {
          id: SessionId('boundary-rejection-loop-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      questionSegmentationInlineEvidence: true,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-output' },
    })
    expect(runs).toBe(CONFIG.maxQuestionBoundaryAgentRuns)
    expect(concludeTurn).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('keeps a child alive across distinct corrective diagnostics and names an invalid retained-image reference', async () => {
    concludeTurn.mockClear()
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async () => {
        runs += 1
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        await expect(submit.execute({
          questions: [],
          corrections: [],
        }, TOOL_CONTEXT)).resolves.toContain('corrections cannot be combined with questions')
        await expect(submit.execute({
          corrections: [{ elementId: 'p0e0', role: 'omit' }],
        }, TOOL_CONTEXT)).resolves.toContain('no complete draft exists')
        const invalidImage = String(await submit.execute({
          headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          nonQuestionHeadElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e0'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT))
        expect(invalidImage).toContain('retainedImageElementIds[0] references p0e0 (type=text)')
        expect(invalidImage).toContain('Valid image element ids in this core-page scope: p0e4, p0e7')
        expect(invalidImage).not.toContain('REJECTION_BUDGET_EXHAUSTED')
        const accepted = String(await submit.execute({
          corrections: [{ elementId: 'p0e0', role: 'omit' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('progressive-diagnostics-child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      questionSegmentationInlineEvidence: true,
    })).resolves.toMatchObject({
      ok: true,
      value: { questions: [{ sourceHeadId: 'p0e2' }, { sourceHeadId: 'p0e6' }] },
    })
    expect(runs).toBe(1)
    expect(concludeTurn).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it.each([true, false])('retains the rejected draft and diagnostic for a fresh boundary child (inline=%s)', async (inlineEvidence) => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    let runs = 0
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: {
        readonly prompt: readonly { readonly text?: string }[]
        readonly toolFilter: { readonly allow: readonly string[] }
      }) => {
        runs += 1
        const submit = [...registered.values()].find(tool => tool.name.startsWith(runs === 1
          ? 'submit_question_boundaries_' : 'correct_question_boundaries_'))
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        if (submit === undefined) throw new Error('boundary submission tool was not registered')
        if (inlineEvidence) {
          expect(submit.parameters).not.toHaveProperty('properties.excludedElementIds')
          expect(submit.parameters).toHaveProperty('properties.corrections.items.properties.role.enum', [
            'question', 'content', 'outside', 'retained-image', 'omit',
          ])
        }
        if (runs === 2) {
          expect(startRequest.toolFilter.allow).toContain(submit.name)
          expect(startRequest.toolFilter.allow.some(name => name.startsWith('submit_question_boundaries_'))).toBe(false)
          expect(submit.parameters).not.toHaveProperty('properties.questions')
          expect(submit.parameters).not.toHaveProperty('properties.outsideBoundaryElementIds')
          const prompt = startRequest.prompt.map(block => block.text ?? '').join('\n')
          expect(prompt).toContain('"rejectedDraft":')
          expect(prompt).toContain('"headElementId":"p0e0"')
          expect(prompt).toContain('"lastRejection":')
          expect(prompt).toContain('core')
          if (!inlineEvidence) {
            await expect(submit.execute({
              corrections: [{ elementId: 'p0e0', role: 'omit' }],
            }, TOOL_CONTEXT)).resolves.toContain('inspect')
          }
        }
        if (source !== undefined) await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        if (runs === 1) {
          for (let attempt = 0; attempt < CONFIG.maxQuestionRejectedToolCalls; attempt += 1) {
            const response = String(await submit.execute({
              questions: [{ headElementId: 'p0e0' }, { headElementId: 'p1e0' }],
            }, TOOL_CONTEXT))
            expect(response).toContain('core')
            if (attempt === CONFIG.maxQuestionRejectedToolCalls - 1) {
              expect(response).toContain('REJECTION_BUDGET_EXHAUSTED')
            }
          }
        } else {
          await expect(submit.execute({
            corrections: [{ elementId: 'p0e0', role: 'omit' }],
          }, TOOL_CONTEXT)).resolves.toContain('ACCEPTED')
        }
        return {
          id: SessionId(`boundary-recovery-${String(runs)}`), localAgent: undefined,
          result: Promise.resolve({ stopReason: runs === 1 ? 'cancelled' as const : 'completed' as const, output: [] }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: 'context-recovery.pdf', padding: 4,
      corePageIndexes: [1],
      pages: [0, 1].map(pageIndex => ({
        pageIndex, width: 600, height: 800,
        elements: [{ type: 'text', text: '1. Calculate the area.', bbox: [30, 30, 540, 60] }],
      })),
    }, { ...CONFIG, questionSegmentationInlineEvidence: inlineEvidence })
    expect(result).toMatchObject({ ok: true, value: { questions: [{ sourceHeadId: 'p1e0' }] } })
    expect(runs).toBe(2)
    expect(registered.size).toBe(0)
    await ctx.fiber.dispose()
  })

  it('does not charge malformed element references against the complete-draft limit', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const malformed = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'missing' }],
        }, TOOL_CONTEXT))
        expect(malformed).toContain('do not consume the complete-draft submission limit')
        const accepted = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          outsideBoundaryElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      maxQuestionBoundarySubmissions: 1,
    })).resolves.toMatchObject({ ok: true })
    await ctx.fiber.dispose()
  })

  it('accepts a corrected boundary draft after the rejected complete-draft allowance is used', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        const rejected = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [],
          nonQuestionHeadElementIds: [],
        }, TOOL_CONTEXT))
        expect(rejected).toContain('REJECTED')
        const accepted = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          outsideBoundaryElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), {
      ...CONFIG,
      maxQuestionBoundarySubmissions: 1,
    })).resolves.toMatchObject({ ok: true })
    await ctx.fiber.dispose()
  })

  it('enforces recognized section headings as crop stops when the agent omits the transition', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    const vision = provideBoundaryPreviewFixture(ctx, registered)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await vision.inspect()
        await expect(submit.execute({
          headConvention: 'Numbered exercises follow hierarchical chapter titles.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e4' }],
          nonQuestionHeadElementIds: ['p0e0'],
        }, TOOL_CONTEXT)).resolves.toContain('references a section or answer heading')
        const accepted = String(await submit.execute({
          headConvention: 'Numbered exercises follow hierarchical chapter titles.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '章节混排.pdf', padding: 10,
      pagePreviews: vision.pagePreviews,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '1. 求函数的定义域', bbox: [40, 50, 520, 80] },
          { type: 'text', text: '写出完整解答过程', bbox: [50, 95, 500, 120] },
          { type: 'text', text: '2.3.2 一元二次不等式恒成立问题', bbox: [120, 150, 500, 180] },
          { type: 'text', text: '本节研究参数范围', bbox: [50, 190, 520, 215] },
          { type: 'text', text: '[题1] 已知二次函数', bbox: [40, 240, 520, 270] },
          { type: 'text', text: '求参数 a 的范围', bbox: [50, 285, 500, 315] },
        ],
      }],
    }, CONFIG)
    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e4'])
    expect(result.ok && result.value.questions[0]?.regions[0]?.bottom).toBeLessThan(150)
    await ctx.fiber.dispose()
  })

  it('requires prompt-bearing worked examples and stops their crops before printed answers', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('worked example that opens with a problem stem')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Each prompt-bearing worked example is one independent question.',
          questions: [{ headElementId: 'p0e0' }],
        }, TOOL_CONTEXT)).resolves.toContain('possible question-head candidates require an explicit decision: p0e4')
        const accepted = String(await submit.execute({
          headConvention: 'Each prompt-bearing worked example is one independent question.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '例题讲义.pdf', padding: 5,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '例1 求函数 f(x) 的最大值', bbox: [40, 40, 500, 70] },
          { type: 'text', text: '写出最大值', bbox: [50, 75, 300, 95] },
          { type: 'text', text: '【答案】4', bbox: [50, 110, 300, 135] },
          { type: 'text', text: '【解析】由单调性可知', bbox: [50, 140, 520, 180] },
          { type: 'text', text: '例 2 证明函数为奇函数', bbox: [40, 220, 500, 250] },
          { type: 'text', text: '写出完整证明', bbox: [50, 260, 300, 285] },
          { type: 'text', text: '答案：证明略', bbox: [50, 310, 300, 335] },
        ],
      }],
    }, CONFIG)
    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e4'])
    expect(result.ok && result.value.questions[0]?.regions[0]?.bottom).toBeLessThan(110)
    expect(result.ok && result.value.questions[1]?.regions[0]?.bottom).toBeLessThan(310)
    await ctx.fiber.dispose()
  })

  it('requires every core page preview when reviewing a complete group', async () => {
    const question = {
      sourceHeadId: 'p1e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 1, groupIndex: 0,
      regions: [{
        pageIndex: 1, left: 10, top: 10, right: 500, rightLimit: 600, bottom: 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    await expect(reviewQuestionCropsWithAgent(new Context(), {
      parentSessionId: SessionId('parent'),
      fileName: '漏整页题.pdf',
      groupIndex: 0,
      corePageIndexes: [0, 1],
      recutAttempt: 0,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [0, 1].map(pageIndex => ({
        pageIndex, width: 600, height: 800,
        elements: pageIndex === 1
          ? [{ type: 'text' as const, text: '1. 求函数值', bbox: [20, 20, 500, 80] as const }]
          : [],
      })),
      pagePreviews: [{ pageIndex: 1, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1,
        contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', message: 'a complete-group review must preview every core page' },
    })
  })

  it('accepts local previews when a follow-up recut covers every current question', async () => {
    const ctx = new Context()
    const question = {
      sourceHeadId: 'p1e0' as TeacherQuestionLayoutElementId,
      questionNo: 1, headPageIndex: 1, groupIndex: 0,
      regions: [{
        pageIndex: 1, left: 10, top: 10, right: 500, rightLimit: 600, bottom: 100,
        excludedAreas: [], pageWidth: 600, pageHeight: 800,
      }],
    }
    const result = await reviewQuestionCropsWithAgent(ctx, {
      parentSessionId: SessionId('parent'),
      fileName: '局部全题复核.pdf',
      groupIndex: 0,
      corePageIndexes: [0, 1],
      recutAttempt: 1,
      reviewQuestionIds: [question.sourceHeadId],
      pages: [0, 1].map(pageIndex => ({
        pageIndex, width: 600, height: 800,
        elements: pageIndex === 1
          ? [{ type: 'text' as const, text: '1. 求函数值', bbox: [20, 20, 500, 80] as const }]
          : [],
      })),
      pagePreviews: [{ pageIndex: 1, mediaType: 'image/png', width: 1, height: 1, contentBase64: PIXEL }],
      questions: [question],
      crops: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1,
        contentBase64: PIXEL,
      }],
      padding: 5,
    }, CONFIG)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tool-model-unavailable' },
    })
    await ctx.fiber.dispose()
  })

  it('rejects a citation-only pseudo-question but permits a cited label with owned problem content', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Bracketed labels identify exercises.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e1' },
            { headElementId: 'p0e3' },
          ],
        }, TOOL_CONTEXT)).resolves.toContain('only a citation label without question content')
        const accepted = String(await submit.execute({
          headConvention: 'A citation is a head only when a problem stem follows it before the next label.',
          questions: [
            { headElementId: 'p0e1' },
            { headElementId: 'p0e3' },
          ],
          nonQuestionHeadElementIds: ['p0e0'],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '引用标签.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [
          { type: 'text', text: '[题4]（2019 人教A版 P43 习题变式）', bbox: [40, 40, 500, 65] },
          { type: 'text', text: '[题1] 已知函数 f(x)', bbox: [40, 90, 500, 120] },
          { type: 'text', text: '求函数的单调区间', bbox: [50, 135, 500, 165] },
          { type: 'text', text: '[引例]（2020 高考模拟题）', bbox: [40, 210, 500, 235] },
          { type: 'text', text: '若 a 大于零，求不等式的解集', bbox: [50, 250, 520, 285] },
        ],
      }],
    }, CONFIG)
    expect(result.ok && result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e1', 'p0e3'])
    expect(result.ok && result.value.questions[1]?.regions[0]?.bottom).toBeGreaterThan(285)
    await ctx.fiber.dispose()
  })

  it('validates multi-megabyte canonical page previews without regular-expression overflow', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const preview = [...registered.values()].find(tool => tool.name.startsWith('question_page_preview_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || preview === undefined || submit === undefined) {
          throw new Error('segmentation tools were not registered')
        }
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await preview.execute({ ids: ['page-1'] }, TOOL_CONTEXT)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numbering starts each question.',
          questions: [{ headElementId: 'p0e0' }],
        }, TOOL_CONTEXT))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    const result = await segmentQuestionsWithAgent(ctx, {
      parentSessionId: SessionId('parent'), fileName: '扫描试卷.pdf', padding: 10,
      pages: [{
        pageIndex: 0, width: 600, height: 800,
        elements: [{ type: 'text', text: '1. 求函数值', bbox: [40, 40, 500, 80] }],
      }],
      pagePreviews: [{
        pageIndex: 0, mediaType: 'image/png', width: 2_000, height: 3_000,
        contentBase64: Buffer.alloc(2_000_000, 0x61).toString('base64'),
      }],
    }, CONFIG)
    expect(result).toMatchObject({ ok: true })
    await ctx.fiber.dispose()
  })

  it('rejects unknown IDs, normalizes head order, and accepts the terminal Host result without a second model call', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({}) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, TOOL_CONTEXT)
        await expect(submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'missing' }],
        }, TOOL_CONTEXT)).resolves.toContain('not present in the inspected source')
        const accepted = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'p0e6' }, { headElementId: 'p0e2' }],
          outsideBoundaryElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, TOOL_CONTEXT))
        expect(accepted).toContain('validationToken=')
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: {} }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toMatchObject({
      ok: true,
    })
    await ctx.fiber.dispose()

    const empty = new Context()
    await expect(segmentQuestionsWithAgent(empty, request(), CONFIG)).resolves.toMatchObject({
      ok: false, error: { code: 'tool-model-unavailable' },
    })
    await expect(segmentQuestionsWithAgent(empty, request(), {
      ...CONFIG, maxQuestionLayoutElements: 2,
    })).resolves.toMatchObject({
      ok: false, error: { code: 'invalid-request' },
    })
    await empty.fiber.dispose()
  })
})
