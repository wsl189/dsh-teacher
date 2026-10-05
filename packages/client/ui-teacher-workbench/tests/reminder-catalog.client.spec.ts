import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeacherScheduledReminderTask } from '@deepseek-ai/dsh-api-remotes/client'
import { createReminderCatalog } from '../src/client/reminder-catalog.ts'

const row: TeacherScheduledReminderTask = {
  key: 'teacher-workbench:todo:a', owner: 'todo', title: 'Lesson preparation',
  deadline: '2099-08-18T18:30', nextRun: '2099-08-18T10:00:00Z',
  channel: 'weixin', botLabel: 'Teacher bot', rule: { kind: 'once', minutesBefore: 30 },
}

describe('workbench reminder catalog', () => {
  it('shares one query, supersedes stale reads, and releases every subscription', async () => {
    let changed = (): void => {}
    let reset = (): void => {}
    const stopChanged = vi.fn()
    const stopReset = vi.fn()
    const requests: ReturnType<typeof Promise.withResolvers<RemoteResult<readonly TeacherScheduledReminderTask[]>>>[] = []
    const list = vi.fn(() => {
      const pending = Promise.withResolvers<RemoteResult<readonly TeacherScheduledReminderTask[]>>()
      requests.push(pending)
      return pending.promise
    })
    const source = createReminderCatalog({
      list,
      subscribeChanged: (listener) => { changed = listener; return stopChanged },
      subscribeReset: (listener) => { reset = listener; return stopReset },
    })
    const first = source.subscribe(vi.fn())
    const second = source.subscribe(vi.fn())
    try {
      expect(list).toHaveBeenCalledTimes(1)
      changed()
      requests[1]!.resolve({ ok: true, value: [row] })
      await requests[1]!.promise
      expect(source.getSnapshot()).toEqual({ records: [row], status: 'ready' })
      requests[0]!.resolve({ ok: true, value: [] })
      await requests[0]!.promise
      expect(source.getSnapshot().records).toEqual([row])
      reset()
      requests[2]!.resolve({ ok: true, value: [] })
      await requests[2]!.promise
      expect(source.getSnapshot().records).toEqual([])
      first()
      expect(stopChanged).not.toHaveBeenCalled()
      changed()
      second()
      expect(stopChanged).toHaveBeenCalledOnce()
      expect(stopReset).toHaveBeenCalledOnce()
      requests[3]!.resolve({ ok: true, value: [row] })
      await requests[3]!.promise
      expect(source.getSnapshot().records).toEqual([])
    } finally { first(); second(); source.dispose() }
  })

  it('keeps rows after a failed read, recovers on retry, and rejects late disposal reads', async () => {
    const pending = Promise.withResolvers<RemoteResult<readonly TeacherScheduledReminderTask[]>>()
    const list = vi.fn().mockResolvedValueOnce({ ok: true, value: [row] })
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: [] })
      .mockReturnValueOnce(pending.promise)
    const source = createReminderCatalog({ list, subscribeChanged: () => () => {}, subscribeReset: () => () => {} })
    try {
      await source.refresh()
      await source.refresh()
      expect(source.getSnapshot()).toEqual({ records: [row], status: 'error' })
      await source.refresh()
      expect(source.getSnapshot()).toEqual({ records: [], status: 'ready' })
      const reading = source.refresh()
      source.dispose()
      pending.resolve({ ok: true, value: [row] })
      await reading
      expect(source.getSnapshot().records).toEqual([])
      await source.refresh()
      expect(list).toHaveBeenCalledTimes(4)
    } finally { source.dispose() }
  })
})
