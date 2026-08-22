/** Filesystem and Office-artifact operations for teacher question images. */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  AlignmentType,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import PptxGenJS from 'pptxgenjs'
import sharp, { type Metadata } from 'sharp'
import type {
  TeacherClass,
  TeacherQuestionAssignment,
  TeacherQuestionAssignmentId,
  TeacherQuestionBatch,
  TeacherQuestionBatchDocumentRequest,
  TeacherQuestionBatchDocumentSuccess,
  TeacherQuestionBatchId,
  TeacherQuestionBatchSaveRequest,
  TeacherQuestionDocumentPayload,
  TeacherQuestionDocumentRequest,
  TeacherQuestionDocumentSkipped,
  TeacherQuestionFolderId,
  TeacherQuestionImage,
  TeacherQuestionImageId,
  TeacherQuestionImageMediaType,
  TeacherQuestionImagePayload,
  TeacherQuestionImageTarget,
  TeacherQuestionTemporaryListRequest,
  TeacherQuestionTemporarySaveRequest,
  TeacherQuestionTemporarySelection,
  TeacherQuestionUploadedDocumentRequest,
  TeacherStudent,
  TeacherStudentId,
  TeacherWorkbenchState,
} from './types.ts'

/** Live storage settings sampled once per operation. */
export interface TeacherQuestionMediaConfig {
  /** Absolute or process-relative paper-batch root. */
  readonly segmentsRoot: string
  /** Absolute or process-relative student hierarchy root. */
  readonly studentsRoot: string
  /** Maximum bytes accepted for one raster. */
  readonly maxImageBytes: number
  /** Maximum aggregate bytes accepted for one automatically saved part. */
  readonly maxBatchBytes: number
}

/** Prepared batch whose files already exist and can still be rolled back. */
export interface PersistedQuestionBatch {
  readonly batch: TeacherQuestionBatch
  rollback(): Promise<void>
}

/** Prepared student copies whose files already exist and can still be rolled back. */
export interface PersistedQuestionAssignments {
  readonly assignments: readonly TeacherQuestionAssignment[]
  rollback(): Promise<void>
}

/** Prepared temporary selection that can restore the previous snapshot until metadata commits. */
export interface PersistedTemporaryQuestionSelection {
  readonly selection: TeacherQuestionTemporarySelection
  commit(): Promise<void>
  rollback(): Promise<void>
}

interface DecodedImage {
  readonly bytes: Buffer
  readonly mediaType: TeacherQuestionImageMediaType
  readonly width: number
  readonly height: number
}

interface ResolvedImage {
  readonly fileName: string
  readonly mediaType: TeacherQuestionImageMediaType
  readonly width: number
  readonly height: number
  readonly path: string
}

type RenderableImage = Omit<ResolvedImage, 'path'> & { readonly bytes: Buffer }

interface TemporaryQuestionImage {
  readonly storedName: string
  readonly fileName: string
  readonly questionNo?: number
  readonly mediaType: TeacherQuestionImageMediaType
  readonly width: number
  readonly height: number
}

interface TemporaryQuestionManifest {
  readonly version: 1
  readonly studentId: TeacherStudentId
  readonly images: readonly TemporaryQuestionImage[]
}

const TEMPORARY_QUESTION_DIRECTORY = '.dsh-question-temp'
const TEMPORARY_QUESTION_MANIFEST = 'manifest.json'
const QUESTION_FILE_COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/** Expected question-media failure safe to translate at the Remote method. */
export class TeacherQuestionMediaError extends Error {
  /**
   * @param code - stable question failure code.
   * @param message - user-safe diagnostic.
   * @param options - optional cause.
   */
  constructor(
    readonly code: 'invalid-request' | 'not-found' | 'file-too-large' | 'storage-failure' | 'generation-failure',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TeacherQuestionMediaError'
  }
}

/**
 * Validate and atomically materialize one bounded question-batch part.
 * @param config - current media roots and decoded-byte limits.
 * @param request - batch metadata and ordered raster payloads.
 * @param now - shared creation timestamp for the batch and its images.
 * @param existingBatch - existing logical paper that receives a continuation part.
 * @returns prepared metadata plus a filesystem rollback.
 */
export async function persistQuestionBatch(
  config: TeacherQuestionMediaConfig,
  request: TeacherQuestionBatchSaveRequest,
  now: number,
  existingBatch?: TeacherQuestionBatch,
): Promise<PersistedQuestionBatch> {
  if (request.images.length === 0) throw new TeacherQuestionMediaError('invalid-request', '切题结果不能为空')
  if (request.name.trim() === '') throw new TeacherQuestionMediaError('invalid-request', '试卷名称不能为空')
  if (existingBatch !== undefined && (
    request.name.trim() !== existingBatch.name
    || safeFileName(request.sourceName, '试卷.pdf') !== existingBatch.sourceName
    || request.pageRange.trim() !== existingBatch.pageRange
    || request.folderId !== existingBatch.folderId
  )) {
    throw new TeacherQuestionMediaError('invalid-request', '追加分片与原试卷信息不一致')
  }
  const existingQuestionNumbers = new Set(existingBatch?.images.map(image => image.questionNo) ?? [])
  const decoded: DecodedImage[] = []
  let aggregateBytes = 0
  for (const upload of request.images) {
    if (!Number.isSafeInteger(upload.questionNo) || upload.questionNo < 1) {
      throw new TeacherQuestionMediaError('invalid-request', '题号必须是正整数')
    }
    if (existingQuestionNumbers.has(upload.questionNo)) {
      throw new TeacherQuestionMediaError('invalid-request', '追加分片包含重复题号')
    }
    existingQuestionNumbers.add(upload.questionNo)
    const image = await decodeImage(upload, config.maxImageBytes)
    aggregateBytes += image.bytes.byteLength
    if (aggregateBytes > config.maxBatchBytes) throw new TeacherQuestionMediaError('file-too-large', '当前切题保存分片超过设置上限')
    decoded.push(image)
  }
  const batchId = existingBatch?.id ?? randomUUID() as TeacherQuestionBatchId
  const folderId = existingBatch?.folderId ?? request.folderId
  const root = configuredRoot(config.segmentsRoot, '试题切割目录')
  const temporary = within(root, `.pending-${String(batchId)}-${randomUUID()}`)
  const finalDir = within(root, String(batchId))
  const images: TeacherQuestionImage[] = request.images.map((upload, index) => {
    const image = decoded[index]
    if (image === undefined) throw new TeacherQuestionMediaError('storage-failure', '切题图片准备不完整')
    return {
      id: randomUUID() as TeacherQuestionImageId,
      questionNo: upload.questionNo,
      fileName: safeFileName(upload.fileName, `第${String(upload.questionNo)}题${extensionFor(image.mediaType)}`),
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      createdAt: now,
      updatedAt: now,
    }
  })
  const appendedPaths: string[] = []
  try {
    await mkdir(temporary, { recursive: true })
    await Promise.all(images.map(async (image, index) => {
      const decodedImage = decoded[index]
      if (decodedImage === undefined) throw new Error('missing decoded image')
      await writeFile(join(temporary, storedImageName(String(image.id), image.mediaType)), decodedImage.bytes, { flag: 'wx' })
    }))
    await mkdir(root, { recursive: true })
    if (existingBatch === undefined) {
      await rename(temporary, finalDir)
    } else {
      for (const image of images) {
        const storedName = storedImageName(String(image.id), image.mediaType)
        const destination = within(finalDir, storedName)
        await rename(within(temporary, storedName), destination)
        appendedPaths.push(destination)
      }
      await rm(temporary, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if (existingBatch === undefined) await rm(finalDir, { recursive: true, force: true })
    else await removeQuestionFiles(appendedPaths)
    throw new TeacherQuestionMediaError('storage-failure', '保存切题图片失败', { cause: error })
  }
  const batch: TeacherQuestionBatch = {
    id: batchId,
    ...(folderId === undefined ? {} : { folderId }),
    name: existingBatch?.name ?? request.name.trim(),
    sourceName: existingBatch?.sourceName ?? safeFileName(request.sourceName, '试卷.pdf'),
    pageRange: existingBatch?.pageRange ?? request.pageRange.trim(),
    createdAt: existingBatch?.createdAt ?? now,
    images: [...(existingBatch?.images ?? []), ...images].sort((left, right) => left.questionNo - right.questionNo),
  }
  return {
    batch,
    rollback: existingBatch === undefined
      ? async () => { await rm(finalDir, { recursive: true, force: true }) }
      : async () => { await removeQuestionFiles(appendedPaths) },
  }
}

async function removeQuestionFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map(async (path) => {
    await unlink(path).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    })
  }))
}

/**
 * Copy selected batch images into the configured readable student hierarchy.
 * @param config - current media roots and decoded-byte limits.
 * @param state - authoritative metadata used to resolve source images and class ownership.
 * @param student - destination roster student.
 * @param sourceImages - ordered source batch images.
 * @param now - shared creation timestamp for the assignment copies.
 * @param folderId - optional nested destination below the student.
 * @returns prepared assignment metadata plus a filesystem rollback.
 */
export async function persistQuestionAssignments(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  student: TeacherStudent,
  sourceImages: readonly TeacherQuestionImage[],
  now: number,
  folderId?: TeacherQuestionFolderId,
): Promise<PersistedQuestionAssignments> {
  const owningClass = state.classes.find(item => item.id === student.classId)
  if (owningClass === undefined) throw new TeacherQuestionMediaError('not-found', '学生所属班级不存在')
  const root = configuredRoot(config.studentsRoot, '学生目录')
  const folder = studentFolder(state, owningClass, student, folderId)
  const createdPaths: string[] = []
  const assignments: TeacherQuestionAssignment[] = []
  try {
    for (const image of sourceImages) {
      const source = resolveBatchImage(config, state, image.id)
      const id = randomUUID() as TeacherQuestionAssignmentId
      const relativePath = join(folder, storedImageName(String(id), image.mediaType))
      const destination = within(root, relativePath)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source.path, destination)
      createdPaths.push(destination)
      assignments.push({
        id,
        studentId: student.id,
        sourceImageId: image.id,
        ...(folderId === undefined ? {} : { folderId }),
        fileName: image.fileName,
        relativePath,
        mediaType: image.mediaType,
        width: image.width,
        height: image.height,
        temporarySaveCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
  } catch (error) {
    await Promise.all(createdPaths.map(async (path) => { await unlink(path).catch(() => {}) }))
    throw error instanceof TeacherQuestionMediaError
      ? error
      : new TeacherQuestionMediaError('storage-failure', '保存学生试题图片失败', { cause: error })
  }
  return {
    assignments,
    rollback: async () => { await Promise.all(createdPaths.map(async (path) => { await unlink(path).catch(() => {}) })) },
  }
}

/**
 * Replace one student's temporary Office-generation selection with independent image snapshots.
 * @param config - current media roots and decoded-byte limits.
 * @param state - authoritative roster and assignment metadata.
 * @param request - student identity and ordered selected assignment ids.
 * @returns the prepared selection plus commit and rollback operations.
 */
export async function saveTemporaryQuestionSelection(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  request: TeacherQuestionTemporarySaveRequest,
): Promise<PersistedTemporaryQuestionSelection> {
  if (request.assignmentIds.length === 0) throw new TeacherQuestionMediaError('invalid-request', '请至少选择一张学生图片')
  if (request.assignmentIds.length > 120) throw new TeacherQuestionMediaError('invalid-request', '一次最多临时保存 120 张图片')
  const student = state.students.find(item => item.id === request.studentId)
  if (student === undefined) throw new TeacherQuestionMediaError('not-found', '学生不存在')
  const requested = new Set(request.assignmentIds)
  if (requested.size !== request.assignmentIds.length) throw new TeacherQuestionMediaError('invalid-request', '临时图片选择存在重复项')
  const assignments = request.assignmentIds.map((id) => {
    const assignment = state.questionAssignments.find(item => item.id === id)
    if (assignment === undefined) throw new TeacherQuestionMediaError('not-found', '部分学生图片不存在')
    if (assignment.studentId !== student.id) throw new TeacherQuestionMediaError('invalid-request', '所选图片不属于当前学生')
    return assignment
  })
  const questionNumbers = questionNumberIndex(state)
  assignments.sort((left, right) => compareQuestionAssignments(left, right, questionNumbers))

  const root = temporaryQuestionRoot(config)
  const finalDirectory = within(root, String(student.id))
  const pendingDirectory = within(root, `.pending-${String(student.id)}-${randomUUID()}`)
  const backupDirectory = within(root, `.backup-${String(student.id)}-${randomUUID()}`)
  const manifestImages: TemporaryQuestionImage[] = []
  let hasBackup = false
  let aggregateBytes = 0
  try {
    await mkdir(pendingDirectory, { recursive: true })
    for (const [index, assignment] of assignments.entries()) {
      const resolved = resolveImage(config, state, { kind: 'assignment', id: assignment.id })
      const bytes = await readFile(resolved.path)
      aggregateBytes += bytes.byteLength
      if (aggregateBytes > config.maxBatchBytes) {
        throw new TeacherQuestionMediaError('file-too-large', '临时图片总体积超过设置上限')
      }
      const storedName = `${String(index + 1).padStart(3, '0')}_${safeFileName(
        resolved.fileName,
        `image${extensionFor(resolved.mediaType)}`,
      )}`
      await writeFile(within(pendingDirectory, storedName), bytes, { flag: 'wx' })
      manifestImages.push({
        storedName,
        fileName: resolved.fileName,
        ...questionNoProperty(questionNumbers.get(assignment.sourceImageId), resolved.fileName),
        mediaType: resolved.mediaType,
        width: resolved.width,
        height: resolved.height,
      })
    }
    const manifest: TemporaryQuestionManifest = { version: 1, studentId: student.id, images: manifestImages }
    await writeFile(
      within(pendingDirectory, TEMPORARY_QUESTION_MANIFEST),
      JSON.stringify(manifest),
      { encoding: 'utf8', flag: 'wx' },
    )
    await mkdir(root, { recursive: true })
    try {
      await rename(finalDirectory, backupDirectory)
      hasBackup = true
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    }
    await rename(pendingDirectory, finalDirectory)
  } catch (error) {
    await rm(pendingDirectory, { recursive: true, force: true })
    await rename(backupDirectory, finalDirectory).catch(() => {
      // Preserve the original write failure when no previous selection exists or restoring it also fails.
    })
    if (error instanceof TeacherQuestionMediaError) throw error
    throw new TeacherQuestionMediaError('storage-failure', '临时保存学生图片失败', { cause: error })
  }
  return {
    selection: { studentId: student.id, imageCount: manifestImages.length },
    commit: async () => { await rm(backupDirectory, { recursive: true, force: true }) },
    rollback: async () => {
      await rm(finalDirectory, { recursive: true, force: true })
      if (hasBackup) await rename(backupDirectory, finalDirectory)
    },
  }
}

/**
 * List students whose temporary Office-generation selections are available.
 * @param config - current student-image root.
 * @param state - authoritative roster metadata.
 * @param request - student identities to inspect.
 * @returns only students with one or more readable staged images.
 */
export async function listTemporaryQuestionSelections(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  request: TeacherQuestionTemporaryListRequest,
): Promise<readonly TeacherQuestionTemporarySelection[]> {
  const requested = new Set(request.studentIds)
  const rows: TeacherQuestionTemporarySelection[] = []
  for (const student of state.students) {
    if (!requested.has(student.id)) continue
    const manifest = await readTemporaryQuestionManifest(config, student.id)
    if (manifest !== undefined && manifest.images.length > 0) {
      rows.push({ studentId: student.id, imageCount: manifest.images.length })
    }
  }
  return rows
}

/**
 * Read one stored batch or student image.
 * @param config - current media roots and decoded-byte limits.
 * @param state - authoritative metadata used to resolve the target.
 * @param target - exact batch or assignment image identity.
 * @returns validated metadata and canonical base64 bytes.
 */
export async function readQuestionImage(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  target: TeacherQuestionImageTarget,
): Promise<TeacherQuestionImagePayload> {
  const image = resolveImage(config, state, target)
  try {
    const bytes = await readFile(image.path)
    return { ...image, contentBase64: bytes.toString('base64') }
  } catch (error) {
    throw new TeacherQuestionMediaError('storage-failure', '读取试题图片失败', { cause: error })
  }
}

/**
 * Replace one stored image and return a rollback that restores its previous bytes.
 * @param config - current media roots and decoded-byte limits.
 * @param state - authoritative metadata used to resolve the target.
 * @param target - exact batch or assignment image identity.
 * @param upload - replacement image metadata and bytes.
 * @returns decoded replacement metadata plus a filesystem rollback.
 */
export async function replaceQuestionImage(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  target: TeacherQuestionImageTarget,
  upload: TeacherQuestionImagePayload,
): Promise<{ readonly image: DecodedImage; rollback(): Promise<void> }> {
  const resolved = resolveImage(config, state, target)
  const decoded = await decodeImage(upload, config.maxImageBytes)
  if (decoded.mediaType !== resolved.mediaType) {
    throw new TeacherQuestionMediaError('invalid-request', '图片编辑结果必须保持原图片格式')
  }
  let previous: Buffer
  try {
    previous = await readFile(resolved.path)
    const pending = `${resolved.path}.pending-${randomUUID()}`
    await writeFile(pending, decoded.bytes, { flag: 'wx' })
    await rename(pending, resolved.path)
  } catch (error) {
    throw new TeacherQuestionMediaError('storage-failure', '保存图片编辑结果失败', { cause: error })
  }
  return {
    image: decoded,
    rollback: async () => { await writeFile(resolved.path, previous) },
  }
}

/**
 * Delete one batch directory after its metadata commit.
 * @param config - current media roots and decoded-byte limits.
 * @param batchId - exact batch directory identity.
 * @returns resolution after best-effort recursive removal.
 */
export async function deleteQuestionBatchFiles(
  config: TeacherQuestionMediaConfig,
  batchId: TeacherQuestionBatchId,
): Promise<void> {
  const root = configuredRoot(config.segmentsRoot, '试题切割目录')
  await rm(within(root, String(batchId)), { recursive: true, force: true })
}

/**
 * Delete one stored image after its metadata commit.
 * @param config - current media roots and decoded-byte limits.
 * @param state - pre-commit metadata used to resolve the file.
 * @param target - exact batch or assignment image identity.
 * @returns resolution after removal or an already-absent file.
 */
export async function deleteQuestionImageFile(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  target: TeacherQuestionImageTarget,
): Promise<void> {
  const image = resolveImage(config, state, target)
  await unlink(image.path).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  })
}

/**
 * Generate a printable Word or presentation artifact from stored images.
 * @param config - current media roots and decoded-byte limits.
 * @param state - authoritative metadata used to resolve image targets.
 * @param request - output family, optional Word metadata, and ordered targets.
 * @returns a canonical base64 Word or PowerPoint artifact.
 */
export async function generateQuestionDocument(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  request: TeacherQuestionDocumentRequest,
): Promise<TeacherQuestionDocumentPayload> {
  if (request.targets.length === 0) throw new TeacherQuestionMediaError('invalid-request', '请至少选择一张试题图片')
  try {
    const images = (await loadStoredImages(config, state, request.targets)).sort(compareRenderableImages)
    return request.kind === 'word'
      ? await generateWord(request.title, request.title, request.studentName, request.includeDate, images)
      : await generatePpt(request.title, images)
  } catch (error) {
    if (error instanceof TeacherQuestionMediaError) throw error
    throw new TeacherQuestionMediaError('generation-failure', '生成教学文档失败', { cause: error })
  }
}

/**
 * Generate one Office artifact from a browser-selected image directory.
 * @param config - current media roots and decoded-byte limits.
 * @param request - selected directory name, ordered source images, and output family.
 * @returns a canonical base64 Word or PowerPoint artifact.
 */
export async function generateUploadedQuestionDocument(
  config: TeacherQuestionMediaConfig,
  request: TeacherQuestionUploadedDocumentRequest,
): Promise<TeacherQuestionDocumentPayload> {
  if (request.images.length === 0) throw new TeacherQuestionMediaError('invalid-request', '所选文件夹中没有可用图片')
  if (request.images.length > 120) throw new TeacherQuestionMediaError('invalid-request', '一次最多生成 120 张图片')
  let aggregateBytes = 0
  const images: RenderableImage[] = []
  try {
    const uploads = [...request.images].sort((left, right) => compareQuestionOrder(
      { fileName: left.fileName, tieBreaker: left.relativePath },
      { fileName: right.fileName, tieBreaker: right.relativePath },
    ))
    for (const upload of uploads) {
      aggregateBytes += Math.floor(upload.contentBase64.length * 3 / 4)
      if (aggregateBytes > config.maxBatchBytes) {
        throw new TeacherQuestionMediaError('file-too-large', '图片总体积超过设置上限')
      }
      let decoded: DecodedDocumentImage
      try {
        decoded = await decodeDocumentImage(upload, config.maxImageBytes)
      } catch (error) {
        if (error instanceof TeacherQuestionMediaError && error.code === 'invalid-request') continue
        throw error
      }
      images.push({
        fileName: safeFileName(upload.fileName, 'image.png'),
        mediaType: 'image/png',
        width: decoded.width,
        height: decoded.height,
        bytes: decoded.bytes,
      })
    }
    if (images.length === 0) throw new TeacherQuestionMediaError('invalid-request', '所选文件夹中没有可生成的有效图片')
    return request.kind === 'word'
      ? await generateWord(request.folderName, '', '', false, images)
      : await generatePpt(request.folderName, images)
  } catch (error) {
    if (error instanceof TeacherQuestionMediaError) throw error
    throw new TeacherQuestionMediaError('generation-failure', '生成教学文档失败', { cause: error })
  }
}

/**
 * Generate one independent Office artifact for every eligible student.
 * @param config - current media roots and decoded-byte limits.
 * @param state - authoritative roster and assignment metadata.
 * @param request - output family and independent per-student Word metadata.
 * @returns generated artifacts plus students skipped for missing or invalid input.
 */
export async function generateStudentDocuments(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  request: TeacherQuestionBatchDocumentRequest,
): Promise<TeacherQuestionBatchDocumentSuccess['value']> {
  if (request.students.length === 0) throw new TeacherQuestionMediaError('invalid-request', '暂无学生可生成')
  const artifacts: TeacherQuestionDocumentPayload[] = []
  const skipped: TeacherQuestionDocumentSkipped[] = []
  const usedNames = new Set<string>()
  const seenStudents = new Set<string>()
  const source = request.source ?? 'temporary'
  for (const options of request.students) {
    if (seenStudents.has(options.studentId)) {
      throw new TeacherQuestionMediaError('invalid-request', '学生生成列表存在重复项')
    }
    seenStudents.add(options.studentId)
    const student = state.students.find(item => item.id === options.studentId)
    if (student === undefined) {
      skipped.push({ studentId: options.studentId, name: '', reason: '学生不存在' })
      continue
    }
    try {
      const images = source === 'temporary'
        ? await loadTemporaryStudentImages(config, student.id)
        : await loadStudentAssignmentImages(config, state, student.id)
      if (images.length === 0) {
        skipped.push({
          studentId: student.id,
          name: student.name,
          reason: source === 'temporary' ? '未找到临时图片' : '未找到试题图片',
        })
        continue
      }
      const artifact = request.kind === 'word'
        ? await generateWord(
          student.name,
          options.title,
          options.includeName ? student.name : '',
          options.includeDate,
          images,
        )
        : await generatePpt(student.name, images)
      const fileName = uniqueGeneratedName(artifact.fileName, usedNames)
      usedNames.add(fileName)
      artifacts.push({ ...artifact, fileName })
      if (source === 'temporary') {
        await deleteTemporaryQuestionSelection(config, student.id).catch(() => {})
      }
    } catch {
      skipped.push({ studentId: student.id, name: student.name, reason: '生成失败' })
    }
  }
  if (artifacts.length === 0) throw new TeacherQuestionMediaError('invalid-request', '所选学生没有可生成的试题图片')
  return { artifacts, skipped }
}

async function loadStudentAssignmentImages(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  studentId: TeacherStudentId,
): Promise<RenderableImage[]> {
  const assignments = state.questionAssignments.filter(item => item.studentId === studentId)
  const questionNumbers = questionNumberIndex(state)
  assignments.sort((left, right) => compareQuestionAssignments(left, right, questionNumbers))
  return await loadStoredImages(
    config,
    state,
    assignments.map(item => ({ kind: 'assignment' as const, id: item.id })),
  )
}

async function loadTemporaryStudentImages(
  config: TeacherQuestionMediaConfig,
  studentId: TeacherStudentId,
): Promise<RenderableImage[]> {
  const manifest = await readTemporaryQuestionManifest(config, studentId)
  if (manifest === undefined) return []
  const directory = temporaryQuestionDirectory(config, studentId)
  const images = [...manifest.images].sort((left, right) => compareQuestionOrder(
    { fileName: left.fileName, ...questionNoProperty(left.questionNo, left.fileName), tieBreaker: left.storedName },
    { fileName: right.fileName, ...questionNoProperty(right.questionNo, right.fileName), tieBreaker: right.storedName },
  ))
  return await Promise.all(images.map(async (image) => {
    const bytes = await readFile(within(directory, image.storedName))
    if (image.mediaType !== 'image/webp') return {
      fileName: image.fileName,
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      bytes,
    }
    return {
      fileName: image.fileName,
      mediaType: 'image/png' as const,
      width: image.width,
      height: image.height,
      bytes: await sharp(bytes).rotate().png().toBuffer(),
    }
  }))
}

async function loadStoredImages(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  targets: readonly TeacherQuestionImageTarget[],
): Promise<RenderableImage[]> {
  return await Promise.all(targets.map(async (target) => {
    const resolved = resolveImage(config, state, target)
    const bytes = await readFile(resolved.path)
    if (resolved.mediaType !== 'image/webp') return { ...resolved, bytes }
    return {
      fileName: resolved.fileName,
      mediaType: 'image/png' as const,
      width: resolved.width,
      height: resolved.height,
      bytes: await sharp(bytes).rotate().png().toBuffer(),
    }
  }))
}

async function readTemporaryQuestionManifest(
  config: TeacherQuestionMediaConfig,
  studentId: TeacherStudentId,
): Promise<TemporaryQuestionManifest | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(
      within(temporaryQuestionDirectory(config, studentId), TEMPORARY_QUESTION_MANIFEST),
      'utf8',
    ))
    if (!isTemporaryQuestionManifest(raw, studentId)) return undefined
    return raw
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    return undefined
  }
}

function isTemporaryQuestionManifest(value: unknown, studentId: TeacherStudentId): value is TemporaryQuestionManifest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.version !== 1 || record.studentId !== studentId || !Array.isArray(record.images)) return false
  return record.images.length <= 120 && record.images.every((item) => {
    if (typeof item !== 'object' || item === null) return false
    const image = item as Record<string, unknown>
    return typeof image.storedName === 'string'
      && image.storedName !== ''
      && typeof image.fileName === 'string'
      && (image.questionNo === undefined
        || (typeof image.questionNo === 'number' && Number.isSafeInteger(image.questionNo) && image.questionNo > 0))
      && (image.mediaType === 'image/png' || image.mediaType === 'image/jpeg' || image.mediaType === 'image/webp')
      && typeof image.width === 'number'
      && Number.isSafeInteger(image.width)
      && image.width > 0
      && typeof image.height === 'number'
      && Number.isSafeInteger(image.height)
      && image.height > 0
  })
}

async function deleteTemporaryQuestionSelection(
  config: TeacherQuestionMediaConfig,
  studentId: TeacherStudentId,
): Promise<void> {
  await rm(temporaryQuestionDirectory(config, studentId), { recursive: true, force: true })
}

function temporaryQuestionRoot(config: TeacherQuestionMediaConfig): string {
  return within(configuredRoot(config.studentsRoot, '学生目录'), TEMPORARY_QUESTION_DIRECTORY)
}

function temporaryQuestionDirectory(config: TeacherQuestionMediaConfig, studentId: TeacherStudentId): string {
  return within(temporaryQuestionRoot(config), String(studentId))
}

function uniqueGeneratedName(fileName: string, used: ReadonlySet<string>): string {
  if (!used.has(fileName)) return fileName
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot) : ''
  let suffix = 2
  while (used.has(`${stem}-${String(suffix)}${extension}`)) suffix += 1
  return `${stem}-${String(suffix)}${extension}`
}

interface QuestionOrderItem {
  readonly fileName: string
  readonly questionNo?: number
  readonly tieBreaker?: string
}

function questionNumberIndex(state: TeacherWorkbenchState): ReadonlyMap<TeacherQuestionImageId, number> {
  const result = new Map<TeacherQuestionImageId, number>()
  for (const batch of state.questionBatches) {
    for (const image of batch.images) {
      if (Number.isSafeInteger(image.questionNo) && image.questionNo > 0) result.set(image.id, image.questionNo)
    }
  }
  return result
}

function compareQuestionAssignments(
  left: TeacherQuestionAssignment,
  right: TeacherQuestionAssignment,
  questionNumbers: ReadonlyMap<TeacherQuestionImageId, number>,
): number {
  return compareQuestionOrder(
    {
      fileName: left.fileName,
      ...questionNoProperty(questionNumbers.get(left.sourceImageId), left.fileName),
      tieBreaker: left.relativePath,
    },
    {
      fileName: right.fileName,
      ...questionNoProperty(questionNumbers.get(right.sourceImageId), right.fileName),
      tieBreaker: right.relativePath,
    },
  )
}

function compareRenderableImages(left: RenderableImage, right: RenderableImage): number {
  return compareQuestionOrder({ fileName: left.fileName }, { fileName: right.fileName })
}

function compareQuestionOrder(left: QuestionOrderItem, right: QuestionOrderItem): number {
  const leftQuestionNo = validQuestionNumber(left.questionNo) ?? questionNumberFromFileName(left.fileName)
  const rightQuestionNo = validQuestionNumber(right.questionNo) ?? questionNumberFromFileName(right.fileName)
  if (leftQuestionNo !== undefined && rightQuestionNo !== undefined && leftQuestionNo !== rightQuestionNo) {
    return leftQuestionNo - rightQuestionNo
  }
  if (leftQuestionNo !== undefined && rightQuestionNo === undefined) return -1
  if (leftQuestionNo === undefined && rightQuestionNo !== undefined) return 1
  const byFileName = QUESTION_FILE_COLLATOR.compare(left.fileName, right.fileName)
  if (byFileName !== 0) return byFileName
  return QUESTION_FILE_COLLATOR.compare(left.tieBreaker ?? '', right.tieBreaker ?? '')
}

function validQuestionNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function questionNumberFromFileName(fileName: string): number | undefined {
  const normalized = fileName.normalize('NFKC')
  const matched = /第\s*(\d+)\s*题/u.exec(normalized) ?? /^\D*?(\d+)(?=\D|$)/u.exec(normalized)
  if (matched?.[1] === undefined) return undefined
  return validQuestionNumber(Number(matched[1]))
}

function questionNoProperty(questionNo: number | undefined, fileName: string): { readonly questionNo?: number } {
  const value = validQuestionNumber(questionNo) ?? questionNumberFromFileName(fileName)
  return value === undefined ? {} : { questionNo: value }
}

interface DecodedDocumentImage {
  readonly bytes: Buffer
  readonly width: number
  readonly height: number
}

async function decodeDocumentImage(
  upload: { readonly contentBase64: string },
  maxBytes: number,
): Promise<DecodedDocumentImage> {
  const bytes = decodeCanonicalBase64(upload.contentBase64, maxBytes)
  try {
    const normalized = await sharp(bytes, { failOn: 'error' }).rotate().png().toBuffer({ resolveWithObject: true })
    if (normalized.info.width < 1 || normalized.info.height < 1) {
      throw new Error('empty image')
    }
    return {
      bytes: normalized.data,
      width: normalized.info.width,
      height: normalized.info.height,
    }
  } catch (error) {
    throw new TeacherQuestionMediaError('invalid-request', '图片文件无法解码', { cause: error })
  }
}

function resolveImage(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  target: TeacherQuestionImageTarget,
): ResolvedImage {
  if (target.kind === 'batch') return resolveBatchImage(config, state, target.id)
  const assignment = state.questionAssignments.find(item => item.id === target.id)
  if (assignment === undefined) throw new TeacherQuestionMediaError('not-found', '学生试题图片不存在')
  const root = configuredRoot(config.studentsRoot, '学生目录')
  return {
    fileName: assignment.fileName,
    mediaType: assignment.mediaType,
    width: assignment.width,
    height: assignment.height,
    path: within(root, assignment.relativePath),
  }
}

function resolveBatchImage(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  imageId: TeacherQuestionImageId,
): ResolvedImage {
  for (const batch of state.questionBatches) {
    const image = batch.images.find(item => item.id === imageId)
    if (image === undefined) continue
    const root = configuredRoot(config.segmentsRoot, '试题切割目录')
    return {
      fileName: image.fileName,
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      path: within(root, join(String(batch.id), storedImageName(String(image.id), image.mediaType))),
    }
  }
  throw new TeacherQuestionMediaError('not-found', '切题图片不存在')
}

async function decodeImage(
  upload: Pick<TeacherQuestionImagePayload, 'mediaType' | 'contentBase64'>,
  maxBytes: number,
): Promise<DecodedImage> {
  const bytes = decodeCanonicalBase64(upload.contentBase64, maxBytes)
  let metadata: Metadata
  try {
    metadata = await sharp(bytes, { failOn: 'error' }).metadata()
  } catch (error) {
    throw new TeacherQuestionMediaError('invalid-request', '图片文件无法解码', { cause: error })
  }
  const detected = metadata.format === 'png'
    ? 'image/png'
    : metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'webp'
        ? 'image/webp'
        : undefined
  if (detected === undefined || detected !== upload.mediaType) {
    throw new TeacherQuestionMediaError('invalid-request', '图片格式或尺寸无效')
  }
  return { bytes, mediaType: detected, width: metadata.width, height: metadata.height }
}

function decodeCanonicalBase64(contentBase64: string, maxBytes: number): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(contentBase64)) {
    throw new TeacherQuestionMediaError('invalid-request', '图片内容不是规范 Base64')
  }
  if (contentBase64.length > Math.ceil(maxBytes / 3) * 4) {
    throw new TeacherQuestionMediaError('file-too-large', '单张试题图片超过设置上限')
  }
  const bytes = Buffer.from(contentBase64, 'base64')
  if (bytes.byteLength === 0 || bytes.toString('base64') !== contentBase64) {
    throw new TeacherQuestionMediaError('invalid-request', '图片内容不是规范 Base64')
  }
  if (bytes.byteLength > maxBytes) throw new TeacherQuestionMediaError('file-too-large', '单张试题图片超过设置上限')
  return bytes
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function generateWord(
  fileStem: string,
  title: string,
  studentName: string,
  includeDate: boolean,
  images: readonly RenderableImage[],
): Promise<TeacherQuestionDocumentPayload> {
  const titleText = title.trim()
  const details = [studentName.trim(), includeDate ? localDate() : '']
    .filter(Boolean)
    .join('  ')
  const children: Paragraph[] = []
  if (titleText !== '') {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: (details === '' ? 10 : 4) * 20 },
      children: [new TextRun({ text: titleText, bold: true, size: 32 })],
    }))
  }
  if (details !== '') {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 8 * 20 },
      children: [new TextRun({ text: details, size: 18 })],
    }))
  }
  for (const image of images) {
    const size = fitWordSize(image.width, image.height)
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: [new ImageRun({
        data: image.bytes,
        type: mediaExtension(image.mediaType),
        transformation: size,
      })],
    }))
  }
  const bytes = await Packer.toBuffer(new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: 11_906,
            height: 16_838,
          },
          margin: {
            top: 1_134,
            right: 1_134,
            bottom: 1_134,
            left: 1_134,
            header: 720,
            footer: 720,
            gutter: 0,
          },
        },
      },
      children,
    }],
  }))
  return {
    fileName: `${safeFileStem(fileStem, 'images')}.docx`,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    contentBase64: bytes.toString('base64'),
  }
}

async function generatePpt(
  fileStem: string,
  images: readonly RenderableImage[],
): Promise<TeacherQuestionDocumentPayload> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'QUESTION_WIDE', width: 13.333, height: 7.5 })
  pptx.layout = 'QUESTION_WIDE'
  pptx.author = 'DeepSeek Harness 教师工作台'
  pptx.subject = fileStem.trim() || 'images'
  pptx.title = fileStem.trim() || 'images'
  const left = 0.5 / 2.54
  const top = 1 / 2.54
  const maxWidth = 13.333 - left - (1 / 2.54)
  const maxHeight = 7.5 - top
  for (const image of images) {
    const slide = pptx.addSlide()
    const box = fitInchesAt96Dpi(image.width, image.height, maxWidth, maxHeight)
    slide.addImage({
      data: `data:${image.mediaType};base64,${image.bytes.toString('base64')}`,
      x: left,
      y: top,
      w: box.w,
      h: box.h,
    })
  }
  const output = await pptx.write({ outputType: 'nodebuffer' })
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer)
  return {
    fileName: `${safeFileStem(fileStem, 'images')}.pptx`,
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    contentBase64: bytes.toString('base64'),
  }
}

function configuredRoot(raw: string, label: string): string {
  const value = raw.trim()
  if (value === '') throw new TeacherQuestionMediaError('invalid-request', `请先在 DSH 设置中配置${label}`)
  return resolve(value)
}

function within(root: string, child: string): string {
  const target = resolve(root, child)
  const rel = relative(root, target)
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return target
  throw new TeacherQuestionMediaError('invalid-request', '存储路径超出配置目录')
}

function studentFolder(
  state: TeacherWorkbenchState,
  owningClass: TeacherClass,
  student: TeacherStudent,
  folderId?: TeacherQuestionFolderId,
): string {
  const grade = owningClass.grade.trim()
  const className = owningClass.name.trim()
  const group = grade !== '' && !className.includes(grade) ? `${grade}${className}` : className
  return join(
    safePathSegment(owningClass.academicYear?.trim() || '未分学年'),
    safePathSegment(group),
    safePathSegment(student.name),
    ...questionFolderSegments(state, student, folderId),
  )
}

function questionFolderSegments(
  state: TeacherWorkbenchState,
  student: TeacherStudent,
  folderId?: TeacherQuestionFolderId,
): string[] {
  if (folderId === undefined) return []
  const folders = new Map(state.questionFolders.map(folder => [folder.id, folder] as const))
  const segments: string[] = []
  const visited = new Set<string>()
  let current = folders.get(folderId)
  while (current !== undefined) {
    if (current.studentId !== student.id) throw new TeacherQuestionMediaError('invalid-request', '目标目录不属于所选学生')
    if (visited.has(current.id) || visited.size >= 64) throw new TeacherQuestionMediaError('invalid-request', '学生目录层级无效')
    visited.add(current.id)
    segments.unshift(safePathSegment(current.name))
    current = current.parentId === undefined ? undefined : folders.get(current.parentId)
  }
  if (!visited.has(folderId)) throw new TeacherQuestionMediaError('not-found', '目标学生目录不存在')
  return segments
}

function safePathSegment(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[\\/\u0000-\u001f:*?"<>|]/gu, '_').trim().replace(/^\.+|\.+$/gu, '')
  return (normalized || '未命名').slice(0, 80)
}

function safeFileName(value: string, fallback: string): string {
  const base = value.split(/[\\/]/u).at(-1)?.replace(/[\u0000-\u001f:*?"<>|]/gu, '_').trim() ?? ''
  return (base || fallback).slice(0, 255)
}

function safeFileStem(value: string, fallback: string): string {
  return safePathSegment(value.trim() || fallback).slice(0, 100)
}

function extensionFor(mediaType: TeacherQuestionImageMediaType): string {
  return mediaType === 'image/png' ? '.png' : mediaType === 'image/jpeg' ? '.jpg' : '.webp'
}

function mediaExtension(mediaType: TeacherQuestionImageMediaType): 'png' | 'jpg' {
  return mediaType === 'image/png' ? 'png' : 'jpg'
}

function storedImageName(id: string, mediaType: TeacherQuestionImageMediaType): string {
  return `${id}${extensionFor(mediaType)}`
}

function centimetersToPixels(value: number): number {
  return value * 96 / 2.54
}

function fitWordSize(width: number, height: number): { width: number; height: number } {
  const centimetersPerPixel = Math.min(17 / width, 25.7 / height, 1)
  return {
    width: Math.max(1, centimetersToPixels(width * centimetersPerPixel)),
    height: Math.max(1, centimetersToPixels(height * centimetersPerPixel)),
  }
}

function fitInchesAt96Dpi(width: number, height: number, maxWidth: number, maxHeight: number): { w: number; h: number } {
  const nativeWidth = width / 96
  const nativeHeight = height / 96
  const scale = Math.min(maxWidth / nativeWidth, maxHeight / nativeHeight, 1)
  return { w: nativeWidth * scale, h: nativeHeight * scale }
}

function localDate(): string {
  const value = new Date()
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-')
}
