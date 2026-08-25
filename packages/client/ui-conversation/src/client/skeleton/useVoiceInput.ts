/** MediaRecorder lifecycle shared by the composer button and hold-space gesture. */

import {
  useVoiceRecorder,
  type VoiceRecorderController,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Composer microphone state and controls. */
export type VoiceInputController = VoiceRecorderController

/**
 * Create one composer voice-input controller.
 * @param transcribe - Host-backed transcription callback.
 * @param onTranscript - receives a final normalized transcript.
 * @param onError - receives a browser or provider error code without recognized text.
 * @returns state and controls shared by pointer and keyboard gestures.
 */
export function useVoiceInput(
  transcribe: ((audio: Blob) => Promise<string>) | undefined,
  onTranscript: (text: string) => void,
  onError: (code: string) => void,
): VoiceInputController {
  return useVoiceRecorder({ transcribe, onTranscript, onError })
}
