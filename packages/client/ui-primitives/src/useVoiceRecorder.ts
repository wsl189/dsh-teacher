/** Browser microphone recording lifecycle shared by product voice-input surfaces. */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  normalizeSpeechRecording,
  type AudioDecoderConstructor,
} from './speech-recording.ts'

const PREFERRED_MEDIA_TYPES = [
  'audio/wav',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const

/** Silence window that finishes an active browser recording. */
export const VOICE_SILENCE_TIMEOUT_MS = 3_000

const VOICE_LEVEL_SAMPLE_MS = 50
const VOICE_ACTIVITY_RMS = 0.02
const VOICE_LEVEL_FLOOR_RMS = 0.006
const VOICE_LEVEL_CEILING_RMS = 0.18
const VOICE_LEVEL_UPDATE_STEP = 0.015

interface VoiceMeterSession {
  readonly context: AudioContext
  readonly source: MediaStreamAudioSourceNode
  readonly analyser: AnalyserNode
  readonly samples: Uint8Array<ArrayBuffer>
  readonly cancelTimers: () => void
}

/** Browser microphone state and controls. */
export interface VoiceRecorderController {
  /** Whether recording and the configured transcription callback are available. */
  readonly supported: boolean
  /** Whether the browser is collecting microphone audio. */
  readonly listening: boolean
  /** Whether microphone permission and recorder startup are pending. */
  readonly starting: boolean
  /** Whether the completed recording is being prepared or awaiting its transcript. */
  readonly transcribing: boolean
  /** Current microphone level from zero (silent) to one (loud). */
  readonly level: number
  /** Begin a new microphone recording. */
  start(this: void): Promise<void>
  /** Finish the active recording and start transcription. */
  stop(this: void): void
  /** Start or stop according to current state. */
  toggle(this: void): void
}

/** Voice-recorder callbacks. */
export interface VoiceRecorderOptions {
  /** Send one prepared browser recording to the product transcription service. */
  readonly transcribe: ((audio: Blob) => Promise<string>) | undefined
  /** Receive one final normalized transcript. */
  readonly onTranscript: (text: string) => void
  /** Receive a browser or service error code without recorded audio. */
  readonly onError: (code: string) => void
}

/**
 * Create one MediaRecorder controller.
 * @param options - transcription and result callbacks.
 * @returns state and controls shared by pointer and keyboard gestures.
 */
export function useVoiceRecorder(options: VoiceRecorderOptions): VoiceRecorderController {
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [level, setLevel] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const meter = useRef<VoiceMeterSession | null>(null)
  const chunks = useRef<Blob[]>([])
  const generation = useRef(0)
  const transcribeHandler = useRef(options.transcribe)
  const transcriptHandler = useRef(options.onTranscript)
  const errorHandler = useRef(options.onError)
  transcribeHandler.current = options.transcribe
  transcriptHandler.current = options.onTranscript
  errorHandler.current = options.onError

  const browser = globalThis as unknown as {
    readonly navigator?: { readonly mediaDevices?: MediaDevices }
    readonly MediaRecorder?: typeof MediaRecorder
    readonly AudioContext?: typeof AudioContext
    readonly webkitAudioContext?: typeof AudioContext
  }
  const mediaDevices = browser.navigator?.mediaDevices
  const Recorder = browser.MediaRecorder
  const AudioContextConstructor = browser.AudioContext ?? browser.webkitAudioContext
  const Decoder: AudioDecoderConstructor | undefined = AudioContextConstructor
  const supported = Recorder !== undefined
    && typeof mediaDevices?.getUserMedia === 'function'
    && options.transcribe !== undefined

  const releaseStream = useCallback((): void => {
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null
  }, [])

  const releaseMeter = useCallback((resetLevel = true): void => {
    const current = meter.current
    meter.current = null
    if (current !== null) {
      current.cancelTimers()
      current.source.disconnect()
      closeMeterContext(current.context)
    }
    if (resetLevel) setLevel(0)
  }, [])

  const stop = useCallback((): void => {
    setStarting(false)
    releaseMeter()
    const current = recorder.current
    if (current !== null && current.state !== 'inactive') current.stop()
  }, [releaseMeter])

  const startMeter = useCallback((nextStream: MediaStream): void => {
    if (AudioContextConstructor === undefined) return
    let context: AudioContext
    try {
      context = new AudioContextConstructor()
    } catch {
      return
    }
    try {
      const source = context.createMediaStreamSource(nextStream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.45
      source.connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      let silenceTimer = setTimeout(stop, VOICE_SILENCE_TIMEOUT_MS)
      const armSilenceTimer = (): void => {
        clearTimeout(silenceTimer)
        silenceTimer = setTimeout(stop, VOICE_SILENCE_TIMEOUT_MS)
      }
      const sampleTimer = setInterval(() => {
        analyser.getByteTimeDomainData(samples)
        const rms = rootMeanSquare(samples)
        const nextLevel = voiceLevel(rms)
        setLevel(previous => Math.abs(previous - nextLevel) >= VOICE_LEVEL_UPDATE_STEP
          ? nextLevel
          : previous)
        if (rms >= VOICE_ACTIVITY_RMS) armSilenceTimer()
      }, VOICE_LEVEL_SAMPLE_MS)
      const current: VoiceMeterSession = {
        context,
        source,
        analyser,
        samples,
        cancelTimers: () => {
          clearInterval(sampleTimer)
          clearTimeout(silenceTimer)
        },
      }
      meter.current = current
      void context.resume().catch(() => {
        if (meter.current === current) releaseMeter()
      })
    } catch {
      closeMeterContext(context)
    }
  }, [AudioContextConstructor, releaseMeter, stop])

  const start = useCallback(async (): Promise<void> => {
    if (!supported || recorder.current !== null || starting || transcribing) return
    const currentGeneration = generation.current + 1
    generation.current = currentGeneration
    setStarting(true)
    try {
      const nextStream = await mediaDevices.getUserMedia({ audio: true })
      if (generation.current !== currentGeneration) {
        for (const track of nextStream.getTracks()) track.stop()
        return
      }
      stream.current = nextStream
      const mimeType = preferredMediaType(Recorder)
      const next = mimeType === undefined
        ? new Recorder(nextStream)
        : new Recorder(nextStream, { mimeType })
      chunks.current = []
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data)
      }
      next.onerror = (event: Event) => {
        if (generation.current !== currentGeneration) return
        generation.current += 1
        recorder.current = null
        chunks.current = []
        releaseMeter()
        releaseStream()
        setListening(false)
        setStarting(false)
        errorHandler.current(recorderErrorName(event))
      }
      next.onstop = () => {
        if (generation.current !== currentGeneration) return
        recorder.current = null
        releaseMeter()
        releaseStream()
        setListening(false)
        const parts = chunks.current
        chunks.current = []
        const audio = new Blob(parts, {
          type: next.mimeType || parts[0]?.type || mimeType || 'audio/webm',
        })
        if (audio.size === 0) {
          errorHandler.current('no-speech')
          return
        }
        const transcribe = transcribeHandler.current
        if (transcribe === undefined) return
        setTranscribing(true)
        void normalizeSpeechRecording(audio, Decoder).then(transcribe).then((text) => {
          if (generation.current !== currentGeneration) return
          const normalized = text.trim()
          if (normalized === '') errorHandler.current('empty-result')
          else transcriptHandler.current(normalized)
        }, (error: unknown) => {
          if (generation.current !== currentGeneration) return
          errorHandler.current(errorName(error, 'transcription-failed'))
        }).finally(() => {
          if (generation.current === currentGeneration) setTranscribing(false)
        })
      }
      recorder.current = next
      next.start()
      setListening(true)
      startMeter(nextStream)
    } catch (error) {
      if (generation.current === currentGeneration) {
        recorder.current = null
        chunks.current = []
        releaseStream()
        errorHandler.current(errorName(error, 'start-failed'))
      }
    } finally {
      if (generation.current === currentGeneration) setStarting(false)
    }
  }, [Decoder, Recorder, mediaDevices, releaseMeter, releaseStream, startMeter, starting, supported, transcribing])

  const toggle = useCallback((): void => {
    if (listening || starting) stop()
    else if (!transcribing) void start()
  }, [listening, start, starting, stop, transcribing])

  useEffect(() => () => {
    generation.current += 1
    const current = recorder.current
    if (current !== null) {
      current.ondataavailable = null
      current.onerror = null
      current.onstop = null
      if (current.state !== 'inactive') current.stop()
    }
    recorder.current = null
    chunks.current = []
    releaseMeter(false)
    releaseStream()
  }, [releaseMeter, releaseStream])

  return { supported, listening, starting, transcribing, level, start, stop, toggle }
}

/**
 * Encode a browser Blob for a JSON transcription Remote.
 * @param blob - completed audio recording.
 * @returns canonical base64 without a data-URL prefix.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function preferredMediaType(Recorder: typeof MediaRecorder): string | undefined {
  if (typeof Recorder.isTypeSupported !== 'function') return undefined
  return PREFERRED_MEDIA_TYPES.find(mediaType => Recorder.isTypeSupported(mediaType))
}

function errorName(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('name' in error)) return fallback
  const { name } = error
  return typeof name === 'string' && name !== '' ? name : fallback
}

function recorderErrorName(event: Event): string {
  return 'error' in event ? errorName(event.error, 'recording-failed') : 'recording-failed'
}

function closeMeterContext(context: AudioContext): void {
  void context.close().catch(() => {
    // Meter cleanup is best-effort and cannot change the recording result.
  })
}

function rootMeanSquare(samples: Uint8Array): number {
  let sum = 0
  for (const sample of samples) {
    const normalized = (sample - 128) / 128
    sum += normalized * normalized
  }
  return Math.sqrt(sum / samples.length)
}

function voiceLevel(rms: number): number {
  if (rms <= VOICE_LEVEL_FLOOR_RMS) return 0
  return Math.min(1, (rms - VOICE_LEVEL_FLOOR_RMS)
    / (VOICE_LEVEL_CEILING_RMS - VOICE_LEVEL_FLOOR_RMS))
}
