// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeSpeechRecording,
  type AudioDecoderConstructor,
} from '../src/speech-recording.ts'

function decoded(channels: readonly number[][], sampleRate = 48_000): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: channel => Float32Array.from(channels[channel] ?? []),
  } as AudioBuffer
}

function decoderFixture(value: AudioBuffer, closeFailure?: Error) {
  const instances: Array<{
    readonly decodeAudioData: ReturnType<typeof vi.fn>
    readonly close: ReturnType<typeof vi.fn>
  }> = []
  class Decoder {
    readonly decodeAudioData = vi.fn(async (_audioData: ArrayBuffer) => value)
    readonly close = vi.fn(async () => {
      if (closeFailure !== undefined) throw closeFailure
    })
    constructor() { instances.push(this) }
  }
  return { Decoder: Decoder as AudioDecoderConstructor, instances }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('normalizeSpeechRecording', () => {
  it('decodes, downmixes, resamples, and encodes browser audio as PCM WAV', async () => {
    const fixture = decoderFixture(decoded([
      [1, 1, 1, -1, -1, -1],
      [1, 1, 1, -1, -1, -1],
    ]))
    vi.stubGlobal('AudioContext', fixture.Decoder)
    const result = await normalizeSpeechRecording(new Blob([Uint8Array.of(1, 2, 3)], {
      type: 'audio/webm;codecs=opus',
    }))
    const bytes = new Uint8Array(await result.arrayBuffer())
    const view = new DataView(bytes.buffer)

    expect(result.type).toBe('audio/wav')
    expect(bytes).toHaveLength(48)
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(40)
    expect(ascii(bytes, 8, 4)).toBe('WAVE')
    expect(ascii(bytes, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(bytes, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(4)
    expect(view.getInt16(44, true)).toBe(32_767)
    expect(view.getInt16(46, true)).toBe(-32_768)
    expect(fixture.instances[0]?.decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer))
    expect(fixture.instances[0]?.close).toHaveBeenCalledOnce()
  })

  it('uses the WebKit decoder, preserves a lower sample rate, and ignores close failure', async () => {
    const fixture = decoderFixture(decoded([[0.5, -0.5]], 8_000), new Error('already closed'))
    vi.stubGlobal('webkitAudioContext', fixture.Decoder)
    const result = await normalizeSpeechRecording(new Blob([Uint8Array.of(7)], { type: 'audio/ogg' }))
    const view = new DataView(await result.arrayBuffer())
    expect(view.getUint32(24, true)).toBe(8_000)
    expect(view.getUint32(40, true)).toBe(4)
    expect(view.getInt16(44, true)).toBe(16_384)
    expect(view.getInt16(46, true)).toBe(-16_384)
    expect(fixture.instances[0]?.close).toHaveBeenCalledOnce()
  })

  it('passes through WAV and hosts without an audio decoder', async () => {
    const wav = new Blob([Uint8Array.of(1)], { type: 'audio/x-wav;rate=16000' })
    await expect(normalizeSpeechRecording(wav)).resolves.toBe(wav)
    const webm = new Blob([Uint8Array.of(2)], { type: 'audio/webm' })
    await expect(normalizeSpeechRecording(webm)).resolves.toBe(webm)
  })

  it('closes the decoder after failures and rejects decoded silence without uploading it', async () => {
    const decodeFailure = new DOMException('bad container', 'EncodingError')
    const close = vi.fn(async () => {})
    class FailedDecoder {
      readonly decodeAudioData = vi.fn(async () => Promise.reject(decodeFailure))
      readonly close = close
    }
    await expect(normalizeSpeechRecording(
      new Blob([Uint8Array.of(3)], { type: 'audio/webm' }),
      FailedDecoder as unknown as AudioDecoderConstructor,
    )).rejects.toBe(decodeFailure)
    expect(close).toHaveBeenCalledOnce()

    const empty = decoderFixture(decoded([[]]))
    const result = normalizeSpeechRecording(
      new Blob([Uint8Array.of(4)], { type: 'audio/webm' }),
      empty.Decoder,
    )
    await expect(result).rejects.toMatchObject({ name: 'no-speech' })
  })
})
