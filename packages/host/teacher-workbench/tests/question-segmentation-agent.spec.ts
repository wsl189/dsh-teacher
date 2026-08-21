/** Question-segmentation agent orchestration and Host boundary validation. */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  questionSegmentationOutputSchema,
  segmentQuestionsWithAgent,
  type TeacherQuestionSegmentationAgentConfig,
} from '../src/question-segmentation-agent.ts'
import { QUESTION_SEGMENTATION_SKILL } from '../src/question-segmentation-skill.ts'
import type { TeacherQuestionSegmentRequest } from '../src/types.ts'

const CONFIG: TeacherQuestionSegmentationAgentConfig = {
  maxQuestionLayoutPages: 10,
  maxQuestionLayoutElements: 100,
  maxQuestionSourceChunkCharacters: 18_000,
  maxSegmentedQuestions: 20,
  maxQuestionBoundarySubmissions: 3,
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

function provideModelInfo(ctx: Context): void {
  ctx.provide('llm', {
    resolveModelInfo: () => Promise.resolve({
      provider: 'p', id: 'm', name: 'm',
      reasoning: {
        efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }],
        defaultEffort: 'high',
      },
    }),
  } as never)
}

describe('segmentQuestionsWithAgent', () => {
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
      const rejected = String(await submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [
          { headElementId: 'p0e2' },
          { headElementId: 'p0e6' },
        ],
      }, {} as never))
      expect(rejected).toContain('endElementId must be p1e2')
      const accepted = String(await submit.execute({
        headConvention: 'Arabic numerals followed by punctuation begin top-level questions.',
        questions: [
          { headElementId: 'p0e2' },
          { headElementId: 'p0e6' },
        ],
        endElementId: 'p1e2',
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
          questionNo: 1, headPageIndex: 0, groupIndex: 0,
          regions: [{
            pageIndex: 0, left: 30, top: 95, right: 620, bottom: 570, pageWidth: 720, pageHeight: 1000,
          }],
        }, {
          questionNo: 2, headPageIndex: 0, groupIndex: 0,
          regions: [
            { pageIndex: 0, left: 30, top: 590, right: 630, bottom: 950, pageWidth: 720, pageHeight: 1000 },
            { pageIndex: 1, left: 35, top: 50, right: 510, bottom: 195, pageWidth: 720, pageHeight: 1000 },
          ],
        }],
      },
    })
    const options = start.mock.calls[0]?.[1]
    expect(options).toMatchObject({
      parent,
      agentOptions: { provider: 'p', model: 'm', reasoningEffort: 'off' },
      outputSchema: questionSegmentationOutputSchema,
      toolFilter: { allow: [
        expect.stringMatching(/^question_layout_/u),
        expect.stringMatching(/^submit_question_boundaries_/u),
      ] },
    })
    expect(options).toHaveProperty('persona', QUESTION_SEGMENTATION_SKILL.content)
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('page break never ends a question')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('geometric or statistical figures')
    expect(QUESTION_SEGMENTATION_SKILL.content).toContain('infer the convention used by this source')
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
        await expect(submit.execute({
          headConvention: 'A score-bearing numeric label starts each top-level problem, including OCR-damaged labels.',
          questions: [
            { headElementId: 'p0e0', additionalElementIds: ['p0e4', 'p0e5'] },
            { headElementId: 'p0e2' },
            { headElementId: 'p0e8' },
          ],
        }, {} as never)).resolves.toContain('must include non-question section heading p0e6')
        const accepted = String(await submit.execute({
          headConvention: 'A score-bearing numeric label starts each top-level problem, including OCR-damaged labels.',
          questions: [
            { headElementId: 'p0e0', additionalElementIds: ['p0e4', 'p0e5'] },
            { headElementId: 'p0e2' },
            { headElementId: 'p0e8' },
          ],
          excludedElementIds: ['p0e6'],
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
        ],
      }],
    }

    await expect(segmentQuestionsWithAgent(ctx, layout, CONFIG)).resolves.toEqual({
      ok: true,
      value: {
        questions: [
          {
            questionNo: 1, headPageIndex: 0, groupIndex: 0,
            regions: [{ pageIndex: 0, left: 20, top: 10, right: 420, bottom: 200, pageWidth: 841, pageHeight: 595 }],
          },
          {
            questionNo: 2, headPageIndex: 0, groupIndex: 0,
            regions: [{ pageIndex: 0, left: 430, top: 10, right: 710, bottom: 75, pageWidth: 841, pageHeight: 595 }],
          },
          {
            questionNo: 3, headPageIndex: 0, groupIndex: 0,
            regions: [{ pageIndex: 0, left: 430, top: 238, right: 710, bottom: 310, pageWidth: 841, pageHeight: 595 }],
          },
        ],
      },
    })
    await ctx.fiber.dispose()
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
    expect(result.ok && result.value.questions[2]?.regions[0]?.top).toBe(400)
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
          endElementId: 'p1e2',
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
