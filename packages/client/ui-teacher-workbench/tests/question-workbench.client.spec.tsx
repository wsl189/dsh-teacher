// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import type {
  TeacherClassId,
  TeacherQuestionAssignmentId,
  TeacherQuestionBatchId,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionFolderId,
  TeacherQuestionLibraryFolderId,
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

const pdfMocks = vi.hoisted(() => ({ getDocument: vi.fn(), workerHandler: {} }))
vi.mock('pdfjs-dist', () => ({ getDocument: pdfMocks.getDocument }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: pdfMocks.workerHandler }))

const classId = 'class-1' as TeacherClassId
const studentId = 'student-1' as TeacherStudentId
const batchId = 'batch-1' as TeacherQuestionBatchId
const imageId = 'image-1' as TeacherQuestionImageId
const assignmentId = 'assignment-1' as TeacherQuestionAssignmentId
const folderAssignmentId = 'assignment-2' as TeacherQuestionAssignmentId
const folderId = 'folder-1' as TeacherQuestionFolderId
const libraryFolderId = 'library-folder-1' as TeacherQuestionLibraryFolderId
const nestedLibraryFolderId = 'library-folder-2' as TeacherQuestionLibraryFolderId

const t: QuestionWorkbenchProps['t'] = (key, params) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

const state: TeacherWorkbenchState = {
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  resources: [], templates: [], records: [], exams: [],
  noticeTemplates: [], notices: [], seatingLayouts: [],
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
  questionLibraryFolders: [],
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
    temporarySaveCount: 0,
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
    createQuestionLibraryFolder: ok,
    renameQuestionLibraryFolder: ok,
    deleteQuestionLibraryFolder: ok,
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
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
    expect(screen.queryByTitle('期中试卷')).toBeNull()
    expect(screen.getByLabelText('学生目录')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '高二第一节' })).toBeNull()
    expect(screen.queryByText('错题分析')).toBeNull()
    expect(screen.queryByPlaceholderText(/同类题|讲义|PPT/u)).toBeNull()
  })

  it('restores question-library folders and supports create, rename, and delete gestures', async () => {
    const c = commands()
    const libraryState: TeacherWorkbenchState = {
      ...state,
      questionLibraryFolders: [{
        id: libraryFolderId, name: '高考模拟', createdAt: 1, updatedAt: 1,
      }, {
        id: nestedLibraryFolderId, parentId: libraryFolderId, name: '五月', createdAt: 2, updatedAt: 2,
      }],
      questionBatches: state.questionBatches.map(batch => ({ ...batch, folderId: nestedLibraryFolderId })),
    }
    render(<QuestionWorkbench state={libraryState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    const library = screen.getByRole('complementary', { name: '试题图片库' })
    fireEvent.click(within(library).getByRole('button', { name: '新建文件夹' }))
    let dialog = screen.getByRole('dialog', { name: '新建文件夹' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '专题训练' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => { expect(c.createQuestionLibraryFolder).toHaveBeenCalledWith({ name: '专题训练' }) })

    const rootFolder = within(library).getByRole('button', { name: /^▸ 高考模拟/u })
    expect(rootFolder.getAttribute('title')).toBe('单击打开，双击新建子目录，三击重命名')
    expect(within(library).queryByRole('button', { name: '在“高考模拟”下新建子目录' })).toBeNull()
    fireEvent.click(rootFolder)
    fireEvent.click(rootFolder)
    dialog = await screen.findByRole('dialog', { name: '新建文件夹' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '六月' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(c.createQuestionLibraryFolder).toHaveBeenLastCalledWith({ parentId: libraryFolderId, name: '六月' })
    })
    const nestedFolder = within(library).getByRole('button', { name: /^▸ 五月/u })
    fireEvent.click(nestedFolder)
    fireEvent.click(nestedFolder)
    fireEvent.click(nestedFolder)
    dialog = await screen.findByRole('dialog', { name: '重命名目录' })
    expect(within(dialog).getByLabelText<HTMLInputElement>('目录名').value).toBe('五月')
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '五月模拟' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.renameQuestionLibraryFolder).toHaveBeenCalledWith(nestedLibraryFolderId, '五月模拟')
    })

    vi.stubGlobal('confirm', vi.fn(() => true))
    fireEvent.click(within(library).getByRole('button', { name: '删除目录“高考模拟”' }))
    await waitFor(() => { expect(c.deleteQuestionLibraryFolder).toHaveBeenCalledWith(libraryFolderId) })
  })

  it('limits question-library folder and batch labels to seven visible characters', async () => {
    const libraryState: TeacherWorkbenchState = {
      ...state,
      questionLibraryFolders: [{
        id: libraryFolderId, name: '高考模拟专题训练', createdAt: 1, updatedAt: 1,
      }, {
        id: nestedLibraryFolderId, name: '月考', createdAt: 2, updatedAt: 2,
      }],
      questionBatches: state.questionBatches.map(batch => ({
        ...batch,
        name: '2025—2026学年第二学期',
        folderId: libraryFolderId,
      })),
    }
    render(<QuestionWorkbench state={libraryState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    const library = screen.getByRole('complementary', { name: '试题图片库' })
    expect(within(library).getByTitle('高考模拟专题训练').textContent).toBe('▸ 高考模拟专题训…')
    expect(within(library).getByTitle('月考').textContent).toBe('月考')
    expect(within(library).getByRole('button', { name: '月考' })).toBeTruthy()
    fireEvent.click(within(library).getByRole('button', { name: '▸ 高考模拟专题训练' }))
    await waitFor(() => {
      expect(within(library).getByTitle('2025—2026学年第二学期').textContent).toBe('2025—20…')
    })
  })

  it('offers existing nested library directories after a PDF is uploaded', async () => {
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1 }),
      destroy: vi.fn(async () => {}),
    })
    const source = await PDFDocument.create()
    source.addPage([600, 800])
    const pdf = new File([Uint8Array.from(await source.save())], '月考试卷.pdf', { type: 'application/pdf' })
    const libraryState: TeacherWorkbenchState = {
      ...state,
      questionLibraryFolders: [{
        id: libraryFolderId, name: '月考', createdAt: 1, updatedAt: 1,
      }, {
        id: nestedLibraryFolderId, parentId: libraryFolderId, name: '高一', createdAt: 2, updatedAt: 2,
      }],
    }
    const view = render(
      <QuestionWorkbench state={libraryState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />,
    )
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"][accept="application/pdf,.pdf"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files: [pdf] } })

    const dialog = await screen.findByRole('dialog', { name: '选择页码范围' })
    const directory = within(dialog).getByLabelText('保存目录')
    expect(within(directory).getByRole('option', { name: '试题图片库根目录' })).toBeTruthy()
    expect(within(directory).getByRole('option', { name: '月考' })).toBeTruthy()
    expect(within(directory).getByRole('option', { name: '月考 / 高一' })).toBeTruthy()
    fireEvent.change(directory, { target: { value: nestedLibraryFolderId } })
    expect((directory as HTMLSelectElement).value).toBe(nestedLibraryFolderId)
  })

  it('toggles image drawers and keeps student and question-bank images mutually exclusive', async () => {
    const c = commands()
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    expect(screen.getByLabelText('学生列表')).toBeTruthy()

    const student = screen.getByRole('button', { name: '张三' })
    fireEvent.click(student)
    await waitFor(() => { expect(screen.getByLabelText('学生图片')).toBeTruthy() })
    await waitFor(() => { expect(screen.getByRole('button', { name: '第1题.png' })).toBeTruthy() })

    fireEvent.click(student)
    await waitFor(() => { expect(screen.queryByLabelText('学生图片')).toBeNull() })
    fireEvent.click(student)
    const studentImages = await screen.findByLabelText('学生图片')

    fireEvent.click(within(studentImages).getByRole('button', { name: '试题图片库' }))
    expect(screen.getByRole('complementary', { name: '试题图片库' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: '试题库图片' })).toBeNull()
    expect(screen.queryByLabelText('学生图片')).toBeNull()

    const batch = screen.getByRole('button', { name: /^期中试卷/u })
    fireEvent.click(batch)
    const bankImages = screen.getByRole('complementary', { name: '试题库图片' })
    expect(screen.queryByLabelText('学生图片')).toBeNull()
    fireEvent.click(within(bankImages).getByLabelText('选择'))
    fireEvent.click(within(bankImages).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.assignQuestions).toHaveBeenCalledWith({ studentId, imageIds: [imageId] })
    })

    fireEvent.click(batch)
    expect(screen.queryByRole('complementary', { name: '试题库图片' })).toBeNull()
  })

  it('saves selected top-level question-bank images to a chosen local directory', async () => {
    const c = commands()
    const write = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const getFileHandle = vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (options?.create !== true) throw new DOMException('missing', 'NotFoundError')
      return { createWritable: async () => ({ write, close }) }
    })
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => ({
      queryPermission: async () => 'granted' as const,
      getFileHandle,
    })))
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    fireEvent.click(screen.getByRole('button', { name: /^期中试卷/u }))
    const bankImages = screen.getByRole('complementary', { name: '试题库图片' })
    fireEvent.click(within(bankImages).getByLabelText('选择'))
    fireEvent.click(within(bankImages).getByRole('button', { name: '另存为' }))

    await waitFor(() => {
      expect(c.readQuestionImage).toHaveBeenCalledWith({ target: { kind: 'batch', id: imageId } })
      expect(getFileHandle).toHaveBeenLastCalledWith('第1题.png', { create: true })
      expect(write).toHaveBeenCalledWith(expect.any(Blob))
      expect(close).toHaveBeenCalledTimes(1)
    })
    expect(c.assignQuestions).not.toHaveBeenCalled()
  })

  it('shows every assigned image for a student while keeping folder views scoped', async () => {
    const aggregateState: TeacherWorkbenchState = {
      ...state,
      questionAssignments: [
        ...state.questionAssignments,
        {
          ...state.questionAssignments[0]!,
          id: folderAssignmentId,
          folderId,
          fileName: '第2题.png',
          relativePath: '高一/一班/张三/第一次作业/第2题.png',
        },
      ],
    }
    render(<QuestionWorkbench state={aggregateState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const student = screen.getByRole('button', { name: '张三' })

    fireEvent.click(student)
    let studentImages = await screen.findByRole('complementary', { name: '学生图片' })
    expect(within(studentImages).getByRole('button', { name: '第1题.png' })).toBeTruthy()
    expect(within(studentImages).getByRole('button', { name: '第2题.png' })).toBeTruthy()

    fireEvent.click(student)
    await waitFor(() => { expect(screen.queryByRole('complementary', { name: '学生图片' })).toBeNull() })
    fireEvent.click(student)
    fireEvent.click(student)
    const folder = await screen.findByRole('button', { name: '第一次作业' })
    fireEvent.click(folder)
    studentImages = await screen.findByRole('complementary', { name: '学生图片' })
    expect(within(studentImages).queryByRole('button', { name: '第1题.png' })).toBeNull()
    expect(within(studentImages).getByRole('button', { name: '第2题.png' })).toBeTruthy()
  })

  it('shows per-question save count and latest time below student images', async () => {
    const historyState: TeacherWorkbenchState = {
      ...state,
      questionAssignments: state.questionAssignments.map(assignment => ({
        ...assignment,
        temporarySaveCount: 3,
        lastTemporarySavedAt: Date.UTC(2026, 7, 22, 3, 18),
      })),
    }
    render(<QuestionWorkbench state={historyState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    fireEvent.click(screen.getByRole('button', { name: '张三' }))
    const studentImages = await screen.findByRole('complementary', { name: '学生图片' })
    expect(within(studentImages).getByText(/已保存 3 次 · 最近：/u)).toBeTruthy()
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
    const getFileHandle = vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (options?.create !== true) throw new DOMException('missing', 'NotFoundError')
      return { createWritable: async () => ({ write, close }) }
    })
    const showDirectoryPicker = vi.fn(async () => ({
      queryPermission: async () => 'granted' as const,
      getFileHandle,
    }))
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
    expect(within(studentDrawer).queryByText('临时 1 张')).toBeNull()

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
      expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
      expect(getFileHandle).toHaveBeenLastCalledWith('张三.docx', { create: true })
      expect(write).toHaveBeenCalledWith(expect.any(Blob))
      expect(close).toHaveBeenCalledTimes(1)
    })
    expect(showSaveFilePicker).not.toHaveBeenCalled()

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
      expect(showDirectoryPicker).toHaveBeenCalledTimes(2)
      expect(getFileHandle).toHaveBeenLastCalledWith('张三.pptx', { create: true })
      expect(close).toHaveBeenCalledTimes(2)
    })
    expect(showSaveFilePicker).not.toHaveBeenCalled()
  })

  it('restores toolbox generation from a naturally ordered browser folder', async () => {
    const c = commands()
    c.generateUploadedQuestionDocument = vi.fn(async (request: TeacherQuestionUploadedDocumentRequest) => ({
      ok: true as const,
      value: {
        fileName: `${request.folderName}.${request.kind === 'word' ? 'docx' : 'pptx'}`,
        mediaType: 'application/octet-stream',
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
    const wordDialog = await screen.findByRole('dialog', { name: 'Word 生成完成' })
    fireEvent.click(within(wordDialog).getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: '技能库' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '生成 PPT' }))
    fireEvent.change(input, { target: { files: [tenth, second] } })
    await waitFor(() => {
      expect(c.generateUploadedQuestionDocument).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'ppt',
        folderName: '练习图片',
      }))
    })
    expect(await screen.findByRole('dialog', { name: 'PPT 生成完成' })).toBeTruthy()
  })
})
