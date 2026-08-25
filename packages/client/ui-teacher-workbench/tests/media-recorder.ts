import { vi } from 'vitest'

/** Deterministic MediaRecorder double used by workbench voice-input tests. */
export class MediaRecorderMock {
  static instances: MediaRecorderMock[] = []
  static isTypeSupported = vi.fn((mediaType: string) => mediaType === 'audio/webm;codecs=opus')

  readonly mimeType: string
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event & { readonly error: DOMException }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
    MediaRecorderMock.instances.push(this)
  }

  start = vi.fn(() => { this.state = 'recording' })

  stop = vi.fn(() => {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob([Uint8Array.of(1, 2, 3)], { type: this.mimeType }),
    } as BlobEvent)
    this.onstop?.()
  })
}

/**
 * Install a working microphone and MediaRecorder for one jsdom test.
 * @returns spies for permission and stream release assertions.
 */
export function installMediaRecorder(): {
  readonly getUserMedia: ReturnType<typeof vi.fn>
  readonly stopTrack: ReturnType<typeof vi.fn>
} {
  MediaRecorderMock.instances = []
  vi.stubGlobal('MediaRecorder', MediaRecorderMock)
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  return { getUserMedia, stopTrack }
}
