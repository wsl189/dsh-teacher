// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  TeacherClassId,
  TeacherExamId,
  TeacherLessonResourceId,
  TeacherRecordId,
  TeacherRecordTemplateId,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../src/settings.ts'
import { LessonPreparation } from '../src/client/LessonPreparation.tsx'
import { ScoreAnalysis } from '../src/client/ScoreAnalysis.tsx'
import { StudentRoster } from '../src/client/StudentRoster.tsx'
import { TeachingRecords } from '../src/client/TeachingRecords.tsx'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
})

const emptyState = (): TeacherWorkbenchState => ({
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  classes: [], students: [], resources: [], templates: [], records: [], exams: [],
  questionBatches: [], questionLibraryFolders: [], questionFolders: [], questionAssignments: [],
  noticeTemplates: [], notices: [], seatingLayouts: [],
})

function commands(): TeacherWorkbenchCommands {
  const action = () => vi.fn(async () => ({ ok: true } as const))
  return {
    listNotificationTargets: vi.fn(async () => []),
    saveDailyTodo: action(),
    toggleDailyTodo: action(),
    deleteDailyTodo: action(),
    saveQuickNote: action(),
    deleteQuickNote: action(),
    saveLedgerCategory: action(),
    deleteLedgerCategory: action(),
    saveLedgerEntry: action(),
    deleteLedgerEntry: action(),
    saveCalendarItem: action(),
    deleteCalendarItem: action(),
    extractDocument: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
    normalizeTimetable: vi.fn(async () => ({ ok: false, error: { code: 'tool-model-unavailable', message: 'unavailable' } } as const)),
    extractQuestionLayout: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
    segmentQuestions: vi.fn(async () => ({ ok: false, error: { code: 'tool-model-unavailable', message: 'unavailable' } } as const)),
    importCalendarItems: action(),
    saveTimetableEntry: action(),
    deleteTimetableEntry: action(),
    importTimetableEntries: action(),
    saveClass: action(),
    deleteClass: action(),
    saveStudent: action(),
    importStudents: action(),
    deleteStudent: action(),
    createQuestionLibraryFolder: action(),
    renameQuestionLibraryFolder: action(),
    deleteQuestionLibraryFolder: action(),
    createQuestionFolder: action(),
    deleteQuestionFolder: action(),
    saveResource: action(),
    deleteResource: action(),
    saveTemplate: action(),
    deleteTemplate: action(),
    saveRecord: action(),
    toggleRecord: action(),
    deleteRecord: action(),
    saveNoticeTemplate: action(), deleteNoticeTemplate: action(), saveNotice: action(), deleteNotice: action(),
    saveSeatingLayout: action(),
    saveExam: action(),
    deleteExam: action(),
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

const failure = { ok: false, error: { code: 'test', message: 'rejected' } } as const

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LessonPreparation actions', () => {
  it('edits, cancels, retries, and deletes resources and observation templates', async () => {
    const c = commands()
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      resources: [
        {
          id: 'resource-a' as TeacherLessonResourceId,
          category: 'resource',
          name: '资源 A',
          url: 'https://a.example',
          description: '',
        },
        {
          id: 'resource-b' as TeacherLessonResourceId,
          category: 'resource',
          name: '资源 B',
          url: 'https://b.example',
          description: '说明',
        },
      ],
      templates: [
        {
          id: 'template-a' as TeacherRecordTemplateId,
          kind: 'observation',
          name: '听课 A',
          scene: '',
          fields: ['目标'],
        },
        {
          id: 'template-b' as TeacherRecordTemplateId,
          kind: 'observation',
          name: '听课 B',
          scene: '公开课',
          fields: ['反馈'],
        },
      ],
    }
    render(<LessonPreparation state={state} commands={c} t={t} />)
    expect(screen.getByText('https://a.example')).toBeTruthy()
    expect(screen.getByText('说明')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
    expect(screen.getByRole('dialog', { name: '编辑资源' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '新说明' } })
    vi.mocked(c.saveResource).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveResource).toHaveBeenCalled() })
    expect(screen.getByRole('dialog', { name: '编辑资源' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '编辑资源' })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '资源 A+' } })
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: 'https://new.example' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '编辑资源' })).toBeNull() })

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    expect(c.deleteResource).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    expect(c.deleteResource).toHaveBeenCalledWith('resource-a')
    expect(confirm).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('tab', { name: '听课链接' }))
    expect(screen.getByText('目标')).toBeTruthy()
    expect(screen.getAllByText('公开课')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
    fireEvent.change(screen.getByLabelText('适用场景'), { target: { value: '随堂课' } })
    fireEvent.change(screen.getByLabelText('记录字段'), { target: { value: '目标\n\n行动' } })
    vi.mocked(c.saveTemplate).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveTemplate).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '编辑听课模板' })).toBeNull() })
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    expect(c.deleteTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    expect(c.deleteTemplate).toHaveBeenCalledWith('template-a')

    fireEvent.click(screen.getByRole('tab', { name: '公开课' }))
    fireEvent.click(screen.getByRole('button', { name: '添加资源' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
  })
})

describe('StudentRoster actions', () => {
  const classA = { id: 'class-a' as TeacherClassId, usage: 'roster' as const, name: 'A班', grade: '高一', subject: '数学' }
  const classB = { id: 'class-b' as TeacherClassId, usage: 'roster' as const, name: 'B班', grade: '高二', subject: '语文' }
  const state: TeacherWorkbenchState = {
    ...emptyState(),
    classes: [classA, classB],
    students: [
      {
        id: 'student-a' as TeacherStudentId,
        classId: classA.id,
        name: '张同学',
        studentNumber: '',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
        extras: {},
      },
      {
        id: 'student-b' as TeacherStudentId,
        classId: classA.id,
        name: '李同学',
        studentNumber: '002',
        gender: '女',
        guardian: '王女士',
        relation: '母亲',
        phone: '13800000000',
        address: '学校路',
        extras: {},
      },
    ],
  }

  it('searches, switches classes, and completes class and student CRUD', async () => {
    const c = commands()
    const rendered = render(
      <StudentRoster state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    const search = screen.getByLabelText('搜索姓名、学号或监护人')
    for (const [query, expected] of [['张', '张同学'], ['002', '李同学'], ['王', '李同学']] as const) {
      fireEvent.change(search, { target: { value: query } })
      expect(screen.getByText(expected)).toBeTruthy()
    }
    fireEvent.change(search, { target: { value: '无结果' } })
    expect(screen.getByText('暂无数据')).toBeTruthy()
    fireEvent.change(search, { target: { value: '' } })

    const classSelect = screen.getByLabelText('选择班级')
    fireEvent.change(classSelect, { target: { value: 'class-b' } })
    expect((classSelect as HTMLSelectElement).value).toBe('class-b')
    expect(screen.getByText('暂无数据')).toBeTruthy()
    fireEvent.change(classSelect, { target: { value: 'class-a' } })

    fireEvent.click(screen.getByRole('button', { name: '编辑班级' }))
    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: 'A+ 班' } })
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: '高三' } })
    fireEvent.change(screen.getByLabelText('学科'), { target: { value: '物理' } })
    vi.mocked(c.saveClass).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveClass).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑班级' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '编辑班级' })).toBeNull() })

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    expect(c.deleteClass).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    expect(c.deleteClass).toHaveBeenCalledWith(classA.id)

    const firstRow = screen.getByText('张同学').closest('tr')!
    fireEvent.click(within(firstRow).getByRole('button', { name: '编辑' }))
    const updates = [
      ['姓名', '张同学+'], ['学号', '001'], ['性别', '男'], ['监护人', '张女士'],
      ['关系', '母亲'], ['电话', '1'], ['地址', '学校路'],
    ] as const
    for (const [label, value] of updates) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    vi.mocked(c.saveStudent).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveStudent).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(within(firstRow).getByRole('button', { name: '删除' }))
    expect(c.deleteStudent).not.toHaveBeenCalled()
    fireEvent.click(within(firstRow).getByRole('button', { name: '删除' }))
    expect(c.deleteStudent).toHaveBeenCalledWith('student-a')
    expect(confirm).toHaveBeenCalled()

    fireEvent.change(classSelect, { target: { value: 'class-b' } })
    rendered.rerender(
      <StudentRoster state={{ ...state, classes: [classA] }} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('选择班级').value).toBe('class-a') })
  })

  it('reports recognition failures, retries reviewed imports, and keeps the captured class', async () => {
    const c = commands()
    const rendered = render(
      <StudentRoster state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!
    vi.mocked(c.extractDocument).mockResolvedValueOnce({
      ok: true,
      value: { name: '错误.xlsx', mediaType: '', markdown: '| 学号 |\n| --- |\n| 1 |', provider: 'mineru', truncated: false },
    })
    fireEvent.change(input, { target: { files: [new File(['bad'], '错误.xlsx')] } })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('没有识别到姓名列') })
    fireEvent.click(screen.getAllByRole('button', { name: '关闭工作台' }).at(-1)!)

    vi.mocked(c.extractDocument).mockResolvedValue({
      ok: true,
      value: { name: '名册.xlsx', mediaType: '', markdown: '| 姓名 | 学号 |\n| --- | --- |\n| 新生 | 003 |', provider: 'mineru', truncated: false },
    })
    fireEvent.change(input, { target: { files: [new File(['roster'], '名册.xlsx')] } })
    await screen.findByRole('dialog', { name: '上传并识别学生名册' })
    expect(screen.getByText('名册.xlsx · 识别到 1 名学生，请确认后导入')).toBeTruthy()
    vi.mocked(c.importStudents).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '导入 1 名学生' }))
    await waitFor(() => { expect(c.importStudents).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    fireEvent.change(input, { target: { files: [new File(['roster'], '名册.xlsx')] } })
    await screen.findByRole('dialog', { name: '上传并识别学生名册' })
    rendered.rerender(
      <StudentRoster state={emptyState()} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('选择班级').value).toBe('') })
    fireEvent.click(screen.getByRole('button', { name: '导入 1 名学生' }))
    await waitFor(() => { expect(c.importStudents).toHaveBeenLastCalledWith('class-a', [expect.objectContaining({ name: '新生' })]) })
    rendered.rerender(
      <StudentRoster state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('选择班级').value).toBe('class-a') })

    fireEvent.click(screen.getByRole('button', { name: '添加学生' }))
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '临时学生' } })
    rendered.rerender(
      <StudentRoster state={emptyState()} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />,
    )
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('选择班级').value).toBe('') })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(c.saveStudent).not.toHaveBeenCalledWith(expect.objectContaining({ name: '临时学生' }))
  })
})

describe('ScoreAnalysis actions', () => {
  it('switches selections, handles sparse trends, retries imports, and deletes exams', async () => {
    const c = commands()
    const classA = { id: 'class-a' as TeacherClassId, usage: 'roster' as const, name: 'A班', grade: '', subject: '' }
    const classB = { id: 'class-b' as TeacherClassId, usage: 'roster' as const, name: 'B班', grade: '', subject: '' }
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      classes: [classA, classB],
      students: [
        { id: 's1' as TeacherStudentId, classId: classA.id, name: '张同学', studentNumber: '1', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {} },
        { id: 's2' as TeacherStudentId, classId: classA.id, name: '李同学', studentNumber: '2', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {} },
      ],
      exams: [
        {
          id: 'exam-a' as TeacherExamId,
          classId: classA.id,
          name: '期中',
          date: '2026-08-01',
          entries: [
            { studentId: 's1' as TeacherStudentId, scores: { '数学': 90 } },
            { studentId: 's2' as TeacherStudentId, scores: { '语文': 80 } },
            { studentId: 'missing' as TeacherStudentId, scores: { '数学': 70 } },
          ],
        },
        { id: 'exam-b' as TeacherExamId, classId: classA.id, name: '月考', date: '', entries: [] },
      ],
    }
    const rendered = render(<ScoreAnalysis state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    const examSelect = screen.getByLabelText('考试')
    await waitFor(() => { expect((examSelect as HTMLSelectElement).value).toBe('exam-b') })
    fireEvent.change(examSelect, { target: { value: 'exam-a' } })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(c.deleteExam).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(c.deleteExam).toHaveBeenCalledWith('exam-a')

    fireEvent.click(screen.getByRole('tab', { name: '多次追踪' }))
    expect(screen.getAllByText('月考').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '个人成长' }))
    fireEvent.change(screen.getByLabelText('选择学生'), { target: { value: 's2' } })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('选择班级'), { target: { value: 'class-b' } })
    expect(screen.getAllByText('当前班级还没有考试数据')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('选择班级'), { target: { value: 'class-a' } })

    const importInput = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!
    vi.mocked(c.extractDocument).mockResolvedValueOnce({
      ok: true,
      value: { name: '错误.xlsx', mediaType: '', markdown: '| 数学 |\n| --- |\n| 90 |', provider: 'mineru', truncated: false },
    })
    fireEvent.change(importInput, { target: { files: [new File(['bad'], '错误.xlsx')] } })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('没有识别到姓名或学号列') })
    fireEvent.click(screen.getAllByRole('button', { name: '关闭工作台' }).at(-1)!)

    vi.mocked(c.extractDocument).mockResolvedValue({
      ok: true,
      value: { name: '期末.xlsx', mediaType: '', markdown: '| 姓名 | 数学 |\n| --- | --- |\n| 张同学 | 95 |\n| 未知 | 80 |', provider: 'mineru', truncated: false },
    })
    fireEvent.change(importInput, { target: { files: [new File(['scores'], '期末.xlsx')] } })
    await screen.findByRole('dialog', { name: '上传并识别成绩表' })
    fireEvent.change(screen.getByLabelText('考试名称'), { target: { value: '期末考试' } })
    fireEvent.change(screen.getByLabelText('考试日期'), { target: { value: '2026-08-18' } })
    expect(screen.getByText('1 行未匹配到名册，已跳过')).toBeTruthy()
    vi.mocked(c.saveExam).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '导入 1 条成绩' }))
    await waitFor(() => { expect(c.saveExam).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '导入 1 条成绩' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '上传并识别成绩表' })).toBeNull() })
    expect(screen.getByText('1 行未匹配到名册，已跳过')).toBeTruthy()
    expect(confirm).toHaveBeenCalledTimes(2)

    fireEvent.change(importInput, { target: { files: [new File(['scores'], '临时.xlsx')] } })
    await screen.findByRole('dialog', { name: '上传并识别成绩表' })
    rendered.rerender(<ScoreAnalysis state={emptyState()} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('选择班级').value).toBe('') })
    fireEvent.click(screen.getByRole('button', { name: '导入 1 条成绩' }))
    await waitFor(() => { expect(c.saveExam).toHaveBeenLastCalledWith(expect.objectContaining({ classId: 'class-a' })) })
  })
})

describe('TeachingRecords actions', () => {
  it('filters and completes record and template management', async () => {
    const c = commands()
    const templateA = {
      id: 'template-a' as TeacherRecordTemplateId,
      kind: 'teaching' as const,
      name: '反思 A',
      scene: '',
      fields: ['问题', '行动'],
    }
    const templateB = {
      id: 'template-b' as TeacherRecordTemplateId,
      kind: 'teaching' as const,
      name: '反思 B',
      scene: '单元课',
      fields: ['亮点'],
    }
    const state: TeacherWorkbenchState = {
      ...emptyState(),
      templates: [templateA, templateB],
      records: [
        { id: 'record-a' as TeacherRecordId, templateId: templateA.id, title: '记录 A', dueDate: '', status: 'active', values: { '问题': '', '行动': '调整' }, updatedAt: 1 },
        { id: 'record-b' as TeacherRecordId, templateId: templateB.id, title: '记录 B', dueDate: '2026-08-17', status: 'done', values: { '亮点': '互动' }, updatedAt: 2 },
      ],
    }
    render(<TeachingRecords state={state} commands={c} t={t} />)
    expect(screen.getByText('2026-08-17')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('模板'), { target: { value: 'template-a' } })
    expect(screen.queryByText('记录 B')).toBeNull()
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'done' } })
    expect(screen.getByText('暂无数据')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('模板'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } })

    const recordA = screen.getByText('记录 A').closest('article')!
    fireEvent.click(within(recordA).getByRole('button', { name: '编辑' }))
    const recordEditor = screen.getByRole('dialog', { name: '编辑教学记录' })
    fireEvent.change(within(recordEditor).getByLabelText('模板'), { target: { value: 'template-b' } })
    fireEvent.change(within(recordEditor).getByLabelText('记录标题'), { target: { value: '记录 A+' } })
    fireEvent.change(within(recordEditor).getByLabelText('记录日期'), { target: { value: '2026-08-18' } })
    fireEvent.change(within(recordEditor).getByLabelText('状态'), { target: { value: 'done' } })
    fireEvent.change(within(recordEditor).getByLabelText('亮点'), { target: { value: '提问' } })
    vi.mocked(c.saveRecord).mockResolvedValueOnce(failure)
    fireEvent.click(within(recordEditor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveRecord).toHaveBeenCalled() })
    fireEvent.click(within(recordEditor).getByRole('button', { name: '取消' }))

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(within(recordA).getByRole('button', { name: '删除' }))
    expect(c.deleteRecord).not.toHaveBeenCalled()
    fireEvent.click(within(recordA).getByRole('button', { name: '删除' }))
    expect(c.deleteRecord).toHaveBeenCalledWith('record-a')
    const recordB = screen.getByText('记录 B').closest('article')!
    fireEvent.click(within(recordB).getByRole('checkbox'))
    expect(c.toggleRecord).toHaveBeenCalledWith('record-b')

    fireEvent.click(screen.getByRole('button', { name: '管理模板' }))
    const manager = screen.getByRole('dialog', { name: '记录模板' })
    const firstTemplateRow = within(manager).getByText('反思 A').parentElement!.parentElement!
    fireEvent.click(within(firstTemplateRow).getByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('dialog', { name: '编辑记录模板' })
    fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: '反思 A+' } })
    fireEvent.change(within(editor).getByLabelText('适用场景'), { target: { value: '日常课' } })
    fireEvent.change(within(editor).getByLabelText('记录字段'), { target: { value: '问题\n\n行动' } })
    vi.mocked(c.saveTemplate).mockResolvedValueOnce(failure)
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(c.saveTemplate).toHaveBeenCalled() })
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))

    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(within(firstTemplateRow).getByRole('button', { name: '删除' }))
    expect(c.deleteTemplate).not.toHaveBeenCalled()
    fireEvent.click(within(firstTemplateRow).getByRole('button', { name: '删除' }))
    expect(c.deleteTemplate).toHaveBeenCalledWith('template-a')
    fireEvent.click(within(manager).getByRole('button', { name: '新建记录模板' }))
    const addEditor = screen.getByRole('dialog', { name: '新建记录模板' })
    fireEvent.change(within(addEditor).getByLabelText('名称'), { target: { value: '新模板' } })
    fireEvent.change(within(addEditor).getByLabelText('记录字段'), { target: { value: '字段' } })
    fireEvent.click(within(addEditor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '新建记录模板' })).toBeNull() })
    fireEvent.click(within(manager).getAllByRole('button', { name: '关闭工作台' }).at(-1)!)
  })

  it('opens template management when no teaching template exists', () => {
    const c = commands()
    render(<TeachingRecords state={emptyState()} commands={c} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '新建教学记录' }))
    expect(screen.getByRole('dialog', { name: '记录模板' })).toBeTruthy()
  })
})
