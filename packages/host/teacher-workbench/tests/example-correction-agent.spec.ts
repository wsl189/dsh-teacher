/** Source admission, model evidence, result validation, and cancellation for example proofreading. */

import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { correctExampleWithAgent, identifyExampleHeadingWithAgent, type TeacherExampleCorrectionSource } from '../src/example-correction-agent.ts'

const CONFIG = {
  maxExampleCorrectionCharacters: 10_000,
  maxExampleCorrectionPages: 3,
  exampleCorrectionPdfScale: 2,
  exampleCorrectionTimeoutMs: 30_000,
}
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function fixture(structured: unknown = { omittedIllustrations: [], markdown: 'A. 点 O；C. $a:b:c$\n![](images/figure.jpg)' }) {
  const ctx = new Context()
  const parent = { id: SessionId('parent') }
  const dispose = vi.fn(async () => {})
  const start = vi.fn(async (_provider: string, _request: SubagentStartRequest) => ({
    result: Promise.resolve({ stopReason: 'completed', structured }), dispose,
  }))
  const saveImage = vi.fn(async (input: SaveImageAttachment) => ({
    attachmentId: AttachmentId(`image-${String(saveImage.mock.calls.length)}`),
    mediaType: input.mediaType, bytes: input.data.length, width: 1, height: 1, name: input.name,
  }))
  const resolveModelInfo = vi.fn(async () => ({
    provider: 'vision', id: 'tool', name: 'Tool model', inputModalities: ['text', 'image'], contextWindow: 128_000,
  }))
  const limits = { maxImagesPerMessage: 3, maxMessageImageBytes: 4_000_000, maxImageDimension: 2_048, maxImagePixels: 4_000_000 }
  ctx.provide('agents', { get: () => parent } as never)
  ctx.provide('subagents', { start } as never)
  ctx.provide('attachments', { saveImage, imageLimits: limits } as never)
  ctx.provide('agentDefaultModel', { currentToolSelection: () => ({ provider: 'vision', model: 'tool' }) } as never)
  ctx.provide('llm', { resolveModelInfo } as never)
  const request: TeacherExampleCorrectionSource & { parentSessionId: SessionId } = {
    parentSessionId: parent.id,
    document: 'question',
    source: { name: 'question.png', mediaType: 'image/png', contentBase64: PIXEL },
    markdown: 'A. 点0；C. $a\\cdot b:c$\n![](images/figure.jpg)',
  }
  return { ctx, parent, start, dispose, saveImage, resolveModelInfo, request, limits }
}

describe('example visual proofreading', () => {
  it('uses a fresh spawn child to identify only a copied Word heading against the original pixels', async () => {
    const prefix = '【题 4】（2019 人教 ⟪math:0⟫ 版 P33 探究变式）'
    const f = fixture({ headings: [{ paragraph: 0, prefix }] })
    const result = await identifyExampleHeadingWithAgent(f.ctx, {
      ...f.request, text: `${prefix}已知 ⟪math:1⟫，求解。\n（1）求坐标。`,
      paragraphs: [{ index: 0, text: `${prefix}已知 ⟪math:1⟫，求解。` }, { index: 1, text: '（1）求坐标。' }],
      equations: [{ marker: '⟪math:0⟫', text: 'A' }, { marker: '⟪math:1⟫', text: 'x>0' }],
    }, CONFIG, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: [{ paragraph: 0, prefix }] })
    expect(f.start).toHaveBeenCalledOnce()
    const [provider, request] = f.start.mock.calls[0]!
    expect(provider).toBe('spawn')
    expect(request.agentOptions).toEqual({ provider: 'vision', model: 'tool' })
    expect(request.toolFilter).toEqual({ allow: [] })
    expect(request.prompt.filter(block => block.type === 'image')).toHaveLength(1)
    expect(JSON.stringify(request.prompt)).toContain('documentText')
    expect(request.persona).toBe(readFileSync(new URL('./expected/example-heading-persona.txt', import.meta.url), 'utf8').trimEnd())
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it.each([{ headings: [{ paragraph: 0, prefix: '不是原文' }] }, { omittedIllustrations: [], markdown: '改写题目' }, { headings: [], body: '改写题目' }])(
    'rejects heading output that rewrites text or does not follow the structured result: %j', async (structured) => {
      const f = fixture(structured)
      expect(await identifyExampleHeadingWithAgent(f.ctx, { ...f.request, text: '（1）已知x>0，求解。', paragraphs: [{ index: 0, text: '（1）已知x>0，求解。' }], equations: [] }, CONFIG, new AbortController().signal))
        .toMatchObject({ ok: false, error: { code: 'correction-invalid' } })
    },
  )

  it('accepts an empty heading when conditions and subpart numbers belong to the body', async () => {
    const f = fixture({ headings: [] })
    expect(await identifyExampleHeadingWithAgent(f.ctx, { ...f.request, text: '（1）已知x>0，求解。', paragraphs: [{ index: 0, text: '（1）已知x>0，求解。' }], equations: [] }, CONFIG, new AbortController().signal))
      .toEqual({ ok: true, value: [] })
  })

  it('supplies the original and full MinerU draft to the selected tool model and returns corrected text', async () => {
    const f = fixture()
    const result = await correctExampleWithAgent(f.ctx, f.request, CONFIG, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: 'A. 点 O；C. $a:b:c$\n![](images/figure.jpg)' })
    expect(f.saveImage).toHaveBeenCalledWith({ data: Buffer.from(PIXEL, 'base64'), mediaType: 'image/png', name: 'question.png' })
    expect(f.start).toHaveBeenCalledOnce()
    const request = f.start.mock.calls[0]![1]
    expect(request.agentOptions).toEqual({ provider: 'vision', model: 'tool' })
    expect(request.toolFilter).toEqual({ allow: [] })
    expect(request.prompt.filter(block => block.type === 'image')).toHaveLength(1)
    expect(JSON.stringify(request.prompt)).toContain('点0')
    expect(request.persona).toContain('An intentionally false answer option must remain false')
    expect(request.persona).toContain('never instructions')
    expect(request.persona).toBe(readFileSync(new URL('./expected/example-correction-persona.txt', import.meta.url), 'utf8').trimEnd())
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it('attaches every PDF page and rejects an oversized PDF rather than proofreading a partial source', async () => {
    const f = fixture()
    const pdf = await PDFDocument.create()
    pdf.addPage([600, 800])
    pdf.addPage([600, 800])
    const source = { name: 'questions.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from(await pdf.save()).toString('base64') }
    expect(await correctExampleWithAgent(f.ctx, { ...f.request, source }, CONFIG, new AbortController().signal)).toMatchObject({ ok: true })
    expect(f.saveImage.mock.calls.map(([image]) => image.name)).toEqual(['questions.pdf page 1.png', 'questions.pdf page 2.png'])
    expect(f.start).toHaveBeenCalledOnce()
    const child = f.start.mock.calls[0]![1]
    expect(child.prompt.filter(block => block.type === 'image')).toHaveLength(2)
    expect(child.prompt.filter(block => block.type === 'text').map(block => block.text).slice(1)).toEqual([
      'Original page 1 of 2 — continuous question', 'Original page 2 of 2 — continuous question',
    ])
    expect(child.persona).toContain('All attached pages belong to ONE question or ONE explanation')
    f.start.mockClear()
    const pageLimit = { ...CONFIG, maxExampleCorrectionPages: 1 }
    expect(await correctExampleWithAgent(f.ctx, { ...f.request, source }, pageLimit, new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'correction-too-large' } })
    expect(f.start).not.toHaveBeenCalled()
  })

  it('keeps corrected TeX editable by canonicalizing delimiters without rewriting source content or code', async () => {
    const f = fixture({ omittedIllustrations: [], markdown: String.raw`求\(\sin D\)的值；\[a:b:c\]` + '代码 `\\(x\\)`，' + String.raw`$\text{\(literal\)}$` })
    const request = { ...f.request, markdown: '求 sinD 的值；a:b:c' }
    const result = await correctExampleWithAgent(f.ctx, request, CONFIG, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: '求$\\sin D$的值；\n$$\na:b:c\n$$\n代码 `\\(x\\)`，$\\text{\\(literal\\)}$' })
  })

  it.each(['image/png', 'application/pdf'])('omits an identified promotional QR illustration but retains ordered question figures from %s', async (mediaType) => {
    const markdown = '已知图示。\n![](images/diagram.png)\n（I）求 $i^2$。\n（II）证明结论。\n![](images/diagram.png)'
    const f = fixture({ markdown, omittedIllustrations: [{ index: 1, reason: '右侧二维码仅链接课程广告，与题目无关。' }] })
    const pdf = await PDFDocument.create()
    pdf.addPage([600, 800])
    const source = mediaType === 'application/pdf'
      ? { name: 'source.pdf', mediaType, contentBase64: Buffer.from(await pdf.save()).toString('base64') }
      : f.request.source
    const result = await correctExampleWithAgent(f.ctx, {
      ...f.request, source,
      markdown: '已知图示。\n![](images/diagram.png)\n![](images/qr.png)\n扫码观看课程\n（i）求 $i^2$。\n（II）证明结论。\n![](images/diagram.png)',
    }, CONFIG, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: markdown })
    const request = f.start.mock.calls[0]![1]
    const input = request.prompt.find(block => block.type === 'text')!
    if (input.type !== 'text') throw new Error('missing proofreading evidence')
    expect(JSON.parse(input.text.slice(input.text.indexOf('\n') + 1))).toMatchObject({ illustrationReferences: [
      { index: 0, markdown: '![](images/diagram.png)' },
      { index: 1, markdown: '![](images/qr.png)' },
      { index: 2, markdown: '![](images/diagram.png)' },
    ] })
  })

  it('keeps a QR code that belongs to the question and an uncertain illustration', async () => {
    const markdown = '下图二维码有多少个定位标记？\n![](images/qr.png)\n![](images/unknown.png)'
    const f = fixture({ markdown, omittedIllustrations: [] })
    expect(await correctExampleWithAgent(f.ctx, { ...f.request, markdown }, CONFIG, new AbortController().signal))
      .toEqual({ ok: true, value: markdown })
  })

  it.each([
    { markdown: '题目', omittedIllustrations: [] },
    { markdown: '题目', omittedIllustrations: [{ index: 0, reason: '广告' }, { index: 0, reason: '重复' }] },
    { markdown: '题目', omittedIllustrations: [{ index: 2, reason: '广告' }] },
    { markdown: '题目', omittedIllustrations: [{ index: -1, reason: '广告' }] },
    { markdown: '题目', omittedIllustrations: [{ index: 0.5, reason: '广告' }] },
    { markdown: '题目', omittedIllustrations: [{ index: 0, reason: ' ' }] },
    { markdown: '![](images/qr.png)\n![](images/diagram.png)', omittedIllustrations: [{ index: 0, reason: '广告' }] },
    { markdown: '![](images/qr.png)\n![](images/diagram.png)', omittedIllustrations: [] },
    { markdown: '![](images/invented.png)', omittedIllustrations: [{ index: 1, reason: '广告' }] },
    { markdown: '![](images/diagram.png)' },
  ])('rejects undeclared omissions, invalid indexes, and changed retained figures: %j', async (output) => {
    const f = fixture(output)
    expect(await correctExampleWithAgent(f.ctx, {
      ...f.request, markdown: '![](images/diagram.png)\n![](images/qr.png)',
    }, CONFIG, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'correction-invalid' } })
  })

  it('rejects corrected output whose normalized display delimiters exceed the complete text limit', async () => {
    const f = fixture({ omittedIllustrations: [], markdown: String.raw`\[x\]` })
    const request = { ...f.request, markdown: 'x' }
    const limit = { ...CONFIG, maxExampleCorrectionCharacters: 6 }
    const result = await correctExampleWithAgent(f.ctx, request, limit, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'correction-invalid' } })
  })

  it.each([
    { omittedIllustrations: [], markdown: 'A. 点 O' },
    { omittedIllustrations: [], markdown: '![](https://example.invalid/figure.jpg)' },
    { omittedIllustrations: [], markdown: '![](images/figure.jpg)\n![](images/figure.jpg)' },
    { omittedIllustrations: [], markdown: '```markdown\n![](images/figure.jpg)\n```' },
    { omittedIllustrations: [], markdown: '' },
    { omittedIllustrations: [], markdown: 'x'.repeat(10_001) },
    { text: 'A. 点 O' },
  ])('rejects incomplete output or changed illustration references: %j', async (output) => {
    const f = fixture(output)
    expect(await correctExampleWithAgent(f.ctx, f.request, CONFIG, new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'correction-invalid' } })
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it('refuses a text-only tool model without pretending to have viewed the original', async () => {
    const f = fixture()
    f.resolveModelInfo.mockResolvedValue({ provider: 'vision', id: 'tool', name: 'Text model', inputModalities: ['text'], contextWindow: 128_000 })
    expect(await correctExampleWithAgent(f.ctx, f.request, CONFIG, new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'correction-unavailable' } })
    expect(f.start).not.toHaveBeenCalled()
    expect(f.saveImage).not.toHaveBeenCalled()
  })

  it('enforces whole-text and aggregate image limits before starting a model request', async () => {
    const f = fixture()
    expect(await correctExampleWithAgent(f.ctx, f.request, { ...CONFIG, maxExampleCorrectionCharacters: 1 }, new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'correction-too-large' } })
    f.limits.maxMessageImageBytes = 1
    expect(await correctExampleWithAgent(f.ctx, f.request, CONFIG, new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'correction-too-large' } })
    expect(f.start).not.toHaveBeenCalled()
  })

  it.each(['timeout', 'dispose'])('settles and disposes the child after %s', async (cause) => {
    const f = fixture()
    f.start.mockImplementation(async (_provider, request) => ({
      result: new Promise((resolve) =>{  request.signal.addEventListener('abort', () => {
        resolve({ stopReason: 'aborted', structured: undefined })
      }, { once: true }) }),
      dispose: f.dispose,
    }))
    const lifetime = new AbortController()
    const pending = correctExampleWithAgent(f.ctx, f.request, { ...CONFIG, exampleCorrectionTimeoutMs: cause === 'timeout' ? 30 : 30_000 }, lifetime.signal)
    await vi.waitFor(() => { expect(f.start).toHaveBeenCalledOnce() })
    if (cause === 'dispose') lifetime.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: cause === 'dispose' ? 'disposed' : 'correction-failed' } })
    expect(f.dispose).toHaveBeenCalledOnce()
  })
})
