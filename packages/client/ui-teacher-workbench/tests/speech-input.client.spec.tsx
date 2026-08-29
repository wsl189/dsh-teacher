// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceInputButton } from '../src/client/SpeechInput.tsx'
import { zh } from '../src/client/locales.ts'
import { installMediaRecorder, MediaRecorderMock } from './media-recorder.ts'

const t = ((key: keyof typeof zh) => zh[key])

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window.navigator, 'mediaDevices')
})

describe('VoiceInputButton', () => {
  it('disables itself when MediaRecorder or microphone capture is unavailable', () => {
    render(<VoiceInputButton transcribe={vi.fn()} onTranscript={vi.fn()} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '当前浏览器不支持语音输入' }).disabled).toBe(true)
  })

  it('records, transcribes, releases the stream, and emits normalized text', async () => {
    const { getUserMedia, stopTrack } = installMediaRecorder()
    let resolveTranscript: ((value: string) => void) | undefined
    const transcribe = vi.fn(() => new Promise<string>((resolve) => { resolveTranscript = resolve }))
    const onTranscript = vi.fn()
    render(<VoiceInputButton transcribe={transcribe} onTranscript={onTranscript} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在连接麦克风' }).disabled).toBe(true)
    await screen.findByRole('button', { name: '停止语音输入' })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(MediaRecorderMock.instances[0]?.mimeType).toBe('audio/webm;codecs=opus')

    fireEvent.click(screen.getByRole('button', { name: '停止语音输入' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在识别语音' }).disabled).toBe(true)
    expect(stopTrack).toHaveBeenCalledOnce()
    await waitFor(() => { expect(transcribe).toHaveBeenCalledWith(expect.any(Blob)) })
    await act(async () => { resolveTranscript?.('  课堂记录  '); await Promise.resolve() })
    expect(onTranscript).toHaveBeenCalledWith('课堂记录')
    await screen.findByRole('button', { name: '开始语音输入' })
  })

  it('maps QQ configuration and service failures to localized notifications', async () => {
    installMediaRecorder()
    const disabled = new Error('disabled')
    disabled.name = 'provider-disabled'
    const failed = new Error('failed')
    failed.name = 'provider-failure'
    const transcribe = vi.fn().mockRejectedValueOnce(disabled).mockRejectedValueOnce(failed)
    render(<VoiceInputButton transcribe={transcribe} onTranscript={vi.fn()} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '停止语音输入' }))
    await screen.findByRole('button', { name: '请先在设置 → 连接平台 → QQ 中启用语音识别' })
    expect(screen.getByRole('alert').textContent).toBe('请先在设置 → 连接平台 → QQ 中启用语音识别')

    fireEvent.click(screen.getByRole('button', { name: '请先在设置 → 连接平台 → QQ 中启用语音识别' }))
    fireEvent.click(await screen.findByRole('button', { name: '停止语音输入' }))
    await screen.findByRole('button', { name: '语音识别服务连接失败' })
    expect(screen.getByRole('alert').textContent).toBe('语音识别服务连接失败')
  })

  it('reports microphone permission and device failures', async () => {
    vi.stubGlobal('MediaRecorder', MediaRecorderMock)
    const missing = new Error('missing')
    missing.name = 'NotFoundError'
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockRejectedValueOnce(missing)
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    render(<VoiceInputButton transcribe={vi.fn()} onTranscript={vi.fn()} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    await screen.findByRole('button', { name: '麦克风权限未开启' })
    fireEvent.click(screen.getByRole('button', { name: '麦克风权限未开启' }))
    await screen.findByRole('button', { name: '未检测到可用麦克风' })
  })

  it('releases an in-flight stream after unmount without transcribing', async () => {
    vi.stubGlobal('MediaRecorder', MediaRecorderMock)
    const stopTrack = vi.fn()
    let resolvePermission: ((stream: MediaStream) => void) | undefined
    const permission = new Promise<MediaStream>((resolve) => { resolvePermission = resolve })
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => permission) },
    })
    const transcribe = vi.fn()
    const rendered = render(<VoiceInputButton transcribe={transcribe} onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    rendered.unmount()
    resolvePermission?.({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
    await act(async () => { await permission })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('dismisses a provider failure notification after its announcement', async () => {
    vi.useFakeTimers()
    installMediaRecorder()
    const failure = new Error('empty')
    failure.name = 'empty-result'
    render(<VoiceInputButton transcribe={vi.fn().mockRejectedValue(failure)} onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '停止语音输入' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('未听到语音，请重试')
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByRole('alert')).toBeNull()
    vi.useRealTimers()
  })

  it('contains an empty successful transcript', async () => {
    installMediaRecorder()
    render(<VoiceInputButton transcribe={vi.fn(async () => '   ')} onTranscript={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '停止语音输入' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('未听到语音，请重试') })
  })
})
