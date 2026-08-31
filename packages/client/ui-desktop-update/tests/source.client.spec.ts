import { describe, expect, it, vi } from 'vitest'
import {
  isDesktopUpdateState, type DesktopUpdateBridge, type DesktopUpdateState,
} from '../src/client/bridge.ts'
import { DesktopUpdateSource } from '../src/client/source.ts'

class FakeBridge implements DesktopUpdateBridge {
  private state: DesktopUpdateState = { status: 'checking' }
  private nextId = 1
  private readonly listeners = new Map<number, (state: DesktopUpdateState) => void>()
  readonly download = vi.fn<() => Promise<void>>(() => Promise.resolve())
  readonly install = vi.fn<() => Promise<void>>(() => Promise.resolve())
  readonly unsubscribed: number[] = []

  getState(): DesktopUpdateState { return this.state }
  subscribe(listener: (state: DesktopUpdateState) => void): number {
    const id = this.nextId++
    this.listeners.set(id, listener)
    listener(this.state)
    return id
  }
  unsubscribe(id: number): void {
    this.unsubscribed.push(id)
    this.listeners.delete(id)
  }
  emit(state: DesktopUpdateState): void {
    this.state = state
    for (const listener of this.listeners.values()) listener(state)
  }
}

describe('desktop update preload source', () => {
  it('validates every discriminated state at the isolation boundary', () => {
    expect(isDesktopUpdateState({ status: 'checking' })).toBe(true)
    expect(isDesktopUpdateState({ status: 'up-to-date', version: '1.2.0' })).toBe(true)
    expect(isDesktopUpdateState({ status: 'available', version: '1.2.0' })).toBe(true)
    expect(isDesktopUpdateState({ status: 'downloading', version: '1.2.0', percent: 4 })).toBe(true)
    expect(isDesktopUpdateState({ status: 'downloaded', version: '1.2.0' })).toBe(true)
    expect(isDesktopUpdateState({ status: 'error', version: '1.2.0', message: 'offline' })).toBe(true)
    expect(isDesktopUpdateState({ status: 'up-to-date' })).toBe(false)
    expect(isDesktopUpdateState({ status: 'available' })).toBe(false)
    expect(isDesktopUpdateState({ status: 'downloading', version: '1.2.0', percent: Number.NaN })).toBe(false)
    expect(isDesktopUpdateState({ status: 'other' })).toBe(false)
    expect(isDesktopUpdateState(null)).toBe(false)
  })

  it('publishes bridge changes, delegates actions, and detaches at zero subscribers', async () => {
    const bridge = new FakeBridge()
    const source = new DesktopUpdateSource(bridge)
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)
    bridge.emit({ status: 'available', version: '1.2.0' })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(source.getSnapshot()).toEqual({ status: 'available', version: '1.2.0' })
    await source.download()
    await source.install()
    expect(bridge.download).toHaveBeenCalledOnce()
    expect(bridge.install).toHaveBeenCalledOnce()
    unsubscribe()
    expect(bridge.unsubscribed).toEqual([1])
    source.dispose()
  })

  it('disposes an active subscription exactly once', () => {
    const bridge = new FakeBridge()
    const source = new DesktopUpdateSource(bridge)
    source.subscribe(vi.fn())
    source.dispose()
    source.dispose()
    expect(bridge.unsubscribed).toEqual([1])
    expect(source.subscribe(vi.fn())).toEqual(expect.any(Function))
  })
})
