import { describe, expect, it, vi } from 'vitest'
import {
  isDesktopUpdateState, type DesktopUpdateBridge, type DesktopUpdateState,
} from '../src/client/bridge.ts'
import { DesktopUpdateSource } from '../src/client/source.ts'

class FakeBridge implements DesktopUpdateBridge {
  private state: DesktopUpdateState
  private nextId = 1
  private readonly listeners = new Map<number, (state: DesktopUpdateState) => void>()
  private lastListener: ((state: DesktopUpdateState) => void) | undefined
  readonly download = vi.fn<() => Promise<void>>(() => Promise.resolve())
  readonly install = vi.fn<() => Promise<void>>(() => Promise.resolve())
  readonly unsubscribed: number[] = []

  constructor(initial: unknown = { status: 'checking' }) {
    this.state = initial as DesktopUpdateState
  }

  getState(): DesktopUpdateState { return this.state }
  subscribe(listener: (state: DesktopUpdateState) => void): number {
    const id = this.nextId++
    this.listeners.set(id, listener)
    this.lastListener = listener
    listener(this.state)
    return id
  }
  unsubscribe(id: number): void {
    this.unsubscribed.push(id)
    this.listeners.delete(id)
  }
  emit(state: unknown): void {
    this.state = state as DesktopUpdateState
    for (const listener of this.listeners.values()) listener(state as DesktopUpdateState)
  }
  emitAfterUnsubscribe(state: DesktopUpdateState): void {
    this.lastListener?.(state)
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
    const unsubscribe = source.subscribe(vi.fn())
    expect(unsubscribe).toEqual(expect.any(Function))
    unsubscribe()
    bridge.emitAfterUnsubscribe({ status: 'available', version: '1.3.0' })
  })

  it('rejects invalid snapshots and keeps one lazy bridge subscription', () => {
    const bridge = new FakeBridge({ status: 'invalid' })
    const source = new DesktopUpdateSource(bridge)
    expect(source.getSnapshot()).toEqual({ status: 'checking' })
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = source.subscribe(first)
    const unsubscribeSecond = source.subscribe(second)
    bridge.emit({ status: 'invalid' })
    expect(source.getSnapshot()).toEqual({ status: 'checking' })

    unsubscribeFirst()
    expect(bridge.unsubscribed).toEqual([])
    unsubscribeSecond()
    unsubscribeSecond()
    expect(bridge.unsubscribed).toEqual([1])
    source.dispose()
  })
})
