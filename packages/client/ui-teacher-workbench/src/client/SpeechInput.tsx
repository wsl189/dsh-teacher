/** Browser speech-recognition adapter and microphone command. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Mic, Square } from 'lucide-react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
}

interface SpeechRecognitionResultLike {
  readonly length: number
  readonly isFinal: boolean
  readonly [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionResultListLike {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionLike
}

type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

interface MicrophoneNavigator {
  readonly mediaDevices?: {
    readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  }
}

type VoiceErrorTranslationKey =
  | 'voice.permissionDenied'
  | 'voice.noMicrophone'
  | 'voice.noSpeech'
  | 'voice.networkError'
  | 'voice.languageUnsupported'

const VOICE_ERROR_KEYS: Readonly<Record<string, VoiceErrorTranslationKey>> = Object.freeze({
  'not-allowed': 'voice.permissionDenied',
  'service-not-allowed': 'voice.permissionDenied',
  'audio-capture': 'voice.noMicrophone',
  'no-speech': 'voice.noSpeech',
  network: 'voice.networkError',
  'language-not-supported': 'voice.languageUnsupported',
})
const MICROPHONE_PERMISSION_ERRORS = new Set(['NotAllowedError', 'SecurityError'])
const MICROPHONE_CAPTURE_ERRORS = new Set([
  'NotFoundError',
  'DevicesNotFoundError',
  'NotReadableError',
  'TrackStartError',
  'OverconstrainedError',
])

/** Microphone button props. */
export interface VoiceInputButtonProps {
  /** BCP 47 recognition language. */
  language: string
  /** Receive one final normalized transcript. */
  onTranscript: (transcript: string) => void
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render a browser-native speech-recognition toggle.
 * @param props - language, transcript callback, and localized copy.
 * @returns an icon command disabled when the browser exposes no recognition engine.
 */
export function VoiceInputButton({ language, onTranscript, t }: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ readonly sequence: number; readonly text: string } | null>(null)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const transcriptHandler = useRef(onTranscript)
  const startAttempt = useRef(0)
  const toastSequence = useRef(0)
  transcriptHandler.current = onTranscript
  const Recognition = typeof window === 'undefined'
    ? undefined
    : (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
  const supported = Recognition !== undefined

  useEffect(() => {
    return () => {
      startAttempt.current += 1
      const current = recognition.current
      if (current !== null) {
        current.onresult = null
        current.onerror = null
        current.onend = null
        current.abort()
      }
    }
  }, [])

  const announceError = useCallback((code: string): void => {
    setError(code)
    toastSequence.current += 1
    setToast({ sequence: toastSequence.current, text: voiceErrorLabel(code, t) })
  }, [t])

  const toggle = useCallback(async (): Promise<void> => {
    if (listening) {
      recognition.current?.stop()
      return
    }
    /* v8 ignore next -- the button is disabled when no recognition constructor exists. */
    if (Recognition === undefined) return
    const attempt = startAttempt.current + 1
    startAttempt.current = attempt
    setError('')
    const mediaDevices = (window.navigator as unknown as MicrophoneNavigator).mediaDevices
    if (mediaDevices?.getUserMedia !== undefined) {
      setStarting(true)
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true })
        for (const track of stream.getTracks()) track.stop()
      } catch (permissionError) {
        if (startAttempt.current === attempt) {
          setStarting(false)
          announceError(normalizeMicrophoneError(permissionError))
        }
        return
      }
      if (startAttempt.current !== attempt) return
      setStarting(false)
    }
    const next = new Recognition()
    next.lang = language
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
      const transcript = parts.join(' ').trim()
      if (transcript !== '') transcriptHandler.current(transcript)
    }
    next.onerror = (event) => {
      announceError(event.error)
      setListening(false)
    }
    next.onend = () => {
      recognition.current = null
      setListening(false)
    }
    recognition.current = next
    setListening(true)
    try {
      next.start()
    } catch (startError) {
      recognition.current = null
      setListening(false)
      announceError(startError instanceof Error ? startError.message : 'start-failed')
    }
  }, [Recognition, announceError, language, listening])

  const errorLabel = error === '' ? t('voice.start') : voiceErrorLabel(error, t)
  const label = !supported
    ? t('voice.unsupported')
    : starting
      ? t('voice.connecting')
      : listening
        ? t('voice.stop')
        : errorLabel

  return (
    <>
      <button
        type="button"
        className={listening ? css.voiceButtonActive : css.voiceButton}
        aria-label={label}
        aria-pressed={listening}
        title={label}
        disabled={!supported || starting}
        onClick={() => { void toggle() }}
      >
        {listening ? <Square size={15} /> : <Mic size={16} />}
      </button>
      {toast !== null && (
        <Toast
          key={toast.sequence}
          text={toast.text}
          icon={<CircleAlert size={16} />}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}

function voiceErrorLabel(error: string, t: TeacherWorkbenchTranslate): string {
  return t(VOICE_ERROR_KEYS[error] ?? 'voice.failed')
}

function normalizeMicrophoneError(error: unknown): string {
  const name = error instanceof DOMException
    ? error.name
    : error instanceof Error
      ? error.name
      : ''
  if (MICROPHONE_PERMISSION_ERRORS.has(name)) return 'not-allowed'
  if (MICROPHONE_CAPTURE_ERRORS.has(name)) return 'audio-capture'
  return 'start-failed'
}
