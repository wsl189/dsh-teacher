/** Browser microphone recording lifecycle shared by product voice-input surfaces. */

import { useCallback, useEffect, useRef, useState } from 'react'

const PREFERRED_MEDIA_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const

/** Browser microphone state and controls. */
export interface VoiceRecorderController {
  /** Whether recording and the configured transcription callback are available. */
  readonly supported: boolean
  /** Whether the browser is collecting microphone audio. */
  readonly listening: boolean
  /** Whether microphone permission and recorder startup are pending. */
  readonly starting: boolean
  /** Whether the completed recording is awaiting its transcript. */
  readonly transcribing: boolean
  /** Begin a new microphone recording. */
  start(): Promise<void>
  /** Finish the active recording and start transcription. */
  stop(): void
  /** Start or stop according to current state. */
  toggle(): void
}

/** Voice-recorder callbacks. */
export interface VoiceRecorderOptions {
  /** Send one completed browser recording to the product transcription service. */
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
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
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
  }
  const mediaDevices = browser.navigator?.mediaDevices
  const Recorder = browser.MediaRecorder
  const supported = Recorder !== undefined
    && typeof mediaDevices?.getUserMedia === 'function'
    && options.transcribe !== undefined

  const releaseStream = useCallback((): void => {
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null
  }, [])

  const stop = useCallback((): void => {
    setStarting(false)
    const current = recorder.current
    if (current !== null && current.state !== 'inactive') current.stop()
  }, [])

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
        releaseStream()
        setListening(false)
        setStarting(false)
        errorHandler.current(recorderErrorName(event))
      }
      next.onstop = () => {
        if (generation.current !== currentGeneration) return
        recorder.current = null
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
        void transcribe(audio).then((text) => {
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
  }, [Recorder, mediaDevices, releaseStream, starting, supported, transcribing])

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
    releaseStream()
  }, [releaseStream])

  return { supported, listening, starting, transcribing, start, stop, toggle }
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
