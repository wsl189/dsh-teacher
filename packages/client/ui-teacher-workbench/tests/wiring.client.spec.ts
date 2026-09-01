// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeacherWorkbenchDocument, TeacherWorkbenchState } from '@deepseek-ai/dsh-api-remotes/client'
import {
  apply as nodeApply,
  TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
  TeacherWorkbenchSettingsSchema,
  validateTeacherWorkbenchSettings,
} from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { apply, inject } from '../src/client/index.ts'
import { createTeacherWorkbenchViewStore } from '../src/client/view-store.ts'

const pdfMocks = vi.hoisted(() => ({ workerHandler: { setup: vi.fn() } }))

vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: pdfMocks.workerHandler }))

const emptyState = (): TeacherWorkbenchState => ({
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  classes: [], students: [], resources: [], templates: [], records: [], exams: [],
  questionBatches: [], questionLibraryFolders: [], questionFolders: [], questionAssignments: [],
  noticeTemplates: [], notices: [], seatingLayouts: [],
})

afterEach(() => { vi.unstubAllGlobals() })

describe('teacher-workbench node wiring', () => {
  it('registers its settings namespace when the settings service appears', () => {
    const register = vi.fn()
    const ctx = {
      inject: vi.fn((_dependencies: string[], install: (scope: unknown) => void) => {
        install({ settings: { register } })
      }),
    }
    nodeApply(ctx as never)
    expect(ctx.inject).toHaveBeenCalledWith(['settings'], expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
      TeacherWorkbenchSettingsSchema,
      { validate: validateTeacherWorkbenchSettings },
    )
  })

  it('rejects inverted score thresholds', () => {
    expect(() => {
      validateTeacherWorkbenchSettings({
        academicYear: '2026',
        teacherName: '', schoolName: '', defaultSubject: '',
        weatherLocation: '',
        scoreFullMark: 100, excellentScore: 59, passScore: 60,
        questionRenderScale: 2, questionCropPadding: 12,
      })
    }).toThrow('passScore')
    expect(() => {
      validateTeacherWorkbenchSettings({
        academicYear: '2026',
        teacherName: '', schoolName: '', defaultSubject: '',
        weatherLocation: '',
        scoreFullMark: 100, excellentScore: 101, passScore: 60,
        questionRenderScale: 2, questionCropPadding: 12,
      })
    }).toThrow('excellentScore')
    expect(() => {
      validateTeacherWorkbenchSettings({
        academicYear: '2026',
        teacherName: '', schoolName: '', defaultSubject: '',
        weatherLocation: '',
        scoreFullMark: 100, excellentScore: 85, passScore: 60,
        questionRenderScale: 2, questionCropPadding: 12,
      })
    }).not.toThrow()
  })

  it('registers the package-owned empty invariant installer', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_name: string, _installer: () => void) => dispose)
    const result = await invariant.apply({ invariants: { register } } as never)
    expect(register).toHaveBeenCalledWith(
      '@deepseek-ai/dsh-client-ui-teacher-workbench',
      expect.any(Function),
    )
    const installer = register.mock.calls[0]![1]
    installer()
    expect(result).toBe(dispose)
  })
})

describe('teacher-workbench view store', () => {
  it('owns disclosure, active-module, and open state without persistence', () => {
    const { store, actions } = createTeacherWorkbenchViewStore().create()
    expect(store.getSnapshot()).toEqual({ expanded: false, open: false, active: 'daily' })
    actions.setExpanded(true)
    actions.openModule('students')
    expect(store.getSnapshot()).toEqual({ expanded: true, open: true, active: 'students' })
    actions.openModule('scores')
    actions.close()
    expect(store.getSnapshot()).toEqual({ expanded: true, open: false, active: 'scores' })
  })
})

describe('teacher-workbench browser wiring', () => {
  it('registers all seats and forwards their semantic commands', async () => {
    expect(inject).toEqual([
      'slots', 'locale', 'connection', 'remote', 'remote.ocr', 'remote.speech', 'remote.teacherWorkbench', 'sessions', 'settingsScope',
    ])
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'generated-id') })
    let document: TeacherWorkbenchDocument = { revision: 0, state: emptyState() }
    const read = vi.fn(async () => ({ ok: true, value: { ok: true, value: document } }))
    const write = vi.fn(async ({ state }: { state: TeacherWorkbenchState }) => {
      document = { revision: document.revision + 1, state }
      return { ok: true, value: { ok: true, value: document } }
    })
    const weather = vi.fn(async () => ({
      ok: true,
      value: { ok: false, error: { code: 'location-not-found', message: 'missing' } },
    }))
    const normalizeTimetable = vi.fn(async () => ({
      ok: true,
      value: { ok: true, value: { items: [] } },
    }))
    const transcribe = vi.fn(async () => ({
      ok: true,
      value: { ok: true, value: { text: '课堂记录', provider: 'model-settings' } },
    }))
    const setSetting = vi.fn(async () => {})
    const scope = { set: setSetting }
    const registrations: { entry: Record<string, unknown>; component: unknown }[] = []
    const resetListeners: (() => void)[] = []
    const navigationListeners: (() => void)[] = []
    let currentSession = 'session-a'
    const effectDisposers: (() => void | Promise<void>)[] = []
    const localeDispose = vi.fn()
    const slotDispose = vi.fn()
    const ctx = {
      locale: { register: vi.fn(() => localeDispose) },
      remote: { speech: { transcribe }, teacherWorkbench: { read, write, weather, normalizeTimetable } },
      sessions: {
        list: {
          getSnapshot: () => ({ current: currentSession }),
        },
      },
      settingsScope: { bind: vi.fn(() => scope) },
      effect: vi.fn((factory: () => undefined | (() => void | Promise<void>)) => {
        const result = factory()
        if (typeof result === 'function') effectDisposers.push(result)
      }),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'connection/reset') resetListeners.push(listener)
        if (event === 'sessions/navigate') navigationListeners.push(listener)
        return () => {
          const list = event === 'connection/reset' ? resetListeners : navigationListeners
          const index = list.indexOf(listener)
          if (index !== -1) list.splice(index, 1)
        }
      }),
      slots: {
        inject: vi.fn((_name: string, install: () => void) => { install() }),
        register: vi.fn((entry: Record<string, unknown>, component: unknown) => {
          registrations.push({ entry, component })
          return slotDispose
        }),
      },
    }

    apply(ctx as never)
    expect(registrations.map(item => item.entry.name)).toEqual([
      'sidebar.primary.section', 'shell.overlay', 'settings.general.item',
    ])
    expect(ctx.locale.register).toHaveBeenCalledWith('teacherWorkbench', expect.any(Object))
    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({
      namespace: TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
    })

    resetListeners[0]!()
    expect(read).not.toHaveBeenCalled()
    const surfaceEntry = registrations.find(item => item.entry.name === 'shell.overlay')!.entry
    const surface = (surfaceEntry.inject as () => Record<string, unknown>)()
    const navigated = vi.fn()
    const stopNavigation = (surface.subscribeSessionNavigation as (listener: () => void) => () => void)(navigated)
    currentSession = 'session-b'
    navigationListeners[0]!()
    expect(navigated).toHaveBeenCalledOnce()
    stopNavigation()
    expect(navigationListeners).toHaveLength(0)
    await (surface.ensure as () => Promise<unknown>)()
    await (surface.ensure as () => Promise<unknown>)()
    expect(read).toHaveBeenCalledTimes(2)
    resetListeners[0]!()
    await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(3) })

    const command = async (name: string, ...args: unknown[]): Promise<void> => {
      await (surface[name] as (...values: unknown[]) => Promise<unknown>)(...args)
    }
    await command('saveDailyTodo', { title: '待办', dueAt: '2026-08-18T18:00' })
    await expect((surface.transcribeVoice as (audio: Blob) => Promise<string>)(
      new Blob([Uint8Array.of(1, 2)], { type: 'audio/webm' }),
    )).resolves.toBe('课堂记录')
    expect(transcribe).toHaveBeenCalledWith({ mediaType: 'audio/webm', contentBase64: 'AQI=' })
    await command('toggleDailyTodo', 'todo-a')
    await command('deleteDailyTodo', 'todo-a')
    await command('saveQuickNote', { content: '备忘录' })
    await command('deleteQuickNote', 'note-a')
    await command('saveLedgerCategory', { name: '保险保费' })
    await command('saveLedgerEntry', { categoryId: 'ledger-category-a', description: '车险', amountCents: 120000, occurredAt: '2026-08-18T10:00' })
    await command('deleteLedgerEntry', 'ledger-entry-a')
    await command('deleteLedgerCategory', 'ledger-category-a')
    await command('saveCalendarItem', {
      date: '2026-08-18', time: '09:00', title: '教研', details: '',
    })
    await command('deleteCalendarItem', 'calendar-a')
    await command('saveClass', { usage: 'roster', name: '一班', grade: '高一', subject: '数学' })
    await command('saveTimetableEntry', {
      usage: 'timetable',
      className: '一班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
      startTime: '', endTime: '', subject: '数学', teacherName: '王老师', location: '',
    })
    await command('importTimetableEntries', [])
    await command('deleteTimetableEntry', 'timetable-a')
    await command('normalizeTimetable', '课表.png', '| 周一 |', {
      className: '一班', classNames: ['一班'], grade: '高一', kind: 'lesson', target: 'class', teacherName: '王老师',
    })
    expect(normalizeTimetable).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'session-b', fileName: '课表.png', markdown: '| 周一 |',
    }))
    await command('deleteClass', 'class-a')
    await command('saveStudent', {
      classId: 'class-a', name: '学生', studentNumber: '', gender: '', guardian: '', relation: '',
      phone: '', address: '',
    })
    await command('importStudents', 'class-a', [])
    await command('deleteStudent', 'student-a')
    await command('saveResource', {
      category: 'resource', name: '资源', url: 'https://example.com', description: '',
    })
    await command('deleteResource', 'resource-a')
    await command('saveTemplate', {
      kind: 'teaching', name: '反思', scene: '', fields: ['问题'],
    })
    await command('deleteTemplate', 'template-a')
    await command('saveRecord', {
      templateId: 'template-a', title: '记录', dueDate: '', status: 'active', values: {},
    })
    await command('toggleRecord', 'record-a')
    await command('deleteRecord', 'record-a')
    await command('saveExam', {
      classId: 'class-a', name: '期中', date: '', entries: [],
    })
    await command('deleteExam', 'exam-a')

    const settingsEntry = registrations.find(item => item.entry.name === 'settings.general.item')!.entry
    const settings = (settingsEntry.inject as () => Record<string, unknown>)()
    await (settings.setSetting as (field: string, value: string) => Promise<void>)('teacherName', '王老师')
    expect(setSetting).toHaveBeenCalledWith('teacherName', '王老师')
    await (surface.setWeatherLocation as (location: string) => Promise<void>)('浦东新区, 上海市')
    expect(setSetting).toHaveBeenCalledWith('weatherLocation', '浦东新区, 上海市')
    await (surface.setTeacherName as (name: string) => Promise<void>)('李老师')
    expect(setSetting).toHaveBeenCalledWith('teacherName', '李老师')
    await expect((surface.loadWeather as (location: string) => Promise<unknown>)('不存在')).rejects.toMatchObject({
      code: 'location-not-found',
    })
    expect(weather).toHaveBeenCalledWith({ location: '不存在' })
    expect((surface.hooks as Record<string, unknown>).teacherSettings).toBe(scope)
    const questionCutting = (surface.hooks as Record<string, unknown>).questionCutting as {
      readonly getSnapshot?: unknown
      readonly subscribe?: unknown
    }
    expect(typeof questionCutting.getSnapshot).toBe('function')
    expect(typeof questionCutting.subscribe).toBe('function')
    expect((settings.hooks as Record<string, unknown>).teacherSettings).toBe(scope)

    for (const disposer of effectDisposers) await Promise.resolve(disposer())
    await expect((surface.saveClass as (value: unknown) => Promise<unknown>)({
      name: '已销毁', grade: '', subject: '',
    })).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
  })
})
