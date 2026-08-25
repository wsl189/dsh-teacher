/** Observable object layer over the Electron preload's update bridge. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  isDesktopUpdateState, type DesktopUpdateBridge, type DesktopUpdateState,
} from './bridge.ts'

const INITIAL_STATE: DesktopUpdateState = Object.freeze({ status: 'checking' })

/** Browser-local snapshot source backed by one preload bridge. */
export class DesktopUpdateSource implements HostObservable<DesktopUpdateState> {
  private state: DesktopUpdateState
  private readonly listeners = new Set<() => void>()
  private subscriptionId: number | undefined
  private disposed = false

  /**
   * @param bridge - context-isolated API installed by the Electron preload.
   */
  constructor(private readonly bridge: DesktopUpdateBridge) {
    const initial = bridge.getState()
    this.state = isDesktopUpdateState(initial) ? initial : INITIAL_STATE
  }

  /** Return the most recent validated preload snapshot. */
  getSnapshot = (): DesktopUpdateState => this.state

  /** Subscribe to snapshot replacement, attaching the preload listener lazily. */
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    if (this.subscriptionId === undefined) {
      this.subscriptionId = this.bridge.subscribe((state) => {
        if (!isDesktopUpdateState(state) || this.disposed) return
        this.state = state
        for (const notify of this.listeners) notify()
      })
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size !== 0 || this.subscriptionId === undefined) return
      this.bridge.unsubscribe(this.subscriptionId)
      this.subscriptionId = undefined
    }
  }

  /** Request download of the Release selected by the desktop updater. */
  download = (): Promise<void> => this.bridge.download()

  /** Request restart into the verified downloaded installer. */
  install = (): Promise<void> => this.bridge.install()

  /** Detach the preload listener and reject all later publications. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.subscriptionId !== undefined) this.bridge.unsubscribe(this.subscriptionId)
    this.subscriptionId = undefined
    this.listeners.clear()
  }
}
