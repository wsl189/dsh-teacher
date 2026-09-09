// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { TimetableImportController, type TimetableImportContext } from '../src/client/timetable-import-controller.ts'

type Extracted = Awaited<ReturnType<TeacherWorkbenchCommands['extractDocument']>>
type Normalized = Awaited<ReturnType<TeacherWorkbenchCommands['normalizeTimetable']>>
type Saved = Awaited<ReturnType<TeacherWorkbenchCommands['importTimetableEntries']>>

const context: TimetableImportContext = {
  classes: [], usage: 'gradeTimetable',
  defaults: { className: '', classNames: [], grade: '高一', kind: 'lesson', target: 'grade', teacherName: '' },
}
const extracted: Extracted = {
  ok: true, value: { name: '课表.xlsx', markdown: '课程表', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', provider: 'mineru', truncated: false },
}
const normalized: Normalized = {
  ok: true, value: { items: [{
    className: '一班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
    startTime: '08:00', endTime: '08:45', subject: '语文', teacherName: '张老师', location: '',
  }] },
}
const file = new File(['workbook'], '课表.xlsx')

function setup() {
  const services = {
    extractDocument: vi.fn<TeacherWorkbenchCommands['extractDocument']>(async () => extracted),
    normalizeTimetable: vi.fn<TeacherWorkbenchCommands['normalizeTimetable']>(async () => normalized),
    importTimetableEntries: vi.fn<TeacherWorkbenchCommands['importTimetableEntries']>(async () => ({ ok: true })),
  }
  return { services, controller: new TimetableImportController(services) }
}

describe('TimetableImportController', () => {
  it('keeps recognition and its destination after every view unsubscribes', async () => {
    const { controller, services } = setup()
    const extraction = Promise.withResolvers<Extracted>()
    const normalization = Promise.withResolvers<Normalized>()
    services.extractDocument.mockReturnValue(extraction.promise)
    services.normalizeTimetable.mockReturnValue(normalization.promise)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    controller.commands.start(file, context)
    const running = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(running)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    controller.commands.start(new File(['other'], 'other.xlsx'), { ...context, usage: 'timetable' })
    controller.commands.discard()
    expect(controller.getSnapshot()).toBe(running)
    extraction.resolve(extracted)
    await extraction.promise
    expect(controller.getSnapshot().job?.kind).toBe('normalizing')
    normalization.resolve(normalized)
    await normalization.promise
    expect(controller.getSnapshot().job).toMatchObject({ kind: 'review', context, fileName: '课表.xlsx', items: [{ subject: '语文' }] })
    expect(services.extractDocument).toHaveBeenCalledOnce()
    expect(services.normalizeTimetable).toHaveBeenCalledWith(file.name, '课程表', context.defaults, undefined)
    expect(listener).toHaveBeenCalledOnce()
    expect(services.importTimetableEntries).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('retains edited rows after a failed save, prevents duplicate saves, and clears only after success', async () => {
    const { controller, services } = setup()
    controller.commands.start(file, context)
    await vi.waitFor(() => { expect(controller.getSnapshot().job?.kind).toBe('review') })
    const review = controller.getSnapshot().job
    if (review?.kind !== 'review') throw new Error('Recognition did not reach review')
    controller.commands.updateItems(review.items.map(item => ({ ...item, selected: false })))
    await controller.commands.importSelected()
    expect(services.importTimetableEntries).not.toHaveBeenCalled()
    const edited = review.items.map(item => ({ ...item, subject: '语文（已确认）' }))
    controller.commands.updateItems(edited)
    const saving = Promise.withResolvers<Saved>()
    services.importTimetableEntries.mockReturnValueOnce(saving.promise)
    const firstSave = controller.commands.importSelected()
    await controller.commands.importSelected()
    controller.commands.updateItems([])
    controller.commands.discard()
    controller.commands.start(file, context)
    expect(controller.getSnapshot().job).toMatchObject({ saving: true, items: edited })
    expect(services.importTimetableEntries).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ subject: '语文（已确认）', usage: 'gradeTimetable' }),
    ])
    expect(services.importTimetableEntries.mock.calls[0]?.[0][0]).not.toHaveProperty('selected')
    saving.resolve({ ok: false, error: { code: 'storage-failure', message: 'Storage unavailable' } })
    await firstSave
    expect(controller.getSnapshot().job).toMatchObject({ saving: false, saveError: 'Storage unavailable', items: edited })
    await controller.commands.importSelected()
    expect(controller.getSnapshot().job).toBeNull()
    controller.commands.start(file, context)
    await vi.waitFor(() => { expect(controller.getSnapshot().job?.kind).toBe('review') })
    controller.commands.discard()
    expect(controller.getSnapshot().job).toBeNull()
    controller.dispose()
  })

  it.each(['extracting', 'normalizing', 'saving'] as const)('disposal suppresses late %s completions', async (stage) => {
    const { controller, services } = setup()
    const pending = Promise.withResolvers<never>()
    if (stage === 'extracting') services.extractDocument.mockReturnValue(pending.promise)
    if (stage === 'normalizing') services.normalizeTimetable.mockReturnValue(pending.promise)
    if (stage === 'saving') services.importTimetableEntries.mockReturnValue(pending.promise)
    controller.commands.start(file, context)
    await vi.waitFor(() => { expect(controller.getSnapshot().job?.kind).toBe(stage === 'saving' ? 'review' : stage) })
    const save = stage === 'saving' ? controller.commands.importSelected() : Promise.resolve()
    controller.dispose()
    const listener = vi.fn()
    controller.subscribe(listener)
    pending.reject(new Error('Connection closed'))
    await pending.promise.catch(() => {})
    await save
    controller.commands.start(file, context)
    expect(controller.getSnapshot().job).toBeNull()
    expect(listener).not.toHaveBeenCalled()
    if (stage === 'extracting') expect(services.normalizeTimetable).not.toHaveBeenCalled()
  })

  it.each(['extracting', 'normalizing'] as const)('publishes rejected %s requests as failures that can be cleared', async (stage) => {
    const { controller, services } = setup()
    if (stage === 'extracting') services.extractDocument.mockRejectedValue(new Error('Disconnected'))
    else services.normalizeTimetable.mockRejectedValue(new Error('Disconnected'))
    controller.commands.start(file, context)
    await vi.waitFor(() => { expect(controller.getSnapshot().job).toMatchObject({ kind: 'error', stage, message: 'Disconnected' }) })
    controller.commands.discard()
    expect(controller.getSnapshot().job).toBeNull()
    controller.dispose()
  })

  it.each(['extracting', 'normalizing'] as const)('ignores successful %s responses after disposal', async (stage) => {
    const { controller, services } = setup()
    const extraction = Promise.withResolvers<Extracted>()
    const normalization = Promise.withResolvers<Normalized>()
    services.extractDocument.mockReturnValue(extraction.promise)
    services.normalizeTimetable.mockReturnValue(normalization.promise)
    controller.commands.start(file, context)
    if (stage === 'normalizing') {
      extraction.resolve(extracted)
      await extraction.promise
    }
    controller.dispose()
    extraction.resolve(extracted)
    normalization.resolve(normalized)
    await Promise.all([extraction.promise, normalization.promise])
    expect(controller.getSnapshot().job).toBeNull()
    if (stage === 'extracting') expect(services.normalizeTimetable).not.toHaveBeenCalled()
  })

  it.each(['extracting', 'normalizing', 'empty'] as const)('retains %s failures for review after navigating away', async (stage) => {
    const { controller, services } = setup()
    if (stage === 'extracting') services.extractDocument.mockResolvedValue({
      ok: false, error: { code: 'provider-unavailable', message: 'OCR unavailable' },
    })
    else services.normalizeTimetable.mockResolvedValue(stage === 'empty'
      ? { ok: true, value: { items: [] } }
      : { ok: false, error: { code: 'timed-out', message: 'Recognition timed out' } })
    controller.commands.start(file, context)
    await vi.waitFor(() => { expect(controller.getSnapshot().job).toMatchObject({ kind: 'error', stage, fileName: file.name }) })
    expect(services.importTimetableEntries).not.toHaveBeenCalled()
    if (stage === 'extracting') expect(services.normalizeTimetable).not.toHaveBeenCalled()
    controller.commands.discard()
    expect(controller.getSnapshot().job).toBeNull()
    controller.dispose()
  })

  it('isolates a failing view subscriber while retaining a transport failure', async () => {
    const { controller, services } = setup()
    services.extractDocument.mockRejectedValue('Connection closed')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.subscribe(() => { throw new Error('Detached view') })
    const listener = vi.fn()
    controller.subscribe(listener)
    try {
      controller.commands.start(file, context)
      await vi.waitFor(() => { expect(controller.getSnapshot().job).toMatchObject({ kind: 'error', message: 'Connection closed' }) })
      expect(listener).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledTimes(2)
    } finally {
      controller.dispose()
      log.mockRestore()
    }
  })
})
