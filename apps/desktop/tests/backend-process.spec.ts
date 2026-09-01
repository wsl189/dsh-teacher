import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBackendMessage, waitForBackendReady } from '../src/backend-process.ts'

const TOKEN = 'a'.repeat(43)
const READY_URL = `http://127.0.0.1:43125/?token=${TOKEN}`

function fakeChild(): ChildProcess {
  return new EventEmitter() as unknown as ChildProcess
}

afterEach(() => { vi.useRealTimers() })

describe('desktop backend process', () => {
  it('accepts only a private loopback URL carrying one launch token', () => {
    expect(parseBackendMessage({ type: 'ready', url: READY_URL }))
      .toEqual({ type: 'ready', url: READY_URL })
    expect(parseBackendMessage({ type: 'fatal', message: 'broken plugin' }))
      .toEqual({ type: 'fatal', message: 'broken plugin' })
    for (const url of [
      `https://127.0.0.1:43125/?token=${TOKEN}`,
      `http://localhost:43125/?token=${TOKEN}`,
      `http://127.0.0.1:43125/chat?token=${TOKEN}`,
      `http://127.0.0.1:43125/?token=${TOKEN}&token=${TOKEN}`,
      'not a URL',
    ]) {
      expect(parseBackendMessage({ type: 'ready', url })).toBeUndefined()
    }
    expect(parseBackendMessage({ type: 'fatal', message: 7 })).toBeUndefined()
    expect(parseBackendMessage(null)).toBeUndefined()
  })

  it('keeps a healthy first launch alive without a wall-clock deadline', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    let state = 'pending'
    const ready = waitForBackendReady(child).finally(() => { state = 'settled' })

    await vi.advanceTimersByTimeAsync(90_000)
    expect(state).toBe('pending')
    child.emit('message', { type: 'ready', url: READY_URL })

    await expect(ready).resolves.toBe(READY_URL)
    expect(child.listenerCount('message')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('still rejects explicit startup failure and premature exit', async () => {
    const fatalChild = fakeChild()
    const fatal = waitForBackendReady(fatalChild)
    fatalChild.emit('message', { type: 'fatal', message: 'plugin tree failed' })
    await expect(fatal).rejects.toThrow('plugin tree failed')

    const exitedChild = fakeChild()
    const exited = waitForBackendReady(exitedChild)
    exitedChild.emit('exit', 7, null)
    await expect(exited).rejects.toThrow('desktop backend exited before ready (7)')

    const erroredChild = fakeChild()
    const errored = waitForBackendReady(erroredChild)
    erroredChild.emit('error', new Error('fork failed'))
    await expect(errored).rejects.toThrow('fork failed')
  })
})
