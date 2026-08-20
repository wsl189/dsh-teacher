// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceInputButton } from '../src/client/SpeechInput.tsx'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh) => zh[key])

class RecognitionMock {
  static instances: RecognitionMock[] = []
  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 0
  onresult: ((event: never) => void) | null = null
  onerror: ((event: never) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => { this.onend?.() })
  abort = vi.fn()

  constructor() {
    RecognitionMock.instances.push(this)
  }
}

afterEach(() => {
  cleanup()
  RecognitionMock.instances = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'SpeechRecognition')
  Reflect.deleteProperty(window, 'webkitSpeechRecognition')
  Reflect.deleteProperty(window.navigator, 'mediaDevices')
})

describe('VoiceInputButton', () => {
  it('disables itself when neither browser recognition constructor exists', () => {
    render(<VoiceInputButton language="zh-CN" onTranscript={vi.fn()} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '当前浏览器不支持语音输入' }).disabled).toBe(true)
  })

  it('emits only final non-empty transcripts and handles stop, end, and recognition errors', () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const onTranscript = vi.fn()
    const rendered = render(<VoiceInputButton language="zh-CN" onTranscript={onTranscript} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    const first = RecognitionMock.instances[0]!
    expect(first).toMatchObject({ lang: 'zh-CN', continuous: false, interimResults: false, maxAlternatives: 1 })
    act(() => {
      first.onresult?.({
        resultIndex: 0,
        results: {
          0: { 0: { transcript: '  第一段  ' }, length: 1, isFinal: true },
          1: { 0: { transcript: '临时结果' }, length: 1, isFinal: false },
          2: { length: 0, isFinal: true },
          length: 3,
        },
      } as never)
    })
    expect(onTranscript).toHaveBeenCalledWith('第一段')
    fireEvent.click(screen.getByRole('button', { name: '停止语音输入' }))
    expect(first.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '开始语音输入' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    const denied = RecognitionMock.instances[1]!
    act(() => { denied.onerror?.({ error: 'not-allowed' } as never) })
    expect(screen.getByRole('button', { name: '麦克风权限未开启' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '麦克风权限未开启' }))
    const generic = RecognitionMock.instances[2]!
    act(() => { generic.onerror?.({ error: 'network' } as never) })
    expect(screen.getByRole('button', { name: '语音识别服务连接失败' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('语音识别服务连接失败')

    fireEvent.click(screen.getByRole('button', { name: '语音识别服务连接失败' }))
    const active = RecognitionMock.instances[3]!
    rendered.unmount()
    expect(active.abort).toHaveBeenCalledOnce()
  })

  it('uses the WebKit constructor and recovers when start throws', () => {
    class ErrorRecognition extends RecognitionMock {
      override start = vi.fn(() => { throw new Error('busy') })
    }
    vi.stubGlobal('webkitSpeechRecognition', ErrorRecognition)
    render(<VoiceInputButton language="en-US" onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    expect(screen.getByRole('button', { name: '语音识别失败，请重试' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('语音识别失败，请重试')

    cleanup()
    class UnknownErrorRecognition extends RecognitionMock {
      override start = vi.fn(() => {
        const failure: unknown = 'busy'
        throw failure
      })
    }
    vi.stubGlobal('webkitSpeechRecognition', UnknownErrorRecognition)
    render(<VoiceInputButton language="en-US" onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    expect(screen.getByRole('button', { name: '语音识别失败，请重试' })).toBeTruthy()
  })

  it('requests microphone access before recognition and releases the probe stream', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const stop = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }))
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    render(<VoiceInputButton language="zh-CN" onTranscript={vi.fn()} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在连接麦克风' }).disabled).toBe(true)
    await waitFor(() => { expect(RecognitionMock.instances).toHaveLength(1) })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '停止语音输入' })).toBeTruthy()
  })

  it('reports microphone permission, device, and unknown preflight failures', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const missingMicrophone = new Error('missing')
    missingMicrophone.name = 'NotFoundError'
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockRejectedValueOnce(missingMicrophone)
      .mockRejectedValueOnce('unexpected')
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    render(<VoiceInputButton language="zh-CN" onTranscript={vi.fn()} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    await screen.findByRole('button', { name: '麦克风权限未开启' })
    expect(screen.getByRole('alert').textContent).toBe('麦克风权限未开启')

    fireEvent.click(screen.getByRole('button', { name: '麦克风权限未开启' }))
    await screen.findByRole('button', { name: '未检测到可用麦克风' })
    expect(screen.getByRole('alert').textContent).toBe('未检测到可用麦克风')

    fireEvent.click(screen.getByRole('button', { name: '未检测到可用麦克风' }))
    await screen.findByRole('button', { name: '语音识别失败，请重试' })
    expect(screen.getByRole('alert').textContent).toBe('语音识别失败，请重试')
    expect(RecognitionMock.instances).toHaveLength(0)
  })

  it('does not start recognition after an in-flight permission probe is disposed', async () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const stop = vi.fn()
    let resolvePermission: ((stream: { getTracks(): { stop(): void }[] }) => void) | undefined
    const permission = new Promise<{ getTracks(): { stop(): void }[] }>((resolve) => {
      resolvePermission = resolve
    })
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => permission) },
    })
    const rendered = render(<VoiceInputButton language="zh-CN" onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    rendered.unmount()
    resolvePermission?.({ getTracks: () => [{ stop }] })
    await act(async () => { await permission })
    expect(stop).toHaveBeenCalledOnce()
    expect(RecognitionMock.instances).toHaveLength(0)

    let rejectPermission: ((reason?: unknown) => void) | undefined
    const rejectedPermission = new Promise<{ getTracks(): { stop(): void }[] }>((_resolve, reject) => {
      rejectPermission = reject
    })
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => rejectedPermission) },
    })
    const rejected = render(<VoiceInputButton language="zh-CN" onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    rejected.unmount()
    await act(async () => {
      rejectPermission?.(new DOMException('denied', 'NotAllowedError'))
      await Promise.resolve()
    })
    expect(RecognitionMock.instances).toHaveLength(0)
  })

  it('dismisses a recognition failure notification after its announcement', () => {
    vi.useFakeTimers()
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    render(<VoiceInputButton language="zh-CN" onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { RecognitionMock.instances[0]!.onerror?.({ error: 'no-speech' } as never) })
    expect(screen.getByRole('alert').textContent).toBe('未听到语音，请重试')
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores empty final recognition output', () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock)
    const onTranscript = vi.fn()
    render(<VoiceInputButton language="zh-CN" onTranscript={onTranscript} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => {
      RecognitionMock.instances[0]!.onresult?.({
        resultIndex: 0,
        results: { 0: { 0: { transcript: '  ' }, length: 1, isFinal: true }, length: 1 },
      } as never)
    })
    expect(onTranscript).not.toHaveBeenCalled()
    act(() => { RecognitionMock.instances[0]!.onend?.() })
  })
})
