// @vitest-environment jsdom

import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceInputButton } from '../src/client/SpeechInput.tsx'
import { zh } from '../src/client/locales.ts'
import { installMediaRecorder, MediaRecorderMock } from './media-recorder.ts'

function Field({ name, transcribe }: { name: string; transcribe: (audio: Blob) => Promise<string> }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('题目描述')
  return <section aria-label={name}>
    <input ref={ref} aria-label={name} value={value} onChange={(event) => { setValue(event.target.value) }} />
    <VoiceInputButton
      transcribe={transcribe} onTranscript={setValue} keyboardInput={{ ref, onChange: setValue }} t={key => zh[key]}
    />
  </section>
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window.navigator, 'mediaDevices')
})
const advance = async (ms: number): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('focused-field hold-Space voice input', () => {
  it('inserts a short space at the selection and preserves the caret without recording', async () => {
    const { getUserMedia } = installMediaRecorder()
    render(<Field name="description" transcribe={vi.fn()} />)
    const input = screen.getByRole<HTMLInputElement>('textbox')
    input.focus()
    input.setSelectionRange(1, 3)
    expect(fireEvent.keyDown(input, { key: ' ', code: 'Space' })).toBe(false)
    await advance(200)
    fireEvent.keyUp(input, { key: ' ', code: 'Space' })
    expect(input.value).toBe('题 述')
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(2)
    await advance(1_000)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('records only the focused target, suppresses repeated spaces, and finishes on release', async () => {
    const { getUserMedia, stopTrack } = installMediaRecorder()
    const description = vi.fn(async () => '描述语音')
    const search = vi.fn(async () => '向量')
    render(<><Field name="description" transcribe={description} /><Field name="search" transcribe={search} /></>)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'search' })
    input.focus()
    fireEvent.keyDown(input, { key: ' ' })
    await advance(500)
    expect(MediaRecorderMock.instances[0]?.state).toBe('recording')
    fireEvent.keyDown(input, { key: ' ', repeat: true })
    await advance(800)
    fireEvent.keyUp(input, { key: ' ' })
    await advance(0)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledOnce()
    expect(description).not.toHaveBeenCalled()
    expect(input.value).toBe('向量')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'description' }).value).toBe('题目描述')
  })

  it('keeps IME confirmation and modified spaces native', async () => {
    const { getUserMedia } = installMediaRecorder()
    render(<Field name="description" transcribe={vi.fn()} />)
    const input = screen.getByRole('textbox')
    for (const modifier of [
      { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(input, { key: ' ', ...modifier })).toBe(true)
      await advance(600)
      fireEvent.keyUp(input, { key: ' ' })
    }
    fireEvent.compositionStart(input)
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(true)
    fireEvent.compositionEnd(input)
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(true)
    await advance(600)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('cancels a pending hold when focus leaves and stops active audio when the window loses focus', async () => {
    const { getUserMedia, stopTrack } = installMediaRecorder()
    render(<Field name="description" transcribe={vi.fn(async () => '语音')} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: ' ' })
    await advance(100)
    fireEvent.blur(input)
    await advance(600)
    expect(getUserMedia).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: ' ' })
    await advance(500)
    fireEvent.blur(window)
    await advance(0)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(MediaRecorderMock.instances[0]?.state).toBe('inactive')
  })

  it('finishes immediately when microphone permission settles after key release', async () => {
    const { getUserMedia, stopTrack } = installMediaRecorder()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    let resolve!: (value: MediaStream) => void
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((done) => { resolve = done }))
    render(<Field name="description" transcribe={vi.fn(async () => '语音')} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: ' ' })
    await advance(500)
    fireEvent.keyUp(input, { key: ' ' })
    expect(MediaRecorderMock.instances).toHaveLength(0)
    await act(async () => { resolve(stream); await Promise.resolve() })
    await advance(0)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(MediaRecorderMock.instances[0]?.state).toBe('inactive')
  })

  it('removes keyboard listeners and pending timers on unmount', async () => {
    const { getUserMedia } = installMediaRecorder()
    const view = render(<Field name="description" transcribe={vi.fn()} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: ' ' })
    view.unmount()
    await advance(600)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(true)
  })
})
