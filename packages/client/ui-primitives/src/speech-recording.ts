/** Browser recording normalization for OpenAI-compatible speech services. */

const SPEECH_SAMPLE_RATE = 16_000
const WAV_HEADER_BYTES = 44

interface AudioDecoderContext {
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBuffer>
  close(): Promise<void>
}

/** Constructor subset shared by standard and WebKit-prefixed AudioContext implementations. */
export type AudioDecoderConstructor = new () => AudioDecoderContext

function decoderConstructor(): AudioDecoderConstructor | undefined {
  const browser = globalThis as unknown as {
    readonly AudioContext?: AudioDecoderConstructor
    readonly webkitAudioContext?: AudioDecoderConstructor
  }
  return browser.AudioContext ?? browser.webkitAudioContext
}

function mediaType(blob: Blob): string {
  return blob.type.split(';', 1).join('').trim().toLowerCase()
}

function noSpeech(): Error {
  const error = new Error('decoded audio is empty')
  error.name = 'no-speech'
  return error
}

function pcm16MonoWav(decoded: AudioBuffer): Blob {
  if (decoded.length === 0) throw noSpeech()
  const sampleRate = Math.min(SPEECH_SAMPLE_RATE, decoded.sampleRate)
  const sampleCount = Math.max(1, Math.round(decoded.length * sampleRate / decoded.sampleRate))
  const channels = Array.from(
    { length: decoded.numberOfChannels },
    (_, channel) => decoded.getChannelData(channel),
  )
  const bytes = new ArrayBuffer(WAV_HEADER_BYTES + sampleCount * 2)
  const view = new DataView(bytes)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, sampleCount * 2, true)

  const sourceFramesPerSample = decoded.sampleRate / sampleRate
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const start = Math.min(decoded.length - 1, Math.floor(sampleIndex * sourceFramesPerSample))
    const end = Math.min(
      decoded.length,
      Math.max(start + 1, Math.floor((sampleIndex + 1) * sourceFramesPerSample)),
    )
    let sum = 0
    for (const channel of channels) {
      for (const value of channel.subarray(start, end)) sum += value
    }
    const sample = Math.max(-1, Math.min(1, sum / ((end - start) * channels.length)))
    view.setInt16(
      WAV_HEADER_BYTES + sampleIndex * 2,
      Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)),
      true,
    )
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

/**
 * Convert a browser MediaRecorder result to 16 kHz mono PCM WAV when Web Audio decoding is available.
 * @param recording - complete browser recording.
 * @param Decoder - optional captured AudioContext constructor for deterministic host selection.
 * @returns WAV audio, or the original recording on hosts without Web Audio decoding.
 */
export async function normalizeSpeechRecording(
  recording: Blob,
  Decoder: AudioDecoderConstructor | undefined = decoderConstructor(),
): Promise<Blob> {
  const type = mediaType(recording)
  if (type === 'audio/wav' || type === 'audio/x-wav' || Decoder === undefined) return recording
  const decoder = new Decoder()
  let decoded: AudioBuffer
  try {
    decoded = await decoder.decodeAudioData(await recording.arrayBuffer())
  } finally {
    try {
      await decoder.close()
    } catch {
      // Decoding determines the operation result; closing an isolated decoder is best-effort.
    }
  }
  return pcm16MonoWav(decoded)
}
