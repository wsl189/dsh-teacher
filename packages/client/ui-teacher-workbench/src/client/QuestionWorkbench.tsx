/** Reference-style MinerU question cutting, image library, assignment, and document output. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FileText,
  FolderOpen,
  Grid2X2Plus,
  Image as ImageIcon,
  Presentation,
  Scissors,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'
import type {
  OcrLayoutDocument,
  TeacherClass,
  TeacherClassId,
  TeacherQuestionAssignment,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionBatchId,
  TeacherQuestionDocumentPayload,
  TeacherQuestionFolder,
  TeacherQuestionFolderId,
  TeacherQuestionImage,
  TeacherQuestionImageTarget,
  TeacherQuestionLibraryFolder,
  TeacherQuestionLibraryFolderId,
  TeacherQuestionMediaBrowseValue,
  TeacherQuestionMediaDirectoryParent,
  TeacherQuestionMediaDirectoryTarget,
  TeacherQuestionUploadedDocumentRequest,
  TeacherStudent,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { QuestionImageEditor } from './QuestionImageEditor.tsx'
import { parseQuestionPageRange } from './question-page-range.ts'
import { partitionQuestionUploads, readPdfPageCount, renderQuestionCrops } from './question-segmentation.ts'
import css from './TeacherWorkbench.module.css'

/** Reference-style question-workspace module props. */
export interface QuestionWorkbenchProps {
  /** Current durable workbench state. */
  state: TeacherWorkbenchState
  /** Browser-side rendering settings. */
  settings: TeacherWorkbenchSettings
  /** OCR, roster, and durable question commands. */
  commands: TeacherWorkbenchCommands
  /** Namespace translator. */
  t: TeacherWorkbenchTranslate
}

type BusyTask = 'pdf' | 'cut' | 'document' | 'assign' | 'temporary' | 'student' | 'folder' | null

const HIERARCHY_CLICK_WINDOW_MS = 260
const LIBRARY_NAME_VISIBLE_CHARACTERS = 7
const QUESTION_MEDIA_REFRESH_INTERVAL_MS = 1_000

interface EditorRequest {
  readonly target: TeacherQuestionImageTarget
  readonly questionNo: number
  readonly fileName: string
  readonly readOnly: boolean
}

interface PendingStudent {
  readonly academicYear: string
  readonly grade: string
  readonly className: string
  readonly studentName: string
}

interface StudentHierarchyRow {
  readonly key: string
  readonly student: TeacherStudent
  readonly folder?: TeacherQuestionFolder
  readonly depth: number
  readonly hasChildren: boolean
  readonly expanded: boolean
}

type FolderPrompt =
  | {
    readonly mode: 'create'
    readonly student: TeacherStudent
    readonly parent?: TeacherQuestionFolder
    readonly filesystemParent?: TeacherQuestionMediaDirectoryParent
  }
  | {
    readonly mode: 'rename'
    readonly student: TeacherStudent
    readonly folder?: TeacherQuestionFolder
    readonly target: TeacherQuestionMediaDirectoryTarget
  }

type LibraryFolderPrompt =
  | { readonly mode: 'create'; readonly parent?: TeacherQuestionLibraryFolder }
  | { readonly mode: 'rename'; readonly folder: TeacherQuestionLibraryFolder }

type LibraryHierarchyRow =
  | { readonly kind: 'folder'; readonly folder: TeacherQuestionLibraryFolder; readonly depth: number; readonly hasChildren: boolean; readonly expanded: boolean }
  | { readonly kind: 'batch'; readonly batch: TeacherWorkbenchState['questionBatches'][number]; readonly depth: number }

interface QuestionBankSaveTarget {
  readonly studentId: TeacherStudentId
  readonly folderId: TeacherQuestionFolderId | ''
}

interface HierarchyClickState {
  key: string
  count: number
  timer: ReturnType<typeof setTimeout> | null
}

interface BatchWordRow {
  readonly studentId: TeacherStudentId
  readonly name: string
  readonly includeName: boolean
  readonly includeDate: boolean
  readonly title: string
}

type OfficeRetry =
  | { readonly scope: 'folder'; readonly request: TeacherQuestionUploadedDocumentRequest }
  | { readonly scope: 'class'; readonly request: TeacherQuestionBatchDocumentRequest }

interface OfficeDialog {
  readonly mode: 'success' | 'error'
  readonly scope: 'folder' | 'class'
  readonly title: string
  readonly message: string
  readonly artifacts: readonly TeacherQuestionDocumentPayload[]
  readonly retry?: OfficeRetry
}

/** Render the reference workbench shell without its former analysis and image-search center pane. */
export function QuestionWorkbench({ state, settings, commands, t }: QuestionWorkbenchProps) {
  const fallbackYear = settings.academicYear.trim() || String(new Date().getFullYear())
  const durableClasses = useMemo(() => state.classes.filter(item => item.usage === 'roster'), [state.classes])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const skillFolderInputRef = useRef<HTMLInputElement | null>(null)
  const skillMenuRef = useRef<HTMLDivElement | null>(null)
  const hierarchyClickRef = useRef<HierarchyClickState>({ key: '', count: 0, timer: null })
  const libraryHierarchyClickRef = useRef<HierarchyClickState>({ key: '', count: 0, timer: null })
  const questionMediaRefreshRef = useRef<Promise<void> | null>(null)
  const questionMediaFingerprintRef = useRef<string | null>(null)
  const questionMediaMountedRef = useRef(false)
  const [busy, setBusy] = useState<BusyTask>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingPdf, setPendingPdf] = useState<File | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [pageRange, setPageRange] = useState('')
  const [pageRangeFolderId, setPageRangeFolderId] = useState<TeacherQuestionLibraryFolderId | ''>('')
  const [pageRangeOpen, setPageRangeOpen] = useState(false)
  const [cutFailure, setCutFailure] = useState<string | null>(null)
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [pendingSkillKind, setPendingSkillKind] = useState<'word' | 'ppt' | null>(null)
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => new Set([fallbackYear]))
  const [expandedHierarchy, setExpandedHierarchy] = useState<Set<string>>(() => new Set())
  const [expandedLibraryFolders, setExpandedLibraryFolders] = useState<Set<TeacherQuestionLibraryFolderId>>(() => new Set())
  const [activeClassId, setActiveClassId] = useState<TeacherClassId | ''>(() => durableClasses[0]?.id ?? '')
  const [activeStudentId, setActiveStudentId] = useState<TeacherStudentId | ''>(() => state.students[0]?.id ?? '')
  const [activeFolderId, setActiveFolderId] = useState<TeacherQuestionFolderId | ''>('')
  const [activeBatchId, setActiveBatchId] = useState<TeacherQuestionBatchId | ''>(() => state.questionBatches.at(-1)?.id ?? '')
  const [activeLibraryFolderId, setActiveLibraryFolderId] = useState<TeacherQuestionLibraryFolderId | ''>('')
  const [selectedBatchImageIds, setSelectedBatchImageIds] = useState<Set<string>>(() => new Set())
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(() => new Set())
  const [temporarySelections, setTemporarySelections] = useState<ReadonlyMap<TeacherStudentId, number>>(() => new Map())
  const [addStudentOpen, setAddStudentOpen] = useState(false)
  const [classDrawerOpen, setClassDrawerOpen] = useState(false)
  const [questionBankOpen, setQuestionBankOpen] = useState(false)
  const [batchImagesOpen, setBatchImagesOpen] = useState(false)
  const [studentImagesOpen, setStudentImagesOpen] = useState(false)
  const [batchWordOpen, setBatchWordOpen] = useState(false)
  const [officeDialog, setOfficeDialog] = useState<OfficeDialog | null>(null)
  const [editor, setEditor] = useState<EditorRequest | null>(null)
  const [questionBankSaveTarget, setQuestionBankSaveTarget] = useState<QuestionBankSaveTarget | null>(null)
  const [addYear, setAddYear] = useState(fallbackYear)
  const [addGrade, setAddGrade] = useState('')
  const [addClassName, setAddClassName] = useState('')
  const [addStudentName, setAddStudentName] = useState('')
  const [pendingStudent, setPendingStudent] = useState<PendingStudent | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<FolderPrompt | null>(null)
  const [folderName, setFolderName] = useState('')
  const [libraryFolderPrompt, setLibraryFolderPrompt] = useState<LibraryFolderPrompt | null>(null)
  const [libraryFolderName, setLibraryFolderName] = useState('')
  const [batchWordRows, setBatchWordRows] = useState<readonly BatchWordRow[]>([])
  const [batchBulkTitle, setBatchBulkTitle] = useState('')
  const [questionMedia, setQuestionMedia] = useState<TeacherQuestionMediaBrowseValue | null>(null)

  const refreshQuestionMedia = useCallback((): Promise<void> => {
    const current = questionMediaRefreshRef.current
    if (current !== null) return current
    const pending = commands.browseQuestionMedia().then((result) => {
      if (!result.ok || !questionMediaMountedRef.current) return
      const fingerprint = JSON.stringify(result.value)
      if (questionMediaFingerprintRef.current === fingerprint) return
      questionMediaFingerprintRef.current = fingerprint
      setQuestionMedia(result.value)
    }).finally(() => {
      questionMediaRefreshRef.current = null
    })
    questionMediaRefreshRef.current = pending
    return pending
  }, [commands.browseQuestionMedia])
  const classes = questionMedia?.classes ?? durableClasses
  const students = questionMedia?.students ?? state.students
  const questionBatches = questionMedia?.questionBatches ?? state.questionBatches
  const questionLibraryFolders = questionMedia?.questionLibraryFolders ?? state.questionLibraryFolders
  const questionFolders = questionMedia?.questionFolders ?? state.questionFolders
  const questionAssignments = questionMedia?.questionAssignments ?? state.questionAssignments
  const readOnlyBatchIds = useMemo(
    () => new Set(questionMedia?.readOnlyBatchIds ?? []),
    [questionMedia?.readOnlyBatchIds],
  )
  const readOnlyLibraryFolderIds = useMemo(
    () => new Set(questionMedia?.readOnlyLibraryFolderIds ?? []),
    [questionMedia?.readOnlyLibraryFolderIds],
  )
  const readOnlyAssignmentIds = useMemo(
    () => new Set(questionMedia?.readOnlyAssignmentIds ?? []),
    [questionMedia?.readOnlyAssignmentIds],
  )
  const readOnlyClassIds = useMemo(
    () => new Set(questionMedia?.readOnlyClassIds ?? []),
    [questionMedia?.readOnlyClassIds],
  )
  const readOnlyStudentIds = useMemo(
    () => new Set(questionMedia?.readOnlyStudentIds ?? []),
    [questionMedia?.readOnlyStudentIds],
  )
  const readOnlyFolderIds = useMemo(
    () => new Set(questionMedia?.readOnlyFolderIds ?? []),
    [questionMedia?.readOnlyFolderIds],
  )

  const activeClass = classes.find(item => item.id === activeClassId)
  const activeStudent = students.find(item => item.id === activeStudentId)
  const activeBatch = questionBatches.find(item => item.id === activeBatchId)
  const classStudents = useMemo(
    () => students.filter(student => student.classId === activeClassId),
    [activeClassId, students],
  )
  const classStudentsWithTemporaryImages = useMemo(
    () => classStudents.filter(student => (temporarySelections.get(student.id) ?? 0) > 0),
    [classStudents, temporarySelections],
  )
  const studentAssignments = useMemo(
    () => questionAssignments.filter(item => item.studentId === activeStudentId
      && (activeFolderId === '' || item.folderId === activeFolderId)),
    [activeFolderId, activeStudentId, questionAssignments],
  )
  const writableStudentAssignments = useMemo(
    () => studentAssignments.filter(item => !readOnlyAssignmentIds.has(item.id)),
    [readOnlyAssignmentIds, studentAssignments],
  )
  const writableSelectedAssignmentIds = useMemo(
    () => writableStudentAssignments.filter(item => selectedAssignmentIds.has(item.id)).map(item => item.id),
    [selectedAssignmentIds, writableStudentAssignments],
  )
  const hierarchyRows = useMemo(
    () => buildStudentHierarchyRows(classStudents, questionFolders, expandedHierarchy),
    [classStudents, expandedHierarchy, questionFolders],
  )
  const libraryRows = useMemo(
    () => buildQuestionLibraryRows(questionLibraryFolders, questionBatches, expandedLibraryFolders),
    [expandedLibraryFolders, questionBatches, questionLibraryFolders],
  )
  const libraryFolderOptions = useMemo(
    () => buildQuestionLibraryFolderOptions(state.questionLibraryFolders),
    [state.questionLibraryFolders],
  )
  const classHierarchy = useMemo(() => {
    const groups = new Map<string, TeacherClass[]>()
    for (const item of classes) {
      const year = classAcademicYear(item, fallbackYear)
      const group = groups.get(year)
      if (group === undefined) groups.set(year, [item])
      else group.push(item)
    }
    if (groups.size === 0) groups.set(fallbackYear, [])
    return [...groups].sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))
  }, [classes, fallbackYear])

  useEffect(() => {
    questionMediaMountedRef.current = true
    return () => { questionMediaMountedRef.current = false }
  }, [])

  useEffect(() => {
    void refreshQuestionMedia()
  }, [
    refreshQuestionMedia,
    state.questionAssignments,
    state.questionBatches,
    state.questionFolders,
    state.questionLibraryFolders,
    state.students,
  ])

  useEffect(() => {
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshQuestionMedia()
    }
    const interval = window.setInterval(refreshWhenVisible, QUESTION_MEDIA_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [refreshQuestionMedia])

  useEffect(() => {
    if (toast === null) return
    const timeout = setTimeout(() => { setToast(null) }, 3000)
    return () => { clearTimeout(timeout) }
  }, [toast])

  useEffect(() => {
    let active = true
    const studentIds = students.filter(student => !readOnlyStudentIds.has(student.id)).map(student => student.id)
    if (studentIds.length === 0) {
      setTemporarySelections(new Map())
      return () => { active = false }
    }
    void commands.listTemporaryQuestionSelections({ studentIds }).then((result) => {
      if (!active || !result.ok) return
      setTemporarySelections(new Map(result.value.map(item => [item.studentId, item.imageCount] as const)))
    })
    return () => { active = false }
  }, [commands, readOnlyStudentIds, students])

  useEffect(() => () => {
    const timer = hierarchyClickRef.current.timer
    if (timer !== null) clearTimeout(timer)
    const libraryTimer = libraryHierarchyClickRef.current.timer
    if (libraryTimer !== null) clearTimeout(libraryTimer)
  }, [])

  useEffect(() => {
    setExpandedYears(current => current.has(fallbackYear) ? current : new Set([...current, fallbackYear]))
  }, [fallbackYear])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!skillMenuOpen) return
      if (event.target instanceof Node && skillMenuRef.current?.contains(event.target)) return
      setSkillMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [skillMenuOpen])

  useEffect(() => {
    if (activeClassId !== '' && classes.some(item => item.id === activeClassId)) return
    setActiveClassId(classes[0]?.id ?? '')
  }, [activeClassId, classes])

  useEffect(() => {
    if (activeBatchId !== '' && questionBatches.some(item => item.id === activeBatchId)) return
    setActiveBatchId(questionBatches.at(-1)?.id ?? '')
    setSelectedBatchImageIds(new Set())
  }, [activeBatchId, questionBatches])

  useEffect(() => {
    if (activeStudentId !== '' && students.some(item => item.id === activeStudentId)) return
    setActiveStudentId(classStudents[0]?.id ?? students[0]?.id ?? '')
  }, [activeStudentId, classStudents, students])

  useEffect(() => {
    if (activeFolderId === '') return
    const folder = questionFolders.find(item => item.id === activeFolderId)
    if (folder?.studentId === activeStudentId) return
    setActiveFolderId('')
  }, [activeFolderId, activeStudentId, questionFolders])

  useEffect(() => {
    if (pendingStudent === null) return
    const createdClass = durableClasses.find(item => classAcademicYear(item, fallbackYear) === pendingStudent.academicYear
      && item.grade === pendingStudent.grade && item.name === pendingStudent.className)
    if (createdClass === undefined) return
    const request = pendingStudent
    setPendingStudent(null)
    setActiveClassId(createdClass.id)
    if (request.studentName === '') {
      setBusy(null)
      setToast(t('questions.classCreated'))
      return
    }
    void commands.saveStudent({
      classId: createdClass.id,
      name: request.studentName,
      studentNumber: '',
      gender: '',
      guardian: '',
      relation: '',
      phone: '',
      address: '',
    }).then((result) => {
      setBusy(null)
      setToast(result.ok ? t('questions.studentCreated') : result.error.message)
    })
  }, [commands, durableClasses, fallbackYear, pendingStudent, t])

  const closeDrawers = (): void => {
    setAddStudentOpen(false)
    setClassDrawerOpen(false)
    setQuestionBankOpen(false)
    setBatchImagesOpen(false)
    setStudentImagesOpen(false)
    setBatchWordOpen(false)
    setFolderPrompt(null)
    setFolderName('')
    setLibraryFolderPrompt(null)
    setLibraryFolderName('')
  }

  const choosePdf = async (file: File | null): Promise<void> => {
    if (file === null) return
    setBusy('pdf')
    setToast(null)
    setCutFailure(null)
    try {
      const count = await readPdfPageCount(file)
      setPendingPdf(file)
      setPdfPageCount(count)
      setPageRange('')
      setPageRangeFolderId(state.questionLibraryFolders.some(folder => folder.id === activeLibraryFolderId)
        ? activeLibraryFolderId
        : '')
      setPageRangeOpen(true)
    } catch (cause) {
      setToast(errorMessage(cause, t('questions.pdfReadFailed')))
    } finally {
      setBusy(null)
    }
  }

  const cutPdf = async (): Promise<void> => {
    if (pendingPdf === null || pdfPageCount < 1 || busy !== null) return
    let selection
    try {
      selection = parseQuestionPageRange(pageRange, pdfPageCount)
    } catch (cause) {
      setCutFailure(errorMessage(cause, t('questions.cutFailed')))
      setPageRangeOpen(false)
      return
    }

    setPageRangeOpen(false)
    setCutFailure(null)
    setBusy('cut')
    let savedCount = 0
    try {
      const result = await commands.extractQuestionLayout(pendingPdf, selection.pageIndexes, settings.questionRenderScale)
      if (!result.ok) throw new Error(result.error.message)
      const exactPages = new Set(selection.pageIndexes)
      const layout: OcrLayoutDocument = {
        ...result.value,
        pages: result.value.pages.filter(page => exactPages.has(page.pageIndex)),
      }
      const segmented = await commands.segmentQuestions(layout, settings.questionCropPadding)
      if (!segmented.ok) throw new Error(segmented.error.message)
      const questions = segmented.value.questions
      if (questions.length === 0) throw new Error(t('questions.noMarkers'))
      const groupCount = segmented.value.groupCount
      const maxSaveBatchBytes = segmented.value.maxSaveBatchBytes
      const baseName = pendingPdf.name.replace(/\.pdf$/iu, '')
      const selectedRange = selection.label || t('questions.allPages')
      let savedBatchId: TeacherQuestionBatchId | undefined
      for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
        const groupQuestions = questions.filter(question => question.groupIndex === groupIndex)
        if (groupQuestions.length === 0) continue
        const crops = await renderQuestionCrops(
          pendingPdf,
          layout,
          groupQuestions,
          segmented.value.horizontalBounds,
          settings.questionRenderScale,
        )
        const parts = partitionQuestionUploads(crops, maxSaveBatchBytes)
        for (const images of parts) {
          const saved = await commands.saveQuestionBatch({
            ...(savedBatchId === undefined ? {} : { appendToBatchId: savedBatchId }),
            ...(pageRangeFolderId === '' ? {} : { folderId: pageRangeFolderId }),
            name: baseName,
            sourceName: pendingPdf.name,
            pageRange: selectedRange,
            images,
          })
          if (!saved.ok) throw new Error(saved.error.message)
          savedBatchId = saved.batchId ?? savedBatchId
          if (savedBatchId === undefined) throw new Error(t('questions.cutFailed'))
          savedCount += images.length
        }
      }
      if (savedBatchId !== undefined) setActiveBatchId(savedBatchId)
      setToast(t('questions.cutSaved', { count: savedCount }))
      setPendingPdf(null)
      setPageRange('')
      setPageRangeFolderId('')
      if (fileInputRef.current !== null) fileInputRef.current.value = ''
    } catch (cause) {
      const message = errorMessage(cause, t('questions.cutFailed'))
      setCutFailure(savedCount > 0 ? t('questions.cutPartiallySaved', { count: savedCount, message }) : message)
    } finally {
      setBusy(null)
    }
  }

  const addStudentHierarchy = async (): Promise<void> => {
    const year = addYear.trim()
    const grade = addGrade.trim()
    const className = addClassName.trim()
    const studentName = addStudentName.trim()
    if (year === '' || grade === '' || className === '' || busy !== null) return
    setExpandedYears(current => new Set([...current, year]))
    setBusy('student')
    const existingClass = durableClasses.find(item => classAcademicYear(item, fallbackYear) === year
      && item.grade === grade && item.name === className)
    if (existingClass !== undefined) {
      setActiveClassId(existingClass.id)
      if (studentName === '') {
        setBusy(null)
        setAddStudentOpen(false)
        setToast(t('questions.classExists'))
        return
      }
      const result = await commands.saveStudent({
        classId: existingClass.id,
        name: studentName,
        studentNumber: '',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
      })
      setBusy(null)
      setAddStudentOpen(false)
      setToast(result.ok ? t('questions.studentCreated') : result.error.message)
      return
    }

    setPendingStudent({ academicYear: year, grade, className, studentName })
    const result = await commands.saveClass({ usage: 'roster', academicYear: year, name: className, grade, subject: settings.defaultSubject })
    setAddStudentOpen(false)
    if (!result.ok) {
      setPendingStudent(null)
      setBusy(null)
      setToast(result.error.message)
    }
  }

  const openAddStudent = (): void => {
    setAddYear(fallbackYear)
    setAddGrade('')
    setAddClassName('')
    setAddStudentName('')
    setAddStudentOpen(true)
  }

  const openClass = (item: TeacherClass): void => {
    setActiveClassId(item.id)
    const firstStudent = students.find(student => student.classId === item.id)
    setActiveStudentId(firstStudent?.id ?? '')
    setActiveFolderId('')
    setStudentImagesOpen(false)
    setClassDrawerOpen(true)
  }

  const openStudent = (student: TeacherStudent, folderId: TeacherQuestionFolderId | '' = ''): void => {
    void refreshQuestionMedia()
    const sameTarget = activeStudentId === student.id && activeFolderId === folderId
    setActiveStudentId(student.id)
    setActiveFolderId(folderId)
    setSelectedAssignmentIds(new Set())
    if (studentImagesOpen && sameTarget) {
      setStudentImagesOpen(false)
      return
    }
    setQuestionBankOpen(false)
    setBatchImagesOpen(false)
    setStudentImagesOpen(true)
  }

  const openQuestionBank = (student?: TeacherStudent, folderId: TeacherQuestionFolderId | '' = ''): void => {
    void refreshQuestionMedia()
    if (student !== undefined) {
      setActiveStudentId(student.id)
      setActiveFolderId(folderId)
      const writableTarget = !readOnlyStudentIds.has(student.id)
        && (folderId === '' || !readOnlyFolderIds.has(folderId))
      setQuestionBankSaveTarget(writableTarget ? { studentId: student.id, folderId } : null)
    } else {
      setQuestionBankSaveTarget(null)
    }
    setStudentImagesOpen(false)
    setQuestionBankOpen(true)
    setBatchImagesOpen(false)
  }

  const toggleHierarchyRow = (row: StudentHierarchyRow): void => {
    setActiveStudentId(row.student.id)
    if (!row.hasChildren) return
    setExpandedHierarchy(current => toggleSet(current, row.key))
  }

  const requestFolderCreate = (row: StudentHierarchyRow): void => {
    setActiveStudentId(row.student.id)
    setActiveFolderId(row.folder?.id ?? '')
    setFolderName('')
    const filesystemParent: TeacherQuestionMediaDirectoryParent | undefined = row.folder !== undefined
      && readOnlyFolderIds.has(row.folder.id)
      ? { kind: 'student-folder', id: row.folder.id }
      : row.folder === undefined && readOnlyStudentIds.has(row.student.id)
        ? { kind: 'student', id: row.student.id }
        : undefined
    setFolderPrompt({
      mode: 'create',
      student: row.student,
      ...(row.folder === undefined ? {} : { parent: row.folder }),
      ...(filesystemParent === undefined ? {} : { filesystemParent }),
    })
  }

  const requestFolderRename = (row: StudentHierarchyRow): void => {
    setActiveStudentId(row.student.id)
    setActiveFolderId(row.folder?.id ?? '')
    setFolderName(row.folder?.name ?? row.student.name)
    setFolderPrompt({
      mode: 'rename',
      student: row.student,
      ...(row.folder === undefined ? {} : { folder: row.folder }),
      target: row.folder === undefined
        ? { kind: 'student', id: row.student.id }
        : { kind: 'student-folder', id: row.folder.id },
    })
  }

  const handleHierarchyClick = (row: StudentHierarchyRow): void => {
    const current = hierarchyClickRef.current
    if (current.key !== row.key) {
      if (current.timer !== null) clearTimeout(current.timer)
      current.key = row.key
      current.count = 0
    }
    current.count += 1
    if (current.timer !== null) clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      const count = current.count
      current.count = 0
      current.timer = null
      if (count <= 1) {
        openStudent(row.student, row.folder?.id ?? '')
      } else if (count === 2) {
        toggleHierarchyRow(row)
      } else if (count === 3) {
        requestFolderCreate(row)
      } else if (count >= 4) {
        requestFolderRename(row)
      }
    }, HIERARCHY_CLICK_WINDOW_MS)
  }

  const saveFolderPrompt = async (): Promise<void> => {
    if (folderPrompt === null || folderName.trim() === '' || busy !== null) return
    const name = folderName.trim()
    const parentId = folderPrompt.mode === 'create' ? folderPrompt.parent?.id : folderPrompt.folder?.parentId
    const duplicate = folderPrompt.mode === 'rename' && folderPrompt.folder === undefined
      ? students.some(student => student.classId === folderPrompt.student.classId
        && student.id !== folderPrompt.student.id
        && sameDirectoryName(student.name, name))
      : questionFolders.some(folder => folder.studentId === folderPrompt.student.id
        && folder.parentId === parentId
        && (folderPrompt.mode === 'create' || folder.id !== folderPrompt.folder?.id)
        && sameDirectoryName(folder.name, name))
    if (duplicate) {
      setToast(t('questions.folderExists'))
      return
    }
    setBusy('folder')
    const filesystemMutation = folderPrompt.mode === 'rename' || folderPrompt.filesystemParent !== undefined
    const result = folderPrompt.mode === 'rename'
      ? await commands.renameQuestionMediaDirectory({ target: folderPrompt.target, name })
      : folderPrompt.filesystemParent === undefined
        ? await commands.createQuestionFolder({
          studentId: folderPrompt.student.id,
          ...(parentId === undefined ? {} : { parentId }),
          name,
        })
        : await commands.createQuestionMediaDirectory({ parent: folderPrompt.filesystemParent, name })
    setBusy(null)
    if (!result.ok) {
      setToast(result.error.message)
      return
    }
    if (filesystemMutation) {
      await refreshQuestionMedia()
      await refreshQuestionMedia()
    }
    if (folderPrompt.mode === 'create') {
      setExpandedHierarchy(current => new Set([...current, hierarchyKey(folderPrompt.student.id, parentId)]))
    }
    setFolderPrompt(null)
    setFolderName('')
    setToast(folderPrompt.mode === 'create'
      ? t('questions.folderCreated', { name })
      : t('questions.folderRenamed', { name }))
  }

  const requestLibraryFolderCreate = (parent?: TeacherQuestionLibraryFolder): void => {
    setLibraryFolderName('')
    setLibraryFolderPrompt(parent === undefined ? { mode: 'create' } : { mode: 'create', parent })
  }

  const requestLibraryFolderRename = (folder: TeacherQuestionLibraryFolder): void => {
    setLibraryFolderName(folder.name)
    setLibraryFolderPrompt({ mode: 'rename', folder })
  }

  const saveLibraryFolderPrompt = async (): Promise<void> => {
    if (libraryFolderPrompt === null || libraryFolderName.trim() === '' || busy !== null) return
    const name = libraryFolderName.trim()
    const parentId = libraryFolderPrompt.mode === 'create'
      ? libraryFolderPrompt.parent?.id
      : libraryFolderPrompt.folder.parentId
    const duplicate = questionLibraryFolders.some(folder => folder.parentId === parentId
      && (libraryFolderPrompt.mode === 'create' || folder.id !== libraryFolderPrompt.folder.id)
      && folder.name.normalize('NFKC').toLowerCase() === name.normalize('NFKC').toLowerCase())
    if (duplicate) {
      setToast(t('questions.folderExists'))
      return
    }
    setBusy('folder')
    const filesystemCreate = libraryFolderPrompt.mode === 'create'
      && libraryFolderPrompt.parent !== undefined
      && readOnlyLibraryFolderIds.has(libraryFolderPrompt.parent.id)
    const filesystemRename = libraryFolderPrompt.mode === 'rename'
      && readOnlyLibraryFolderIds.has(libraryFolderPrompt.folder.id)
    const result = filesystemCreate
      ? await commands.createQuestionMediaDirectory({
        parent: { kind: 'library-folder', id: libraryFolderPrompt.parent.id },
        name,
      })
      : filesystemRename
        ? await commands.renameQuestionMediaDirectory({
          target: { kind: 'library-folder', id: libraryFolderPrompt.folder.id },
          name,
        })
        : libraryFolderPrompt.mode === 'create'
          ? await commands.createQuestionLibraryFolder({
            ...(parentId === undefined ? {} : { parentId }),
            name,
          })
          : await commands.renameQuestionLibraryFolder(libraryFolderPrompt.folder.id, name)
    setBusy(null)
    if (!result.ok) {
      setToast(result.error.message)
      return
    }
    if (filesystemCreate || filesystemRename) {
      await refreshQuestionMedia()
      await refreshQuestionMedia()
    }
    if (libraryFolderPrompt.mode === 'create' && parentId !== undefined) {
      setExpandedLibraryFolders(current => new Set([...current, parentId]))
    }
    setLibraryFolderPrompt(null)
    setLibraryFolderName('')
    setToast(libraryFolderPrompt.mode === 'create'
      ? t('questions.folderCreated', { name })
      : t('questions.folderRenamed', { name }))
  }

  const deleteLibraryFolder = async (folder: TeacherQuestionLibraryFolder): Promise<void> => {
    const filesystemDirectory = readOnlyLibraryFolderIds.has(folder.id)
    const confirmation = filesystemDirectory
      ? t('questions.confirmDeleteFolder', { name: folder.name })
      : t('questions.confirmDeleteLibraryFolder', { name: folder.name })
    if (!globalThis.confirm(confirmation)) return
    setBusy('folder')
    const result = filesystemDirectory
      ? await commands.deleteQuestionMediaDirectory({ target: { kind: 'library-folder', id: folder.id } })
      : await commands.deleteQuestionLibraryFolder(folder.id)
    setBusy(null)
    if (result.ok) {
      const removed = questionLibraryFolderDescendants(questionLibraryFolders, folder.id)
      setExpandedLibraryFolders(current => new Set([...current].filter(id => !removed.has(id))))
      if (removed.has(activeLibraryFolderId as TeacherQuestionLibraryFolderId)) {
        setActiveLibraryFolderId(folder.parentId ?? '')
        setBatchImagesOpen(false)
      }
      if (filesystemDirectory) {
        await refreshQuestionMedia()
        await refreshQuestionMedia()
      }
    }
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const deleteFolder = async (folder: TeacherQuestionFolder): Promise<void> => {
    if (!globalThis.confirm(t('questions.confirmDeleteFolder', { name: folder.name }))) return
    const result = await commands.deleteQuestionFolder(folder.id)
    if (result.ok) {
      setActiveFolderId('')
      setStudentImagesOpen(false)
      setExpandedHierarchy((current) => {
        const removed = questionFolderDescendants(questionFolders, folder.id)
        return new Set([...current].filter(key => ![...removed].some(id => key === hierarchyKey(folder.studentId, id))))
      })
    }
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const deleteHierarchyRow = async (row: StudentHierarchyRow): Promise<void> => {
    const filesystemDirectory = row.folder === undefined
      ? readOnlyStudentIds.has(row.student.id)
      : readOnlyFolderIds.has(row.folder.id)
    if (!filesystemDirectory) {
      if (row.folder === undefined) await deleteStudent(row.student)
      else await deleteFolder(row.folder)
      return
    }
    const name = row.folder?.name ?? row.student.name
    if (!globalThis.confirm(t('questions.confirmDeleteFolder', { name }))) return
    setBusy('folder')
    const target: TeacherQuestionMediaDirectoryTarget = row.folder === undefined
      ? { kind: 'student', id: row.student.id }
      : { kind: 'student-folder', id: row.folder.id }
    const result = await commands.deleteQuestionMediaDirectory({ target })
    setBusy(null)
    if (result.ok) {
      if (row.folder === undefined) {
        const folderIds = new Set(questionFolders
          .filter(folder => folder.studentId === row.student.id)
          .map(folder => folder.id))
        const removedKeys = new Set([
          hierarchyKey(row.student.id),
          ...[...folderIds].map(id => hierarchyKey(row.student.id, id)),
        ])
        setExpandedHierarchy(current => new Set([...current].filter(key => (
          !removedKeys.has(key)
        ))))
        if (activeStudentId === row.student.id) {
          setActiveStudentId('')
          setActiveFolderId('')
          setStudentImagesOpen(false)
        }
      } else {
        const removed = questionFolderDescendants(questionFolders, row.folder.id)
        const removedKeys = new Set([...removed].map(id => hierarchyKey(row.student.id, id)))
        setExpandedHierarchy(current => new Set([...current].filter(key => (
          !removedKeys.has(key)
        ))))
        if (activeFolderId !== '' && removed.has(activeFolderId)) {
          setActiveFolderId('')
          setStudentImagesOpen(false)
        }
      }
      await refreshQuestionMedia()
      await refreshQuestionMedia()
    }
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const openBatch = (batchId: TeacherQuestionBatchId): void => {
    if (batchImagesOpen && activeBatchId === batchId) {
      setBatchImagesOpen(false)
      return
    }
    setActiveBatchId(batchId)
    setSelectedBatchImageIds(new Set())
    setStudentImagesOpen(false)
    setBatchImagesOpen(true)
  }

  const toggleLibraryFolder = (folder: TeacherQuestionLibraryFolder): void => {
    setActiveLibraryFolderId(folder.id)
    setBatchImagesOpen(false)
    setExpandedLibraryFolders((current) => {
      const next = new Set(current)
      if (next.has(folder.id)) next.delete(folder.id)
      else next.add(folder.id)
      return next
    })
  }

  const handleLibraryHierarchyClick = (folder: TeacherQuestionLibraryFolder): void => {
    const current = libraryHierarchyClickRef.current
    if (current.key !== folder.id) {
      if (current.timer !== null) clearTimeout(current.timer)
      current.key = folder.id
      current.count = 0
    }
    current.count += 1
    if (current.timer !== null) clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      const count = current.count
      current.count = 0
      current.timer = null
      if (count <= 1) toggleLibraryFolder(folder)
      else if (count === 2) requestLibraryFolderCreate(folder)
      else if (count >= 3) requestLibraryFolderRename(folder)
    }, HIERARCHY_CLICK_WINDOW_MS)
  }

  const requestCloseClassDrawer = (): void => {
    if (studentImagesOpen) {
      setStudentImagesOpen(false)
      return
    }
    setClassDrawerOpen(false)
  }

  const toggleBatchImage = (imageId: string): void => {
    setSelectedBatchImageIds(current => toggleSet(current, imageId))
  }

  const toggleAllBatchImages = (): void => {
    if (activeBatch === undefined) return
    setSelectedBatchImageIds(current => current.size === activeBatch.images.length
      ? new Set()
      : new Set(activeBatch.images.map(image => image.id)))
  }

  const saveSelectedBatchImages = async (): Promise<void> => {
    if (activeBatch === undefined || selectedBatchImageIds.size === 0 || busy !== null) return
    const selectedImages = activeBatch.images.filter(image => selectedBatchImageIds.has(image.id))
    if (questionBankSaveTarget === null) {
      try {
        const directory = await pickWritableDirectory(
          t('questions.directoryPickerUnsupported'),
          t('questions.directoryPermissionDenied'),
        )
        if (directory === null) return
        setBusy('assign')
        let saved = 0
        let failed = 0
        for (const image of selectedImages) {
          const result = await commands.readQuestionImage({ target: { kind: 'batch', id: image.id } })
          if (!result.ok) {
            failed += 1
            continue
          }
          try {
            await writeUniqueFile(directory, result.value.fileName, artifactBlob(result.value))
            saved += 1
          } catch {
            failed += 1
          }
        }
        setBusy(null)
        if (saved > 0) setSelectedBatchImageIds(new Set())
        setToast(failed === 0
          ? t('questions.imagesSaved', { count: saved })
          : t('questions.imagesSavedWithFailed', { saved, failed }))
      } catch (cause) {
        setBusy(null)
        if (isAbortError(cause)) return
        setToast(errorMessage(cause, t('questions.imageExportFailed')))
      }
      return
    }

    setBusy('assign')
    const result = await commands.assignQuestions({
      studentId: questionBankSaveTarget.studentId,
      ...(questionBankSaveTarget.folderId === '' ? {} : { folderId: questionBankSaveTarget.folderId }),
      imageIds: selectedImages.map(image => image.id),
    })
    setBusy(null)
    if (result.ok) setSelectedBatchImageIds(new Set())
    setToast(result.ok ? t('questions.assigned') : result.error.message)
  }

  const saveTemporarySelection = async (): Promise<void> => {
    if (activeStudent === undefined || writableSelectedAssignmentIds.length === 0 || busy !== null) return
    setBusy('temporary')
    const result = await commands.saveTemporaryQuestionSelection({
      studentId: activeStudent.id,
      assignmentIds: writableSelectedAssignmentIds,
    })
    setBusy(null)
    if (!result.ok) {
      setToast(result.error.message)
      return
    }
    setTemporarySelections(current => new Map(current).set(result.value.studentId, result.value.imageCount))
    setSelectedAssignmentIds(new Set())
    setToast(t('questions.tempSaved', { count: result.value.imageCount }))
  }

  const generateFolderDocument = async (request: TeacherQuestionUploadedDocumentRequest): Promise<void> => {
    if (busy !== null) return
    setSkillMenuOpen(false)
    setBusy('document')
    const result = await commands.generateUploadedQuestionDocument(request)
    setBusy(null)
    const retry: OfficeRetry = { scope: 'folder', request }
    if (result.ok) {
      setOfficeDialog({
        mode: 'success',
        scope: 'folder',
        title: request.kind === 'word' ? t('questions.wordComplete') : t('questions.pptComplete'),
        message: t('questions.fileGenerated', { name: result.value.fileName }),
        artifacts: [result.value],
        retry,
      })
    } else {
      setOfficeDialog({
        mode: 'error',
        scope: 'folder',
        title: t('questions.generationFailed'),
        message: result.error.message,
        artifacts: [],
        retry,
      })
    }
  }

  const startFolderGeneration = (kind: 'word' | 'ppt'): void => {
    if (busy !== null) return
    setSkillMenuOpen(false)
    setPendingSkillKind(kind)
    if (skillFolderInputRef.current !== null) {
      skillFolderInputRef.current.value = ''
      skillFolderInputRef.current.click()
    }
  }

  const chooseSkillFolder = async (files: FileList | null): Promise<void> => {
    const kind = pendingSkillKind
    setPendingSkillKind(null)
    if (kind === null || files === null || files.length === 0 || busy !== null) return
    setBusy('document')
    try {
      const request = await buildFolderDocumentRequest(kind, files)
      setBusy(null)
      await generateFolderDocument(request)
    } catch (cause) {
      setBusy(null)
      setOfficeDialog({
        mode: 'error',
        scope: 'folder',
        title: t('questions.generationFailed'),
        message: errorMessage(cause, t('questions.generationFailed')),
        artifacts: [],
      })
    }
  }

  const openBatchWord = (): void => {
    if (classStudentsWithTemporaryImages.length === 0) return
    setBatchWordRows(classStudentsWithTemporaryImages.map(student => ({
      studentId: student.id,
      name: student.name,
      includeName: false,
      includeDate: false,
      title: '',
    })))
    setBatchBulkTitle('')
    setBatchWordOpen(true)
  }

  const generateClassDocuments = async (request: TeacherQuestionBatchDocumentRequest): Promise<void> => {
    if (request.students.length === 0 || busy !== null) return
    setBusy('document')
    const result = await commands.generateStudentDocuments(request)
    setBusy(null)
    setBatchWordOpen(false)
    const retry: OfficeRetry = { scope: 'class', request }
    if (result.ok) {
      const skipped = new Set(result.value.skipped.map(item => item.studentId))
      setTemporarySelections((current) => {
        const next = new Map(current)
        for (const student of request.students) {
          if (!skipped.has(student.studentId)) next.delete(student.studentId)
        }
        return next
      })
      setOfficeDialog({
        mode: 'success',
        scope: 'class',
        title: t('questions.batchGenerationComplete'),
        message: result.value.skipped.length === 0
          ? t('questions.batchGenerated', { count: result.value.artifacts.length })
          : t('questions.batchGeneratedWithSkipped', {
            count: result.value.artifacts.length,
            skipped: result.value.skipped.length,
          }),
        artifacts: result.value.artifacts,
        retry,
      })
    } else {
      setOfficeDialog({
        mode: 'error',
        scope: 'class',
        title: t('questions.batchGenerationFailed'),
        message: result.error.message,
        artifacts: [],
        retry,
      })
    }
  }

  const generateClassWord = async (): Promise<void> => {
    await generateClassDocuments({
      kind: 'word',
      source: 'temporary',
      students: batchWordRows.map(row => ({
        studentId: row.studentId,
        title: row.title,
        includeName: row.includeName,
        includeDate: row.includeDate,
      })),
    })
  }

  const generateClassPpt = async (): Promise<void> => {
    await generateClassDocuments({
      kind: 'ppt',
      source: 'temporary',
      students: classStudentsWithTemporaryImages.map(student => ({
        studentId: student.id,
        title: '',
        includeName: false,
        includeDate: false,
      })),
    })
  }

  const retryOfficeGeneration = async (): Promise<void> => {
    const retry = officeDialog?.retry
    if (retry === undefined) return
    setOfficeDialog(null)
    if (retry.scope === 'folder') await generateFolderDocument(retry.request)
    else await generateClassDocuments(retry.request)
  }

  const saveOfficeArtifacts = async (): Promise<void> => {
    if (officeDialog === null || officeDialog.artifacts.length === 0) return
    try {
      if (officeDialog.scope === 'class') {
        const directory = await pickWritableDirectory(
          t('questions.directoryPickerUnsupported'),
          t('questions.directoryPermissionDenied'),
        )
        if (directory === null) return
        let saved = 0
        let failed = 0
        for (const artifact of officeDialog.artifacts) {
          try {
            await writeUniqueFile(directory, artifact.fileName, artifactBlob(artifact))
            saved += 1
          } catch {
            failed += 1
          }
        }
        setToast(t('questions.filesSaved', { saved, failed }))
      } else if (officeDialog.artifacts.length === 1) {
        const artifact = officeDialog.artifacts[0]
        if (artifact === undefined) return
        const saved = await saveSingleArtifact(artifact)
        if (!saved) return
        setToast(t('questions.fileSaved', { name: artifact.fileName }))
      } else {
        for (const artifact of officeDialog.artifacts) downloadArtifact(artifact)
        setToast(t('questions.filesDownloaded', { count: officeDialog.artifacts.length }))
      }
      setOfficeDialog(null)
    } catch (cause) {
      if (isAbortError(cause)) return
      setToast(errorMessage(cause, t('questions.saveFailed')))
    }
  }

  const deleteClass = async (item: TeacherClass): Promise<void> => {
    if (!globalThis.confirm(t('questions.confirmDeleteClass', { name: classDisplayName(item) }))) return
    const result = await commands.deleteClass(item.id)
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const deleteStudent = async (student: TeacherStudent): Promise<void> => {
    if (!globalThis.confirm(t('questions.confirmDeleteStudent', { name: student.name }))) return
    const result = await commands.deleteStudent(student.id)
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const deleteBatch = async (batchId: TeacherQuestionBatchId, name: string): Promise<void> => {
    if (!globalThis.confirm(t('questions.confirmDeleteBatch', { name }))) return
    const result = await commands.deleteQuestionBatch({ batchId })
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const deleteImage = async (target: TeacherQuestionImageTarget): Promise<void> => {
    if (!globalThis.confirm(t('confirm.delete'))) return
    const result = await commands.deleteQuestionImage({ target })
    setToast(result.ok ? t('questions.deleted') : result.error.message)
  }

  const anyDrawerOpen = addStudentOpen || classDrawerOpen || questionBankOpen || batchImagesOpen
    || studentImagesOpen || batchWordOpen

  return (
    <div className={css.legacyQuestionShell} data-question-workbench data-reference-question-shell>
      <header className={css.legacyQuestionTopBar}>
        <div className={css.legacyTopLeft}>
          <span className={css.legacyStatusDot} aria-hidden="true" />
          <h2>{t('questions.referenceTitle')}</h2>
        </div>
        <div className={css.legacyTopActions}>
          <div ref={skillMenuRef} className={css.legacySkillMenuWrap}>
            <TopAction icon={<Grid2X2Plus size={18} />} label={t('questions.skillLibrary')} expanded={skillMenuOpen} onClick={() => { setSkillMenuOpen(value => !value) }} />
            {skillMenuOpen && (
              <div className={css.legacySkillMenu} role="menu">
                <button type="button" role="menuitem" onClick={() => { startFolderGeneration('word') }}>{t('questions.generateWord')}</button>
                <button type="button" role="menuitem" onClick={() => { startFolderGeneration('ppt') }}>{t('questions.generatePpt')}</button>
              </div>
            )}
          </div>
          <TopAction icon={<FolderOpen size={18} />} label={t('questions.library')} onClick={() => { openQuestionBank() }} />
          <TopAction icon={<UserPlus size={18} />} label={t('questions.addStudent')} onClick={openAddStudent} />
          <TopAction icon={<Upload size={18} />} label={t('questions.uploadPdf')} disabled={busy !== null} onClick={() => { fileInputRef.current?.click() }} />
          <input
            ref={fileInputRef}
            className={css.legacyHiddenInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => { void choosePdf(event.target.files?.[0] ?? null) }}
          />
          <input
            ref={(node) => {
              skillFolderInputRef.current = node
              node?.setAttribute('webkitdirectory', '')
              node?.setAttribute('directory', '')
            }}
            className={css.legacyHiddenInput}
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.heic,.heif,.svg"
            multiple
            onChange={(event) => { void chooseSkillFolder(event.target.files) }}
          />
        </div>
      </header>

      <div className={css.legacyQuestionBody}>
        <aside className={css.legacyStudentNav} aria-label={t('questions.studentHierarchy')}>
          {classHierarchy.map(([year, classes]) => (
            <div key={year} className={css.legacyYearGroup}>
              <div className={css.legacyYearRow}>
                <button type="button" className={css.legacyYearButton} aria-expanded={expandedYears.has(year)} onClick={() => { setExpandedYears(current => toggleSet(current, year)) }}>
                  {year}
                </button>
              </div>
              {expandedYears.has(year) && (
                <div className={css.legacyClassList}>
                  {classes.length === 0 && <div className={css.legacyDrawerState}>{t('questions.noClasses')}</div>}
                  {classes.map(item => (
                    <div key={item.id} className={css.legacyClassRow}>
                      <button
                        type="button"
                        className={activeClassId === item.id ? css.legacyClassButtonActive : css.legacyClassButton}
                        onClick={() => { setActiveClassId(item.id) }}
                        onDoubleClick={() => { openClass(item) }}
                      >
                        {classDisplayName(item)}
                      </button>
                      {!readOnlyClassIds.has(item.id) && (
                        <button type="button" className={css.legacyHoverDelete} aria-label={t('delete')} onClick={() => { void deleteClass(item) }}><X size={13} /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>
        <main className={css.legacyBlankMain} aria-label={t('questions.blankArea')}>
          <div className={css.legacyBlankHint}>
            <Scissors size={28} />
            <strong>{t('questions.blankTitle')}</strong>
            <span>{t('questions.blankHint')}</span>
            {activeBatch !== undefined && <small>{activeBatch.name} · {t('questions.questionCount', { count: activeBatch.images.length })}</small>}
          </div>
        </main>
      </div>

      {anyDrawerOpen && <button type="button" className={css.legacyDrawerMask} aria-label={t('close')} onClick={closeDrawers} />}

      {addStudentOpen && (
        <aside className={`${css.legacyDrawer} ${css.legacyAddStudentDrawer}`} aria-label={t('questions.addStudent')}>
          <DrawerHeader title={t('questions.addStudentDirectory')} onClose={() => { setAddStudentOpen(false) }} t={t} />
          <div className={css.legacyHierarchyForm}>
            <FormField label={t('questions.yearRequired')}><input maxLength={20} value={addYear} onChange={(event) => { setAddYear(event.target.value) }} placeholder={String(new Date().getFullYear())} /></FormField>
            <FormField label={t('questions.gradeRequired')}>
              <select value={addGrade} onChange={(event) => { setAddGrade(event.target.value) }}>
                <option value="">{t('questions.choose')}</option>
                <option value="高一">高一</option><option value="高二">高二</option><option value="高三">高三</option>
              </select>
            </FormField>
            <FormField label={t('questions.classRequired')}><input maxLength={40} value={addClassName} onChange={(event) => { setAddClassName(event.target.value) }} placeholder={t('questions.classPlaceholder')} /></FormField>
            <FormField label={t('questions.studentOptional')}><input maxLength={40} value={addStudentName} onChange={(event) => { setAddStudentName(event.target.value) }} placeholder={t('questions.optional')} /></FormField>
          </div>
          <div className={css.legacyDrawerFooter}>
            <button type="button" disabled={busy !== null || addYear.trim() === '' || addGrade === '' || addClassName.trim() === ''} onClick={() => { void addStudentHierarchy() }}>
              {busy === 'student' ? t('saving') : t('questions.confirmAdd')}
            </button>
          </div>
        </aside>
      )}

      {classDrawerOpen && activeClass !== undefined && (
        <aside className={`${css.legacyDrawer} ${css.legacyClassDrawer}`} aria-label={t('questions.classStudents')}>
          <DrawerHeader title={classDisplayName(activeClass)} onClose={requestCloseClassDrawer} t={t}>
            <button
              type="button"
              disabled={classStudentsWithTemporaryImages.length === 0 || busy !== null}
              title={classStudentsWithTemporaryImages.length === 0 ? t('questions.noTemporary') : undefined}
              onClick={openBatchWord}
            ><FileText size={14} />Word</button>
            <button
              type="button"
              disabled={classStudentsWithTemporaryImages.length === 0 || busy !== null}
              title={classStudentsWithTemporaryImages.length === 0 ? t('questions.noTemporary') : undefined}
              onClick={() => { void generateClassPpt() }}
            ><Presentation size={14} />PPT</button>
          </DrawerHeader>
          <p className={css.legacyHierarchyHint}>{t('questions.hierarchyClickHint')}</p>
          <div className={css.legacyStudentRows}>
            {classStudents.length === 0 && <div className={css.legacyDrawerState}>{t('questions.noStudents')}</div>}
            {hierarchyRows.map((row) => {
              const selected = activeStudentId === row.student.id && activeFolderId === (row.folder?.id ?? '')
              const readOnlyFolder = row.folder !== undefined && readOnlyFolderIds.has(row.folder.id)
              const readOnlyStudent = readOnlyStudentIds.has(row.student.id)
              const indentation = row.depth * 16
              return (
                <div
                  key={row.key}
                  className={css.legacyStudentRow}
                  style={{ marginLeft: `${String(indentation)}px`, maxWidth: `calc(100% - ${String(indentation)}px)` }}
                >
                  <button
                    type="button"
                    className={selected ? css.legacyStudentButtonActive : css.legacyStudentButton}
                    title={t('questions.hierarchyClickHint')}
                    onClick={() => { handleHierarchyClick(row) }}
                  >
                    <span className={css.legacyHierarchyMarker} aria-hidden="true">{row.hasChildren ? row.expanded ? '▾' : '▸' : '·'}</span>
                    <span className={css.legacyHierarchyName}>{row.folder?.name ?? row.student.name}</span>
                  </button>
                  {row.folder !== undefined && !row.hasChildren && !readOnlyFolder && !readOnlyStudent && (
                    <button type="button" className={css.legacyStudentAdd} aria-label={t('questions.addFromLibrary')} onClick={() => { openQuestionBank(row.student, row.folder?.id ?? '') }}>+</button>
                  )}
                  <button
                    type="button"
                    className={css.legacyHoverDelete}
                    aria-label={t('delete')}
                    onClick={() => { void deleteHierarchyRow(row) }}
                  ><X size={13} /></button>
                </div>
              )
            })}
          </div>
        </aside>
      )}

      {questionBankOpen && (
        <aside className={`${css.legacyDrawer} ${css.legacyBankFolders}`} aria-label={t('questions.library')}>
          <DrawerHeader title={t('questions.library')} onClose={() => { setQuestionBankOpen(false); setBatchImagesOpen(false) }} t={t}>
            <button type="button" onClick={() => { requestLibraryFolderCreate() }}>{t('questions.newFolder')}</button>
          </DrawerHeader>
          <div className={css.legacyFolderList}>
            {libraryRows.length === 0 && <div className={css.legacyDrawerState}>{t('questions.emptyBatch')}</div>}
            {libraryRows.map(row => row.kind === 'folder' ? (
              <div key={`folder:${row.folder.id}`} className={css.legacyFolderRow} style={{ marginLeft: `${String(row.depth * 16)}px` }}>
                <button
                  type="button"
                  className={row.folder.id === activeLibraryFolderId ? css.legacyFolderButtonActive : css.legacyFolderButton}
                  aria-expanded={row.expanded}
                  aria-label={`${libraryFolderMarker(row)}${row.hasChildren ? ' ' : ''}${row.folder.name}`}
                  title={t('questions.libraryFolderClickHint')}
                  onClick={() => { handleLibraryHierarchyClick(row.folder) }}
                >
                  <span className={css.legacyHierarchyMarker} aria-hidden="true">{libraryFolderMarker(row)}</span>
                  <span className={css.legacyHierarchyName} title={row.folder.name}>{truncateLibraryName(row.folder.name)}</span>
                  <small>{libraryFolderImageCount(row.folder.id, questionLibraryFolders, questionBatches)}</small>
                </button>
                <button
                  type="button"
                  className={`${css.legacyHoverDelete} ${css.legacyLibraryDelete}`}
                  aria-label={t('questions.deleteLibraryFolder', { name: row.folder.name })}
                  onClick={() => { void deleteLibraryFolder(row.folder) }}
                ><X size={13} /></button>
              </div>
            ) : (
              <div key={`batch:${row.batch.id}`} className={css.legacyFolderRow} style={{ marginLeft: `${String(row.depth * 16)}px` }}>
                <button type="button" className={row.batch.id === activeBatchId ? css.legacyFolderButtonActive : css.legacyFolderButton} aria-label={`${row.batch.name} ${String(row.batch.images.length)}`} onClick={() => { openBatch(row.batch.id) }}>
                  <span title={row.batch.name}>{truncateLibraryName(row.batch.name)}</span><small>{row.batch.images.length}</small>
                </button>
                {!readOnlyBatchIds.has(row.batch.id) && (
                  <button type="button" className={css.legacyHoverDelete} aria-label={t('delete')} onClick={() => { void deleteBatch(row.batch.id, row.batch.name) }}><X size={13} /></button>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}

      {batchImagesOpen && activeBatch !== undefined && (
        <aside
          className={`${css.legacyDrawer} ${css.legacyBankImages} ${classDrawerOpen ? css.legacyBankImagesBesideClass : ''}`}
          aria-label={t('questions.batchImages')}
        >
          <div className={css.legacyImagesHeader}>
            <button type="button" onClick={toggleAllBatchImages}>{selectedBatchImageIds.size === activeBatch.images.length ? t('questions.clearAll') : t('questions.selectAll')}</button>
            <button
              type="button"
              disabled={selectedBatchImageIds.size === 0 || busy !== null
                || (questionBankSaveTarget !== null && readOnlyBatchIds.has(activeBatch.id))}
              onClick={() => { void saveSelectedBatchImages() }}
            >
              {questionBankSaveTarget === null ? t('questions.saveAs') : t('questions.saveGenerated')}
            </button>
          </div>
          <div className={css.legacyImageScroll}>
            {activeBatch.images.map(image => (
              <StoredQuestionTile
                key={image.id}
                target={{ kind: 'batch', id: image.id }}
                meta={image}
                label={t('questions.questionAlt', { number: image.questionNo })}
                checked={selectedBatchImageIds.has(image.id)}
                commands={commands}
                t={t}
                onToggle={() => { toggleBatchImage(image.id) }}
                onOpen={() => {
                  setEditor({
                    target: { kind: 'batch', id: image.id },
                    questionNo: image.questionNo,
                    fileName: image.fileName,
                    readOnly: readOnlyBatchIds.has(activeBatch.id),
                  })
                }}
                {...(readOnlyBatchIds.has(activeBatch.id) ? {} : {
                  onDelete: () => { void deleteImage({ kind: 'batch', id: image.id }) },
                })}
              />
            ))}
          </div>
        </aside>
      )}

      {studentImagesOpen && activeStudent !== undefined && (
        <aside className={`${css.legacyDrawer} ${css.legacyStudentImages}`} aria-label={t('questions.studentImages')}>
          <div className={css.legacyImagesHeader}>
            <button type="button" onClick={() => {
              setSelectedAssignmentIds(writableSelectedAssignmentIds.length === writableStudentAssignments.length
                ? new Set()
                : new Set(writableStudentAssignments.map(item => item.id)))
            }}>
              {writableSelectedAssignmentIds.length === writableStudentAssignments.length
                && writableStudentAssignments.length > 0 ? t('questions.clearAll') : t('questions.selectAll')}
            </button>
            <button type="button" disabled={writableSelectedAssignmentIds.length === 0 || busy !== null} onClick={() => { void saveTemporarySelection() }}>
              {t('questions.tempSave')}
            </button>
            <button type="button" onClick={() => { openQuestionBank(activeStudent, activeFolderId) }}>{t('questions.library')}</button>
          </div>
          <div className={css.legacyImageScroll}>
            {studentAssignments.length === 0 && <div className={css.legacyDrawerState}>{t('questions.noAssignments')}</div>}
            {studentAssignments.map((assignment, index) => (
              <StoredQuestionTile
                key={assignment.id}
                target={{ kind: 'assignment', id: assignment.id }}
                meta={assignment}
                temporarySaveCount={assignment.temporarySaveCount}
                {...(assignment.lastTemporarySavedAt === undefined ? {} : { lastTemporarySavedAt: assignment.lastTemporarySavedAt })}
                label={assignment.fileName}
                checked={!readOnlyAssignmentIds.has(assignment.id) && selectedAssignmentIds.has(assignment.id)}
                commands={commands}
                t={t}
                selectable={!readOnlyAssignmentIds.has(assignment.id)}
                onToggle={() => {
                  if (!readOnlyAssignmentIds.has(assignment.id)) {
                    setSelectedAssignmentIds(current => toggleSet(current, assignment.id))
                  }
                }}
                onOpen={() => {
                  setEditor({
                    target: { kind: 'assignment', id: assignment.id },
                    questionNo: assignmentQuestionNo(assignment, index),
                    fileName: assignment.fileName,
                    readOnly: readOnlyAssignmentIds.has(assignment.id),
                  })
                }}
                {...(readOnlyAssignmentIds.has(assignment.id) ? {} : {
                  onDelete: () => { void deleteImage({ kind: 'assignment', id: assignment.id }) },
                })}
              />
            ))}
          </div>
        </aside>
      )}

      {batchWordOpen && (
        <aside className={`${css.legacyDrawer} ${css.legacyBatchWordDrawer}`} aria-label={t('questions.wordConfig')}>
          <DrawerHeader title={t('questions.wordConfig')} onClose={() => { setBatchWordOpen(false) }} t={t} />
          <div className={css.legacyBatchBulkRow}>
            <div className={css.legacyBatchNameCell}>
              <span aria-hidden="true" />
              <label><input type="checkbox" checked={batchWordRows.length > 0 && batchWordRows.every(row => row.includeName)} onChange={(event) => { const checked = event.target.checked; setBatchWordRows(rows => rows.map(row => ({ ...row, includeName: checked }))) }} />{t('questions.selectAll')}</label>
            </div>
            <label><input type="checkbox" checked={batchWordRows.length > 0 && batchWordRows.every(row => row.includeDate)} onChange={(event) => { const checked = event.target.checked; setBatchWordRows(rows => rows.map(row => ({ ...row, includeDate: checked }))) }} />{t('questions.selectAll')}</label>
            <input value={batchBulkTitle} onChange={(event) => { const title = event.target.value; setBatchBulkTitle(title); setBatchWordRows(rows => rows.map(row => ({ ...row, title }))) }} placeholder={t('questions.uniformTitle')} />
          </div>
          <div className={css.legacyBatchStudents}>
            {batchWordRows.map((row, index) => (
              <div key={row.studentId} className={css.legacyBatchStudentRow}>
                <div className={css.legacyBatchNameCell}>
                  <span title={row.name}>{displayStudentName(row.name)}</span>
                  <label><input type="checkbox" checked={row.includeName} onChange={(event) => { const checked = event.target.checked; setBatchWordRows(rows => rows.map((item, itemIndex) => itemIndex === index ? { ...item, includeName: checked } : item)) }} />{t('questions.includeName')}</label>
                </div>
                <label><input type="checkbox" checked={row.includeDate} onChange={(event) => { const checked = event.target.checked; setBatchWordRows(rows => rows.map((item, itemIndex) => itemIndex === index ? { ...item, includeDate: checked } : item)) }} />{t('questions.includeDate')}</label>
                <input value={row.title} onChange={(event) => { const title = event.target.value; setBatchWordRows(rows => rows.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item)) }} placeholder={t('questions.studentTitlePlaceholder')} />
              </div>
            ))}
          </div>
          <div className={css.legacyDrawerFooter}><button type="button" disabled={batchWordRows.length === 0 || busy !== null} onClick={() => { void generateClassWord() }}>{t('questions.confirmGenerate')}</button></div>
        </aside>
      )}

      {officeDialog !== null && (
        <div className={css.legacyDialogLayer} role="dialog" aria-modal="true" aria-label={officeDialog.title}>
          <button type="button" className={css.legacyEditorMask} aria-label={`${t('questions.closeDialog')} ${officeDialog.title}`} onClick={() => { setOfficeDialog(null) }} />
          <section className={`${css.legacyFailureDialog} ${css.legacyOfficeDialog}`}>
            <h3>{officeDialog.title}</h3>
            <p>{officeDialog.message}</p>
            <div>
              {officeDialog.mode === 'success' && (
                <button type="button" onClick={() => { void saveOfficeArtifacts() }}>
                  {officeDialog.scope === 'class' || officeDialog.artifacts.length === 1
                    ? t('questions.saveGenerated')
                    : t('questions.downloadAll')}
                </button>
              )}
              {officeDialog.mode === 'error' && officeDialog.retry !== undefined && (
                <button type="button" onClick={() => { void retryOfficeGeneration() }}>{t('questions.retryGeneration')}</button>
              )}
              <button type="button" onClick={() => { setOfficeDialog(null) }}>{t('questions.closeDialog')}</button>
            </div>
          </section>
        </div>
      )}

      {pageRangeOpen && (
        <>
          <button type="button" className={css.legacyDrawerMask} aria-label={t('close')} onClick={() => { setPageRangeOpen(false) }} />
          <section className={css.legacyTopSheet} role="dialog" aria-modal="true" aria-label={t('questions.pageRangeTitle')}>
            <DrawerHeader title={t('questions.pageRangeTitle')} onClose={() => { setPageRangeOpen(false) }} t={t} />
            <p>{t('questions.totalPages', { count: pdfPageCount })}</p>
            <p className={css.legacyMuted}>{t('questions.pageRangeHint')}</p>
            <input value={pageRange} onChange={(event) => { setPageRange(event.target.value) }} placeholder={t('questions.pageRangePlaceholder')} />
            <FormField label={t('questions.saveDirectory')}>
              <select
                value={pageRangeFolderId}
                onChange={(event) => { setPageRangeFolderId(event.target.value as TeacherQuestionLibraryFolderId | '') }}
              >
                <option value="">{t('questions.libraryRoot')}</option>
                {libraryFolderOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </FormField>
            <div className={css.legacySheetActions}><button type="button" onClick={() => { void cutPdf() }}>{t('questions.confirmCut')}</button></div>
          </section>
        </>
      )}

      {folderPrompt !== null && (
        <div
          className={css.legacyDialogLayer}
          role="dialog"
          aria-modal="true"
          aria-label={folderPrompt.mode === 'create' ? t('questions.createFolder') : t('questions.renameFolder')}
        >
          <button type="button" className={css.legacyEditorMask} aria-label={t('close')} onClick={() => { setFolderPrompt(null); setFolderName('') }} />
          <section className={`${css.legacyFailureDialog} ${css.legacyFolderDialog}`}>
            <h3>{folderPrompt.mode === 'create' ? t('questions.createFolder') : t('questions.renameFolder')}</h3>
            {folderPrompt.mode === 'create'
              && <p>{t('questions.createFolderBelow', { name: folderPrompt.parent?.name ?? folderPrompt.student.name })}</p>}
            <FormField label={t('questions.folderName')}>
              <input
                maxLength={80}
                value={folderName}
                onChange={(event) => { setFolderName(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') void saveFolderPrompt() }}
                placeholder={t('questions.folderPlaceholder')}
              />
            </FormField>
            <div>
              <button type="button" onClick={() => { setFolderPrompt(null); setFolderName('') }}>{t('cancel')}</button>
              <button type="button" disabled={folderName.trim() === '' || busy !== null} onClick={() => { void saveFolderPrompt() }}>
                {folderPrompt.mode === 'create' ? t('add') : t('save')}
              </button>
            </div>
          </section>
        </div>
      )}

      {libraryFolderPrompt !== null && (
        <div
          className={css.legacyDialogLayer}
          role="dialog"
          aria-modal="true"
          aria-label={libraryFolderPrompt.mode === 'create' ? t('questions.newFolder') : t('questions.renameFolder')}
        >
          <button type="button" className={css.legacyEditorMask} aria-label={t('close')} onClick={() => { setLibraryFolderPrompt(null); setLibraryFolderName('') }} />
          <section className={`${css.legacyFailureDialog} ${css.legacyFolderDialog}`}>
            <h3>{libraryFolderPrompt.mode === 'rename'
              ? t('questions.renameFolder')
              : libraryFolderPrompt.parent === undefined ? t('questions.newFolder') : t('questions.createFolder')}</h3>
            {libraryFolderPrompt.mode === 'create' && libraryFolderPrompt.parent !== undefined
              && <p>{t('questions.createFolderBelow', { name: libraryFolderPrompt.parent.name })}</p>}
            <FormField label={t('questions.folderName')}>
              <input
                maxLength={80}
                value={libraryFolderName}
                onChange={(event) => { setLibraryFolderName(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') void saveLibraryFolderPrompt() }}
                placeholder={t('questions.folderPlaceholder')}
              />
            </FormField>
            <div>
              <button type="button" onClick={() => { setLibraryFolderPrompt(null); setLibraryFolderName('') }}>{t('cancel')}</button>
              <button type="button" disabled={libraryFolderName.trim() === '' || busy !== null} onClick={() => { void saveLibraryFolderPrompt() }}>
                {libraryFolderPrompt.mode === 'create' ? t('add') : t('save')}
              </button>
            </div>
          </section>
        </div>
      )}

      {cutFailure !== null && (
        <div className={css.legacyDialogLayer} role="dialog" aria-modal="true" aria-label={t('questions.cutFailed')}>
          <button type="button" className={css.legacyEditorMask} aria-label={t('close')} onClick={() => { setCutFailure(null) }} />
          <section className={css.legacyFailureDialog}>
            <h3>{t('questions.cutFailed')}</h3><p>{cutFailure}</p>
            <div><button type="button" onClick={() => { void cutPdf() }}>{t('questions.retryCut')}</button><button type="button" onClick={() => { setCutFailure(null) }}>{t('cancel')}</button></div>
          </section>
        </div>
      )}

      {editor !== null && (
        <QuestionImageEditor
          target={editor.target}
          questionNo={editor.questionNo}
          fileName={editor.fileName}
          readOnly={editor.readOnly}
          commands={commands}
          t={t}
          onClose={() => { setEditor(null) }}
          onSaved={() => { setToast(t('questions.imageSaved')) }}
        />
      )}

      {toast !== null && <div className={css.legacyToast} role="status">{toast}</div>}
      {busy !== null && <div className={css.legacyProgress} role="status"><span />{busy === 'cut' ? t('questions.cutting') : busy === 'pdf' ? t('questions.readingPdf') : t('saving')}</div>}
    </div>
  )
}

interface TopActionProps {
  readonly icon: ReactNode
  readonly label: string
  readonly disabled?: boolean
  readonly expanded?: boolean
  readonly onClick: () => void
}

function TopAction({ icon, label, disabled = false, expanded, onClick }: TopActionProps) {
  return <button type="button" className={css.legacyTopAction} aria-label={label} aria-expanded={expanded} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></button>
}

interface DrawerHeaderProps {
  readonly title: string
  readonly onClose: () => void
  readonly t: TeacherWorkbenchTranslate
  readonly children?: ReactNode
}

function DrawerHeader({ title, onClose, t, children }: DrawerHeaderProps) {
  return <header className={css.legacyDrawerHeader}><h2>{title}</h2><div>{children}<button type="button" aria-label={t('close')} onClick={onClose}><X size={15} /></button></div></header>
}

function FormField({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <label className={css.legacyFormField}><span>{label}</span>{children}</label>
}

interface StoredQuestionTileProps {
  readonly target: TeacherQuestionImageTarget
  readonly meta: Pick<TeacherQuestionImage, 'fileName' | 'mediaType' | 'width' | 'height' | 'updatedAt'>
    | Pick<TeacherQuestionAssignment, 'fileName' | 'mediaType' | 'width' | 'height' | 'updatedAt'>
  readonly label: string
  readonly checked: boolean
  readonly temporarySaveCount?: number
  readonly lastTemporarySavedAt?: number
  readonly commands: Pick<TeacherWorkbenchCommands, 'readQuestionImage'>
  readonly t: TeacherWorkbenchTranslate
  readonly onToggle: () => void
  readonly selectable?: boolean
  readonly onOpen: () => void
  readonly onDelete?: () => void
}

function StoredQuestionTile(props: StoredQuestionTileProps) {
  const [source, setSource] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setSource(null)
    setLoadError(null)
    void props.commands.readQuestionImage({ target: props.target }).then((result) => {
      if (!active) return
      if (result.ok) setSource(`data:${result.value.mediaType};base64,${result.value.contentBase64}`)
      else setLoadError(result.error.message)
    })
    return () => { active = false }
  }, [props.commands, props.meta.updatedAt, props.target.id, props.target.kind])
  return (
    <article className={css.legacyImageItem}>
      <button type="button" className={css.legacyImageStage} aria-label={props.label} onClick={props.onOpen}>
        {source === null
          ? <span><ImageIcon size={22} />{loadError ?? props.t('loading')}</span>
          : <img src={source} alt={props.label} />}
      </button>
      {props.onDelete !== undefined && (
        <button type="button" className={css.legacyImageDelete} aria-label={props.t('delete')} onClick={props.onDelete}><Trash2 size={14} /></button>
      )}
      <div className={css.legacyImageMeta}>
        <span>{props.meta.fileName}</span>
        <label><input type="checkbox" checked={props.checked} disabled={props.selectable === false} onChange={props.onToggle} />{props.t('questions.select')}</label>
      </div>
      {props.temporarySaveCount !== undefined && (
        <div className={css.legacyImageHistory}>
          {props.temporarySaveCount === 0 || props.lastTemporarySavedAt === undefined
            ? props.t('questions.tempNever')
            : props.t('questions.tempHistory', {
              count: props.temporarySaveCount,
              time: formatTemporarySavedAt(props.lastTemporarySavedAt),
            })}
        </div>
      )}
    </article>
  )
}

function buildQuestionLibraryRows(
  folders: readonly TeacherQuestionLibraryFolder[],
  batches: TeacherWorkbenchState['questionBatches'],
  expanded: ReadonlySet<TeacherQuestionLibraryFolderId>,
): LibraryHierarchyRow[] {
  const rows: LibraryHierarchyRow[] = []
  const append = (parentId: TeacherQuestionLibraryFolderId | undefined, depth: number): void => {
    const children = folders.filter(folder => folder.parentId === parentId)
      .toSorted((left, right) => left.createdAt - right.createdAt)
    for (const folder of children) {
      const hasChildren = folders.some(candidate => candidate.parentId === folder.id)
        || batches.some(batch => batch.folderId === folder.id)
      const isExpanded = expanded.has(folder.id)
      rows.push({ kind: 'folder', folder, depth, hasChildren, expanded: isExpanded })
      if (isExpanded) append(folder.id, depth + 1)
    }
    const papers = batches.filter(batch => batch.folderId === parentId)
      .toSorted((left, right) => right.createdAt - left.createdAt)
    for (const batch of papers) rows.push({ kind: 'batch', batch, depth })
  }
  append(undefined, 0)
  return rows
}

function libraryFolderImageCount(
  folderId: TeacherQuestionLibraryFolderId,
  folders: readonly TeacherQuestionLibraryFolder[],
  batches: TeacherWorkbenchState['questionBatches'],
): number {
  const included = new Set<TeacherQuestionLibraryFolderId>([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId === undefined || !included.has(folder.parentId) || included.has(folder.id)) continue
      included.add(folder.id)
      changed = true
    }
  }
  return batches.reduce((total, batch) => batch.folderId !== undefined && included.has(batch.folderId)
    ? total + batch.images.length
    : total, 0)
}

function buildQuestionLibraryFolderOptions(
  folders: readonly TeacherQuestionLibraryFolder[],
): readonly { readonly id: TeacherQuestionLibraryFolderId; readonly label: string }[] {
  const options: { id: TeacherQuestionLibraryFolderId; label: string }[] = []
  const append = (parentId: TeacherQuestionLibraryFolderId | undefined, ancestors: readonly string[]): void => {
    const children = folders.filter(folder => folder.parentId === parentId)
      .toSorted((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))
    for (const folder of children) {
      const path = [...ancestors, folder.name]
      options.push({ id: folder.id, label: path.join(' / ') })
      append(folder.id, path)
    }
  }
  append(undefined, [])
  return options
}

function questionLibraryFolderDescendants(
  folders: readonly TeacherQuestionLibraryFolder[],
  rootId: TeacherQuestionLibraryFolderId,
): Set<TeacherQuestionLibraryFolderId> {
  const removed = new Set<TeacherQuestionLibraryFolderId>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId === undefined || !removed.has(folder.parentId) || removed.has(folder.id)) continue
      removed.add(folder.id)
      changed = true
    }
  }
  return removed
}

function formatTemporarySavedAt(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

function hierarchyKey(studentId: TeacherStudentId, folderId?: TeacherQuestionFolderId): string {
  return folderId === undefined ? `student:${studentId}` : `folder:${folderId}`
}

function sameDirectoryName(left: string, right: string): boolean {
  return left.normalize('NFKC').toLowerCase() === right.normalize('NFKC').toLowerCase()
}

function buildStudentHierarchyRows(
  students: readonly TeacherStudent[],
  folders: readonly TeacherQuestionFolder[],
  expanded: ReadonlySet<string>,
): StudentHierarchyRow[] {
  const byParent = new Map<string, TeacherQuestionFolder[]>()
  for (const folder of folders) {
    const key = `${folder.studentId}\u0000${folder.parentId ?? ''}`
    const siblings = byParent.get(key)
    if (siblings === undefined) byParent.set(key, [folder])
    else siblings.push(folder)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  }

  const rows: StudentHierarchyRow[] = []
  const appendFolders = (student: TeacherStudent, parentId: TeacherQuestionFolderId | undefined, depth: number): void => {
    const children = byParent.get(`${student.id}\u0000${parentId ?? ''}`) ?? []
    for (const folder of children) {
      const key = hierarchyKey(student.id, folder.id)
      const hasChildren = (byParent.get(`${student.id}\u0000${folder.id}`)?.length ?? 0) > 0
      const isExpanded = hasChildren && expanded.has(key)
      rows.push({ key, student, folder, depth, hasChildren, expanded: isExpanded })
      if (isExpanded) appendFolders(student, folder.id, depth + 1)
    }
  }

  for (const student of students) {
    const key = hierarchyKey(student.id)
    const hasChildren = (byParent.get(`${student.id}\u0000`)?.length ?? 0) > 0
    const isExpanded = hasChildren && expanded.has(key)
    rows.push({ key, student, depth: 0, hasChildren, expanded: isExpanded })
    if (isExpanded) appendFolders(student, undefined, 1)
  }
  return rows
}

function questionFolderDescendants(
  folders: readonly TeacherQuestionFolder[],
  rootId: TeacherQuestionFolderId,
): Set<TeacherQuestionFolderId> {
  const removed = new Set<TeacherQuestionFolderId>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId === undefined || !removed.has(folder.parentId) || removed.has(folder.id)) continue
      removed.add(folder.id)
      changed = true
    }
  }
  return removed
}

function classDisplayName(item: Pick<TeacherClass, 'grade' | 'name'>): string {
  const grade = item.grade.trim()
  const name = item.name.trim()
  return grade !== '' && !name.includes(grade) ? `${grade}${name}` : name
}

function classAcademicYear(item: Pick<TeacherClass, 'academicYear'>, fallback: string): string {
  return item.academicYear?.trim() || fallback
}

function assignmentQuestionNo(assignment: TeacherQuestionAssignment, index: number): number {
  const match = /(?:第\s*)?(\d{1,3})\s*题/u.exec(assignment.fileName)
  return match?.[1] === undefined ? index + 1 : Number(match[1])
}

function toggleSet(current: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function displayStudentName(value: string): string {
  const name = value.trim()
  return name.length > 4 ? `${name.slice(0, 4)}…` : name
}

function truncateLibraryName(value: string): string {
  const characters = Array.from(value)
  return characters.length <= LIBRARY_NAME_VISIBLE_CHARACTERS
    ? value
    : `${characters.slice(0, LIBRARY_NAME_VISIBLE_CHARACTERS).join('')}…`
}

function libraryFolderMarker(row: Extract<LibraryHierarchyRow, { kind: 'folder' }>): string {
  if (!row.hasChildren) return ''
  return row.expanded ? '▾' : '▸'
}

interface FolderPickedImage {
  readonly file: File
  readonly relativePath: string
}

async function buildFolderDocumentRequest(
  kind: 'word' | 'ppt',
  list: FileList,
): Promise<TeacherQuestionUploadedDocumentRequest> {
  const selected = Array.from(list)
    .map(file => ({
      file,
      relativePath: (file.webkitRelativePath || file.name).replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, ''),
    }))
    .filter(item => isFolderImage(item))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN', {
      numeric: true,
      sensitivity: 'base',
    }))
    .slice(0, 120)
  if (selected.length === 0) throw new Error('所选文件夹中没有可用图片')
  const totalBytes = selected.reduce((sum, item) => sum + item.file.size, 0)
  if (totalBytes > 80 * 1024 * 1024) throw new Error('图片总体积过大，请减少后重试')
  const first = selected[0]
  if (first === undefined) throw new Error('所选文件夹中没有可用图片')
  const firstSegments = first.relativePath.split('/').filter(Boolean)
  const folderName = firstSegments.length > 1 ? (firstSegments[0] ?? 'selected-folder') : 'selected-folder'
  const images = []
  for (const item of selected) {
    images.push({
      fileName: item.file.name,
      relativePath: item.relativePath,
      contentBase64: await fileToBase64(item.file),
    })
  }
  return { kind, folderName, images }
}

function isFolderImage(item: FolderPickedImage): boolean {
  return item.file.type.toLowerCase().startsWith('image/')
    || /\.(?:png|jpe?g|webp|bmp|gif|tiff?|heic|heif|svg)$/iu.test(item.relativePath)
}

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(new Error(`读取文件失败：${file.name}`)) }
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`读取文件失败：${file.name}`))
        return
      }
      const value = reader.result
      const comma = value.indexOf(',')
      resolve(comma < 0 ? value : value.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

interface OfficeWritable {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface OfficeFileHandle {
  createWritable(): Promise<OfficeWritable>
}

interface OfficeDirectoryHandle {
  queryPermission?(options?: { readonly mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
  requestPermission?(options?: { readonly mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<OfficeFileHandle>
}

type OfficePickerGlobal = typeof globalThis & {
  showSaveFilePicker?: (options: { readonly suggestedName: string }) => Promise<OfficeFileHandle>
  showDirectoryPicker?: () => Promise<OfficeDirectoryHandle>
}

async function pickWritableDirectory(
  unsupported: string,
  denied: string,
): Promise<OfficeDirectoryHandle | null> {
  const picker = (globalThis as OfficePickerGlobal).showDirectoryPicker
  if (picker === undefined) throw new Error(unsupported)
  const directory = await picker()
  let permission = await directory.queryPermission?.({ mode: 'readwrite' })
  if (permission !== 'granted') permission = await directory.requestPermission?.({ mode: 'readwrite' })
  if (permission !== 'granted') throw new Error(denied)
  return directory
}

async function writeUniqueFile(directory: OfficeDirectoryHandle, desiredName: string, blob: Blob): Promise<void> {
  const fileName = await uniqueDirectoryFileName(directory, desiredName)
  const handle = await directory.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

async function uniqueDirectoryFileName(directory: OfficeDirectoryHandle, desiredName: string): Promise<string> {
  const safeName = desiredName.trim().replace(/[\\/:*?"<>|]/gu, '_') || `image_${Date.now()}.png`
  const dot = safeName.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < safeName.length - 1
  const stem = hasExtension ? safeName.slice(0, dot) : safeName
  const extension = hasExtension ? safeName.slice(dot) : ''
  for (let index = 0; index < 5000; index += 1) {
    const candidate = index === 0 ? safeName : `${stem}_${index}${extension}`
    try {
      await directory.getFileHandle(candidate)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'NotFoundError') return candidate
      throw cause
    }
  }
  return `${stem}_${Date.now()}${extension}`
}

async function saveSingleArtifact(artifact: TeacherQuestionDocumentPayload): Promise<boolean> {
  const picker = (globalThis as OfficePickerGlobal).showSaveFilePicker
  if (globalThis.isSecureContext && picker !== undefined) {
    try {
      const handle = await picker({ suggestedName: artifact.fileName })
      const writable = await handle.createWritable()
      await writable.write(artifactBlob(artifact))
      await writable.close()
      return true
    } catch (cause) {
      if (isAbortError(cause)) return false
    }
  }
  downloadArtifact(artifact)
  return true
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function artifactBlob(artifact: TeacherQuestionDocumentPayload): Blob {
  const binary = atob(artifact.contentBase64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new Blob([bytes], { type: artifact.mediaType })
}

function downloadArtifact(artifact: { fileName: string; mediaType: string; contentBase64: string }): void {
  const url = URL.createObjectURL(artifactBlob(artifact))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = artifact.fileName
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
