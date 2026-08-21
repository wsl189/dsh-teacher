// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  TeacherClassId,
  TeacherQuestionAssignmentId,
  TeacherQuestionBatchId,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionFolderId,
  TeacherQuestionImageId,
  TeacherQuestionTemporarySaveRequest,
  TeacherQuestionUploadedDocumentRequest,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../src/settings.ts'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import { QuestionWorkbench, type QuestionWorkbenchProps } from '../src/client/QuestionWorkbench.tsx'

const classId = 'class-1' as TeacherClassId
const studentId = 'student-1' as TeacherStudentId
const batchId = 'batch-1' as TeacherQuestionBatchId
const imageId = 'image-1' as TeacherQuestionImageId
const assignmentId = 'assignment-1' as TeacherQuestionAssignmentId
const folderId = 'folder-1' as TeacherQuestionFolderId

const t: QuestionWorkbenchProps['t'] = (key, params) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

const state: TeacherWorkbenchState = {
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  resources: [], templates: [], records: [], exams: [],
  classes: [
    { id: classId, usage: 'roster', academicYear: '2026', name: '一班', grade: '高一', subject: '数学' },
    { id: 'grade-class' as TeacherClassId, usage: 'gradeTimetable', name: '第一节', grade: '高二', subject: '数学' },
  ],
  students: [{
    id: studentId, classId, name: '张三', studentNumber: '', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
  }],
  questionBatches: [{
    id: batchId,
    name: '期中试卷',
    sourceName: '期中试卷.pdf',
    pageRange: '1-2',
    createdAt: 1,
    images: [{ id: imageId, questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 100, height: 80, createdAt: 1, updatedAt: 1 }],
  }],
  questionFolders: [{
    id: folderId,
    studentId,
    name: '第一次作业',
    createdAt: 1,
    updatedAt: 1,
  }],
  questionAssignments: [{
    id: assignmentId,
    studentId,
    sourceImageId: imageId,
    fileName: '第1题.png',
    relativePath: '高一/一班/张三/第1题.png',
    mediaType: 'image/png',
    width: 100,
    height: 80,
    createdAt: 1,
    updatedAt: 1,
  }],
}

function commands(): TeacherWorkbenchCommands {
  const ok = vi.fn(async () => ({ ok: true } as const))
  return {
    saveClass: ok,
    deleteClass: ok,
    saveStudent: ok,
    deleteStudent: ok,
    createQuestionFolder: ok,
    deleteQuestionFolder: ok,
    deleteQuestionBatch: ok,
    deleteQuestionImage: ok,
    assignQuestions: ok,
    saveTemporaryQuestionSelection: vi.fn(async (request: TeacherQuestionTemporarySaveRequest) => ({
      ok: true as const,
      value: { studentId: request.studentId, imageCount: request.assignmentIds.length },
    })),
    listTemporaryQuestionSelections: vi.fn(async () => ({ ok: true as const, value: [] })),
    readQuestionImage: vi.fn(async () => ({
      ok: true,
      value: { fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: 'iVBORw0KGgo=' },
    } as const)),
  } as unknown as TeacherWorkbenchCommands
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('QuestionWorkbench reference shell', () => {
  it('keeps the original top bar and hierarchy while omitting analysis and image search', () => {
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />)
    expect(screen.getByText('试题分割系统')).toBeTruthy()
    expect(screen.getByRole('button', { name: '技能库' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '试题图片库' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加学生' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '上传 PDF' })).toBeTruthy()
    expect(screen.getByLabelText('学生目录')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '高二第一节' })).toBeNull()
    expect(screen.queryByText('错题分析')).toBeNull()
    expect(screen.queryByPlaceholderText(/同类题|讲义|PPT/u)).toBeNull()
  })

  it('opens the original class, student-image, and question-bank drawer flow', async () => {
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    expect(screen.getByLabelText('学生列表')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '张三' }))
    await waitFor(() => { expect(screen.getByLabelText('学生图片')).toBeTruthy() })
    await waitFor(() => { expect(screen.getByRole('button', { name: '第1题.png' })).toBeTruthy() })

    fireEvent.click(screen.getAllByRole('button', { name: '试题图片库' }).at(-1)!)
    expect(screen.getByRole('complementary', { name: '试题图片库' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '试题库图片' })).toBeTruthy()
  })

  it('preserves double-click expansion and triple-click subfolder creation', async () => {
    const c = commands()
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))

    const student = screen.getByRole('button', { name: '张三' })
    fireEvent.click(student)
    fireEvent.click(student)
    await waitFor(() => { expect(screen.getByRole('button', { name: '第一次作业' })).toBeTruthy() })

    const folder = screen.getByRole('button', { name: '第一次作业' })
    fireEvent.click(folder)
    fireEvent.click(folder)
    fireEvent.click(folder)
    const dialog = await screen.findByRole('dialog', { name: '新建子目录' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '错题订正' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(c.createQuestionFolder).toHaveBeenCalledWith({ studentId, parentId: folderId, name: '错题订正' })
    })
  })

  it('opens the reference student-directory form and persists its academic year', async () => {
    const c = commands()
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '添加学生' }))
    expect(screen.getByRole('complementary', { name: '添加学生' })).toBeTruthy()
    expect(screen.getByText('年份 *')).toBeTruthy()
    expect(screen.getByText('学生姓名（可选）')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('年份 *'), { target: { value: '2025-2026' } })
    fireEvent.change(screen.getByLabelText('年级 *'), { target: { value: '高二' } })
    fireEvent.change(screen.getByLabelText('班级 *'), { target: { value: '二班' } })
    fireEvent.click(screen.getByRole('button', { name: '确认添加' }))
    await waitFor(() => {
      expect(c.saveClass).toHaveBeenCalledWith({ usage: 'roster', academicYear: '2025-2026', name: '二班', grade: '高二', subject: '' })
    })
  })

  it('restores independent per-student Word options and class PowerPoint generation', async () => {
    const c = commands()
    const write = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }))
    const showDirectoryPicker = vi.fn(async () => {
      throw new Error('the protected-directory picker must not be used')
    })
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker)
    vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
    c.generateStudentDocuments = vi.fn(async (request: TeacherQuestionBatchDocumentRequest) => ({
      ok: true as const,
      value: {
        artifacts: [{
          fileName: request.kind === 'word' ? '张三.docx' : '张三.pptx',
          mediaType: 'application/octet-stream',
          contentBase64: 'UEs=',
        }],
        skipped: [],
      },
    }))
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))

    fireEvent.click(screen.getByRole('button', { name: '张三' }))
    const studentDrawer = await screen.findByRole('complementary', { name: '学生图片' })
    fireEvent.click(within(studentDrawer).getByLabelText('选择'))
    fireEvent.click(within(studentDrawer).getByRole('button', { name: '临时保存' }))
    await waitFor(() => {
      expect(c.saveTemporaryQuestionSelection).toHaveBeenCalledWith({ studentId, assignmentIds: [assignmentId] })
    })
    expect(await within(studentDrawer).findByText('临时 1 张')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Word' }))
    const drawer = screen.getByRole('complementary', { name: 'Word 配置' })
    expect(within(drawer).getAllByRole('checkbox').every(item => !(item as HTMLInputElement).checked)).toBe(true)
    fireEvent.click(within(drawer).getByLabelText('姓名'))
    fireEvent.click(within(drawer).getByLabelText('日期'))
    fireEvent.change(within(drawer).getByPlaceholderText('标题（黑体3号加粗）'), { target: { value: '每日练习' } })
    fireEvent.click(within(drawer).getByRole('button', { name: '确认生成' }))
    await waitFor(() => {
      expect(c.generateStudentDocuments).toHaveBeenCalledWith({
        kind: 'word',
        source: 'temporary',
        students: [{ studentId, title: '每日练习', includeName: true, includeDate: true }],
      })
    })
    const resultDialog = await screen.findByRole('dialog', { name: '批量生成成功' })
    fireEvent.click(within(resultDialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: '张三.docx' })
      expect(write).toHaveBeenCalledWith(expect.any(Blob))
      expect(close).toHaveBeenCalledTimes(1)
    })
    expect(showDirectoryPicker).not.toHaveBeenCalled()

    fireEvent.click(within(studentDrawer).getByLabelText('选择'))
    fireEvent.click(within(studentDrawer).getByRole('button', { name: '临时保存' }))
    await waitFor(() => { expect(c.saveTemporaryQuestionSelection).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByRole('button', { name: 'PPT' }))
    await waitFor(() => {
      expect(c.generateStudentDocuments).toHaveBeenLastCalledWith({
        kind: 'ppt',
        source: 'temporary',
        students: [{ studentId, title: '', includeName: false, includeDate: false }],
      })
    })
    const pptResultDialog = await screen.findByRole('dialog', { name: '批量生成成功' })
    fireEvent.click(within(pptResultDialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(showSaveFilePicker).toHaveBeenLastCalledWith({ suggestedName: '张三.pptx' })
      expect(close).toHaveBeenCalledTimes(2)
    })
    expect(showDirectoryPicker).not.toHaveBeenCalled()
  })

  it('restores toolbox generation from a naturally ordered browser folder', async () => {
    const c = commands()
    c.generateUploadedQuestionDocument = vi.fn(async (request: TeacherQuestionUploadedDocumentRequest) => ({
      ok: true as const,
      value: {
        fileName: `${request.folderName}.docx`,
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: 'UEs=',
      },
    }))
    const view = render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '技能库' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '生成 Word' }))
    const input = view.container.querySelector<HTMLInputElement>('input[webkitdirectory]')!
    const second = new File([new Uint8Array([2])], '第2题.png', { type: 'image/png' })
    const tenth = new File([new Uint8Array([10])], '第10题.png', { type: 'image/png' })
    Object.defineProperty(second, 'webkitRelativePath', { value: '练习图片/第2题.png' })
    Object.defineProperty(tenth, 'webkitRelativePath', { value: '练习图片/第10题.png' })
    fireEvent.change(input, { target: { files: [tenth, second] } })
    await waitFor(() => {
      expect(c.generateUploadedQuestionDocument).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'word',
        folderName: '练习图片',
        images: [
          expect.objectContaining({ relativePath: '练习图片/第2题.png' }),
          expect.objectContaining({ relativePath: '练习图片/第10题.png' }),
        ],
      }))
    })
    expect(await screen.findByRole('dialog', { name: 'Word 生成完成' })).toBeTruthy()
  })
})
