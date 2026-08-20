// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  TeacherClassId,
  TeacherTimetableEntryId,
  TeacherWeekday,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../src/settings.ts'
import { Timetable } from '../src/client/Timetable.tsx'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
})

function commands(): TeacherWorkbenchCommands {
  const action = () => vi.fn(async () => ({ ok: true } as const))
  return {
    saveDailyTodo: action(), toggleDailyTodo: action(), deleteDailyTodo: action(),
    saveQuickNote: action(), deleteQuickNote: action(), saveCalendarItem: action(), deleteCalendarItem: action(),
    extractDocument: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
    extractQuestionLayout: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
    importCalendarItems: action(), saveTimetableEntry: action(), deleteTimetableEntry: action(), importTimetableEntries: action(),
    saveClass: action(), deleteClass: action(), saveStudent: action(), importStudents: action(), deleteStudent: action(),
    createQuestionFolder: action(), deleteQuestionFolder: action(),
    saveResource: action(), deleteResource: action(), saveTemplate: action(), deleteTemplate: action(),
    saveRecord: action(), toggleRecord: action(), deleteRecord: action(), saveExam: action(), deleteExam: action(),
    saveQuestionBatch: action(), replaceQuestionImage: action(), deleteQuestionImage: action(),
    deleteQuestionBatch: action(), assignQuestions: action(),
    saveTemporaryQuestionSelection: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    listTemporaryQuestionSelections: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    readQuestionImage: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    generateQuestionDocument: vi.fn(async () => ({ ok: false, error: { code: 'generation-failure', message: 'unavailable' } } as const)),
    generateUploadedQuestionDocument: vi.fn(async () => ({ ok: false, error: { code: 'generation-failure', message: 'unavailable' } } as const)),
    generateStudentDocuments: vi.fn(async () => ({ ok: false, error: { code: 'generation-failure', message: 'unavailable' } } as const)),
  }
}

function weekdayToday(): TeacherWeekday {
  const day = new Date().getDay()
  return (day === 0 ? 7 : day) as TeacherWeekday
}

function state(): TeacherWorkbenchState {
  const classA = 'week-class-a' as TeacherClassId
  const classB = 'week-class-b' as TeacherClassId
  const classC = 'week-class-c' as TeacherClassId
  const gradeClassA = 'grade-class-a' as TeacherClassId
  const gradeClassB = 'grade-class-b' as TeacherClassId
  const weekday = weekdayToday()
  return {
    dailyTodos: [], quickNotes: [], calendarItems: [], students: [], resources: [], templates: [], records: [], exams: [],
    questionBatches: [], questionFolders: [], questionAssignments: [],
    classes: [
      { id: classA, usage: 'timetable', name: '高一（1）班', grade: '高一', subject: '数学' },
      { id: classB, usage: 'timetable', name: '高一（2）班', grade: '高一', subject: '物理' },
      { id: classC, usage: 'timetable', name: '高一（3）班', grade: '高一', subject: '历史' },
      { id: gradeClassA, usage: 'gradeTimetable', name: '年级一班', grade: '高一', subject: '数学' },
      { id: gradeClassB, usage: 'gradeTimetable', name: '年级二班', grade: '高一', subject: '物理' },
      { id: 'roster-class' as TeacherClassId, usage: 'roster', name: '试题切割班', grade: '高一', subject: '数学' },
    ],
    timetableEntries: [
      {
        id: 'entry-math' as TeacherTimetableEntryId, classId: classA, kind: 'lesson', weekday, period: 1,
        startTime: '08:00', endTime: '08:45', subject: '数学', teacherName: '王老师', location: '101', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'entry-physics' as TeacherTimetableEntryId, classId: classB, kind: 'lesson', weekday, period: 2,
        startTime: '09:00', endTime: '09:45', subject: '物理', teacherName: '王老师', location: '202', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'entry-history' as TeacherTimetableEntryId, classId: classC, kind: 'lesson', weekday, period: 3,
        startTime: '10:00', endTime: '10:45', subject: '历史', teacherName: '王老师', location: '303', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'entry-english' as TeacherTimetableEntryId, classId: classA, kind: 'lesson', weekday: weekday === 7 ? 1 : weekday + 1 as TeacherWeekday, period: 2,
        startTime: '', endTime: '', subject: '英语', teacherName: '李老师', location: '', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'entry-grade-math' as TeacherTimetableEntryId, classId: gradeClassA, kind: 'lesson', weekday, period: 1,
        startTime: '', endTime: '', subject: '年级数学', teacherName: '王老师', location: '', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'entry-grade-physics' as TeacherTimetableEntryId, classId: gradeClassB, kind: 'lesson', weekday, period: 2,
        startTime: '', endTime: '', subject: '物理', teacherName: '王老师', location: '', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'entry-study' as TeacherTimetableEntryId, classId: classA, kind: 'morningStudy', weekday, period: 1,
        startTime: '07:20', endTime: '07:50', subject: '语文晨读', teacherName: '王老师', location: '101', createdAt: 1, updatedAt: 1,
      },
    ],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Timetable', () => {
  it('projects shared entries by class, teacher, week, grade, and study type', async () => {
    const c = commands()
    render(<Timetable
      state={state()}
      settings={{ ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, teacherName: '王老师' }}
      commands={c}
      setTeacherName={vi.fn(async () => {})}
      t={t}
    />)

    expect(screen.getByText('数学')).toBeTruthy()
    expect(screen.queryByText('物理')).toBeNull()
    expect(screen.queryByRole('button', { name: '选择班级' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加班级' })).toBeNull()
    expect(screen.queryByRole('button', { name: '识别课程表' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加课程' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: '上课班级' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '地点' })).toBeNull()
    expect(screen.getByRole('cell', { name: '高一（1）班' })).toBeTruthy()
    expect(screen.queryByText('101')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '筛选教师姓名' }).value).toBe('王老师')
    fireEvent.click(screen.getByRole('checkbox', { name: '仅显示' }))
    expect(screen.getByText('物理')).toBeTruthy()
    expect(screen.getByText('历史')).toBeTruthy()
    expect(screen.getByRole('cell', { name: '高一（2）班' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '高一（3）班' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '本周课表' }))
    expect(screen.getByRole('button', { name: '添加班级' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '识别课程表' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加课程' })).toBeTruthy()
    expect(screen.getByText('数学')).toBeTruthy()
    expect(screen.getByText('物理')).toBeTruthy()
    expect(screen.queryByText('英语')).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /数学/ }))
    expect(screen.getByRole('dialog', { name: '编辑课程' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('课程'), { target: { value: '化学' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveTimetableEntry).toHaveBeenCalledWith(expect.objectContaining({
        id: 'entry-math', weekday: weekdayToday(), period: 1, subject: '化学', classId: 'week-class-a', usage: 'timetable',
      }))
    })
    fireEvent.change(screen.getByRole('textbox', { name: '筛选教师姓名' }), { target: { value: '李老师' } })
    expect(screen.getByText('英语')).toBeTruthy()
    expect(screen.queryByText('物理')).toBeNull()
    expect(screen.queryByText('历史')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '仅显示' }))
    expect(screen.getByText('英语')).toBeTruthy()
    expect(screen.queryByText('物理')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '年级课表' }))
    expect(screen.getByText('物理')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '早晚自习' }))
    expect(screen.getByText('语文晨读')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '今日课表' }))
    expect(screen.queryByRole('button', { name: '选择班级' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加班级' })).toBeNull()
    expect(screen.queryByRole('button', { name: '识别课程表' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加课程' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
  })

  it('switches classes through the workbench menu and adds a class in place', async () => {
    const c = commands()
    render(<Timetable
      state={state()}
      settings={{ ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, defaultSubject: '数学' }}
      commands={c}
      setTeacherName={vi.fn(async () => {})}
      t={t}
    />)

    expect(screen.queryByRole('combobox', { name: '选择班级' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '本周课表' }))
    fireEvent.click(screen.getByRole('button', { name: '选择班级' }))
    expect(screen.queryByRole('menuitem', { name: '年级一班' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '试题切割班' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '高一（2）班' }))
    expect(screen.getByText('物理')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '今日课表' }))
    expect(screen.getByText('物理')).toBeTruthy()
    expect(screen.queryByText('数学')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '本周课表' }))

    fireEvent.click(screen.getByRole('tab', { name: '早晚自习' }))
    fireEvent.click(screen.getByRole('button', { name: '选择班级' }))
    expect(screen.getByRole('menuitem', { name: '高一（1）班' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '年级一班' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '试题切割班' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '高一（1）班' }))
    fireEvent.click(screen.getByRole('tab', { name: '本周课表' }))

    fireEvent.click(screen.getByRole('button', { name: '添加班级' }))
    expect(screen.getByRole('dialog', { name: '添加班级' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '高一（4）班' } })
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: '高一' } })
    fireEvent.change(screen.getByLabelText('学科'), { target: { value: '化学' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.saveClass).toHaveBeenCalledWith({ usage: 'timetable', name: '高一（4）班', grade: '高一', subject: '化学' })
    })
  })

  it('extracts, reviews, and imports a course table through the shared OCR command', async () => {
    const c = commands()
    vi.mocked(c.extractDocument).mockResolvedValueOnce({
      ok: true,
      value: {
        name: '高一课表.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        markdown: '| 节次 | 周一 | 周二 |\n| --- | --- | --- |\n| 第1节 | 数学 | 语文 |',
        provider: 'mineru', truncated: false,
      },
    })
    const rendered = render(<Timetable
      state={state()}
      settings={{ ...DEFAULT_TEACHER_WORKBENCH_SETTINGS, teacherName: '王老师' }}
      commands={c}
      setTeacherName={vi.fn(async () => {})}
      t={t}
    />)

    fireEvent.click(screen.getByRole('tab', { name: '本周课表' }))
    fireEvent.click(screen.getByRole('button', { name: '识别课程表' }))
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['sheet'], '高一课表.xlsx')] } })

    expect(await screen.findByRole('dialog', { name: '上传并识别课程表' })).toBeTruthy()
    expect(await screen.findByText('识别到 2 节，请确认班级、星期和节次后导入')).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('课程')[0]!, { target: { value: '数学（确认）' } })
    fireEvent.click(screen.getByRole('button', { name: '导入 2 节' }))
    await waitFor(() => {
      expect(c.importTimetableEntries).toHaveBeenCalledWith([
        expect.objectContaining({ classId: 'week-class-a', usage: 'timetable', className: '高一（1）班', weekday: 1, period: 1, subject: '数学（确认）' }),
        expect.objectContaining({ classId: 'week-class-a', usage: 'timetable', className: '高一（1）班', weekday: 2, period: 1, subject: '语文' }),
      ])
    })
  })
})
