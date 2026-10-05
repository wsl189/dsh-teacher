/** A live projection of Host-owned reminders; this source never schedules delivery. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeacherScheduledReminderTask } from '@deepseek-ai/dsh-api-remotes/client'

/** Latest authoritative rows and the current catalog read state. */
export interface ReminderCatalogSnapshot {
  readonly records: readonly TeacherScheduledReminderTask[]
  readonly status: 'loading' | 'ready' | 'error'
}

interface Dependencies {
  list: () => Promise<RemoteResult<readonly TeacherScheduledReminderTask[]>>
  subscribeChanged: (listener: () => void) => () => void
  subscribeReset: (listener: () => void) => () => void
}

/**
 * Subscribe only while rendered, superseding reads after a change or reconnect.
 * @param deps - Host reads and durable-change/connection subscriptions.
 * @returns A shared observable with retry and explicit plugin-disposal callbacks.
 */
export function createReminderCatalog(deps: Dependencies): HostObservable<ReminderCatalogSnapshot> & {
  refresh: () => Promise<void>
  dispose: () => void
} {
  let snapshot: ReminderCatalogSnapshot = { records: [], status: 'loading' }
  const listeners = new Set<() => void>()
  let disposers: readonly (() => void)[] = []
  let epoch = 0
  let disposed = false
  const publish = (next: ReminderCatalogSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const refresh = async (): Promise<void> => {
    if (disposed) return
    const current = ++epoch
    publish({ ...snapshot, status: 'loading' })
    try {
      const result = await deps.list()
      if (current !== epoch) return
      publish(result.ok ? { records: result.value, status: 'ready' } : { ...snapshot, status: 'error' })
    } catch {
      if (current === epoch) publish({ ...snapshot, status: 'error' })
    }
  }
  const stop = (): void => {
    epoch++
    for (const dispose of disposers) dispose()
    disposers = []
  }
  const invalidate = (): void => { void refresh() }
  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      if (listeners.size === 1) {
        disposers = [deps.subscribeChanged(invalidate), deps.subscribeReset(invalidate)]
        invalidate()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
    dispose() {
      disposed = true
      stop()
      listeners.clear()
    },
  }
}
