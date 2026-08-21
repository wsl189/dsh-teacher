/** Browser speech-recognition lifecycle shared by the button and hold-space gesture. */

import { useCallback, useEffect, useRef, useState } from 'react'

interface RecognitionAlternative { readonly transcript: string }
interface RecognitionResult {
  readonly length: number
  readonly isFinal: boolean
  readonly [index: number]: RecognitionAlternative
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult }
}
interface RecognitionErrorEvent extends Event { readonly error: string }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
interface RecognitionConstructor { new(): Recognition }
type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}

/** Browser speech-recognition state and controls. */
export interface VoiceInputController {
  readonly supported: boolean
  readonly listening: boolean
  readonly starting: boolean
  start(): Promise<void>
  stop(): void
  toggle(): void
}

/**
 * Create one speech-recognition controller.
 * @param onTranscript - receives a final normalized transcript.
 * @param onError - receives a browser error code without recognized text.
 * @returns state and controls shared by pointer and keyboard gestures.
 */
export function useVoiceInput(
  onTranscript: (text: string) => void,
  onError: (code: string) => void,
): VoiceInputController {
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const attempt = useRef(0)
  const transcriptHandler = useRef(onTranscript)
  const errorHandler = useRef(onError)
  transcriptHandler.current = onTranscript
  errorHandler.current = onError
  const Constructor = typeof window === 'undefined'
    ? undefined
    : (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition

  const stop = useCallback((): void => {
    attempt.current += 1
    setStarting(false)
    recognition.current?.stop()
  }, [])

  const start = useCallback(async (): Promise<void> => {
    if (Constructor === undefined || recognition.current !== null || starting) return
    const currentAttempt = attempt.current + 1
    attempt.current = currentAttempt
    setStarting(true)
    try {
      const mediaDevices = (window.navigator as { readonly mediaDevices?: MediaDevices }).mediaDevices
      if (mediaDevices !== undefined) {
        const stream = await mediaDevices.getUserMedia({ audio: true })
        for (const track of stream.getTracks()) track.stop()
      }
      if (attempt.current !== currentAttempt) return
      const next = new Constructor()
      next.lang = navigator.language
      next.continuous = false
      next.interimResults = false
      next.maxAlternatives = 1
      next.onresult = (event) => {
        const parts: string[] = []
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const alternative = result?.[0]
          if (result?.isFinal && alternative !== undefined) parts.push(alternative.transcript)
        }
        const text = parts.join(' ').trim()
        if (text !== '') transcriptHandler.current(text)
      }
      next.onerror = (event) => {
        errorHandler.current(event.error)
        recognition.current = null
        setListening(false)
      }
      next.onend = () => {
        recognition.current = null
        setListening(false)
      }
      recognition.current = next
      setListening(true)
      next.start()
    } catch (error) {
      if (attempt.current === currentAttempt) {
        const code = error instanceof DOMException ? error.name : error instanceof Error ? error.name : 'start-failed'
        errorHandler.current(code)
      }
    } finally {
      if (attempt.current === currentAttempt) setStarting(false)
    }
  }, [Constructor, starting])

  const toggle = useCallback((): void => {
    if (listening || starting) stop()
    else void start()
  }, [listening, start, starting, stop])

  useEffect(() => () => {
    attempt.current += 1
    const current = recognition.current
    if (current !== null) {
      current.onresult = null
      current.onerror = null
      current.onend = null
      current.abort()
    }
  }, [])

  return { supported: Constructor !== undefined, listening, starting, start, stop, toggle }
}
