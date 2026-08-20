import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import OcrRuntime, { OcrError, type OcrProvider } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
})

async function harness(config: ConstructorParameters<typeof OcrRuntime>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(OcrRuntime, config)
  contexts.push(ctx)
  return { ctx, ocr: ctx.ocr }
}

function provider(id: string, available = true): OcrProvider {
  return {
    id,
    available: () => available,
    extract: request => Promise.resolve({
      name: request.name,
      mediaType: request.mediaType,
      markdown: `content:${id}`,
      provider: id,
      truncated: false,
    }),
    extractLayout: request => Promise.resolve({
      name: request.name,
      provider: id,
      pages: [{ pageIndex: 0, width: 100, height: 200, elements: [] }],
    }),
  }
}

const request = { name: 'calendar.png', mediaType: 'image/png', contentBase64: 'YQ==' }

describe('OcrRuntime', () => {
  it('auto-selects one usable provider and returns its normalized result', async () => {
    const { ocr } = await harness()
    ocr.registerProvider(provider('mineru'))
    await expect(ocr.extract(request)).resolves.toMatchObject({
      ok: true,
      value: { markdown: 'content:mineru', provider: 'mineru' },
    })
  })

  it('returns stable unavailable failures for missing and ambiguous providers', async () => {
    const empty = await harness()
    await expect(empty.ocr.extract(request)).resolves.toMatchObject({ ok: false, error: { code: 'provider-unavailable' } })

    const ambiguous = await harness()
    ambiguous.ocr.registerProvider(provider('a'))
    ambiguous.ocr.registerProvider(provider('b'))
    await expect(ambiguous.ocr.extract(request)).resolves.toMatchObject({ ok: false, error: { code: 'provider-unavailable' } })
  })

  it('routes structured layout extraction through the selected provider', async () => {
    const { ocr } = await harness({ provider: 'mineru' })
    ocr.registerProvider(provider('mineru'))
    await expect(ocr.layout({ ...request, pageRange: { start: 1, end: 2 } })).resolves.toEqual({
      ok: true,
      value: {
        name: 'calendar.png',
        provider: 'mineru',
        pages: [{ pageIndex: 0, width: 100, height: 200, elements: [] }],
      },
    })
  })

  it('uses explicit provider selection and contains provider errors', async () => {
    const selected = await harness({ provider: 'mineru' })
    selected.ocr.registerProvider(provider('other'))
    selected.ocr.registerProvider({
      ...provider('mineru'),
      extract: () => Promise.reject(new OcrError('too large', 'file-too-large')),
    })
    await expect(selected.ocr.extract(request)).resolves.toEqual({
      ok: false,
      error: { code: 'file-too-large', message: 'too large' },
    })

    const opaque = await harness()
    opaque.ocr.registerProvider({
      ...provider('mineru'),
      extract: () => Promise.reject(new Error('internal secret')),
    })
    await expect(opaque.ocr.extract(request)).resolves.toEqual({
      ok: false,
      error: { code: 'provider-failure', message: 'document extraction failed' },
    })
  })

  it('rejects duplicate provider ids and unregisters through the disposer', async () => {
    const { ocr } = await harness()
    expect(() => ocr.registerProvider(provider('Bad Provider'))).toThrow('must use lower-case')
    const dispose = ocr.registerProvider(provider('mineru'))
    expect(() => ocr.registerProvider(provider('mineru'))).toThrow('already registered')
    dispose()
    await expect(ocr.extract(request)).resolves.toMatchObject({ ok: false, error: { code: 'provider-unavailable' } })
  })
})
