/** Sandboxed context-isolation bridge for the desktop update controls. */

import { contextBridge, ipcRenderer } from 'electron'
import {
  isDesktopUpdateState, UPDATE_CHANNELS, type DesktopUpdateBridge, type DesktopUpdateState,
} from './update-protocol.ts'

let state: DesktopUpdateState = Object.freeze({ status: 'checking' })
let nextSubscriptionId = 1
const listeners = new Map<number, (state: DesktopUpdateState) => void>()

/** Publish one validated main-process snapshot to every renderer listener. */
function publish(value: unknown): void {
  if (!isDesktopUpdateState(value)) return
  state = value
  for (const listener of listeners.values()) listener(state)
}

ipcRenderer.on(UPDATE_CHANNELS.state, (_event, value: unknown) => { publish(value) })
void ipcRenderer.invoke(UPDATE_CHANNELS.getState).then(
  (value: unknown) => { publish(value) },
  () => {
    // The main handler may not exist during an early teardown; `checking`
    // remains a hidden UI state, so no renderer-visible error is warranted.
  },
)

const bridge: DesktopUpdateBridge = Object.freeze({
  getState: () => state,
  subscribe(listener: (state: DesktopUpdateState) => void) {
    if (typeof listener !== 'function') throw new TypeError('desktop update listener must be a function')
    const id = nextSubscriptionId
    nextSubscriptionId += 1
    listeners.set(id, listener)
    listener(state)
    return id
  },
  unsubscribe(id: number) {
    listeners.delete(id)
  },
  async download() {
    await ipcRenderer.invoke(UPDATE_CHANNELS.download)
  },
  async install() {
    await ipcRenderer.invoke(UPDATE_CHANNELS.install)
  },
})

contextBridge.exposeInMainWorld('dshDesktopUpdate', bridge)
