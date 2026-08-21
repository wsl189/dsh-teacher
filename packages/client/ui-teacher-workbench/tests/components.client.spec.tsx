// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  TeacherClassId,
  TeacherRecordId,
  TeacherRecordTemplateId,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS, type TeacherWorkbenchSettings } from '../src/settings.ts'
import { zh } from '../src/client/locales.ts'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { LessonPreparation } from '../src/client/LessonPreparation.tsx'
import { StudentRoster } from '../src/client/StudentRoster.tsx'
import { ScoreAnalysis } from '../src/client/ScoreAnalysis.tsx'
import { TeachingRecords } from '../src/client/TeachingRecords.tsx'
import { SidebarWorkbench, type SidebarWorkbenchProps } from '../src/client/SidebarWorkbench.tsx'
import { TeacherWorkbenchSettingsRow } from '../src/client/TeacherWorkbenchSettingsRow.tsx'
import { WorkbenchSurface, type WorkbenchSurfaceProps } from '../src/client/WorkbenchSurface.tsx'
import { formatMetric } from '../src/client/shared.tsx'

const t: WorkbenchSurfaceProps['t'] = (key, params) => {
  let value: string = zh[key as keyof typeof zh] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

const emptyState = (): TeacherWorkbenchState => ({
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  classes: [], students: [], resources: [], templates: [], records: [], exams: [],
  questionBatches: [], questionFolders: [], questionAssignments: [],
})

const globalProps: Pick<SidebarWorkbenchProps, 'useSessions' | 'useWorkspaces'> = {
  useSessions: (() => undefined) as SidebarWorkbenchProps['useSessions'],
  useWorkspaces: (() => undefined) as SidebarWorkbenchProps['useWorkspaces'],
}

function commands() {
  const ok = vi.fn(async () => ({ ok: true } as const))
  return {
    value: {
      saveDailyTodo: ok, toggleDailyTodo: ok, deleteDailyTodo: ok,
      saveQuickNote: ok, deleteQuickNote: ok, saveLedgerCategory: ok, deleteLedgerCategory: ok,
      saveLedgerEntry: ok, deleteLedgerEntry: ok, saveCalendarItem: ok, deleteCalendarItem: ok,
      extractDocument: vi.fn(), normalizeTimetable: vi.fn(), importCalendarItems: ok,
      saveTimetableEntry: ok, deleteTimetableEntry: ok, importTimetableEntries: ok,
      saveClass: ok, deleteClass: ok, saveStudent: ok, importStudents: ok, deleteStudent: ok,
      saveResource: ok, deleteResource: ok, saveTemplate: ok, deleteTemplate: ok,
      saveRecord: ok, toggleRecord: ok, deleteRecord: ok, saveExam: ok, deleteExam: ok,
    } as unknown as TeacherWorkbenchCommands,
    ok,
  }
}

afterEach(() => { cleanup() })

it('formats fractional metrics to one decimal place', () => {
  expect(formatMetric(12.25, '%')).toBe('12.3%')
})

describe('SidebarWorkbench', () => {
  it('expands seven functions and opens the selected module', () => {
    const actions = { setExpanded: vi.fn(), openModule: vi.fn(), close: vi.fn() }
    const state = { expanded: true, active: 'lesson' as const, open: true }
    const rendered = render(
      <SidebarWorkbench {...globalProps} wide useStore={selector => selector(state)} actions={actions} t={t} />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: '学生名册' }))
    expect(actions.openModule).toHaveBeenCalledWith('students')
    fireEvent.click(screen.getByRole('button', { name: '打开工作台' }))
    expect(actions.setExpanded).toHaveBeenCalledWith(false)
    rendered.rerender(
      <SidebarWorkbench
        {...globalProps}
        wide
        useStore={selector => selector({ ...state, expanded: false })}
        actions={actions}
        t={t}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('opens the active module from the collapsed rail', () => {
    const actions = { setExpanded: vi.fn(), openModule: vi.fn(), close: vi.fn() }
    render(<SidebarWorkbench {...globalProps} wide={false} useStore={selector => selector({ expanded: false, active: 'lesson', open: false })} actions={actions} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '打开工作台' }))
    expect(actions.openModule).toHaveBeenCalledWith('lesson')
  })
})

describe('LessonPreparation', () => {
  it('creates resources and observation templates', async () => {
    const c = commands()
    render(<LessonPreparation state={emptyState()} commands={c.value} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '添加资源' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '校本资源' } })
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.value.saveResource).toHaveBeenCalledWith({ category: 'resource', name: '校本资源', url: 'https://example.com', description: '' }) })

    fireEvent.click(screen.getByRole('tab', { name: '听课链接' }))
    fireEvent.click(screen.getByRole('button', { name: '新建听课模板' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '随堂观察' } })
    fireEvent.change(screen.getByLabelText('记录字段'), { target: { value: '目标\n反馈' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.value.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'observation', fields: ['目标', '反馈'] })) })
  })
})

describe('StudentRoster', () => {
  it('creates a class, a student, and imports pasted roster rows', async () => {
    const c = commands()
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      classes: [{ id: 'class-a' as TeacherClassId, usage: 'roster', name: '高一（1）班', grade: '高一', subject: '数学' }],
    }
    render(<StudentRoster state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c.value} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '添加学生' }))
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张同学' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.value.saveStudent).toHaveBeenCalledWith(expect.objectContaining({ classId: 'class-a', name: '张同学' })) })

    fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    fireEvent.change(screen.getByLabelText('批量导入'), { target: { value: '姓名\t学号\n李同学\t002' } })
    fireEvent.click(screen.getByRole('button', { name: '导入名册' }))
    await waitFor(() => { expect(c.value.importStudents).toHaveBeenCalledWith('class-a', [expect.objectContaining({ name: '李同学', studentNumber: '002' })]) })
  })

  it('opens class creation when no class exists', async () => {
    const c = commands()
    render(<StudentRoster state={emptyState()} settings={{ ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, defaultSubject: '语文' }} commands={c.value} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '新建班级' }))
    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '新班' } })
    expect(screen.getByLabelText<HTMLInputElement>('学科').value).toBe('语文')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.value.saveClass).toHaveBeenCalledWith({ usage: 'roster', name: '新班', grade: '', subject: '语文' }) })
  })
})

describe('ScoreAnalysis', () => {
  it('imports scores and renders all three analysis modes', async () => {
    const c = commands()
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      classes: [{ id: 'class-a' as TeacherClassId, usage: 'roster', name: '一班', grade: '', subject: '' }],
      students: [{ id: 'student-a' as TeacherStudentId, classId: 'class-a' as TeacherClassId, name: '张同学', studentNumber: '001', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {} }],
      exams: [{ id: 'exam-a' as never, classId: 'class-a' as TeacherClassId, name: '期中', date: '2026-08-01', entries: [{ studentId: 'student-a' as TeacherStudentId, scores: { 数学: 90, 语文: 80 } }] }],
    }
    render(<ScoreAnalysis state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c.value} t={t} />)
    expect(screen.getAllByText('170').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '多次追踪' }))
    expect(screen.getByText(/平均分 170/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '个人成长' }))
    expect(screen.getAllByText('170').length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: '导入成绩' }).at(-1)!)
    fireEvent.change(screen.getByLabelText('考试名称'), { target: { value: '期末' } })
    fireEvent.change(screen.getByLabelText('考试日期'), { target: { value: '2026-08-19' } })
    fireEvent.change(screen.getByLabelText('导入成绩'), { target: { value: '姓名\t数学\n张同学\t95' } })
    fireEvent.click(screen.getAllByRole('button', { name: '导入成绩' }).at(-1)!)
    await waitFor(() => { expect(c.value.saveExam).toHaveBeenCalledWith(expect.objectContaining({ name: '期末', date: '2026-08-19', entries: [{ studentId: 'student-a', scores: { 数学: 95 } }] })) })
  })
})

describe('TeachingRecords', () => {
  it('toggles and creates dynamic template-backed records', async () => {
    const c = commands()
    const templateId = 'template-a' as TeacherRecordTemplateId
    const recordId = 'record-a' as TeacherRecordId
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      templates: [{ id: templateId, kind: 'teaching', name: '课后反思', scene: '', fields: ['问题', '行动'] }],
      records: [{ id: recordId, templateId, title: '第一课', dueDate: '2026-08-17', status: 'active', values: { 问题: '节奏' }, updatedAt: 1 }],
    }
    render(<TeachingRecords state={state} commands={c.value} t={t} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(c.value.toggleRecord).toHaveBeenCalledWith(recordId)
    fireEvent.click(screen.getByRole('button', { name: '新建教学记录' }))
    fireEvent.change(screen.getByLabelText('记录标题'), { target: { value: '第二课' } })
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '提问不足' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.value.saveRecord).toHaveBeenCalledWith(expect.objectContaining({ templateId, title: '第二课', values: { 问题: '提问不足' } })) })
  })
})

describe('TeacherWorkbenchSettingsRow', () => {
  it('edits and persists text and numeric dsh settings fields', () => {
    const setSetting = vi.fn(async () => {})
    const snapshot = {
      status: 'ready' as const,
      value: DEFAULT_TEACHER_WORKBENCH_SETTINGS,
      base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const,
    }
    render(
      <TeacherWorkbenchSettingsRow
        {...globalProps}
        useTeacherSettings={selector => selector(snapshot)}
        setSetting={setSetting}
        t={t}
      />,
    )
    const teacher = screen.getByLabelText('教师姓名')
    fireEvent.change(teacher, { target: { value: '王老师' } })
    fireEvent.blur(teacher)
    expect(setSetting).toHaveBeenCalledWith('teacherName', '王老师')
    const pass = screen.getByLabelText('及格线')
    fireEvent.change(pass, { target: { value: '65' } })
    fireEvent.blur(pass)
    expect(setSetting).toHaveBeenCalledWith('passScore', 65)

    for (const [label, field, value] of [
      ['当前学年', 'academicYear', '2026-2027'],
      ['学校名称', 'schoolName', '海淀中学'],
      ['默认学科', 'defaultSubject', '物理'],
      ['天气地点', 'weatherLocation', '浦东新区, 上海市'],
      ['满分', 'scoreFullMark', '120'],
      ['优秀线', 'excellentScore', '95'],
    ] as const) {
      const input = screen.getByLabelText(label)
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
      expect(setSetting).toHaveBeenCalledWith(field, typeof DEFAULT_TEACHER_WORKBENCH_SETTINGS[field] === 'number' ? Number(value) : value)
    }
    fireEvent.change(screen.getByLabelText('语音识别语言'), { target: { value: 'en-US' } })
    expect(setSetting).toHaveBeenCalledWith('speechLanguage', 'en-US')
  })

  it('uses defaults while unavailable and ignores non-numeric threshold input', () => {
    const setSetting = vi.fn(async () => {})
    const cold = {
      status: 'unavailable' as const,
      value: undefined,
      base: {}, user: {}, revision: 0, writable: false, mode: 'host' as const,
    }
    const rendered = render(
      <TeacherWorkbenchSettingsRow
        {...globalProps}
        useTeacherSettings={selector => selector(cold)}
        setSetting={setSetting}
        t={t}
      />,
    )
    expect(screen.getByLabelText<HTMLInputElement>('教师姓名').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('满分').value).toBe('100')

    const readOnly = { ...cold, status: 'ready' as const }
    rendered.rerender(
      <TeacherWorkbenchSettingsRow
        {...globalProps}
        useTeacherSettings={selector => selector(readOnly)}
        setSetting={setSetting}
        t={t}
      />,
    )
    const fullMark = screen.getByLabelText('满分')
    fireEvent.change(fullMark, { target: { value: 'not-a-number' } })
    expect((fullMark as HTMLInputElement).value).toBe('100')
  })

  it('preserves staged fields while completed writes refresh the settings snapshot', async () => {
    const setSetting = vi.fn(async () => {})
    let snapshot = {
      status: 'ready' as const,
      value: DEFAULT_TEACHER_WORKBENCH_SETTINGS,
      base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const,
    }
    const row = () => {
      const current = snapshot
      return (
        <TeacherWorkbenchSettingsRow
          {...globalProps}
          useTeacherSettings={selector => selector(current)}
          setSetting={setSetting}
          t={t}
        />
      )
    }
    const rendered = render(row())
    fireEvent.change(screen.getByLabelText('学校名称'), { target: { value: '海淀中学' } })

    snapshot = {
      ...snapshot,
      value: { ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, teacherName: '王老师' },
      revision: 2,
    }
    rendered.rerender(row())

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('教师姓名').value).toBe('王老师')
      expect(screen.getByLabelText<HTMLInputElement>('学校名称').value).toBe('海淀中学')
    })
    fireEvent.blur(screen.getByLabelText('学校名称'))
    expect(setSetting).toHaveBeenCalledWith('schoolName', '海淀中学')
  })

  it('settles only the current staged value against the latest snapshot', async () => {
    let resolveFirst!: () => void
    let resolveThird!: () => void
    const first = new Promise<void>((resolve) => { resolveFirst = resolve })
    const third = new Promise<void>((resolve) => { resolveThird = resolve })
    const setSetting = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => third)
    let snapshot: {
      status: 'ready' | 'unavailable'
      value: TeacherWorkbenchSettings | undefined
      base: Record<string, never>
      user: Record<string, never>
      revision: number
      writable: boolean
      mode: 'host'
    } = {
      status: 'ready', value: DEFAULT_TEACHER_WORKBENCH_SETTINGS,
      base: {}, user: {}, revision: 1, writable: true, mode: 'host',
    }
    const row = () => (
      <TeacherWorkbenchSettingsRow
        {...globalProps}
        useTeacherSettings={selector => selector(snapshot)}
        setSetting={setSetting}
        t={t}
      />
    )
    const rendered = render(row())
    const teacher = screen.getByLabelText('教师姓名')
    fireEvent.change(teacher, { target: { value: '王老师' } })
    fireEvent.blur(teacher)
    fireEvent.change(teacher, { target: { value: '王老师二' } })
    resolveFirst()
    await waitFor(() => { expect((teacher as HTMLInputElement).value).toBe('王老师二') })

    snapshot = {
      ...snapshot,
      value: { ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, teacherName: '王老师二' },
      revision: 2,
    }
    rendered.rerender(row())
    await waitFor(() => { expect((teacher as HTMLInputElement).value).toBe('王老师二') })
    fireEvent.blur(teacher)
    await waitFor(() => { expect(setSetting).toHaveBeenCalledTimes(2) })

    const school = screen.getByLabelText('学校名称')
    fireEvent.change(school, { target: { value: '海淀中学' } })
    fireEvent.blur(school)
    snapshot = { ...snapshot, status: 'unavailable', value: undefined, revision: 3 }
    rendered.rerender(row())
    resolveThird()
    await waitFor(() => { expect((school as HTMLInputElement).value).toBe('海淀中学') })
  })
})

describe('WorkbenchSurface', () => {
  const propsFor = (
    active: 'daily' | 'timetable' | 'lesson' | 'students' | 'scores' | 'records',
    snapshot: {
      status: 'cold' | 'loading' | 'ready' | 'saving' | 'error'
      document: { revision: number; state: TeacherWorkbenchState } | null
      error: { code: string; message: string } | null
    },
    value = DEFAULT_TEACHER_WORKBENCH_SETTINGS,
  ): WorkbenchSurfaceProps => {
    const c = commands()
    const view = { expanded: true, open: true, active }
    const settings = {
      status: 'ready' as const,
      value,
      base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const,
    }
    return {
      useStore: selector => selector(view),
      actions: { setExpanded: vi.fn(), openModule: vi.fn(), close: vi.fn() },
      useWorkbench: selector => selector(snapshot),
      useTeacherSettings: selector => selector(settings),
      ensure: vi.fn(async () => ({ ok: true })),
      subscribeSessionNavigation: vi.fn(() => () => {}),
      setWeatherLocation: vi.fn(async () => {}),
      setTeacherName: vi.fn(async () => {}),
      loadWeather: vi.fn(async () => { throw new Error('weather is not configured') }),
      ...c.value,
      t,
      sidebarWidth: 280,
      detailsWidth: 0,
    } as WorkbenchSurfaceProps
  }

  it('loads in the main area without a duplicate header and closes on Session navigation', async () => {
    const loading = propsFor('lesson', { status: 'loading', document: null, error: null })
    let navigate: (() => void) | undefined
    loading.subscribeSessionNavigation = vi.fn((listener: () => void) => {
      navigate = listener
      return () => { navigate = undefined }
    })
    const rendered = render(<WorkbenchSurface {...loading} />)
    expect(screen.getByRole('region', { name: '工作台' })).toBeTruthy()
    expect(screen.queryByText('工作台')).toBeNull()
    expect(screen.queryByRole('button', { name: '关闭工作台' })).toBeNull()
    expect(screen.getByText('正在载入工作台…')).toBeTruthy()
    await waitFor(() => { expect(loading.ensure).toHaveBeenCalled() })
    act(() => { navigate?.() })
    expect(loading.actions.close).toHaveBeenCalled()

    const saving = propsFor('lesson', {
      status: 'saving', document: { revision: 1, state: emptyState() }, error: null,
    }, { ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, schoolName: '海淀中学', teacherName: '王老师' })
    rendered.rerender(<WorkbenchSurface {...saving} />)
    expect(screen.getByText('正在保存…')).toBeTruthy()

    const modules = [
      ['daily', '今天还没有待办'],
      ['timetable', '今日课表'],
      ['students', '新建班级'],
      ['scores', '当前班级还没有考试数据'],
      ['records', '新建教学记录'],
    ] as const
    for (const [active, expected] of modules) {
      rendered.rerender(<WorkbenchSurface {...propsFor(active, {
        status: 'ready', document: { revision: 1, state: emptyState() }, error: null,
      })} />)
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
    }
  })

  it('maps host failures to localized recovery copy', () => {
    const errors = [
      ['revision-conflict', '数据已在其他窗口更新，请重试'],
      ['invalid-state', '数据关系无效，未保存本次更改'],
      ['offline', '无法连接工作台服务'],
    ] as const
    const first = propsFor('lesson', {
      status: 'error', document: null, error: { code: errors[0][0], message: 'failure' },
    })
    const rendered = render(<WorkbenchSurface {...first} />)
    expect(screen.getByText(errors[0][1])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    expect(first.ensure).toHaveBeenCalled()
    for (const [code, message] of errors.slice(1)) {
      rendered.rerender(<WorkbenchSurface {...propsFor('lesson', {
        status: 'error', document: null, error: { code, message: 'failure' },
      })} />)
      expect(screen.getByText(message)).toBeTruthy()
    }
  })

  it('does not load while closed and falls back to default settings', () => {
    const closed = propsFor('lesson', {
      status: 'ready', document: { revision: 1, state: emptyState() }, error: null,
    })
    closed.useStore = selector => selector({ expanded: true, open: false, active: 'lesson' })
    closed.useTeacherSettings = selector => selector({
      status: 'ready', value: undefined, base: {}, user: {}, revision: 1, writable: true, mode: 'host',
    })
    render(<WorkbenchSurface {...closed} />)
    expect(closed.ensure).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '工作台' })).toBeNull()
  })
})
