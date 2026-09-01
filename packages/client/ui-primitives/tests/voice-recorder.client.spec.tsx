// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  blobToBase64,
  useVoiceRecorder,
  VOICE_SILENCE_TIMEOUT_MS,
  type VoiceRecorderOptions,
} from '../src/useVoiceRecorder.ts'

const originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices')

class RecorderDouble {
  static instances: RecorderDouble[] = []
  static supported = new Set<string>(['audio/webm;codecs=opus'])
  static outputMimeType: string | undefined
  static isTypeSupported(mediaType: string): boolean {
    return RecorderDouble.supported.has(mediaType)
  }

  readonly mimeType: string
  readonly options: MediaRecorderOptions | undefined
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event & { readonly error: DOMException }) => void) | null = null
  onstop: (() => void) | null = null
  start = vi.fn(() => { this.state = 'recording' })
  stop = vi.fn(() => { this.state = 'inactive' })

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.options = options
    this.mimeType = RecorderDouble.outputMimeType ?? options?.mimeType ?? 'audio/webm'
    RecorderDouble.instances.push(this)
  }

  data(bytes: Uint8Array, type = this.mimeType): void {
    const blobBytes = new Uint8Array(bytes.byteLength)
    blobBytes.set(bytes)
    this.ondataavailable?.({ data: new Blob([blobBytes], { type }) } as BlobEvent)
  }

  finish(): void {
    this.state = 'inactive'
    this.onstop?.()
  }

  fail(name: string): void {
    this.onerror?.({ error: { name } } as never)
  }
}

class AudioMeterDouble {
  static instances: AudioMeterDouble[] = []
  static failConstruction = false
  static failSetup = false
  static failClose = false
  static resumeResult: Promise<void> | undefined

  amplitude = 0
  readonly analyser = {
    fftSize: 256,
    smoothingTimeConstant: 0,
    getByteTimeDomainData: vi.fn((samples: Uint8Array) => {
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = 128 + (index % 2 === 0 ? this.amplitude : -this.amplitude)
      }
    }),
  }
  readonly source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  readonly resume = vi.fn(() => AudioMeterDouble.resumeResult ?? Promise.resolve())
  readonly close = vi.fn(() => AudioMeterDouble.failClose
    ? Promise.reject(new Error('close failed'))
    : Promise.resolve())

  constructor() {
    if (AudioMeterDouble.failConstruction) throw new Error('construction failed')
    AudioMeterDouble.instances.push(this)
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    if (AudioMeterDouble.failSetup) throw new Error('setup failed')
    return this.source as unknown as MediaStreamAudioSourceNode
  }

  createAnalyser(): AnalyserNode {
    return this.analyser as unknown as AnalyserNode
  }
}

function installRecorder(getUserMedia?: () => Promise<MediaStream>) {
  RecorderDouble.instances = []
  RecorderDouble.supported = new Set(['audio/webm;codecs=opus'])
  RecorderDouble.outputMimeType = undefined
  vi.stubGlobal('MediaRecorder', RecorderDouble)
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  const capture = vi.fn(getUserMedia ?? (async () => stream))
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: capture },
  })
  return { capture, stopTrack, stream }
}

function options(overrides: Partial<VoiceRecorderOptions> = {}): VoiceRecorderOptions {
  return {
    transcribe: vi.fn(async () => 'transcript'),
    onTranscript: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

async function start(result: { current: ReturnType<typeof useVoiceRecorder> }): Promise<RecorderDouble> {
  await act(async () => { await result.current.start() })
  return RecorderDouble.instances.at(-1)!
}

async function finish(
  recorder: RecorderDouble,
  bytes = Uint8Array.of(1),
  type?: string,
): Promise<void> {
  await act(async () => {
    recorder.data(bytes, type)
    recorder.finish()
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  RecorderDouble.instances = []
  AudioMeterDouble.instances = []
  AudioMeterDouble.failConstruction = false
  AudioMeterDouble.failSetup = false
  AudioMeterDouble.failClose = false
  AudioMeterDouble.resumeResult = undefined
  if (originalMediaDevices === undefined) Reflect.deleteProperty(window.navigator, 'mediaDevices')
  else Object.defineProperty(window.navigator, 'mediaDevices', originalMediaDevices)
})

describe('useVoiceRecorder', () => {
  it('records, chooses a supported type, ignores duplicate starts, and toggles stop', async () => {
    const { capture, stopTrack } = installRecorder()
    RecorderDouble.supported = new Set(['audio/ogg;codecs=opus'])
    const props = options()
    const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })
    expect(hook.result.current.supported).toBe(true)
    act(() => { hook.result.current.stop() })

    const recorder = await start(hook.result)
    expect(recorder.options).toEqual({ mimeType: 'audio/ogg;codecs=opus' })
    expect(hook.result.current.listening).toBe(true)
    await act(async () => { await hook.result.current.start() })
    expect(capture).toHaveBeenCalledOnce()
    recorder.data(new Uint8Array())
    recorder.data(Uint8Array.of(1, 2))
    act(() => { hook.result.current.toggle() })
    expect(recorder.stop).toHaveBeenCalledOnce()
    await act(async () => { recorder.finish(); await Promise.resolve() })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(props.transcribe).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/ogg;codecs=opus' }))
    expect(props.onTranscript).toHaveBeenCalledWith('transcript')
    expect(hook.result.current.transcribing).toBe(false)
  })

  it('tracks microphone level and stops after three seconds of silence', async () => {
    vi.useFakeTimers()
    try {
      const { stopTrack } = installRecorder()
      RecorderDouble.supported = new Set(['audio/wav'])
      vi.stubGlobal('AudioContext', AudioMeterDouble)
      const props = options()
      const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })
      const recorder = await start(hook.result)
      const audioMeter = AudioMeterDouble.instances[0]!
      expect(audioMeter.source.connect).toHaveBeenCalledWith(audioMeter.analyser)
      expect(hook.result.current.level).toBe(0)

      audioMeter.amplitude = 20
      act(() => { vi.advanceTimersByTime(100) })
      expect(hook.result.current.level).toBeGreaterThan(0.8)

      audioMeter.amplitude = 0
      act(() => { vi.advanceTimersByTime(VOICE_SILENCE_TIMEOUT_MS - 1) })
      expect(recorder.stop).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(recorder.stop).toHaveBeenCalledOnce()
      expect(audioMeter.source.disconnect).toHaveBeenCalledOnce()
      expect(audioMeter.close).toHaveBeenCalledOnce()
      expect(hook.result.current.level).toBe(0)

      await finish(recorder)
      expect(stopTrack).toHaveBeenCalledOnce()
      expect(props.transcribe).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/wav' }))
      expect(props.onTranscript).toHaveBeenCalledWith('transcript')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps recording available when optional Web Audio metering fails', async () => {
    installRecorder()
    RecorderDouble.supported = new Set(['audio/wav'])
    vi.stubGlobal('AudioContext', AudioMeterDouble)

    AudioMeterDouble.failConstruction = true
    const constructionProps = options()
    const construction = renderHook(current => useVoiceRecorder(current), { initialProps: constructionProps })
    const constructionRecorder = await start(construction.result)
    expect(construction.result.current.listening).toBe(true)
    act(() => { construction.result.current.stop() })
    await finish(constructionRecorder)
    expect(constructionProps.onTranscript).toHaveBeenCalledWith('transcript')
    construction.unmount()

    AudioMeterDouble.failConstruction = false
    AudioMeterDouble.failSetup = true
    AudioMeterDouble.failClose = true
    const setupProps = options()
    const setup = renderHook(current => useVoiceRecorder(current), { initialProps: setupProps })
    const setupRecorder = await start(setup.result)
    expect(AudioMeterDouble.instances.at(-1)?.close).toHaveBeenCalledOnce()
    act(() => { setup.result.current.stop() })
    await finish(setupRecorder)
    expect(setupProps.onTranscript).toHaveBeenCalledWith('transcript')
    setup.unmount()

    AudioMeterDouble.failSetup = false
    AudioMeterDouble.failClose = false
    AudioMeterDouble.resumeResult = Promise.reject(new Error('resume failed'))
    const rejected = renderHook(current => useVoiceRecorder(current), { initialProps: options() })
    const rejectedRecorder = await start(rejected.result)
    await act(async () => { await Promise.resolve() })
    expect(AudioMeterDouble.instances.at(-1)?.source.disconnect).toHaveBeenCalledOnce()
    act(() => { rejected.result.current.stop() })
    await finish(rejectedRecorder)
    rejected.unmount()

    let rejectResume: ((error: unknown) => void) | undefined
    AudioMeterDouble.resumeResult = new Promise<void>((_resolve, reject) => { rejectResume = reject })
    const stale = renderHook(current => useVoiceRecorder(current), { initialProps: options() })
    const staleRecorder = await start(stale.result)
    const staleMeter = AudioMeterDouble.instances.at(-1)!
    act(() => { stale.result.current.stop() })
    rejectResume?.(new Error('late resume failure'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(staleMeter.source.disconnect).toHaveBeenCalledOnce()
    await finish(staleRecorder)
    stale.unmount()
  })

  it('reports empty audio and honors a callback removed during recording', async () => {
    installRecorder()
    const props = options()
    const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })
    const empty = await start(hook.result)
    await act(async () => { empty.finish(); await Promise.resolve() })
    expect(props.onError).toHaveBeenCalledWith('no-speech')

    const second = await start(hook.result)
    hook.rerender({ ...props, transcribe: undefined })
    await finish(second)
    expect(props.transcribe).not.toHaveBeenCalled()
    expect(hook.result.current.supported).toBe(false)
    await act(async () => { await hook.result.current.start() })
    expect(RecorderDouble.instances).toHaveLength(2)
  })

  it('normalizes successful text and contains empty and rejected transcripts', async () => {
    installRecorder()
    const named = Object.assign(new Error('offline'), { name: 'provider-failure' })
    const transcribe = vi.fn()
      .mockResolvedValueOnce('  normalized  ')
      .mockResolvedValueOnce('   ')
      .mockRejectedValueOnce(named)
      .mockRejectedValueOnce('opaque')
      .mockRejectedValueOnce({ name: '' })
      .mockRejectedValueOnce({ name: 42 })
    const props = options({ transcribe })
    const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })

    for (let index = 0; index < 6; index += 1) {
      await finish(await start(hook.result))
    }
    expect(props.onTranscript).toHaveBeenCalledWith('normalized')
    expect(props.onError).toHaveBeenNthCalledWith(1, 'empty-result')
    expect(props.onError).toHaveBeenNthCalledWith(2, 'provider-failure')
    expect(props.onError).toHaveBeenNthCalledWith(3, 'transcription-failed')
    expect(props.onError).toHaveBeenNthCalledWith(4, 'transcription-failed')
    expect(props.onError).toHaveBeenNthCalledWith(5, 'transcription-failed')
  })

  it('contains recorder and microphone-start errors and ignores stale recorder events', async () => {
    const { stopTrack } = installRecorder()
    const props = options()
    const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })
    const recorder = await start(hook.result)
    const staleError = recorder.onerror!
    const staleStop = recorder.onstop!
    act(() => { recorder.fail('') })
    expect(props.onError).toHaveBeenCalledWith('recording-failed')
    expect(stopTrack).toHaveBeenCalledOnce()
    act(() => {
      staleError({ error: { name: 'ignored' } } as never)
      staleStop()
    })
    expect(props.onError).toHaveBeenCalledTimes(1)

    const withoutDetails = await start(hook.result)
    act(() => { withoutDetails.onerror?.(new Event('error') as never) })
    expect(props.onError).toHaveBeenNthCalledWith(2, 'recording-failed')
    expect(stopTrack).toHaveBeenCalledTimes(2)

    hook.unmount()
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const named = installRecorder(() => Promise.reject(denied))
    const namedHook = renderHook(current => useVoiceRecorder(current), { initialProps: options() })
    await act(async () => { await namedHook.result.current.start() })
    expect(namedHook.result.current.listening).toBe(false)
    namedHook.unmount()

    const opaque = Object.assign(new Error('opaque'), { name: '' })
    installRecorder(() => Promise.reject(opaque))
    const opaqueProps = options()
    const opaqueHook = renderHook(current => useVoiceRecorder(current), { initialProps: opaqueProps })
    await act(async () => { await opaqueHook.result.current.start() })
    expect(opaqueProps.onError).toHaveBeenCalledWith('start-failed')
    expect(named.capture).toHaveBeenCalledOnce()
  })

  it('releases a permission result and resolved transcription after unmount', async () => {
    let resolveCapture: ((stream: MediaStream) => void) | undefined
    const stopTrack = vi.fn()
    const pendingCapture = new Promise<MediaStream>((resolve) => { resolveCapture = resolve })
    installRecorder(() => pendingCapture)
    const props = options()
    const pending = renderHook(current => useVoiceRecorder(current), { initialProps: props })
    act(() => { pending.result.current.toggle() })
    expect(pending.result.current.starting).toBe(true)
    act(() => { pending.result.current.toggle() })
    pending.unmount()
    resolveCapture?.({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
    await act(async () => { await pendingCapture })
    expect(stopTrack).toHaveBeenCalledOnce()

    let rejectCapture: ((error: unknown) => void) | undefined
    const rejectedCapture = new Promise<MediaStream>((_resolve, reject) => { rejectCapture = reject })
    installRecorder(() => rejectedCapture)
    const rejectedProps = options()
    const rejected = renderHook(current => useVoiceRecorder(current), { initialProps: rejectedProps })
    act(() => { rejected.result.current.toggle() })
    rejected.unmount()
    rejectCapture?.(new Error('late rejection'))
    await expect(rejectedCapture).rejects.toThrow('late rejection')
    expect(rejectedProps.onError).not.toHaveBeenCalled()

    installRecorder()
    let resolveTranscript: ((text: string) => void) | undefined
    const transcript = new Promise<string>((resolve) => { resolveTranscript = resolve })
    const transcribe = vi.fn(() => transcript)
    const settledProps = options({ transcribe })
    const settled = renderHook(current => useVoiceRecorder(current), { initialProps: settledProps })
    const recorder = await start(settled.result)
    await act(async () => { recorder.data(Uint8Array.of(1)); recorder.finish(); await Promise.resolve() })
    expect(settled.result.current.transcribing).toBe(true)
    settled.unmount()
    resolveTranscript?.('late')
    await act(async () => { await transcript })
    expect(settledProps.onTranscript).not.toHaveBeenCalled()

    installRecorder()
    let rejectTranscript: ((error: unknown) => void) | undefined
    const rejectedTranscript = new Promise<string>((_resolve, reject) => { rejectTranscript = reject })
    const rejectedTranscriptProps = options({ transcribe: vi.fn(() => rejectedTranscript) })
    const rejectedTranscriptHook = renderHook(current => useVoiceRecorder(current), {
      initialProps: rejectedTranscriptProps,
    })
    const rejectedRecorder = await start(rejectedTranscriptHook.result)
    await act(async () => {
      rejectedRecorder.data(Uint8Array.of(1))
      rejectedRecorder.finish()
      await Promise.resolve()
    })
    rejectedTranscriptHook.unmount()
    rejectTranscript?.(new Error('late transcript failure'))
    await expect(rejectedTranscript).rejects.toThrow('late transcript failure')
    expect(rejectedTranscriptProps.onError).not.toHaveBeenCalled()
  })

  it('uses every safe recording MIME fallback and stops an active recorder on unmount', async () => {
    const { stopTrack } = installRecorder()
    const props = options()
    const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })

    RecorderDouble.outputMimeType = ''
    const fromPart = await start(hook.result)
    await finish(fromPart, Uint8Array.of(1), 'audio/wav')
    expect(props.transcribe).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'audio/wav' }))

    const fromPreference = await start(hook.result)
    await finish(fromPreference, Uint8Array.of(1), '')
    expect(props.transcribe).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'audio/webm;codecs=opus' }))

    RecorderDouble.supported.clear()
    const fromDefault = await start(hook.result)
    expect(fromDefault.options).toBeUndefined()
    await finish(fromDefault, Uint8Array.of(1), '')
    expect(props.transcribe).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'audio/webm' }))

    const active = await start(hook.result)
    hook.unmount()
    expect(active.stop).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalledTimes(4)
    expect(active.onstop).toBeNull()

    installRecorder()
    const inactive = renderHook(current => useVoiceRecorder(current), { initialProps: options() })
    const inactiveRecorder = await start(inactive.result)
    inactiveRecorder.state = 'inactive'
    inactive.unmount()
    expect(inactiveRecorder.stop).not.toHaveBeenCalled()
  })

  it('supports a MediaRecorder constructor without isTypeSupported', async () => {
    const { stream } = installRecorder()
    class MinimalRecorder extends RecorderDouble {}
    Object.defineProperty(MinimalRecorder, 'isTypeSupported', { configurable: true, value: undefined })
    vi.stubGlobal('MediaRecorder', MinimalRecorder)
    const props = options()
    const hook = renderHook(current => useVoiceRecorder(current), { initialProps: props })
    await act(async () => { await hook.result.current.start() })
    const recorder = RecorderDouble.instances.at(-1)!
    expect(recorder.options).toBeUndefined()
    expect(stream.getTracks()).toHaveLength(1)
  })

  it('reports unsupported combinations and does not toggle while transcribing', async () => {
    const transcribe = vi.fn(async () => 'ok')
    const unsupported = renderHook(current => useVoiceRecorder(current), {
      initialProps: options({ transcribe: undefined }),
    })
    expect(unsupported.result.current.supported).toBe(false)
    act(() => { unsupported.result.current.toggle() })

    installRecorder()
    let resolveTranscript: ((text: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { resolveTranscript = resolve })
    const hook = renderHook(current => useVoiceRecorder(current), {
      initialProps: options({ transcribe: vi.fn(() => pending) }),
    })
    await finish(await start(hook.result))
    expect(hook.result.current.transcribing).toBe(true)
    act(() => { hook.result.current.toggle() })
    expect(RecorderDouble.instances).toHaveLength(1)
    await act(async () => { resolveTranscript?.('done'); await pending })
    expect(hook.result.current.transcribing).toBe(false)
    expect(transcribe).not.toHaveBeenCalled()
  })
})

describe('blobToBase64', () => {
  it('encodes empty and multi-chunk browser Blobs canonically', async () => {
    await expect(blobToBase64(new Blob())).resolves.toBe('')
    const bytes = new Uint8Array(40_000)
    bytes[0] = 1
    bytes[39_999] = 2
    await expect(blobToBase64(new Blob([bytes]))).resolves.toBe(Buffer.from(bytes).toString('base64'))
  })
})
