// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import type {
  TeacherClassId,
  TeacherQuestionAssignmentId,
  TeacherQuestionBatchId,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionFolderId,
  TeacherQuestionLibraryFolderId,
  TeacherQuestionImageId,
  TeacherQuestionMediaBrowseValue,
  TeacherQuestionTemporarySaveRequest,
  TeacherQuestionUploadedDocumentRequest,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../src/settings.ts'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import { EMPTY_QUESTION_CUTTING_VIEW } from '../src/client/question-cutting-controller.ts'
import {
  QuestionWorkbench as QuestionWorkbenchComponent,
  type QuestionWorkbenchProps,
} from '../src/client/QuestionWorkbench.tsx'

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
const siblingLibraryFolderId = 'library-folder-3' as TeacherQuestionLibraryFolderId

const t: QuestionWorkbenchProps['t'] = (key, params) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

const defaultQuestionCuttingReasoning: QuestionWorkbenchProps['questionCuttingReasoning'] = {
  enabled: false,
  writable: true,
  setEnabled: vi.fn(async () => {}),
}

function QuestionWorkbench(
  props: Omit<QuestionWorkbenchProps, 'cutting' | 'questionCuttingReasoning' | 'saveDirectoryAvailable' | 'renderSlot'>
    & Partial<Pick<QuestionWorkbenchProps, 'questionCuttingReasoning' | 'saveDirectoryAvailable' | 'renderSlot'>>,
) {
  return <QuestionWorkbenchComponent
    {...props}
    saveDirectoryAvailable={props.saveDirectoryAvailable ?? false}
    renderSlot={props.renderSlot ?? (() => null)}
    questionCuttingReasoning={props.questionCuttingReasoning ?? defaultQuestionCuttingReasoning}
    cutting={EMPTY_QUESTION_CUTTING_VIEW}
  />
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
    createQuestionMediaDirectory: ok,
    deleteQuestionMediaDirectory: ok,
    renameQuestionMediaDirectory: ok,
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
    browseQuestionMedia: vi.fn(async () => ({ ok: false, error: { code: 'storage-failure', message: 'unavailable' } } as const)),
    enqueueQuestionCutting: vi.fn(),
  } as unknown as TeacherWorkbenchCommands
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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
    expect(screen.getByLabelText('试题切割进度').textContent).toContain('暂无切割任务')
  })

  it('starts each elapsed timer when its queued PDF starts processing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(15_000)
    render(
      <QuestionWorkbenchComponent
        saveDirectoryAvailable={false}
        renderSlot={() => null}
        state={state}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={commands()}
        questionCuttingReasoning={defaultQuestionCuttingReasoning}
        cutting={{
          jobs: [{
            key: 'active',
            fileName: '正在处理.pdf',
            pageRange: '1-5,8',
            stage: 'extracting',
            progress: 37,
            queuedAt: 10_000,
            startedAt: 11_000,
            savedCount: 0,
            groupCount: 12,
            completedGroupCount: 4,
          }, {
            key: 'queued',
            fileName: '下一份.pdf',
            pageRange: '全部页码',
            stage: 'queued',
            progress: 0,
            queuedAt: 12_000,
            savedCount: 0,
          }],
        }}
        t={t}
      />,
    )

    const progress = screen.getByLabelText('试题切割进度')
    expect(within(progress).getByText('1 项处理中 · 1 项排队中 · 0 项已完成')).toBeTruthy()
    expect(within(progress).getByRole('progressbar', { name: '正在提取 PDF 版面' }).getAttribute('aria-valuenow')).toBe('37')
    expect(within(progress).getByRole('progressbar', { name: '等待切割' }).getAttribute('aria-valuenow')).toBe('0')
    expect(within(progress).getByText('37%')).toBeTruthy()
    expect(within(progress).getByText('0%')).toBeTruthy()
    const active = within(progress).getByRole('listitem', { name: '正在处理.pdf' })
    const queued = within(progress).getByRole('listitem', { name: '下一份.pdf' })
    expect(within(active).getByText('页码范围：1-5,8')).toBeTruthy()
    expect(within(active).getByText('已完成 4/12 组')).toBeTruthy()
    expect(within(queued).getByText('页码范围：全部页码')).toBeTruthy()
    expect(within(active).getByText('用时 00:04')).toBeTruthy()
    expect(within(queued).getByText('用时 00:00')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(within(active).getByText('用时 00:06')).toBeTruthy()
    expect(within(queued).getByText('用时 00:00')).toBeTruthy()
  })

  it('refreshes elapsed time from animation frames when interval callbacks are throttled', () => {
    vi.useFakeTimers()
    vi.setSystemTime(15_000)
    let frameCallback: FrameRequestCallback | undefined
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 1
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const setInterval = vi.spyOn(window, 'setInterval')
    const clearInterval = vi.spyOn(window, 'clearInterval').mockImplementation(() => {})
    try {
      render(
        <QuestionWorkbenchComponent
          saveDirectoryAvailable={false}
          renderSlot={() => null}
          state={state}
          settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
          commands={commands()}
          questionCuttingReasoning={defaultQuestionCuttingReasoning}
          cutting={{
            jobs: [{
              key: 'active',
              fileName: '连续计时.pdf',
              pageRange: '1-5',
              stage: 'reviewing',
              progress: 50,
              queuedAt: 10_000,
              startedAt: 11_000,
              savedCount: 0,
            }],
          }}
          t={t}
        />,
      )

      const job = screen.getByRole('listitem', { name: '连续计时.pdf' })
      expect(within(job).getByText('用时 00:04')).toBeTruthy()
      vi.setSystemTime(16_050)
      act(() => { frameCallback?.(0) })
      expect(within(job).getByText('用时 00:05')).toBeTruthy()
      expect(requestFrame).toHaveBeenCalled()
      expect(setInterval).toHaveBeenCalled()
    } finally {
      cleanup()
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
      setInterval.mockRestore()
      clearInterval.mockRestore()
    }
  })

  it('shows retained unverified questions as a completed-job warning', () => {
    render(
      <QuestionWorkbenchComponent
        saveDirectoryAvailable={false}
        renderSlot={() => null}
        state={state}
        settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
        commands={commands()}
        questionCuttingReasoning={defaultQuestionCuttingReasoning}
        cutting={{
          jobs: [{
            key: 'unverified',
            fileName: '复杂双栏试卷.pdf',
            pageRange: '2-16',
            stage: 'completed',
            progress: 100,
            queuedAt: 10_000,
            startedAt: 11_000,
            finishedAt: 12_000,
            savedCount: 18,
            unverifiedGroupCount: 1,
            unverifiedQuestionCount: 2,
          }],
        }}
        t={t}
      />,
    )

    const job = screen.getByRole('listitem', { name: '复杂双栏试卷.pdf' })
    expect(within(job).getByText(t('questions.progressUnverifiedGroups', { count: 1 }))).toBeTruthy()
    expect(within(job).getByText(t('questions.progressUnverifiedQuestions', { count: 2 }))).toBeTruthy()
    expect(within(job).getByText(t('questions.progressCompleted', { count: 18 }))).toBeTruthy()
    expect(within(job).queryByText(t('questions.progressFailed'))).toBeNull()
  })

  it('shows each filesystem question directory once while preserving direct images and nested folders', async () => {
    const c = commands()
    const paperFolderId = 'filesystem-paper-folder' as TeacherQuestionLibraryFolderId
    const paperBatchId = 'filesystem-paper-batch' as TeacherQuestionBatchId
    const paperImageId = 'filesystem-paper-image' as TeacherQuestionImageId
    const monthFolderId = 'filesystem-month-folder' as TeacherQuestionLibraryFolderId
    const monthBatchId = 'filesystem-month-batch' as TeacherQuestionBatchId
    const monthImageId = 'filesystem-month-image' as TeacherQuestionImageId
    const nestedFolderId = 'filesystem-month-nested-folder' as TeacherQuestionLibraryFolderId
    c.browseQuestionMedia = vi.fn(async () => ({
      ok: true,
      value: {
        classes: state.classes,
        students: state.students,
        questionBatches: [{
          id: paperBatchId,
          folderId: paperFolderId,
          name: '金考卷',
          sourceName: '金考卷',
          pageRange: '',
          createdAt: 2,
          images: [{
            id: paperImageId,
            questionNo: 1,
            fileName: '金考卷_1.png',
            mediaType: 'image/png',
            width: 100,
            height: 80,
            createdAt: 2,
            updatedAt: 2,
          }],
        }, {
          id: monthBatchId,
          folderId: monthFolderId,
          name: '月考',
          sourceName: '月考',
          pageRange: '',
          createdAt: 3,
          images: [{
            id: monthImageId,
            questionNo: 2,
            fileName: '月考_2.png',
            mediaType: 'image/png',
            width: 100,
            height: 80,
            createdAt: 3,
            updatedAt: 3,
          }],
        }],
        questionLibraryFolders: [{
          id: paperFolderId,
          name: '金考卷',
          createdAt: 2,
          updatedAt: 2,
        }, {
          id: monthFolderId,
          name: '月考',
          createdAt: 3,
          updatedAt: 3,
        }, {
          id: nestedFolderId,
          parentId: monthFolderId,
          name: '第一次',
          createdAt: 4,
          updatedAt: 4,
        }],
        questionFolders: state.questionFolders,
        questionAssignments: state.questionAssignments,
      },
    } as const))
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)

    await waitFor(() => { expect(c.browseQuestionMedia).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    const library = await screen.findByRole('complementary', { name: '试题图片库' })
    const paperFolder = within(library).getByRole('button', { name: '金考卷' })
    expect(within(library).getAllByText('金考卷')).toHaveLength(1)
    expect(within(library).queryByRole('button', { name: '金考卷 1' })).toBeNull()
    expect(within(library).queryByRole('button', { name: '展开目录“金考卷”' })).toBeNull()

    fireEvent.click(paperFolder)
    const bankImages = await screen.findByRole('complementary', { name: '试题库图片' })
    expect(await within(bankImages).findByRole('button', { name: '第 1 题' })).toBeTruthy()

    fireEvent.click(within(library).getByRole('button', { name: '月考' }))
    expect(await within(bankImages).findByRole('button', { name: '第 2 题' })).toBeTruthy()
    if (within(library).queryByRole('button', { name: '第一次' }) === null) {
      fireEvent.click(within(library).getByRole('button', { name: '展开目录“月考”' }))
    }
    expect(await within(library).findByRole('button', { name: '第一次' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '试题库图片' })).toBeTruthy()
  })

  it('shows students discovered from the configured fourth-level directory', async () => {
    const c = commands()
    const directoryStudentId = 'filesystem-student' as TeacherStudentId
    const directoryAssignmentId = 'filesystem-assignment' as TeacherQuestionAssignmentId
    const directoryFolderId = 'filesystem-folder' as TeacherQuestionFolderId
    const nestedDirectoryFolderId = 'filesystem-nested-folder' as TeacherQuestionFolderId
    const externalLibraryFolderId = 'filesystem-library-folder' as TeacherQuestionLibraryFolderId
    const externalNestedLibraryFolderId = 'filesystem-nested-library-folder' as TeacherQuestionLibraryFolderId
    const externalBatchId = 'filesystem-batch' as TeacherQuestionBatchId
    const externalImageId = 'filesystem-image' as TeacherQuestionImageId
    c.browseQuestionMedia = vi.fn(async () => ({
      ok: true,
      value: {
        classes: [state.classes[0]!],
        students: [...state.students, {
          id: directoryStudentId,
          classId,
          name: '目录学生',
          studentNumber: '',
          gender: '',
          guardian: '',
          relation: '',
          phone: '',
          address: '',
          extras: {},
        }],
        questionBatches: [...state.questionBatches, {
          id: externalBatchId,
          folderId: externalNestedLibraryFolderId,
          name: '套题甲',
          sourceName: '套题甲.pdf',
          pageRange: '',
          createdAt: 3,
          images: [{
            id: externalImageId,
            questionNo: 1,
            fileName: '套题甲_1.png',
            mediaType: 'image/png',
            width: 100,
            height: 80,
            createdAt: 3,
            updatedAt: 3,
          }],
        }],
        questionLibraryFolders: [...state.questionLibraryFolders, {
          id: externalLibraryFolderId,
          name: '月考',
          createdAt: 2,
          updatedAt: 2,
        }, {
          id: externalNestedLibraryFolderId,
          parentId: externalLibraryFolderId,
          name: '第一次',
          createdAt: 3,
          updatedAt: 3,
        }],
        questionFolders: [...state.questionFolders, {
          id: directoryFolderId,
          studentId: directoryStudentId,
          name: '复习',
          createdAt: 2,
          updatedAt: 2,
        }, {
          id: nestedDirectoryFolderId,
          studentId: directoryStudentId,
          parentId: directoryFolderId,
          name: '第一周',
          createdAt: 3,
          updatedAt: 3,
        }],
        questionAssignments: [...state.questionAssignments, {
          id: directoryAssignmentId,
          studentId: directoryStudentId,
          sourceImageId: imageId,
          folderId: nestedDirectoryFolderId,
          fileName: '四级目录题.png',
          relativePath: '2026/高一/一班/目录学生/复习/第一周/四级目录题.png',
          mediaType: 'image/png',
          width: 100,
          height: 80,
          temporarySaveCount: 0,
          createdAt: 2,
          updatedAt: 2,
        }],
      },
    } as const))
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)

    await waitFor(() => { expect(c.browseQuestionMedia).toHaveBeenCalled() })
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const classDrawer = await screen.findByRole('complementary', { name: '学生列表' })
    const directoryStudent = await within(classDrawer).findByRole('button', { name: '目录学生' })

    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    let dialog = await screen.findByRole('dialog', { name: '新建子目录' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '周练' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(c.createQuestionMediaDirectory).toHaveBeenCalledWith({
        parent: { kind: 'student', id: directoryStudentId },
        name: '周练',
      })
    })

    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    dialog = await screen.findByRole('dialog', { name: '重命名目录' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '目录学生甲' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.renameQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'student', id: directoryStudentId },
        name: '目录学生甲',
      })
    })

    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    const directoryFolder = await within(classDrawer).findByRole('button', { name: '复习' })
    fireEvent.click(directoryFolder)
    fireEvent.click(directoryFolder)
    const nestedDirectoryFolder = await within(classDrawer).findByRole('button', { name: '第一周' })

    fireEvent.click(nestedDirectoryFolder)
    fireEvent.click(nestedDirectoryFolder)
    fireEvent.click(nestedDirectoryFolder)
    dialog = await screen.findByRole('dialog', { name: '新建子目录' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '第二周' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(c.createQuestionMediaDirectory).toHaveBeenCalledWith({
        parent: { kind: 'student-folder', id: nestedDirectoryFolderId },
        name: '第二周',
      })
    })

    fireEvent.click(nestedDirectoryFolder)
    fireEvent.click(nestedDirectoryFolder)
    fireEvent.click(nestedDirectoryFolder)
    fireEvent.click(nestedDirectoryFolder)
    dialog = await screen.findByRole('dialog', { name: '重命名目录' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '第一周订正' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.renameQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'student-folder', id: nestedDirectoryFolderId },
        name: '第一周订正',
      })
    })

    fireEvent.click(nestedDirectoryFolder)
    const studentImages = await screen.findByRole('complementary', { name: '学生图片' })
    expect(await within(studentImages).findByRole('button', { name: '四级目录题.png' })).toBeTruthy()
    const externalSelection = within(studentImages).getByRole('checkbox', { name: '选择' }) as HTMLInputElement
    expect(externalSelection.disabled).toBe(false)
    fireEvent.click(externalSelection)
    fireEvent.click(within(studentImages).getByRole('button', { name: '临时保存' }))
    await waitFor(() => {
      expect(c.saveTemporaryQuestionSelection).toHaveBeenCalledWith({
        studentId: directoryStudentId,
        assignmentIds: [directoryAssignmentId],
      })
    })
    expect(within(classDrawer).getByRole('button', { name: 'Word' })).toHaveProperty('disabled', false)
    expect(within(studentImages).getByRole('button', { name: '删除' })).toBeTruthy()

    fireEvent.click(within(studentImages).getByRole('button', { name: '试题图片库' }))
    const library = await screen.findByRole('complementary', { name: '试题图片库' })
    const externalLibraryFolder = within(library).getByRole('button', { name: '月考' })
    fireEvent.click(externalLibraryFolder)
    fireEvent.click(externalLibraryFolder)
    dialog = await screen.findByRole('dialog', { name: '新建文件夹' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '第二次' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(c.createQuestionMediaDirectory).toHaveBeenCalledWith({
        parent: { kind: 'library-folder', id: externalLibraryFolderId },
        name: '第二次',
      })
    })
    if (within(library).queryByRole('button', { name: '第一次' }) === null) {
      fireEvent.click(within(library).getByRole('button', { name: '展开目录“月考”' }))
    }
    const externalNestedLibraryFolder = await within(library).findByRole('button', { name: '第一次' })
    fireEvent.click(externalNestedLibraryFolder)
    fireEvent.click(externalNestedLibraryFolder)
    fireEvent.click(externalNestedLibraryFolder)
    dialog = await screen.findByRole('dialog', { name: '重命名目录' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '第一次月考' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.renameQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'library-folder', id: externalNestedLibraryFolderId },
        name: '第一次月考',
      })
    })
    expect(within(library).queryByText('套题甲')).toBeNull()
    fireEvent.click(externalNestedLibraryFolder)
    const bankImages = await screen.findByRole('complementary', { name: '试题库图片' })
    expect(await within(bankImages).findByRole('button', { name: '第 1 题' })).toBeTruthy()
    const externalQuestionSelection = within(bankImages).getByRole('checkbox', { name: '选择' }) as HTMLInputElement
    expect(externalQuestionSelection.disabled).toBe(false)
    fireEvent.click(externalQuestionSelection)
    fireEvent.click(within(bankImages).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.assignQuestions).toHaveBeenCalledWith({
        studentId: directoryStudentId,
        folderId: nestedDirectoryFolderId,
        imageIds: [externalImageId],
      })
    })

    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    fireEvent.click(within(nestedDirectoryFolder.parentElement!).getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(c.deleteQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'student-folder', id: nestedDirectoryFolderId },
      })
    })
    fireEvent.click(within(library).getByRole('button', { name: '删除目录“第一次”' }))
    expect(confirm).toHaveBeenCalledWith('确认删除目录“第一次”及其下全部内容吗？')
    await waitFor(() => {
      expect(c.deleteQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'library-folder', id: externalNestedLibraryFolderId },
      })
    })
  })

  it('updates visible student and question-library directory trees after filesystem changes', async () => {
    vi.useFakeTimers()
    const c = commands()
    const directoryStudentId = 'live-filesystem-student' as TeacherStudentId
    const directoryFolderId = 'live-filesystem-folder' as TeacherQuestionFolderId
    const libraryRootId = 'live-filesystem-library-root' as TeacherQuestionLibraryFolderId
    const libraryChildId = 'live-filesystem-library-child' as TeacherQuestionLibraryFolderId
    const baseValue: TeacherQuestionMediaBrowseValue = {
      classes: [state.classes[0]!],
      students: state.students,
      questionBatches: state.questionBatches,
      questionLibraryFolders: state.questionLibraryFolders,
      questionFolders: state.questionFolders,
      questionAssignments: state.questionAssignments,
    }
    let currentValue = baseValue
    c.browseQuestionMedia = vi.fn(async () => ({ ok: true as const, value: currentValue }))
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    await act(async () => { await Promise.resolve() })

    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const classDrawer = screen.getByRole('complementary', { name: '学生列表' })
    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    const library = screen.getByRole('complementary', { name: '试题图片库' })

    currentValue = {
      ...baseValue,
      students: [...baseValue.students, {
        id: directoryStudentId,
        classId,
        name: '实时目录学生',
        studentNumber: '',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
        extras: {},
      }],
      questionLibraryFolders: [{
        id: libraryRootId,
        name: '实时月考',
        createdAt: 2,
        updatedAt: 2,
      }, {
        id: libraryChildId,
        parentId: libraryRootId,
        name: '第一次',
        createdAt: 3,
        updatedAt: 3,
      }],
      questionFolders: [...baseValue.questionFolders, {
        id: directoryFolderId,
        studentId: directoryStudentId,
        name: '实时复习',
        createdAt: 2,
        updatedAt: 2,
      }],
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    const directoryStudent = within(classDrawer).getByRole('button', { name: '实时目录学生' })
    fireEvent.click(directoryStudent)
    fireEvent.click(directoryStudent)
    expect(within(library).getByRole('button', { name: '实时月考' })).toBeTruthy()
    fireEvent.click(within(library).getByRole('button', { name: '展开目录“实时月考”' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(260) })
    expect(within(classDrawer).getByRole('button', { name: '实时复习' })).toBeTruthy()
    expect(within(library).getByRole('button', { name: '第一次' })).toBeTruthy()

    currentValue = baseValue
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(within(classDrawer).queryByRole('button', { name: '实时目录学生' })).toBeNull()
    expect(within(classDrawer).queryByRole('button', { name: '实时复习' })).toBeNull()
    expect(within(library).queryByRole('button', { name: '实时月考' })).toBeNull()
    expect(within(library).queryByRole('button', { name: '第一次' })).toBeNull()
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

    const rootFolder = within(library).getByRole('button', { name: '高考模拟' })
    expect(rootFolder.getAttribute('title')).toBe('单击查看图片或展开目录，双击新建子目录，三击重命名')
    expect(within(library).queryByRole('button', { name: '在“高考模拟”下新建子目录' })).toBeNull()
    fireEvent.click(rootFolder)
    fireEvent.click(rootFolder)
    dialog = await screen.findByRole('dialog', { name: '新建文件夹' })
    fireEvent.change(within(dialog).getByLabelText('目录名'), { target: { value: '六月' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(c.createQuestionLibraryFolder).toHaveBeenLastCalledWith({ parentId: libraryFolderId, name: '六月' })
    })
    if (within(library).queryByRole('button', { name: '五月' }) === null) {
      fireEvent.click(within(library).getByRole('button', { name: '展开目录“高考模拟”' }))
    }
    const nestedFolder = within(library).getByRole('button', { name: '五月' })
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
    await waitFor(() => {
      expect(c.deleteQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'library-folder', id: libraryFolderId },
      })
    })
  })

  it('limits question-library folder labels and omits batch names from the directory tree', async () => {
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
    expect(within(library).getByTitle('高考模拟专题训练').textContent).toBe('高考模拟专题训…')
    expect(within(library).getByTitle('月考').textContent).toBe('月考')
    expect(within(library).getByRole('button', { name: '月考' })).toBeTruthy()
    expect(within(library).queryByText('2025—20…')).toBeNull()
    fireEvent.click(within(library).getByRole('button', { name: '高考模拟专题训练' }))
    expect(await screen.findByRole('complementary', { name: '试题库图片' })).toBeTruthy()
  })

  it('shows every batch image directly through its physical library directory', async () => {
    const secondBatchId = 'batch-2' as TeacherQuestionBatchId
    const secondImageId = 'image-2' as TeacherQuestionImageId
    const libraryState: TeacherWorkbenchState = {
      ...state,
      questionLibraryFolders: [{
        id: libraryFolderId, name: '第一次', createdAt: 1, updatedAt: 1,
      }],
      questionBatches: [{
        ...state.questionBatches[0]!,
        folderId: libraryFolderId,
        name: '数学新高考金考卷',
      }, {
        ...state.questionBatches[0]!,
        id: secondBatchId,
        folderId: libraryFolderId,
        name: '第二份月考试卷',
        sourceName: '第二份月考试卷.pdf',
        images: [{
          ...state.questionBatches[0]!.images[0]!,
          id: secondImageId,
          questionNo: 2,
          fileName: '第2题.png',
        }],
      }],
    }
    render(<QuestionWorkbench state={libraryState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={commands()} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    const library = screen.getByRole('complementary', { name: '试题图片库' })
    const folder = within(library).getByRole('button', { name: '第一次' })
    expect(folder.textContent).toContain('2')
    expect(within(library).queryByText('数学新高考金考卷')).toBeNull()
    expect(within(library).queryByText('第二份月考试卷')).toBeNull()

    fireEvent.click(folder)
    const images = await screen.findByRole('complementary', { name: '试题库图片' })
    expect(within(images).getByRole('button', { name: '第 1 题' })).toBeTruthy()
    expect(within(images).getByRole('button', { name: '第 2 题' })).toBeTruthy()
  })

  it('opens page-range selection before PDF parsing settles and offers only leaf library directories', async () => {
    let resolvePdf!: (pdf: { readonly numPages: number }) => void
    const loadedPdf = new Promise<{ readonly numPages: number }>((resolve) => { resolvePdf = resolve })
    pdfMocks.getDocument.mockReturnValue({
      promise: loadedPdf,
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
      }, {
        id: siblingLibraryFolderId, name: '周考', createdAt: 3, updatedAt: 3,
      }],
    }
    const scannedRootId = 'filesystem-library-root' as TeacherQuestionLibraryFolderId
    const scannedLeafId = 'filesystem-library-leaf' as TeacherQuestionLibraryFolderId
    const c = commands()
    c.browseQuestionMedia = vi.fn(async () => ({
      ok: true,
      value: {
        classes: libraryState.classes.filter(item => item.usage === 'roster'),
        students: libraryState.students,
        questionBatches: libraryState.questionBatches,
        questionLibraryFolders: [...libraryState.questionLibraryFolders, {
          id: scannedRootId,
          name: '当前根目录',
          createdAt: 4,
          updatedAt: 4,
        }, {
          id: scannedLeafId,
          parentId: scannedRootId,
          name: '扫描叶目录',
          createdAt: 5,
          updatedAt: 5,
        }],
        questionFolders: libraryState.questionFolders,
        questionAssignments: libraryState.questionAssignments,
      } satisfies TeacherQuestionMediaBrowseValue,
    } as const))
    let resolveReasoning!: () => void
    const reasoningSaved = new Promise<void>((resolve) => { resolveReasoning = resolve })
    const setReasoningEnabled = vi.fn(() => reasoningSaved)
    const view = render(<QuestionWorkbench
      state={libraryState}
      settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS}
      commands={c}
      questionCuttingReasoning={{ enabled: false, writable: true, setEnabled: setReasoningEnabled }}
      t={t}
    />)
    await waitFor(() => { expect(c.browseQuestionMedia).toHaveBeenCalled() })
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"][accept="application/pdf,.pdf"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files: [pdf] } })

    const dialog = screen.getByRole('dialog', { name: '选择页码范围' })
    const confirmCut = within(dialog).getByRole('button', { name: '确认切割' })
    expect(within(dialog).getByText('月考试卷.pdf · 正在读取 PDF')).toBeTruthy()
    expect((confirmCut as HTMLButtonElement).disabled).toBe(true)
    expect(c.enqueueQuestionCutting).not.toHaveBeenCalled()
    resolvePdf({ numPages: 1 })
    await waitFor(() => { expect(within(dialog).getByText('总页数：1')).toBeTruthy() })
    expect((confirmCut as HTMLButtonElement).disabled).toBe(false)
    const directory = within(dialog).getByLabelText('保存目录')
    expect((directory as HTMLSelectElement).value).toBe('')
    expect(within(directory).getByRole('option', { name: '不选择（按 PDF 名新建文件夹）' })).toBeTruthy()
    expect(within(directory).queryByRole('option', { name: '试题图片库根目录' })).toBeNull()
    expect(within(directory).queryByRole('option', { name: '月考' })).toBeNull()
    expect(within(directory).getByRole('option', { name: '月考 / 高一' })).toBeTruthy()
    expect(within(directory).getByRole('option', { name: '周考' })).toBeTruthy()
    expect(within(directory).getByRole('option', { name: '当前根目录 / 扫描叶目录' })).toBeTruthy()
    const reasoning = within(dialog).getByRole('switch', { name: '开启深度模式' })
    expect((reasoning as HTMLInputElement).checked).toBe(false)
    expect(directory.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(reasoning)
    expect((reasoning as HTMLInputElement).checked).toBe(true)
    expect(setReasoningEnabled).not.toHaveBeenCalled()
    fireEvent.change(directory, { target: { value: scannedLeafId } })
    expect((directory as HTMLSelectElement).value).toBe(scannedLeafId)
    fireEvent.click(within(dialog).getByRole('button', { name: '确认切割' }))
    await waitFor(() => { expect(setReasoningEnabled).toHaveBeenCalledWith(true) })
    expect(c.enqueueQuestionCutting).not.toHaveBeenCalled()
    resolveReasoning()
    await waitFor(() => {
      expect(c.enqueueQuestionCutting).toHaveBeenCalledWith(expect.objectContaining({
        file: pdf,
        pageIndexes: [0],
        pageRange: '全部页码',
        reasoningEnabled: true,
        folderId: scannedLeafId,
      }))
    })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '选择页码范围' })).toBeNull() })
    expect(screen.getByRole('button', { name: '上传 PDF' }).hasAttribute('disabled')).toBe(false)
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

    const rootDirectory = screen.getByRole('button', { name: '试题图片库根目录' })
    fireEvent.click(rootDirectory)
    const bankImages = screen.getByRole('complementary', { name: '试题库图片' })
    expect(screen.queryByLabelText('学生图片')).toBeNull()
    fireEvent.click(within(bankImages).getByLabelText('选择'))
    fireEvent.click(within(bankImages).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.assignQuestions).toHaveBeenCalledWith({ studentId, imageIds: [imageId] })
    })

    fireEvent.click(rootDirectory)
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
    const showDirectoryPicker = vi.fn(async (options?: { mode?: string }) => {
      if (options?.mode !== 'readwrite') throw new DOMException('write permission required', 'AbortError')
      return { getFileHandle }
    })
    vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: '试题图片库' }))
    fireEvent.click(screen.getByRole('button', { name: '试题图片库根目录' }))
    const bankImages = screen.getByRole('complementary', { name: '试题库图片' })
    fireEvent.click(within(bankImages).getByLabelText('选择'))
    const save = within(bankImages).getByRole('button', { name: '另存为' })
    act(() => {
      fireEvent.click(save)
      fireEvent.click(save)
    })
    expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' })

    await waitFor(() => {
      expect(c.readQuestionImage).toHaveBeenCalledWith({ target: { kind: 'batch', id: imageId } })
      expect(getFileHandle).toHaveBeenLastCalledWith('第1题.png', { create: true })
      expect(write).toHaveBeenCalledWith(expect.any(Blob))
      expect(close).toHaveBeenCalledTimes(1)
    })
    expect(c.assignQuestions).not.toHaveBeenCalled()
  })

  it('shows all descendant images for a student folder and temporarily saves only that subtree', async () => {
    const c = commands()
    const childId = 'child-folder' as TeacherQuestionFolderId
    const grandchildId = 'grandchild-folder' as TeacherQuestionFolderId
    const siblingId = 'sibling-folder' as TeacherQuestionFolderId
    const childAssignmentId = 'child-assignment' as TeacherQuestionAssignmentId
    const grandchildAssignmentId = 'grandchild-assignment' as TeacherQuestionAssignmentId
    const aggregateState: TeacherWorkbenchState = {
      ...state,
      questionFolders: [
        ...state.questionFolders,
        { ...state.questionFolders[0]!, id: childId, parentId: folderId, name: '订正' },
        { ...state.questionFolders[0]!, id: grandchildId, parentId: childId, name: '再练' },
        { ...state.questionFolders[0]!, id: siblingId, name: '第二次作业' },
      ],
      questionAssignments: [
        ...state.questionAssignments,
        {
          ...state.questionAssignments[0]!,
          id: folderAssignmentId,
          folderId,
          fileName: '第2题.png',
          relativePath: '高一/一班/张三/第一次作业/第2题.png',
        },
        { ...state.questionAssignments[0]!, id: childAssignmentId, folderId: childId, fileName: '第3题.png' },
        { ...state.questionAssignments[0]!, id: grandchildAssignmentId, folderId: grandchildId, fileName: '第4题.png' },
        { ...state.questionAssignments[0]!, id: 'sibling-assignment' as TeacherQuestionAssignmentId, folderId: siblingId, fileName: '第5题.png' },
        { ...state.questionAssignments[0]!, id: 'other-assignment' as TeacherQuestionAssignmentId, studentId: 'student-2' as TeacherStudentId, fileName: '其他学生.png' },
      ],
    }
    render(<QuestionWorkbench state={aggregateState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const student = screen.getByRole('button', { name: '张三' })

    fireEvent.click(student)
    let studentImages = await screen.findByRole('complementary', { name: '学生图片' })
    expect(within(studentImages).getByRole('button', { name: '第1题.png' })).toBeTruthy()
    expect(within(studentImages).getByRole('button', { name: '第2题.png' })).toBeTruthy()
    expect(within(studentImages).getAllByRole('checkbox', { name: '选择' })).toHaveLength(5)
    expect(within(studentImages).queryByRole('button', { name: '其他学生.png' })).toBeNull()

    fireEvent.click(student)
    await waitFor(() => { expect(screen.queryByRole('complementary', { name: '学生图片' })).toBeNull() })
    fireEvent.click(student)
    fireEvent.click(student)
    const folder = await screen.findByRole('button', { name: '第一次作业' })
    fireEvent.click(folder)
    studentImages = await screen.findByRole('complementary', { name: '学生图片' })
    expect(within(studentImages).queryByRole('button', { name: '第1题.png' })).toBeNull()
    expect(within(studentImages).getByRole('button', { name: '第2题.png' })).toBeTruthy()
    expect(within(studentImages).getByRole('button', { name: '第3题.png' })).toBeTruthy()
    expect(within(studentImages).getByRole('button', { name: '第4题.png' })).toBeTruthy()
    expect(within(studentImages).queryByRole('button', { name: '第5题.png' })).toBeNull()
    fireEvent.click(within(studentImages).getByRole('button', { name: '全选' }))
    fireEvent.click(within(studentImages).getByRole('button', { name: '临时保存' }))
    await waitFor(() => {
      expect(c.saveTemporaryQuestionSelection).toHaveBeenCalledWith({
        studentId, assignmentIds: [folderAssignmentId, childAssignmentId, grandchildAssignmentId],
      })
    })

    fireEvent.click(folder)
    fireEvent.click(folder)
    fireEvent.click(await screen.findByRole('button', { name: '订正' }))
    await waitFor(() => {
      expect(within(studentImages).getAllByRole('checkbox', { name: '选择' })).toHaveLength(2)
    })
    expect(within(studentImages).queryByRole('button', { name: '第2题.png' })).toBeNull()
    expect(within(studentImages).getByRole('button', { name: '第3题.png' })).toBeTruthy()
    expect(within(studentImages).getByRole('button', { name: '第4题.png' })).toBeTruthy()
  })

  it('shows the accumulated student total across folder saves and clears it without accepting an older list response', async () => {
    const c = commands()
    const siblingId = 'sibling-folder' as TeacherQuestionFolderId
    const folderState: TeacherWorkbenchState = {
      ...state,
      questionFolders: [...state.questionFolders, { ...state.questionFolders[0]!, id: siblingId, name: '第二次作业' }],
      questionAssignments: [
        { ...state.questionAssignments[0]!, folderId },
        { ...state.questionAssignments[0]!, id: folderAssignmentId, folderId: siblingId, fileName: '第2题.png' },
      ],
    }
    const oldList = Promise.withResolvers<Awaited<ReturnType<TeacherWorkbenchCommands['listTemporaryQuestionSelections']>>>()
    c.listTemporaryQuestionSelections = vi.fn(() => oldList.promise)
    const save = vi.mocked(c.saveTemporaryQuestionSelection)
    for (const count of [1, 2, 0]) save.mockResolvedValueOnce({
      ok: true,
      value: { studentId, imageCount: count, document: { revision: count, state: folderState } },
    })
    render(<QuestionWorkbench state={folderState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const student = screen.getByRole('button', { name: '张三' })
    fireEvent.click(student)
    fireEvent.click(student)
    fireEvent.click(await screen.findByRole('button', { name: '第一次作业' }))
    const drawer = await screen.findByRole('complementary', { name: '学生图片' })
    fireEvent.click(within(drawer).getByRole('checkbox', { name: '选择' }))
    fireEvent.click(within(drawer).getByRole('button', { name: '临时保存' }))
    await screen.findByText('该学生已暂存 1 张')
    expect(save).toHaveBeenLastCalledWith({ studentId, assignmentIds: [assignmentId] })
    await act(async () => { oldList.resolve({ ok: true, value: [] }) })
    expect(screen.getByText('该学生已暂存 1 张')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '第二次作业' }))
    await within(drawer).findByRole('button', { name: '第2题.png' })
    fireEvent.click(within(drawer).getByRole('checkbox', { name: '选择' }))
    fireEvent.click(within(drawer).getByRole('button', { name: '临时保存' }))
    await screen.findByText('该学生已暂存 2 张')
    expect(save).toHaveBeenLastCalledWith({ studentId, assignmentIds: [folderAssignmentId] })
    fireEvent.click(within(drawer).getByRole('button', { name: '清空暂存' }))
    await screen.findByText('该学生已暂存 0 张')
    expect(save).toHaveBeenLastCalledWith({ studentId, assignmentIds: [] })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Word' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'PPT' }).disabled).toBe(true)
    expect(within(drawer).getByRole('button', { name: '第2题.png' })).toBeTruthy()
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

    fireEvent.click(folder)
    fireEvent.click(folder)
    fireEvent.click(folder)
    fireEvent.click(folder)
    const renameDialog = await screen.findByRole('dialog', { name: '重命名目录' })
    fireEvent.change(within(renameDialog).getByLabelText('目录名'), { target: { value: '第一次订正' } })
    fireEvent.click(within(renameDialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(c.renameQuestionMediaDirectory).toHaveBeenCalledWith({
        target: { kind: 'student-folder', id: folderId },
        name: '第一次订正',
      })
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

  it('releases temporary-save controls after a rejected request and retains the checked images for retry', async () => {
    const c = commands()
    const pending = Promise.withResolvers<Awaited<ReturnType<TeacherWorkbenchCommands['saveTemporaryQuestionSelection']>>>()
    vi.mocked(c.saveTemporaryQuestionSelection).mockImplementationOnce(() => pending.promise)
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    fireEvent.click(screen.getByRole('button', { name: '张三' }))
    const drawer = await screen.findByRole('complementary', { name: '学生图片' })
    const selected = within(drawer).getByRole<HTMLInputElement>('checkbox', { name: '选择' })
    fireEvent.click(selected)
    const save = within(drawer).getByRole<HTMLButtonElement>('button', { name: '临时保存' })
    fireEvent.click(save)
    expect(screen.getByText('正在更新暂存图片…')).toBeTruthy()
    await act(async () => { pending.reject(new Error('连接已断开')) })
    expect(save.disabled).toBe(false)
    expect(selected.checked).toBe(true)
    expect(screen.queryByText('正在更新暂存图片…')).toBeNull()
    expect(screen.getByText('连接已断开')).toBeTruthy()
    fireEvent.click(save)
    await screen.findByText('该学生已暂存 1 张')
    expect(selected.checked).toBe(false)
  })

  it.each(['word', 'ppt'] as const)('releases %s generation controls after rejection and retries the staged selection', async (kind) => {
    const c = commands()
    c.listTemporaryQuestionSelections = vi.fn(async () => ({ ok: true as const, value: [{ studentId, imageCount: 1 }] }))
    const pending = Promise.withResolvers<Awaited<ReturnType<TeacherWorkbenchCommands['generateStudentDocuments']>>>()
    c.generateStudentDocuments = vi.fn<TeacherWorkbenchCommands['generateStudentDocuments']>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({ ok: true, value: { artifacts: [{ fileName: '练习.docx', mediaType: 'application/octet-stream', contentBase64: 'UEs=' }], skipped: [] } })
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const generate = screen.getByRole<HTMLButtonElement>('button', { name: kind === 'word' ? 'Word' : 'PPT' })
    await waitFor(() => { expect(generate.disabled).toBe(false) })
    fireEvent.click(generate)
    if (kind === 'word') fireEvent.click(screen.getByRole('button', { name: '确认生成' }))
    expect(screen.getByText('正在生成 Word/PPT…')).toBeTruthy()
    await act(async () => { pending.reject(new Error('生成连接已断开')) })
    expect(screen.queryByText('正在生成 Word/PPT…')).toBeNull()
    const dialog = await screen.findByRole('dialog', { name: '批量生成失败' })
    expect(within(dialog).getByText('生成连接已断开')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
    await screen.findByRole('dialog', { name: '批量生成成功' })
    expect(c.generateStudentDocuments).toHaveBeenCalledTimes(2)
    expect(generate.disabled).toBe(true)
  })

  it('keeps failed large Office files available for retry without saving successful files again', async () => {
    const c = commands()
    const secondStudentId = 'student-second' as TeacherStudentId
    const exportState: TeacherWorkbenchState = {
      ...state,
      students: [...state.students, { ...state.students[0]!, id: secondStudentId, name: '李四' }],
    }
    const binary = String.fromCharCode(128).repeat(8 * 1024 * 1024)
    c.listTemporaryQuestionSelections = vi.fn(async () => ({ ok: true as const, value: [
      { studentId, imageCount: 1 }, { studentId: secondStudentId, imageCount: 1 },
    ] }))
    c.generateStudentDocuments = vi.fn(async () => ({
      ok: true as const,
      value: { artifacts: [
        { fileName: 'first.docx', mediaType: 'application/octet-stream', contentBase64: 'UEs=' },
        { fileName: 'second.docx', mediaType: 'application/octet-stream', contentBase64: btoa(binary) },
      ], skipped: [] },
    }))
    const blobs: Blob[] = []
    const abort = vi.fn(async () => {})
    const firstWrite = vi.fn(async () => {})
    const secondWrite = vi.fn(async (blob: Blob) => { blobs.push(blob) })
    const secondClose = vi.fn(async () => {}).mockRejectedValueOnce(new Error('disk write failed'))
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => ({
      queryPermission: async () => 'granted',
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (options?.create !== true) throw new DOMException('missing', 'NotFoundError')
        return { createWritable: async () => name === 'first.docx'
          ? { write: firstWrite, close: async () => {}, abort }
          : { write: secondWrite, close: secondClose, abort } }
      },
    })))
    render(<QuestionWorkbench state={exportState} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Word' }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Word' }))
    fireEvent.click(screen.getByRole('button', { name: '确认生成' }))
    const dialog = await screen.findByRole('dialog', { name: '批量生成成功' })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await within(dialog).findByText('已保存 1 个文件，失败 1 个')
    expect(abort).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('正在写入文件…')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '批量生成成功' })).toBeNull() })
    expect(firstWrite).toHaveBeenCalledTimes(1)
    expect(secondWrite).toHaveBeenCalledTimes(2)
    expect(c.generateStudentDocuments).toHaveBeenCalledTimes(1)
    const saved = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = reject
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result)
        else reject(new Error('file bytes unavailable'))
      }
      reader.readAsArrayBuffer(blobs[1]!)
    })
    const bytes = new Uint8Array(saved)
    expect(bytes.byteLength).toBe(binary.length)
    expect(bytes.every(byte => byte === 128)).toBe(true)
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

  it.each(['word', 'ppt'] as const)('prevents overlapping %s save pickers and retries after cancellation and permission denial', async (kind) => {
    const c = commands()
    let finishWrite: () => void = () => { throw new Error('write has not started') }
    const write = vi.fn(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    const close = vi.fn(async () => {})
    const directory = {
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (options?.create !== true) throw new DOMException('missing', 'NotFoundError')
        return { createWritable: async () => ({ write, close }) }
      }),
    }
    let pickerActive = false
    let chooseDirectory: (value: typeof directory) => void = () => { throw new Error('picker has not opened') }
    let cancelPicker: (cause: unknown) => void = () => { throw new Error('picker has not opened') }
    const showDirectoryPicker = vi.fn(() => {
      if (pickerActive) return Promise.reject(new DOMException('File picker already active', 'InvalidStateError'))
      pickerActive = true
      return new Promise<typeof directory>((resolve, reject) => {
        chooseDirectory = resolve
        cancelPicker = reject
      }).finally(() => { pickerActive = false })
    })
    vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
    c.generateStudentDocuments = vi.fn(async () => ({
      ok: true as const,
      value: {
        artifacts: [{ fileName: `张三.${kind === 'word' ? 'docx' : 'pptx'}`, mediaType: 'application/octet-stream', contentBase64: 'UEs=' }],
        skipped: [],
      },
    }))
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    fireEvent.click(screen.getByRole('button', { name: '张三' }))
    const studentDrawer = await screen.findByRole('complementary', { name: '学生图片' })
    fireEvent.click(within(studentDrawer).getByLabelText('选择'))
    fireEvent.click(within(studentDrawer).getByRole('button', { name: '临时保存' }))
    await screen.findByText('已临时保存 1 张图片')
    fireEvent.click(screen.getByRole('button', { name: kind === 'word' ? 'Word' : 'PPT' }))
    if (kind === 'word') fireEvent.click(screen.getByRole('button', { name: '确认生成' }))
    const dialog = await screen.findByRole('dialog', { name: '批量生成成功' })
    const save = within(dialog).getByRole<HTMLButtonElement>('button', { name: '保存' })
    act(() => {
      fireEvent.click(save)
      fireEvent.click(save)
    })
    expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(save.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog', { name: '批量生成成功' })).toBe(dialog)
    await act(async () => { cancelPicker(new DOMException('cancelled', 'AbortError')) })
    expect(save.disabled).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(within(dialog).getByText('未保存文件：已取消选择，或浏览器未授予写入权限。可重新选择保存位置。')).toBeTruthy()

    fireEvent.click(save)
    await act(async () => { cancelPicker(new DOMException('write permission denied', 'NotAllowedError')) })
    expect(save.disabled).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '批量生成成功' })).toBe(dialog)
    expect(within(dialog).getByText('未授予目标文件夹写入权限')).toBeTruthy()

    fireEvent.click(save)
    await act(async () => { chooseDirectory(directory) })
    await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
    fireEvent.click(save)
    expect(showDirectoryPicker).toHaveBeenCalledTimes(3)
    expect(save.disabled).toBe(true)
    await act(async () => { finishWrite() })
    expect(close).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '批量生成成功' })).toBeNull()
    expect(c.generateStudentDocuments).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/File picker already active/u)).toBeNull()
  })

  it.each(['word', 'ppt'] as const)('saves generated %s files to a selected Host directory and retries only failed files', async (kind) => {
    const c = commands()
    c.listTemporaryQuestionSelections = vi.fn(async () => ({ ok: true as const, value: [{ studentId, imageCount: 1 }] }))
    const extension = kind === 'word' ? 'docx' : 'pptx'
    const artifacts = ['张三', '李四'].map(name => ({ fileName: `${name}.${extension}`, mediaType: 'application/octet-stream', contentBase64: 'UEs=' }))
    c.generateStudentDocuments = vi.fn(async () => ({ ok: true as const, value: { artifacts, skipped: [] } }))
    let finishSave: (value: Awaited<ReturnType<typeof c.saveQuestionDocument>>) => void = () => { throw new Error('save not started') }
    c.saveQuestionDocument = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { path: `/chosen folder/${artifacts[0]!.fileName}` } })
      .mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve }))
      .mockResolvedValueOnce({ ok: true, value: { path: `/chosen folder/${artifacts[1]!.fileName}` } })
    const browserPicker = vi.fn()
    vi.stubGlobal('showDirectoryPicker', browserPicker)
    render(<QuestionWorkbench state={state} settings={DEFAULT_TEACHER_WORKBENCH_SETTINGS} commands={c} t={t}
      saveDirectoryAvailable
      renderSlot={((_slot: string, owner: DirectoryFlowOwnerProps) => owner.open ? <div role="dialog" aria-label={owner.title}>
        <button onClick={owner.onCancel}>取消目录</button>
        <button onClick={() => { owner.onPicked('/chosen folder') }}>{owner.confirmLabel}</button>
      </div> : null) as QuestionWorkbenchProps['renderSlot']}
    />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '高一一班' }))
    const generate = screen.getByRole<HTMLButtonElement>('button', { name: kind === 'word' ? 'Word' : 'PPT' })
    await waitFor(() => { expect(generate.disabled).toBe(false) })
    fireEvent.click(generate)
    if (kind === 'word') fireEvent.click(screen.getByRole('button', { name: '确认生成' }))
    const dialog = await screen.findByRole('dialog', { name: '批量生成成功' })
    expect(within(dialog).queryByRole('button', { name: '直接下载' })).toBeNull()
    const save = within(dialog).getByRole<HTMLButtonElement>('button', { name: '保存' })
    fireEvent.click(save)
    expect(save.disabled).toBe(true)
    expect(c.saveQuestionDocument).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消目录' }))
    expect(save.disabled).toBe(false)
    expect(within(dialog).getByText('已取消选择保存目录。文件仍可重新保存。')).toBeTruthy()
    fireEvent.click(save)
    fireEvent.click(screen.getByRole('button', { name: '保存到此文件夹' }))
    await waitFor(() => { expect(c.saveQuestionDocument).toHaveBeenCalledTimes(2) })
    fireEvent.click(save)
    expect(save.disabled).toBe(true)
    await act(async () => { finishSave({ ok: false, error: { code: 'storage-failure', message: '磁盘不可写' } }) })
    expect(within(dialog).getByText(/磁盘不可写/u)).toBeTruthy()
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    fireEvent.click(screen.getByRole('button', { name: '保存到此文件夹' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '批量生成成功' })).toBeNull() })
    expect(c.saveQuestionDocument).toHaveBeenNthCalledWith(3, { directory: '/chosen folder', artifact: artifacts[1] })
    expect(c.generateStudentDocuments).toHaveBeenCalledTimes(1)
    expect(browserPicker).not.toHaveBeenCalled()
    expect(screen.getByText('已保存 1 个文件到：/chosen folder')).toBeTruthy()
  })

  it('submits every image from a naturally ordered browser folder larger than 120 images', async () => {
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
    const files = Array.from({ length: 121 }, (_, index) => {
      const file = new File([new Uint8Array([index])], `第${String(index + 1)}题.png`, { type: 'image/png' })
      Object.defineProperty(file, 'webkitRelativePath', { value: `练习图片/${file.name}` })
      return file
    })
    const expectedImages = files.map((file, index) => ({
      fileName: file.name,
      relativePath: file.webkitRelativePath,
      contentBase64: btoa(String.fromCharCode(index)),
    }))
    const selectedFiles = [...files].reverse()
    fireEvent.change(input, { target: { files: selectedFiles } })
    await waitFor(() => {
      expect(c.generateUploadedQuestionDocument).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'word',
        folderName: '练习图片',
        images: expectedImages,
      }))
    })
    const wordDialog = await screen.findByRole('dialog', { name: 'Word 生成完成' })
    fireEvent.click(within(wordDialog).getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: '技能库' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '生成 PPT' }))
    fireEvent.change(input, { target: { files: selectedFiles } })
    await waitFor(() => {
      expect(c.generateUploadedQuestionDocument).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'ppt',
        folderName: '练习图片',
        images: expectedImages,
      }))
    })
    expect(await screen.findByRole('dialog', { name: 'PPT 生成完成' })).toBeTruthy()
  })
})
