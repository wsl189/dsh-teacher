/** Question-segmentation agent orchestration and Host boundary validation. */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  questionSegmentationOutputSchema,
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
  maxSegmentedQuestions: 20,
  maxQuestionBoundarySubmissions: 3,
  maxQuestionBoundaryAgentRuns: 2,
  maxQuestionAutoOwnedGapRatio: 0.18,
  maxQuestionVisionImagesPerToolCall: 4,
  questionSegmentationAgentTimeoutMs: 30_000,
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

function provideAttachments(ctx: Context): void {
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
    saveImage: () => Promise.resolve({
      attachmentId: `image-${String(++id)}` as never,
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 1,
      height: 1,
    }),
  } as never)
}

describe('segmentQuestionsWithAgent', () => {
  it('owns only core-page heads while retaining continuation evidence from an adjacent page', async () => {
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
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Arabic item labels begin independent questions.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p1e1' }],
        }, {} as never)).resolves.toContain('belongs to an adjacent context page')
        const accepted = String(await submit.execute({
          headConvention: 'Arabic item labels begin independent questions.',
          questions: [{ headElementId: 'p0e0' }],
        }, {} as never))
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
          { type: 'text', text: '接上页，写出最终结论', bbox: [40, 20, 360, 50] },
          { type: 'text', text: '2. 已知数列 {a_n}', bbox: [30, 100, 400, 130] },
          { type: 'text', text: '求通项公式', bbox: [45, 150, 300, 180] },
        ],
      }],
    }, CONFIG)

    expect(result.ok && result.value.questions).toHaveLength(1)
    expect(result.ok && result.value.questions[0]?.headPageIndex).toBe(0)
    expect(result.ok && result.value.questions[0]?.regions.map(region => region.pageIndex)).toEqual([0, 1])
    expect(result.ok && result.value.questions[0]?.regions[1]).toMatchObject({ top: 10, bottom: 60 })
    await ctx.fiber.dispose()
  })

  it('starts one fresh recovery child when the first child invents a validation token', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    ctx.provide('agents', { get: () => ({ session: { id: SessionId('parent') } }) } as never)
    ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    provideModelInfo(ctx)
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
        expect(startRequest.prompt[0]?.text).toContain('previous child ended without returning a token accepted in that run')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          excludedElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e2', stopBeforeElementId: 'p0e6' }],
          nonQuestionHeadElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, {} as never)).resolves.toContain('possible question-head candidates require an explicit decision: p0e6')
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          nonQuestionHeadElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await preview.execute({ ids: ['page-1'] }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Only an instruction that asks the learner for a response starts a question.',
          questions: [],
          nonQuestionHeadElementIds: ['p0e2', 'p0e4'],
        }, {} as never))
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
        expect(startRequest.prompt[0]?.text).toContain('A section title, answer heading, explanation, footer, or other transition')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises in each column.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e3' },
          ],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await preview.execute({ ids: ['page-1'] }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e4' },
          ],
        }, {} as never))
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
          { regions: [{ top: 5, bottom: 45 }] },
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
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'The numbered stem begins the question.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e2' }],
          excludedElementIds: ['p0e2'],
        }, {} as never))
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
            top: 5,
            bottom: 110,
            excludedAreas: [[360, 95, 400, 127]],
          }],
        }],
      },
    })
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Each numbered stem begins one question.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e1' }],
        }, {} as never))
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
          { sourceHeadId: 'p0e0', regions: [{ top: 5, bottom: 20 }] },
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
    ctx.provide('agentDefaultModel', {
      currentToolSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    } as never)
    provideModelInfo(ctx, ['text', 'image'])
    provideAttachments(ctx)
    ctx.provide('subagents', {
      start: async (_mode: string, startRequest: { readonly prompt: readonly { readonly text?: string }[] }) => {
        expect(startRequest.prompt[0]?.text).toContain('next-section title, answer or explanation, footer, decoration')
        expect(startRequest.prompt[0]?.text).toContain('blank white pixels on the right are intentional padding')
        expect(startRequest.prompt[0]?.text).toContain('name the actual topmost and bottommost visible non-white content in evidence')
        expect(startRequest.prompt[0]?.text).toContain('report only that crop for local correction')
        expect(startRequest.prompt[0]?.text).toContain('This is the complete-group review')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e4'] }, {} as never)
        await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e4',
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
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
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
        }, {} as never)).resolves.toContain('cannot claim stopBeforeElementId')
        await expect(revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e4', stopBeforeElementId: 'p0e5' },
          ],
        }, {} as never)).resolves.toContain('crop-only corrections modify uncited question heads: p0e4')
        await expect(revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e2' }],
          nonQuestionHeadElementIds: ['p0e4'],
        }, {} as never)).resolves.toContain('REJECTED')
        const accepted = String(await revise.execute({
          headConvention: 'Arabic numerals start independent exercises.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p0e2' }],
        }, {} as never))
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
    }, CONFIG)

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: 'revised',
        affectedQuestionIds: ['p0e0'],
        questions: [
          { questionNo: 1, groupIndex: 0, regions: [{ top: 5, bottom: 45 }] },
          { questionNo: 2, groupIndex: 0, regions: [{ top: 205, bottom: 260 }] },
        ],
      },
    })
    await ctx.fiber.dispose()
  })

  it('requires a complete-group repair when a missing question is visible inside another crop', async () => {
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
        expect(startRequest.prompt[0]?.text).toContain('set missingQuestionHead to that problem\'s visible printed head')
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e2', 'crop-p0e6'] }, {} as never)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: '求集合交集',
            evidence: 'question 1 ends after its option row',
          }, {
            cropId: 'crop-p0e6',
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
            missingQuestionHead: '5. 已知展开式中系数为 m',
            issue: 'question 5 has no listed crop',
            evidence: 'its full stem and options are visible only inside crop-p0e2',
          }],
        }, {} as never)).resolves.toContain('DEFECTS_RECORDED')
        await source.execute({ chunk: 0 }, {} as never)
        await expect(revise.execute({
          headConvention: 'Each numbered answer-producing stem begins one question.',
          questions: [{ headElementId: 'p0e2', stopBeforeElementId: 'p0e4' }],
        }, {} as never)).resolves.toContain('possible question-head candidates require an explicit decision')
        const accepted = String(await revise.execute({
          headConvention: 'Each numbered answer-producing stem begins one question.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e4' },
            { headElementId: 'p0e4', stopBeforeElementId: 'p0e6' },
            { headElementId: 'p0e6' },
          ],
        }, {} as never))
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
        { type: 'text' as const, text: '5. 已知展开式中系数为 m', bbox: [20, 150, 500, 170] as const },
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
    expect(result.value.decision).toBe('revised')
    expect(result.value.questions.map(question => question.sourceHeadId)).toEqual(['p0e0', 'p0e2', 'p0e4', 'p0e6'])
    expect(result.value.affectedQuestionIds).toContain('p0e4')
    await ctx.fiber.dispose()
  })

  it('forbids page-level missing-question recovery during a crop-local recut', async () => {
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
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: '求集合交集',
            evidence: 'question 1 ends after its option row',
          }],
          findings: [{
            pageId: 'page-1',
            missingQuestionHead: '2. 求集合并集',
            issue: 'question 2 has no listed crop in this request',
            evidence: 'question 2 is visible below the reviewed crop',
          }],
        }, {} as never)).resolves.toContain('forbidden during a crop-local recut')
        const accepted = String(await findings.execute({
          cropId: 'crop-p0e0',
          answerDemand: '求集合交集',
          evidence: 'question 1 starts at its printed head and ends after its option row',
          finalize: true,
        }, {} as never))
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
      reviewQuestionIds: ['p0e0' as TeacherQuestionLayoutElementId],
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

  it('removes a spurious theory-page crop while preserving the real question in its group', async () => {
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1', 'page-2'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e2', 'crop-p1e0'] }, {} as never)
        await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p1e0',
            answerDemand: '求函数的定义域',
            evidence: 'the stem starts with the given function and ends after the requested domain',
          }],
          findings: [
            {
              cropId: 'crop-p0e2',
              repairIntents: ['remove-crop'],
              issue: 'the crop is a theory summary rather than an independent problem',
              evidence: 'the page contains several numbered definitions and methods but asks for no response',
            },
          ],
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
        await expect(revise.execute({
          headConvention: 'Only answer-producing instructions begin independent questions.',
          questions: [],
          removedCropIds: ['crop-p0e2'],
        }, {} as never)).resolves.toContain('requires one finding with both its cropId and a source pageId')
        await expect(findings.execute({
          pageId: 'page-1',
          issue: 'the page contains a spurious detected question that must be removed',
          evidence: 'crop-p0e2 has no learner answer demand',
        }, {} as never)).resolves.toContain('pageId-only finding requires missingQuestionHead')
        await expect(findings.execute({
          cropId: 'crop-p0e2',
          pageId: 'page-1',
          repairIntents: ['remove-crop'],
          issue: 'the crop is a theory summary rather than an independent problem',
          evidence: 'the page contains several numbered definitions and methods but asks for no response',
          finalize: true,
        }, {} as never)).resolves.toContain('DEFECTS_UPDATED')
        const accepted = String(await revise.execute({
          headConvention: 'Only answer-producing instructions begin independent questions.',
          questions: [],
          removedCropIds: ['crop-p0e2'],
        }, {} as never))
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
        { type: 'text' as const, text: '1. 判断集合关系的两种方法：', bbox: [30, 120, 360, 145] as const },
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
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the crop omits visible content',
            evidence: 'the source page visibly continues below the crop',
          }],
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
        await expect(revise.execute({
          headConvention: 'The first instruction starts the question.',
          questions: [{ headElementId: 'p0e0' }],
        }, {} as never)).resolves.toContain('changes no rendered crop geometry')
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
        pageIndex: 0, left: 15, top: 5, right: 305, rightLimit: 600, bottom: 45,
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the related diagram is absent',
            evidence: 'the source page shows a diagram beside question 1 that the crop omits',
          }],
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', additionalElementIds: ['p0e4'] }],
        }, {} as never))
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

  it('lets visual review adjust only a cited crop vertical edge when pixels have no OCR element', async () => {
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: 'the answer line below the OCR text is clipped',
            evidence: 'a drawn answer line remains visible below the crop on the source page',
          }],
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
        await expect(revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 105 }] }],
        }, {} as never)).resolves.toContain('crosses question head p0e2')
        const accepted = String(await revise.execute({
          headConvention: 'Numbered lines start independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 80 }] }],
        }, {} as never))
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
      recutAttempt: 0,
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0', 'crop-p0e2'] }, {} as never)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e2',
            answerDemand: '求参数取值',
            evidence: 'question 2 contains its complete stem after the leading answer line',
          }],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: 'question 1 omits its printed answer line',
            evidence: 'the answer line is visible at the top of crop-p0e2 instead of crop-p0e0',
          }],
        }, {} as never)).resolves.toContain('DEFECTS_RECORDED')
        await source.execute({ chunk: 0 }, {} as never)
        await expect(revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 40 }] }],
        }, {} as never)).resolves.toContain('trim-bottom direction')
        await expect(revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 65 }] }],
        }, {} as never)).resolves.toContain('requires a cited trim-top finding for that neighbor')
        await expect(findings.execute({
          cropId: 'crop-p0e2',
          repairIntents: ['trim-top'],
          issue: 'question 2 starts with question 1 answer line',
          evidence: 'the leading line completes the preceding prompt before question 2 begins',
          finalize: true,
        }, {} as never)).resolves.toContain('DEFECTS_UPDATED')
        await expect(revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{
            headElementId: 'p0e0',
            verticalRegionEdits: [{ pageIndex: 0, bottom: 65 }],
          }, {
            headElementId: 'p0e2',
            verticalRegionEdits: [{ pageIndex: 0, top: 65, bottom: 100 }],
          }],
        }, {} as never)).resolves.toContain('expand-bottom direction')
        const accepted = String(await revise.execute({
          headConvention: 'Numbered stems begin independent questions.',
          questions: [{
            headElementId: 'p0e0',
            verticalRegionEdits: [{ pageIndex: 0, bottom: 65 }],
          }, {
            headElementId: 'p0e2',
            verticalRegionEdits: [{ pageIndex: 0, top: 65 }],
          }],
        }, {} as never))
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['expand-bottom'],
            issue: 'the final answer line is clipped',
            evidence: 'the source shows the line below the current crop edge in the left column',
          }],
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await revise.execute({
          headConvention: 'Each column contains an independent question.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, bottom: 105 }] }],
        }, {} as never))
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
      recutAttempt: 0,
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_review_layout_'))
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        const revise = [...registered.values()].find(tool => tool.name.startsWith('revise_question_boundaries_'))
        if (source === undefined || pages === undefined || crops === undefined
          || findings === undefined || revise === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['trim-top'],
            issue: 'the crop has unrelated pixels above its head',
            evidence: 'the crop begins above the visible question head',
          }],
        }, {} as never)
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await revise.execute({
          headConvention: 'The current final question keeps its existing semantic boundary.',
          questions: [{ headElementId: 'p0e0', verticalRegionEdits: [{ pageIndex: 0, top: 8 }] }],
        }, {} as never))
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
      start: async () => {
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        await expect(findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: '求函数定义域',
            evidence: 'question stem through final line is visible',
          }],
          findings: [],
        }, {} as never))
          .resolves.toContain('inspect every requested source-page preview and question crop')
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await expect(findings.execute({
          verifiedCrops: [{ cropId: 'crop-p0e0', answerDemand: '', evidence: 'complete visible crop' }],
          findings: [],
        }, {} as never)).resolves.toContain('answerDemand must identify the visible response')
        await expect(findings.execute({ verifiedCrops: [], findings: [] }, {} as never))
          .resolves.toContain('every requested crop requires a verified or defective classification: crop-p0e0')
        await expect(findings.execute({
          verifiedCrops: [],
          findings: [{
            cropId: 'crop-p0e0',
            repairIntents: ['reassign-content'],
            issue: 'the crop might omit a continuation',
            evidence: 'the initial visual comparison appeared ambiguous',
          }],
        }, {} as never)).resolves.toContain('DEFECTS_RECORDED')
        const accepted = String(await findings.execute({
          cropId: 'crop-p0e0',
          answerDemand: '求函数定义域',
          evidence: 'question stem through final line is visible',
          finalize: true,
        }, {} as never))
        const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
        if (validationToken === undefined) throw new Error(`review was not accepted: ${accepted}`)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: { validationToken } }),
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
      fileName: '单题.pdf',
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
    }, { ...CONFIG, maxQuestionBoundarySubmissions: 4 })

    if (!result.ok) throw new Error(result.error.message)
    expect(result).toMatchObject({
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
        expect(startRequest.prompt[0]?.text).toContain('previous crop-review child ended without returning a token accepted in that run')
        const pages = [...registered.values()].find(tool => tool.name.startsWith('question_review_page_'))
        const crops = [...registered.values()].find(tool => tool.name.startsWith('question_review_crop_'))
        const findings = [...registered.values()].find(tool => tool.name.startsWith('submit_question_crop_findings_'))
        if (pages === undefined || crops === undefined || findings === undefined) {
          throw new Error('crop review tools were not registered')
        }
        await pages.execute({ ids: ['page-1'] }, {} as never)
        await crops.execute({ ids: ['crop-p0e0'] }, {} as never)
        const accepted = String(await findings.execute({
          verifiedCrops: [{
            cropId: 'crop-p0e0',
            answerDemand: 'complete the requested calculation',
            evidence: 'the complete stem and final instruction are both visible',
          }],
          findings: [],
        }, {} as never))
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

  it('keeps subquestions, diagrams, and continuation pages while excluding instructions and answers', async () => {
    const ctx = new Context()
    const registered = provideTools(ctx)
    const parent = { session: { id: SessionId('parent') } }
    const start = vi.fn(async (_name: string, startRequest: unknown) => {
      const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
      const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
      if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
      const inspected = String(await source.execute({ chunk: 0 }, {} as never))
      expect(inspected).toContain('"elementId":"p0e4"')
      expect(inspected).toContain('"type":"image"')
      const accepted = String(await submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [
          { headElementId: 'p0e2' },
          { headElementId: 'p0e6' },
        ],
        excludedElementIds: ['p0e1'],
        retainedImageElementIds: ['p0e4', 'p0e7'],
        stopBeforeElementId: 'p1e2',
      }, {} as never))
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

    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toEqual({
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
      agentOptions: { provider: 'p', model: 'm' },
      outputSchema: questionSegmentationOutputSchema,
      toolFilter: { allow: [
        expect.stringMatching(/^question_layout_/u),
        expect.stringMatching(/^submit_question_boundaries_/u),
      ] },
    })
    expect(options).toHaveProperty('persona', QUESTION_SEGMENTATION_SKILL.content)
    const promptText = (options as { prompt: readonly { readonly text?: string }[] }).prompt[0]?.text
    expect(promptText).toContain('"possibleQuestionHeadIds":["p0e1","p0e2","p0e6"]')
    expect(promptText).toContain('"possibleAnswerHeadingIds":["p1e3"]')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('A page break does not end a task')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('formula, table, diagram')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain("Infer each source's own visual and textual convention")
    await ctx.fiber.dispose()
  })

  it('reassigns interleaved columns, accepts an OCR-damaged head, and excludes section headings', async () => {
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'A score-bearing numeric label starts each top-level problem, including OCR-damaged labels.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2', stopBeforeElementId: 'p0e6' },
            { headElementId: 'p0e8' },
          ],
          excludedElementIds: ['p0e6', 'p0e7', 'p0e10'],
          retainedImageElementIds: ['p0e5'],
        }, {} as never))
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
              pageIndex: 0, left: 20, top: 10, right: 420, rightLimit: 440, bottom: 200,
              excludedAreas: [], pageWidth: 841, pageHeight: 595,
            }],
          },
          {
            sourceHeadId: 'p0e2',
            questionNo: 2, headPageIndex: 0, groupIndex: 0,
            regions: [{
              pageIndex: 0, left: 430, top: 10, right: 710, rightLimit: 841, bottom: 75,
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Score-bearing Arabic labels start top-level questions in each column.',
          questions: [
            { headElementId: 'p0e0', additionalElementIds: ['p0e5'] },
            { headElementId: 'p0e2', additionalElementIds: ['p0e4'] },
          ],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Bracketed 题 labels start each top-level question.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2', additionalElementIds: ['p0e1'] },
            { headElementId: 'p0e4' },
          ],
          retainedImageElementIds: ['p0e6'],
        }, {} as never)).resolves.toContain('assigns p0e1 across the vertical band of p0e0')
        const accepted = String(await submit.execute({
          headConvention: 'Bracketed 题 labels start each top-level question.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e2' },
            { headElementId: 'p0e4', additionalElementIds: ['p0e6'] },
          ],
          retainedImageElementIds: ['p0e1'],
        }, {} as never))
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
    expect(result.ok && result.value.questions[0]?.regions[0]?.top).toBe(10)
    expect(result.ok && result.value.questions[1]?.regions[0]?.rightLimit).toBe(450)
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
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic labels begin top-level questions; a page-bottom stem may continue at the top of the next column.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e7' },
          ],
          retainedImageElementIds: ['p0e3'],
        }, {} as never))
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

    const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
    expect(result.ok && result.value.questions[0]?.regions).toEqual([
      {
        pageIndex: 0, left: 63, top: 721, right: 618, rightLimit: 1244, bottom: 809,
        excludedAreas: [], pageWidth: 1244, pageHeight: 831,
      },
      {
        pageIndex: 0, left: 669, top: 31, right: 1026, rightLimit: 1244, bottom: 247,
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
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic labels begin top-level questions.',
          questions: [{ headElementId: 'p0e0' }],
          excludedElementIds: ['p0e2', 'p0e3', 'p0e4'],
        }, {} as never))
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
      provideModelInfo(ctx)
      ctx.provide('subagents', {
        start: async () => {
          const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
          const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
          if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
          await source.execute({ chunk: 0 }, {} as never)
          const accepted = String(await submit.execute({
            headConvention: 'The score-bearing label starts the final problem.',
            questions: [{
              headElementId: 'p0e0',
              ...(explicit ? { additionalElementIds: ['p0e2'] } : {}),
            }],
            ...(explicit ? {} : { retainedImageElementIds: ['p0e2'] }),
            excludedElementIds: ['p0e3', 'p0e4'],
          }, {} as never))
          const validationToken = accepted.match(/validationToken=([^\n]+)/u)?.[1]
          if (validationToken === undefined) throw new Error(`draft was not accepted: ${accepted}`)
          return {
            id: SessionId('child'), localAgent: undefined,
            result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: { validationToken } }),
            dispose: () => Promise.resolve(),
          }
        },
      } as never)
      const result = await segmentQuestionsWithAgent(ctx, layout, CONFIG)
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
        await source.execute({ chunk: 0 }, {} as never)
        const questions = [
          { headElementId: 'p0e0' },
          { headElementId: 'p0e2' },
          { headElementId: 'p0e7' },
          { headElementId: 'p0e9' },
        ]
        const accepted = String(await submit.execute({
          headConvention: 'Each paper uses its own Arabic sequence; a new paper title resets the printed labels.',
          questions,
          excludedElementIds: ['p0e4', 'p0e5', 'p0e6'],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Each paper restarts ordinary Arabic numbering at one.',
          questions: [{ headElementId: 'p0e0', stopBeforeElementId: 'p1e0' }, { headElementId: 'p1e3' }],
        }, {} as never))
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
      pageIndex: 0, left: 30, top: 10, right: 610, rightLimit: 841, bottom: 110,
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
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Each page contains one numbered final question.',
          questions: [
            { headElementId: 'p0e0', stopBeforeElementId: 'p0e2' },
            { headElementId: 'p1e0', stopBeforeElementId: 'p1e2' },
            { headElementId: 'p2e0', stopBeforeElementId: 'p2e2' },
          ],
          excludedElementIds: ['p0e2', 'p1e2', 'p2e2'],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Bracketed 题 labels and 变式 labels start separate tasks; after the next chapter title, the first imperative stem starts an unnumbered task.',
          questions: [
            { headElementId: 'p0e1' },
            { headElementId: 'p0e3' },
            { headElementId: 'p0e5' },
            { headElementId: 'p0e8' },
          ],
          excludedElementIds: ['p0e0', 'p0e7'],
          retainedImageElementIds: ['p0e9'],
        }, {} as never))
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
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Bracketed 题 labels start independent exercises.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
          excludedElementIds: ['p0e2', 'p0e3'],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Only the first and final labels are independent tasks; the middle span is an embedded worked example.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
          excludedElementIds: ['p0e2', 'p0e3'],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic labels start questions in both columns.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e2' }, { headElementId: 'p0e5' }],
        }, {} as never))
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

  it('reports the missing accepted draft instead of exposing token-schema validation', async () => {
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
        await source.execute({ chunk: 0 }, {} as never)
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({
            stopReason: 'completed', output: [], structured: { validationToken: 'unavailable' },
          }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)

    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-output',
        message: 'the agent did not produce a Host-accepted boundary draft; retry the cut',
      },
    })
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
        await source.execute({ chunk: 0 }, {} as never)
        const malformed = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'missing' }],
        }, {} as never))
        expect(malformed).toContain('do not consume the complete-draft submission limit')
        const accepted = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e6' }],
          excludedElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, {} as never))
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
    provideModelInfo(ctx)
    ctx.provide('subagents', {
      start: async () => {
        const source = [...registered.values()].find(tool => tool.name.startsWith('question_layout_'))
        const submit = [...registered.values()].find(tool => tool.name.startsWith('submit_question_boundaries_'))
        if (source === undefined || submit === undefined) throw new Error('segmentation tools were not registered')
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Numbered exercises follow hierarchical chapter titles.',
          questions: [{ headElementId: 'p0e2' }, { headElementId: 'p0e4' }],
          nonQuestionHeadElementIds: ['p0e0'],
        }, {} as never)).resolves.toContain('references a section or answer heading')
        const accepted = String(await submit.execute({
          headConvention: 'Numbered exercises follow hierarchical chapter titles.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Each prompt-bearing worked example is one independent question.',
          questions: [{ headElementId: 'p0e0' }],
        }, {} as never)).resolves.toContain('possible question-head candidates require an explicit decision: p0e4')
        const accepted = String(await submit.execute({
          headConvention: 'Each prompt-bearing worked example is one independent question.',
          questions: [{ headElementId: 'p0e0' }, { headElementId: 'p0e4' }],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Bracketed labels identify exercises.',
          questions: [
            { headElementId: 'p0e0' },
            { headElementId: 'p0e1' },
            { headElementId: 'p0e3' },
          ],
        }, {} as never)).resolves.toContain('only a citation label without question content')
        const accepted = String(await submit.execute({
          headConvention: 'A citation is a head only when a problem stem follows it before the next label.',
          questions: [
            { headElementId: 'p0e1' },
            { headElementId: 'p0e3' },
          ],
          nonQuestionHeadElementIds: ['p0e0'],
        }, {} as never))
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
        await source.execute({ chunk: 0 }, {} as never)
        await preview.execute({ ids: ['page-1'] }, {} as never)
        const accepted = String(await submit.execute({
          headConvention: 'Arabic numbering starts each question.',
          questions: [{ headElementId: 'p0e0' }],
        }, {} as never))
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

  it('rejects unknown IDs, normalizes head order, and reports missing services and oversized layouts', async () => {
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
        await source.execute({ chunk: 0 }, {} as never)
        await expect(submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'missing' }],
        }, {} as never)).resolves.toContain('not present in the inspected source')
        const accepted = String(await submit.execute({
          headConvention: 'Numeric starts.',
          questions: [{ headElementId: 'p0e6' }, { headElementId: 'p0e2' }],
          excludedElementIds: ['p0e1'],
          retainedImageElementIds: ['p0e4', 'p0e7'],
          stopBeforeElementId: 'p1e2',
        }, {} as never))
        expect(accepted).toContain('validationToken=')
        return {
          id: SessionId('child'), localAgent: undefined,
          result: Promise.resolve({ stopReason: 'completed', output: [], structured: {} }),
          dispose: () => Promise.resolve(),
        }
      },
    } as never)
    await expect(segmentQuestionsWithAgent(ctx, request(), CONFIG)).resolves.toMatchObject({
      ok: false, error: { code: 'invalid-output' },
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
