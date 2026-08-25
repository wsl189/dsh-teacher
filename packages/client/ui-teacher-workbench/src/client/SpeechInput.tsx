/** Host-backed speech-transcription microphone command. */

import { useCallback, useRef, useState } from 'react'
import { CircleAlert, Mic, Square } from 'lucide-react'
import { Toast, useVoiceRecorder } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import css from './TeacherWorkbench.module.css'

type VoiceErrorTranslationKey =
  | 'voice.permissionDenied'
  | 'voice.noMicrophone'
  | 'voice.noSpeech'
  | 'voice.networkError'
  | 'voice.notConfigured'
  | 'voice.fileTooLarge'

const VOICE_ERROR_KEYS: Readonly<Record<string, VoiceErrorTranslationKey>> = Object.freeze({
  'not-allowed': 'voice.permissionDenied',
  NotAllowedError: 'voice.permissionDenied',
  SecurityError: 'voice.permissionDenied',
  'audio-capture': 'voice.noMicrophone',
  NotFoundError: 'voice.noMicrophone',
  DevicesNotFoundError: 'voice.noMicrophone',
  NotReadableError: 'voice.noMicrophone',
  TrackStartError: 'voice.noMicrophone',
  OverconstrainedError: 'voice.noMicrophone',
  'no-speech': 'voice.noSpeech',
  'empty-result': 'voice.noSpeech',
  network: 'voice.networkError',
  'provider-unavailable': 'voice.networkError',
  'provider-failure': 'voice.networkError',
  'provider-disabled': 'voice.notConfigured',
  'file-too-large': 'voice.fileTooLarge',
})

/** Microphone button props. */
export interface VoiceInputButtonProps {
  /** Transcribe one completed recording through the shared Host provider. */
  transcribe: (audio: Blob) => Promise<string>
  /** Receive one final normalized transcript. */
  onTranscript: (transcript: string) => void
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render a MediaRecorder toggle backed by the configured QQ ASR service.
 * @param props - transcription callback, transcript callback, and localized copy.
 * @returns an icon command disabled while recording startup or transcription is pending.
 */
export function VoiceInputButton({ transcribe, onTranscript, t }: VoiceInputButtonProps) {
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ readonly sequence: number; readonly text: string } | null>(null)
  const toastSequence = useRef(0)
  const announceError = useCallback((code: string): void => {
    setError(code)
    toastSequence.current += 1
    setToast({ sequence: toastSequence.current, text: voiceErrorLabel(code, t) })
  }, [t])
  const voice = useVoiceRecorder({
    transcribe,
    onTranscript,
    onError: announceError,
  })
  const errorLabel = error === '' ? t('voice.start') : voiceErrorLabel(error, t)
  const label = !voice.supported
    ? t('voice.unsupported')
    : voice.starting
      ? t('voice.connecting')
      : voice.transcribing
        ? t('voice.transcribing')
        : voice.listening
          ? t('voice.stop')
          : errorLabel

  return (
    <>
      <button
        type="button"
        className={voice.listening ? css.voiceButtonActive : css.voiceButton}
        aria-label={label}
        aria-pressed={voice.listening}
        title={label}
        disabled={!voice.supported || voice.starting || voice.transcribing}
        onClick={() => { setError(''); voice.toggle() }}
      >
        {voice.listening ? <Square size={15} /> : <Mic size={16} />}
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
