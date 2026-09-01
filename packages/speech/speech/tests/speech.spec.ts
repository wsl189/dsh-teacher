import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpeechRuntime, { SpeechError, type SpeechProvider } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
})

async function harness(config: ConstructorParameters<typeof SpeechRuntime>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(SpeechRuntime, config)
  contexts.push(ctx)
  return ctx.speech
}

function provider(id: string, available = true): SpeechProvider {
  return {
    id,
    available: () => available,
    transcribe: () => Promise.resolve({ text: `text:${id}`, provider: id }),
  }
}

const request = { mediaType: 'audio/webm;codecs=opus', contentBase64: 'YQ==' }

describe('SpeechRuntime', () => {
  it('auto-selects one usable provider', async () => {
    const speech = await harness()
    speech.registerProvider(provider('model-settings'))
    await expect(speech.transcribe(request)).resolves.toEqual({
      ok: true,
      value: { text: 'text:model-settings', provider: 'model-settings' },
    })
  })

  it('returns stable provider-selection failures', async () => {
    const empty = await harness()
    await expect(empty.transcribe(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })
    const ambiguous = await harness()
    ambiguous.registerProvider(provider('a'))
    ambiguous.registerProvider(provider('b'))
    await expect(ambiguous.transcribe(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })
    const selectedMissing = await harness({ provider: 'model-settings' })
    await expect(selectedMissing.transcribe(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })
    selectedMissing.registerProvider(provider('model-settings', false))
    await expect(selectedMissing.transcribe(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })
  })

  it('contains typed and opaque provider failures', async () => {
    const typed = await harness({ provider: 'model-settings' })
    typed.registerProvider({
      ...provider('model-settings'),
      transcribe: () => Promise.reject(new SpeechError('select a speech model', 'provider-disabled')),
    })
    await expect(typed.transcribe(request)).resolves.toEqual({
      ok: false,
      error: { code: 'provider-disabled', message: 'select a speech model' },
    })

    const opaque = await harness()
    opaque.registerProvider({
      ...provider('model-settings'),
      transcribe: () => Promise.reject(new Error('secret response')),
    })
    await expect(opaque.transcribe(request)).resolves.toEqual({
      ok: false,
      error: { code: 'provider-failure', message: 'speech transcription failed' },
    })
  })

  it('forwards same-process cancellation', async () => {
    const speech = await harness({ provider: 'model-settings' })
    const transcribe = vi.fn<SpeechProvider['transcribe']>(() =>
      Promise.resolve({ text: 'done', provider: 'model-settings' }))
    speech.registerProvider({ ...provider('model-settings'), transcribe })
    const signal = new AbortController().signal
    await expect(speech.transcribeAbortable(request, signal)).resolves.toMatchObject({ ok: true })
    expect(transcribe).toHaveBeenCalledWith(request, signal)
  })

  it('rejects duplicate ids and unregisters through the disposer', async () => {
    const speech = await harness()
    expect(() => speech.registerProvider(provider('Bad Provider'))).toThrow('must use lower-case')
    const dispose = speech.registerProvider(provider('model-settings'))
    expect(() => speech.registerProvider(provider('model-settings'))).toThrow('already registered')
    dispose()
    await expect(speech.transcribe(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-unavailable' },
    })
  })

  it('registers its explained empty invariant companion', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, installer: () => void) => {
      installer()
      return dispose
    })
    await expect(invariant.apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-speech', expect.any(Function))
  })
})
