import { describe, expect, it, vi } from 'vitest'
import { OcrError } from '@deepseek-ai/dsh-ocr'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { Config as ConfigSchema, MinerUProvider, type Config } from '../src/index.ts'

const config = (overrides: Partial<Config> = {}): Config => ({
  endpoint: 'http://127.0.0.1:8000/file_parse',
  backend: 'pipeline',
  effort: 'high',
  language: 'ch',
  timeoutMs: 10_000,
  maxFileBytes: 1024,
  maxOutputCharacters: 1000,
  maxResponseBytes: 16_384,
  layoutBatchPages: 4,
  ...overrides,
})

const request = (overrides: Partial<Parameters<MinerUProvider['extract']>[0]> = {}) => ({
  name: 'calendar.png',
  mediaType: 'image/png',
  contentBase64: Buffer.from('image bytes').toString('base64'),
  ...overrides,
})

describe('MinerUProvider', () => {
  it('advertises the current upload and layout batch limits', () => {
    const provider = new MinerUProvider(config({ maxFileBytes: 4096, layoutBatchPages: 7 }))

    expect(provider.layoutLimits()).toEqual({ maxFileBytes: 4096, maxPagesPerRequest: 7 })
  })

  it('uploads MinerU multipart fields and returns Markdown', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.get('backend')).toBe('pipeline')
      expect(form.get('effort')).toBe('high')
      expect(form.get('lang_list')).toBe('ch')
      expect(form.get('return_md')).toBe('true')
      const file = form.get('files') as File
      expect(file.name).toBe('calendar.png')
      expect(await file.text()).toBe('image bytes')
      return Response.json({ backend: 'pipeline', version: '3', results: { calendar: { md_content: '# Calendar' } } })
    })
    const provider = new MinerUProvider(config(), fetch)
    await expect(provider.extract(request())).resolves.toEqual({
      name: 'calendar.png',
      mediaType: 'image/png',
      markdown: '# Calendar',
      provider: 'mineru',
      truncated: false,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('prepends requested discarded text without duplicating Markdown content', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.get('return_md')).toBe('true')
      expect(form.get('return_middle_json')).toBe('true')
      return Response.json({
        results: {
          timetable: {
            md_content: '<table><tr><td>第一节</td></tr></table>',
            middle_json: JSON.stringify({
              pdf_info: [{
                page_idx: 0,
                page_size: [720, 405],
                discarded_blocks: [
                  { type: 'text', lines: [{ spans: [{ type: 'text', content: '高三年' }] }] },
                  { type: 'text', lines: [{ spans: [{ type: 'text', content: '第一节' }] }] },
                ],
              }],
            }),
          },
        },
      })
    })
    const provider = new MinerUProvider(config(), fetch)

    await expect(provider.extract(request({ includeDiscardedText: true }))).resolves.toMatchObject({
      markdown: '高三年\n\n<table><tr><td>第一节</td></tr></table>',
      truncated: false,
    })
  })

  it('cross-checks raster detail with one enhanced whole image and six overlapping regions', async () => {
    const bytes = await sharp({
      create: { width: 60, height: 30, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('files') as File
      expect(file.name).toMatch(/\.detail-\d+\.png$/u)
      return Response.json({ results: { timetable: { md_content: `content-${String(fetch.mock.calls.length)}` } } })
    })
    const provider = new MinerUProvider(config({ maxFileBytes: 10_000, maxOutputCharacters: 10_000 }), fetch)

    const result = await provider.extract(request({
      contentBase64: bytes.toString('base64'),
      enhanceImageDetail: true,
    }))
    expect(result.markdown).toContain('## OCR pass: enhanced whole image')
    expect(result.truncated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(7)
  })

  it('requests middle JSON and normalizes line and image coordinates', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.get('return_md')).toBe('false')
      expect(form.get('return_middle_json')).toBe('true')
      expect(form.get('start_page_id')).toBe('2')
      expect(form.get('end_page_id')).toBe('3')
      return Response.json({
        results: {
          paper: {
            middle_json: JSON.stringify({
              pdf_info: [{
                page_idx: 0,
                page_size: [720, 405],
                para_blocks: [
                  { type: 'text', lines: [{ bbox: [40, 50, 300, 80], spans: [
                    { type: 'text', content: '1. 已知 ' },
                    { type: 'inline_equation', content: 'x=1' },
                  ] }] },
                  { type: 'image', bbox: [60, 90, 400, 300] },
                ],
              }],
            }),
          },
        },
      })
    })
    const provider = new MinerUProvider(config(), fetch)
    await expect(provider.extractLayout({ ...request({ name: 'paper.pdf', mediaType: 'application/pdf' }), pageRange: { start: 2, end: 3 } }))
      .resolves.toEqual({
        name: 'paper.pdf',
        provider: 'mineru',
        pages: [{
          pageIndex: 2,
          width: 720,
          height: 405,
          elements: [
            { type: 'text', text: '1. 已知 x=1', bbox: [40, 50, 300, 80] },
            { type: 'image', text: '', bbox: [60, 90, 400, 300] },
          ],
        }],
      })
  })

  it('splits a large layout page range into bounded MinerU requests and restores source indexes', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      const start = Number(form.get('start_page_id'))
      const end = Number(form.get('end_page_id'))
      return Response.json({
        results: {
          paper: {
            middle_json: JSON.stringify({
              pdf_info: Array.from({ length: end - start + 1 }, (_, pageIndex) => ({
                page_idx: pageIndex,
                page_size: [720, 405],
                para_blocks: [],
              })),
            }),
          },
        },
      })
    })
    const provider = new MinerUProvider(config({ layoutBatchPages: 4 }), fetch)

    const result = await provider.extractLayout({
      ...request({ name: 'paper.pdf', mediaType: 'application/pdf' }),
      pageRange: { start: 0, end: 9 },
    })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map((call) => {
      const form = call[1]?.body as FormData
      return [form.get('start_page_id'), form.get('end_page_id')]
    })).toEqual([['0', '3'], ['4', '7'], ['8', '9']])
    expect(result.pages.map(page => page.pageIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('repairs cross-page paragraph lines with targeted single-page layout requests', async () => {
    const line = (text: string, bbox: [number, number, number, number]) => ({
      bbox,
      spans: [{ type: 'text', content: text }],
    })
    const response = (pdfInfo: readonly unknown[]) => Response.json({
      results: { paper: { middle_json: JSON.stringify({ pdf_info: pdfInfo }) } },
    })
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      const start = form.get('start_page_id')
      if (start === '0') {
        return response([{
          page_idx: 0,
          page_size: [100, 100],
          para_blocks: [{
            type: 'text', bbox: [10, 70, 90, 90], lines: [line('[题1] 第一页', [10, 72, 90, 88])],
          }],
        }])
      }
      if (start === '1') {
        return response([{
          page_idx: 0,
          page_size: [100, 100],
          para_blocks: [
            { type: 'text', bbox: [10, 10, 90, 30], lines: [line('[题2] 第二页', [10, 12, 90, 28])] },
            { type: 'text', bbox: [10, 40, 90, 60], lines: [line('后续正文', [10, 42, 90, 58])] },
          ],
        }])
      }
      return response([{
        page_idx: 0,
        page_size: [100, 100],
        para_blocks: [{
          type: 'text',
          bbox: [10, 70, 90, 90],
          lines: [
            line('[题1] 第一页', [10, 72, 90, 88]),
            line('[题2] 错挂到上一页', [10, 12, 90, 28]),
          ],
        }],
        preproc_blocks: [{
          type: 'text', bbox: [10, 70, 90, 90], lines: [line('[题1] 第一页', [10, 72, 90, 88])],
        }],
      }, {
        page_idx: 1,
        page_size: [100, 100],
        para_blocks: [
          { type: 'text', bbox: [10, 10, 90, 30], lines_deleted: true, lines: [] },
          { type: 'text', bbox: [10, 40, 90, 60], lines: [line('后续正文', [10, 42, 90, 58])] },
        ],
        preproc_blocks: [
          { type: 'text', bbox: [10, 10, 90, 30], lines: [line('[题2] 第二页', [10, 12, 90, 28])] },
          { type: 'text', bbox: [10, 40, 90, 60], lines: [line('后续正文', [10, 42, 90, 58])] },
        ],
      }])
    })
    const provider = new MinerUProvider(config(), fetch)

    const result = await provider.extractLayout(request({ name: 'paper.pdf', mediaType: 'application/pdf' }))

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.slice(1).map((call) => {
      const form = call[1]?.body as FormData
      return [form.get('start_page_id'), form.get('end_page_id')]
    })).toEqual([['0', '0'], ['1', '1']])
    expect(result.pages.map(page => page.elements.map(element => element.text))).toEqual([
      ['[题1] 第一页'],
      ['[题2] 第二页', '后续正文'],
    ])
  })

  it('recovers a missing numbered question from isolated landscape columns', async () => {
    const line = (text: string, bbox: [number, number, number, number]) => ({
      bbox,
      spans: [{ type: 'text', content: text }],
    })
    const response = (pageSize: [number, number], blocks: readonly unknown[]) => Response.json({
      results: { paper: { middle_json: JSON.stringify({
        pdf_info: [{ page_idx: 0, page_size: pageSize, para_blocks: blocks }],
      }) } },
    })
    const block = (text: string, bbox: [number, number, number, number]) => ({
      type: 'text', bbox, lines: [line(text, bbox)],
    })
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const file = (init?.body as FormData).get('files') as File
      if (file.name.endsWith('-left.pdf')) {
        return response([50, 60], [
          block('1. left first', [5, 5, 45, 15]),
          block('2. recovered', [5, 25, 45, 35]),
        ])
      }
      if (file.name.endsWith('-right.pdf')) {
        return response([50, 60], [block('3. right third', [5, 5, 45, 15])])
      }
      return response([100, 60], [
        block('1. corrupted across columns', [5, 5, 95, 15]),
        block('3. right third', [55, 25, 95, 35]),
      ])
    })
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 60])
    const bytes = await pdf.save()
    const provider = new MinerUProvider(config({ maxFileBytes: 100_000 }), fetch)

    const result = await provider.extractLayout({
      name: 'paper.pdf',
      mediaType: 'application/pdf',
      contentBase64: Buffer.from(bytes).toString('base64'),
    })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result.pages[0]?.elements).toEqual([
      { type: 'text', text: '1. left first', bbox: [5, 5, 45, 15] },
      { type: 'text', text: '2. recovered', bbox: [5, 25, 45, 35] },
      { type: 'text', text: '3. right third', bbox: [55, 25, 95, 35] },
    ])
  })

  it('infers a supported extension from media type and truncates output', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.body as FormData).get('files')).toMatchObject({ name: 'calendar.xlsx' })
      return Response.json({ results: { calendar: { md_content: '123456' } } })
    })
    const provider = new MinerUProvider(config({ maxOutputCharacters: 4 }), fetch)
    await expect(provider.extract(request({
      name: 'calendar',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))).resolves.toMatchObject({ markdown: '1234', truncated: true })
  })

  it('snapshots live settings at the start of each extraction', async () => {
    let active = config()
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(input).toBe('http://mineru.test/file_parse')
      expect((init?.body as FormData).get('backend')).toBe('hybrid-engine')
      return Response.json({ results: { calendar: { md_content: '# Calendar' } } })
    })
    const provider = new MinerUProvider(() => active, fetch)
    active = config({ endpoint: 'http://mineru.test/file_parse', backend: 'hybrid-engine' })

    await provider.extract(request())

    expect(fetch).toHaveBeenCalledOnce()
  })

  it('accepts only MinerU public local backends and OCR model languages', () => {
    expect(ConfigSchema(config({ backend: 'vlm-engine', effort: 'medium', language: 'korean' }))).toMatchObject({
      backend: 'vlm-engine',
      effort: 'medium',
      language: 'korean',
    })
    expect(() => ConfigSchema({ backend: 'vlm-http-client' } as unknown as Config)).toThrow()
    expect(() => ConfigSchema({ effort: 'low' } as unknown as Config)).toThrow()
    expect(() => ConfigSchema({ language: 'en' } as unknown as Config)).toThrow()
  })

  it('rejects unsupported, oversized, malformed, and empty requests before fetch', async () => {
    const fetch = vi.fn()
    const provider = new MinerUProvider(config({ maxFileBytes: 4 }), fetch)
    await expect(provider.extract(request({ name: 'calendar.txt' }))).rejects.toMatchObject({ code: 'file-too-large' } satisfies Partial<OcrError>)
    await expect(provider.extract(request({ contentBase64: '***' }))).rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<OcrError>)
    await expect(provider.extract(request({ contentBase64: 'YR==' }))).rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<OcrError>)
    await expect(provider.extract(request({ contentBase64: '', name: 'calendar.png' }))).rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<OcrError>)
    const formatProvider = new MinerUProvider(config(), fetch)
    await expect(formatProvider.extract(request({ name: 'calendar.txt' }))).rejects.toMatchObject({ code: 'unsupported-format' } satisfies Partial<OcrError>)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates multi-megabyte canonical base64 without recursive regular-expression matching', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({
      results: { paper: { md_content: '# Paper' } },
    })))
    const bytes = Buffer.alloc(4 * 1024 * 1024, 0x61)
    const provider = new MinerUProvider(config({ maxFileBytes: 5 * 1024 * 1024 }), fetch)

    await expect(provider.extract(request({
      name: 'paper.pdf',
      mediaType: 'application/pdf',
      contentBase64: bytes.toString('base64'),
    }))).resolves.toMatchObject({ markdown: '# Paper' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects an invalid structured page range before fetch', async () => {
    const fetch = vi.fn()
    const provider = new MinerUProvider(config(), fetch)
    await expect(provider.extractLayout({ ...request(), pageRange: { start: 2, end: 1 } }))
      .rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<OcrError>)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('contains network and response failures in the provider taxonomy', async () => {
    const offline = new MinerUProvider(config(), () => Promise.reject(new Error('offline')))
    await expect(offline.extract(request())).rejects.toMatchObject({ code: 'provider-unavailable' } satisfies Partial<OcrError>)

    const invalid = new MinerUProvider(config(), () => Promise.resolve(new Response('not json')))
    await expect(invalid.extract(request())).rejects.toMatchObject({ code: 'invalid-response' } satisfies Partial<OcrError>)

    const empty = new MinerUProvider(config(), () => Promise.resolve(Response.json({ results: { calendar: {} } })))
    await expect(empty.extract(request())).rejects.toMatchObject({ code: 'empty-result' } satisfies Partial<OcrError>)

    const oversized = new MinerUProvider(config({ maxResponseBytes: 4 }), () => Promise.resolve(new Response('12345')))
    await expect(oversized.extract(request())).rejects.toMatchObject({ code: 'invalid-response' } satisfies Partial<OcrError>)
  })
})
