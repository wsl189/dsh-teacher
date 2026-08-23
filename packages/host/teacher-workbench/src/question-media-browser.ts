/** Filesystem discovery for question media stored outside the durable workbench document. */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import sharp from 'sharp'
import {
  questionMediaPathSegment,
  studentQuestionDirectory,
  TeacherQuestionMediaError,
  type TeacherQuestionMediaConfig,
} from './question-media.ts'
import {
  discoveredQuestionDirectoryTargetKey,
  type DiscoveredQuestionDirectory,
} from './question-media-directories.ts'
import type {
  TeacherQuestionAssignment,
  TeacherQuestionAssignmentId,
  TeacherQuestionBatch,
  TeacherQuestionBatchId,
  TeacherClass,
  TeacherClassId,
  TeacherQuestionImage,
  TeacherQuestionImageId,
  TeacherQuestionImageMediaType,
  TeacherQuestionImagePayload,
  TeacherQuestionImageTarget,
  TeacherQuestionFolder,
  TeacherQuestionFolderId,
  TeacherQuestionLibraryFolderId,
  TeacherQuestionMediaBrowseValue,
  TeacherStudent,
  TeacherStudentId,
  TeacherWorkbenchState,
} from './types.ts'

const MAX_DISCOVERED_IMAGES_PER_ROOT = 5_000
const IMAGE_COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/** One discovered file retained for a later image-byte read. */
export interface DiscoveredQuestionFile {
  /** Absolute path contained by the configured root. */
  readonly path: string
  /** Browser-safe file metadata. */
  readonly payload: Omit<TeacherQuestionImagePayload, 'contentBase64'>
}

/** Result of scanning both configured roots. */
export interface DiscoveredQuestionMedia {
  /** Collections rendered by the question workbench. */
  readonly value: TeacherQuestionMediaBrowseValue
  /** Target identity to validated absolute file. */
  readonly files: ReadonlyMap<string, DiscoveredQuestionFile>
  /** Opaque directory identity to a validated configured-root descendant. */
  readonly directories: ReadonlyMap<string, DiscoveredQuestionDirectory>
}

interface ImageFile {
  readonly absolutePath: string
  readonly relativePath: string
  readonly fileName: string
  readonly mediaType: TeacherQuestionImageMediaType
  readonly width: number
  readonly height: number
  readonly updatedAt: number
}

interface LibraryDirectory {
  readonly absolutePath: string
  readonly relativePath: string
  readonly name: string
  readonly hasChildren: boolean
  readonly images: readonly ImageFile[]
  readonly updatedAt: number
}

interface StudentDirectory {
  readonly student: TeacherStudent
  readonly absolutePath: string
  readonly folderIdsByRelativeDirectory: ReadonlyMap<string, TeacherQuestionFolderId>
}

interface StudentHierarchy {
  readonly classes: TeacherClass[]
  readonly students: TeacherStudent[]
  readonly questionFolders: TeacherQuestionFolder[]
  readonly directories: StudentDirectory[]
  readonly readOnlyClassIds: TeacherClassId[]
  readonly readOnlyStudentIds: TeacherStudentId[]
  readonly readOnlyFolderIds: TeacherQuestionFolderId[]
}

interface StudentFolderDirectory {
  readonly absolutePath: string
  readonly relativePath: string
  readonly updatedAt: number
}

/**
 * Scan the configured roots instead of relying on paths retained by earlier settings.
 * @param config - live media roots and per-image byte limit.
 * @param state - durable roster and metadata used to retain stable identities when files match.
 * @returns current filesystem collections plus their read map.
 */
export async function discoverQuestionMedia(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
): Promise<DiscoveredQuestionMedia> {
  const files = new Map<string, DiscoveredQuestionFile>()
  const directories = new Map<string, DiscoveredQuestionDirectory>()
  const batchResult = await discoverBatches(config, state, files, directories)
  const hierarchy = await discoverStudentHierarchy(config, state, directories)
  const assignmentResult = await discoverAssignments(config, state, hierarchy.directories, files)
  return {
    value: Object.freeze({
      classes: Object.freeze(hierarchy.classes),
      students: Object.freeze(hierarchy.students),
      questionBatches: Object.freeze(batchResult.batches),
      questionLibraryFolders: Object.freeze(batchResult.libraryFolders),
      questionFolders: Object.freeze(hierarchy.questionFolders),
      questionAssignments: Object.freeze(assignmentResult.assignments),
      readOnlyBatchIds: Object.freeze(batchResult.readOnlyBatchIds),
      readOnlyLibraryFolderIds: Object.freeze(batchResult.readOnlyLibraryFolderIds),
      readOnlyAssignmentIds: Object.freeze(assignmentResult.readOnlyAssignmentIds),
      readOnlyClassIds: Object.freeze(hierarchy.readOnlyClassIds),
      readOnlyStudentIds: Object.freeze(hierarchy.readOnlyStudentIds),
      readOnlyFolderIds: Object.freeze(hierarchy.readOnlyFolderIds),
    }),
    files,
    directories,
  }
}

/**
 * Read one file returned by {@link discoverQuestionMedia}.
 * @param file - discovered path and trusted metadata.
 * @param maxImageBytes - maximum bytes accepted from one configured-root image.
 * @returns browser-safe image metadata and base64 bytes.
 */
export async function readDiscoveredQuestionFile(
  file: DiscoveredQuestionFile,
  maxImageBytes: number,
): Promise<TeacherQuestionImagePayload> {
  try {
    const bytes = await readFile(file.path)
    if (bytes.byteLength > maxImageBytes) {
      throw new TeacherQuestionMediaError('file-too-large', '试题图片超过设置上限')
    }
    return { ...file.payload, contentBase64: bytes.toString('base64') }
  } catch (error) {
    if (error instanceof TeacherQuestionMediaError) throw error
    throw new TeacherQuestionMediaError('storage-failure', '读取试题图片失败', { cause: error })
  }
}

/**
 * Build the stable lookup key shared by discovery and Remote reads.
 * @param target - batch or assignment image identity.
 * @returns map key for the discovered file.
 */
export function discoveredQuestionTargetKey(target: TeacherQuestionImageTarget): string {
  return `${target.kind}:${String(target.id)}`
}

async function discoverBatches(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  discoveredFiles: Map<string, DiscoveredQuestionFile>,
  discoveredDirectories: Map<string, DiscoveredQuestionDirectory>,
): Promise<{
  batches: TeacherQuestionBatch[]
  libraryFolders: TeacherWorkbenchState['questionLibraryFolders'][number][]
  readOnlyBatchIds: TeacherQuestionBatchId[]
  readOnlyLibraryFolderIds: TeacherQuestionLibraryFolderId[]
}> {
  const root = configuredRoot(config.segmentsRoot, '试题切割目录')
  const tree = await collectLibraryDirectories(root, config.maxImageBytes)
  const durableById = new Map(state.questionBatches.map(batch => [String(batch.id), batch] as const))
  const durableDirectories = new Map(tree.directories.flatMap((directory) => {
    if (directory.relativePath.includes('/')) return []
    const durable = durableById.get(directory.name)
    return durable === undefined ? [] : [[directory.relativePath, durable] as const]
  }))
  const batches: TeacherQuestionBatch[] = []
  const readOnlyBatchIds: TeacherQuestionBatchId[] = []
  const externalFolders: TeacherWorkbenchState['questionLibraryFolders'][number][] = []
  const readOnlyLibraryFolderIds: TeacherQuestionLibraryFolderId[] = []
  const externalFolderIdsByPath = new Map<string, TeacherQuestionLibraryFolderId>()

  for (const directory of tree.directories) {
    if (durableDirectories.has(topRelativePath(directory.relativePath))) continue
    const id = stableId(
      'library-folder',
      `${root}\0${directory.relativePath}`,
    ) as TeacherQuestionLibraryFolderId
    const parentId = externalFolderIdsByPath.get(parentRelativePath(directory.relativePath))
    externalFolders.push({
      id,
      ...(parentId === undefined ? {} : { parentId }),
      name: directory.name.slice(0, 200),
      createdAt: directory.updatedAt,
      updatedAt: directory.updatedAt,
    })
    externalFolderIdsByPath.set(directory.relativePath, id)
    readOnlyLibraryFolderIds.push(id)
    discoveredDirectories.set(discoveredQuestionDirectoryTargetKey({ kind: 'library-folder', id }), {
      root,
      path: directory.absolutePath,
    })
  }

  const appendExternalBatch = (
    identityPath: string,
    name: string,
    sourceName: string,
    imageFiles: readonly ImageFile[],
    folderId?: TeacherQuestionLibraryFolderId,
  ): void => {
    const batchId = stableId('batch', `${root}\0${identityPath}`) as TeacherQuestionBatchId
    const images = imageFiles.map((file, index): TeacherQuestionImage => {
      const imagePath = normalizeRelative(relative(root, file.absolutePath))
      const id = stableId('batch-image', `${root}\0${imagePath}`) as TeacherQuestionImageId
      discoveredFiles.set(discoveredQuestionTargetKey({ kind: 'batch', id }), discoveredFile(file))
      return {
        id,
        questionNo: questionNumber(file.fileName, index + 1),
        fileName: file.fileName,
        mediaType: file.mediaType,
        width: file.width,
        height: file.height,
        createdAt: file.updatedAt,
        updatedAt: file.updatedAt,
      }
    })
    batches.push({
      id: batchId,
      ...(folderId === undefined ? {} : { folderId }),
      name: name.slice(0, 200),
      sourceName: sourceName.slice(0, 240),
      pageRange: '',
      createdAt: Math.min(...images.map(image => image.createdAt)),
      images,
    })
    readOnlyBatchIds.push(batchId)
  }

  if (tree.rootImages.length > 0) {
    appendExternalBatch('.', basename(root) || '根目录图片', `${basename(root) || '根目录图片'}.pdf`, tree.rootImages)
  }

  for (const directory of tree.directories) {
    if (directory.images.length === 0) continue
    const durable = durableDirectories.get(directory.relativePath)
    if (durable !== undefined) {
      const byStoredName = new Map(durable.images.map(image => [storedImageName(image), image] as const))
      const images: TeacherQuestionImage[] = []
      for (const file of directory.images) {
        const image = byStoredName.get(file.relativePath)
        if (image === undefined) continue
        images.push(image)
        discoveredFiles.set(discoveredQuestionTargetKey({ kind: 'batch', id: image.id }), discoveredFile(file))
      }
      if (images.length > 0) {
        batches.push({ ...durable, images })
        continue
      }
    }
    if (durableDirectories.has(topRelativePath(directory.relativePath))) continue
    const folderId = externalFolderIdsByPath.get(directory.relativePath)
    appendExternalBatch(
      directory.relativePath,
      directory.name,
      `${directory.name}.pdf`,
      directory.images,
      folderId,
    )
  }
  return {
    batches,
    libraryFolders: [...state.questionLibraryFolders, ...externalFolders],
    readOnlyBatchIds,
    readOnlyLibraryFolderIds,
  }
}

async function discoverAssignments(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  directories: readonly StudentDirectory[],
  discoveredFiles: Map<string, DiscoveredQuestionFile>,
): Promise<{ assignments: TeacherQuestionAssignment[]; readOnlyAssignmentIds: TeacherQuestionAssignmentId[] }> {
  const root = configuredRoot(config.studentsRoot, '学生目录')
  const durableByPath = new Map(state.questionAssignments.map(assignment => [
    normalizeRelative(assignment.relativePath),
    assignment,
  ] as const))
  const assignments: TeacherQuestionAssignment[] = []
  const readOnlyAssignmentIds: TeacherQuestionAssignmentId[] = []
  const claimed = new Set<string>()
  let remaining = MAX_DISCOVERED_IMAGES_PER_ROOT

  for (const directory of directories) {
    if (remaining === 0) break
    const imageFiles = await collectImages(directory.absolutePath, config.maxImageBytes, remaining)
    remaining -= imageFiles.length
    for (const file of imageFiles) {
      const rootRelativePath = normalizeRelative(relative(root, file.absolutePath))
      if (claimed.has(rootRelativePath)) continue
      claimed.add(rootRelativePath)
      const durable = durableByPath.get(rootRelativePath)
      if (durable !== undefined && durable.studentId === directory.student.id) {
        assignments.push(durable)
        discoveredFiles.set(discoveredQuestionTargetKey({ kind: 'assignment', id: durable.id }), discoveredFile(file))
        continue
      }
      const id = stableId(
        'assignment',
        `${root}\0${String(directory.student.id)}:${rootRelativePath}`,
      ) as TeacherQuestionAssignmentId
      const relativeFolder = parentRelativePath(normalizeRelative(file.relativePath))
      const folderId = relativeFolder === ''
        ? undefined
        : directory.folderIdsByRelativeDirectory.get(relativeFolder)
      assignments.push({
        id,
        studentId: directory.student.id,
        sourceImageId: stableId('assignment-source', `${root}\0${rootRelativePath}`) as TeacherQuestionImageId,
        ...(folderId === undefined ? {} : { folderId }),
        fileName: file.fileName,
        relativePath: rootRelativePath,
        mediaType: file.mediaType,
        width: file.width,
        height: file.height,
        temporarySaveCount: 0,
        createdAt: file.updatedAt,
        updatedAt: file.updatedAt,
      })
      readOnlyAssignmentIds.push(id)
      discoveredFiles.set(discoveredQuestionTargetKey({ kind: 'assignment', id }), discoveredFile(file))
    }
  }
  return { assignments, readOnlyAssignmentIds }
}

async function discoverStudentHierarchy(
  config: TeacherQuestionMediaConfig,
  state: TeacherWorkbenchState,
  discoveredDirectories: Map<string, DiscoveredQuestionDirectory>,
): Promise<StudentHierarchy> {
  const root = configuredRoot(config.studentsRoot, '学生目录')
  const durableClasses = state.classes.filter(item => item.usage === 'roster')
  const classes = [...durableClasses]
  const students = [...state.students]
  const unresolvedDirectories: Omit<StudentDirectory, 'folderIdsByRelativeDirectory'>[] = []
  const readOnlyClassIds: TeacherClassId[] = []
  const readOnlyStudentIds: TeacherStudentId[] = []
  const claimedClassIds = new Set<TeacherClassId>()
  const claimedStudentIds = new Set<TeacherStudentId>()

  for (const academicYear of await childDirectories(root)) {
    const yearPath = join(root, academicYear)
    for (const levelOne of await childDirectories(yearPath)) {
      const levelOnePath = join(yearPath, levelOne)
      const levelTwoNames = await childDirectories(levelOnePath)
      const levelTwoChildren = new Map<string, string[]>()
      for (const levelTwo of levelTwoNames) {
        levelTwoChildren.set(levelTwo, await childDirectories(join(levelOnePath, levelTwo)))
      }
      const legacy = !levelOne.includes('班') && levelTwoNames.some(name =>
        name.includes('班') && (levelTwoChildren.get(name)?.length ?? 0) > 0)
      if (legacy) {
        for (const className of levelTwoNames) {
          appendDiscoveredGroup({
            root,
            academicYear,
            grade: levelOne,
            className,
            groupPath: join(levelOnePath, className),
            studentNames: levelTwoChildren.get(className) ?? [],
            durableClasses,
            durableStudents: state.students,
            classes,
            students,
            directories: unresolvedDirectories,
            readOnlyClassIds,
            readOnlyStudentIds,
            claimedClassIds,
            claimedStudentIds,
            discoveredDirectories,
          })
        }
        continue
      }
      appendDiscoveredGroup({
        root,
        academicYear,
        grade: '',
        className: levelOne,
        groupPath: levelOnePath,
        studentNames: levelTwoNames,
        durableClasses,
        durableStudents: state.students,
        classes,
        students,
        directories: unresolvedDirectories,
        readOnlyClassIds,
        readOnlyStudentIds,
        claimedClassIds,
        claimedStudentIds,
        discoveredDirectories,
      })
    }
  }
  const questionFolders = [...state.questionFolders]
  const readOnlyFolderIds: TeacherQuestionFolderId[] = []
  const directories: StudentDirectory[] = []
  for (const directory of unresolvedDirectories) {
    const discovered = await discoverStudentFolders(root, state, directory, discoveredDirectories)
    questionFolders.push(...discovered.folders)
    readOnlyFolderIds.push(...discovered.readOnlyFolderIds)
    directories.push({ ...directory, folderIdsByRelativeDirectory: discovered.idsByRelativeDirectory })
  }
  return {
    classes,
    students,
    questionFolders,
    directories,
    readOnlyClassIds,
    readOnlyStudentIds,
    readOnlyFolderIds,
  }
}

interface DiscoveredGroupInput {
  readonly root: string
  readonly academicYear: string
  readonly grade: string
  readonly className: string
  readonly groupPath: string
  readonly studentNames: readonly string[]
  readonly durableClasses: readonly TeacherClass[]
  readonly durableStudents: readonly TeacherStudent[]
  readonly classes: TeacherClass[]
  readonly students: TeacherStudent[]
  readonly directories: Omit<StudentDirectory, 'folderIdsByRelativeDirectory'>[]
  readonly readOnlyClassIds: TeacherClassId[]
  readonly readOnlyStudentIds: TeacherStudentId[]
  readonly claimedClassIds: Set<TeacherClassId>
  readonly claimedStudentIds: Set<TeacherStudentId>
  readonly discoveredDirectories: Map<string, DiscoveredQuestionDirectory>
}

function appendDiscoveredGroup(input: DiscoveredGroupInput): void {
  const displayName = input.grade === '' ? input.className : `${input.grade}${input.className}`
  const pathDisplayName = questionMediaPathSegment(displayName)
  const pathAcademicYear = questionMediaPathSegment(input.academicYear)
  let owningClass = input.durableClasses.find(item => !input.claimedClassIds.has(item.id)
    && questionMediaPathSegment(classDisplayName(item)) === pathDisplayName
    && questionMediaPathSegment(item.academicYear?.trim() || '未分学年') === pathAcademicYear)
  owningClass ??= input.durableClasses.find(item => !input.claimedClassIds.has(item.id)
    && questionMediaPathSegment(classDisplayName(item)) === pathDisplayName
    && (item.academicYear?.trim() ?? '') === '')
  if (owningClass === undefined) {
    const id = stableId(
      'class',
      `${input.root}\0${normalizeRelative(relative(input.root, input.groupPath))}`,
    ) as TeacherClassId
    owningClass = {
      id,
      usage: 'roster',
      academicYear: input.academicYear,
      name: input.className,
      grade: input.grade,
      subject: '',
    }
    input.classes.push(owningClass)
    input.readOnlyClassIds.push(id)
  } else {
    input.claimedClassIds.add(owningClass.id)
  }

  for (const studentName of input.studentNames) {
    const pathStudentName = questionMediaPathSegment(studentName)
    let student = input.durableStudents.find(item => !input.claimedStudentIds.has(item.id)
      && item.classId === owningClass.id && questionMediaPathSegment(item.name) === pathStudentName)
    if (student === undefined) {
      const id = stableId('student', `${input.root}\0${normalizeRelative(relative(
        input.root,
        join(input.groupPath, studentName),
      ))}`) as TeacherStudentId
      student = {
        id,
        classId: owningClass.id,
        name: studentName,
        studentNumber: '',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
        extras: {},
      }
      input.students.push(student)
      input.readOnlyStudentIds.push(id)
    } else {
      input.claimedStudentIds.add(student.id)
    }
    input.discoveredDirectories.set(discoveredQuestionDirectoryTargetKey({ kind: 'student', id: student.id }), {
      root: input.root,
      path: join(input.groupPath, studentName),
    })
    input.directories.push({ student, absolutePath: join(input.groupPath, studentName) })
  }
}

async function discoverStudentFolders(
  root: string,
  state: TeacherWorkbenchState,
  directory: Omit<StudentDirectory, 'folderIdsByRelativeDirectory'>,
  discoveredDirectories: Map<string, DiscoveredQuestionDirectory>,
): Promise<{
  folders: TeacherQuestionFolder[]
  readOnlyFolderIds: TeacherQuestionFolderId[]
  idsByRelativeDirectory: ReadonlyMap<string, TeacherQuestionFolderId>
}> {
  const durableByPath = durableStudentFoldersByPath(state, directory.student)
  const folders: TeacherQuestionFolder[] = []
  const readOnlyFolderIds: TeacherQuestionFolderId[] = []
  const idsByRelativeDirectory = new Map<string, TeacherQuestionFolderId>()
  for (const entry of await collectStudentDirectories(directory.absolutePath)) {
    const durable = durableByPath.get(entry.relativePath)
    if (durable !== undefined) {
      idsByRelativeDirectory.set(entry.relativePath, durable.id)
      discoveredDirectories.set(discoveredQuestionDirectoryTargetKey({ kind: 'student-folder', id: durable.id }), {
        root,
        path: entry.absolutePath,
      })
      continue
    }
    const id = stableId(
      'student-folder',
      `${root}\0${normalizeRelative(relative(root, entry.absolutePath))}`,
    ) as TeacherQuestionFolderId
    const parentId = idsByRelativeDirectory.get(parentRelativePath(entry.relativePath))
    folders.push({
      id,
      studentId: directory.student.id,
      ...(parentId === undefined ? {} : { parentId }),
      name: basename(entry.absolutePath).slice(0, 200),
      createdAt: entry.updatedAt,
      updatedAt: entry.updatedAt,
    })
    readOnlyFolderIds.push(id)
    idsByRelativeDirectory.set(entry.relativePath, id)
    discoveredDirectories.set(discoveredQuestionDirectoryTargetKey({ kind: 'student-folder', id }), {
      root,
      path: entry.absolutePath,
    })
  }
  return { folders, readOnlyFolderIds, idsByRelativeDirectory }
}

function durableStudentFoldersByPath(
  state: TeacherWorkbenchState,
  student: TeacherStudent,
): ReadonlyMap<string, TeacherQuestionFolder> {
  const durableStudent = state.students.find(item => item.id === student.id)
  if (durableStudent === undefined) return new Map()
  const owningClass = state.classes.find(item => item.id === durableStudent.classId)
  if (owningClass === undefined) return new Map()
  const studentPath = studentQuestionDirectory(state, owningClass, durableStudent)
  const folders = new Map<string, TeacherQuestionFolder>()
  for (const folder of state.questionFolders) {
    if (folder.studentId !== durableStudent.id) continue
    const folderPath = studentQuestionDirectory(state, owningClass, durableStudent, folder.id)
    folders.set(normalizeRelative(relative(studentPath, folderPath)), folder)
  }
  return folders
}

async function collectStudentDirectories(root: string): Promise<StudentFolderDirectory[]> {
  const directories: StudentFolderDirectory[] = []
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => IMAGE_COLLATOR.compare(left.name, right.name))
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const absolutePath = join(current, entry.name)
      const directoryStat = await stat(absolutePath)
      directories.push({
        absolutePath,
        relativePath: normalizeRelative(relative(root, absolutePath)),
        updatedAt: Math.max(0, Math.trunc(directoryStat.mtimeMs)),
      })
      await walk(absolutePath)
    }
  }
  try {
    await walk(root)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw new TeacherQuestionMediaError('storage-failure', '读取学生试题目录失败', { cause: error })
  }
  return directories
}

async function collectLibraryDirectories(
  root: string,
  maxImageBytes: number,
): Promise<{ rootImages: readonly ImageFile[]; directories: readonly LibraryDirectory[] }> {
  const directories: LibraryDirectory[] = []
  let remaining = MAX_DISCOVERED_IMAGES_PER_ROOT
  const walk = async (current: string, relativePath: string): Promise<ImageFile[]> => {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => IMAGE_COLLATOR.compare(left.name, right.name))
    const childDirectoryEntries = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    const images: ImageFile[] = []
    for (const entry of entries) {
      if (remaining === 0) break
      if (!entry.isFile() || entry.name.startsWith('.') || mediaTypeFor(entry.name) === undefined) continue
      const image = await inspectImageFile(join(current, entry.name), current, maxImageBytes)
      if (image === undefined) continue
      images.push(image)
      remaining -= 1
    }
    if (relativePath !== '') {
      const directoryStat = await stat(current)
      directories.push({
        absolutePath: current,
        relativePath,
        name: basename(current),
        hasChildren: childDirectoryEntries.length > 0,
        images,
        updatedAt: Math.max(0, Math.trunc(directoryStat.mtimeMs)),
      })
    }
    for (const entry of childDirectoryEntries) {
      const childPath = join(current, entry.name)
      await walk(childPath, normalizeRelative(relative(root, childPath)))
    }
    return images
  }
  try {
    const rootImages = await walk(root, '')
    return { rootImages, directories }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { rootImages: [], directories: [] }
    throw new TeacherQuestionMediaError('storage-failure', '读取试题库目录失败', { cause: error })
  }
}

async function collectImages(directory: string, maxImageBytes: number, limit: number): Promise<ImageFile[]> {
  const paths: string[] = []
  const walk = async (current: string): Promise<void> => {
    if (paths.length >= limit) return
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => IMAGE_COLLATOR.compare(left.name, right.name))
    for (const entry of entries) {
      if (paths.length >= limit) return
      if (entry.name.startsWith('.')) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && mediaTypeFor(entry.name) !== undefined) paths.push(path)
    }
  }
  await walk(directory)
  const result: ImageFile[] = []
  for (const path of paths) {
    const image = await inspectImageFile(path, directory, maxImageBytes)
    if (image !== undefined) result.push(image)
  }
  return result
}

async function inspectImageFile(
  path: string,
  relativeRoot: string,
  maxImageBytes: number,
): Promise<ImageFile | undefined> {
  const fileStat = await stat(path)
  if (fileStat.size > maxImageBytes) return undefined
  try {
    const metadata = await sharp(path).metadata()
    const mediaType = mediaTypeFor(path)
    if (mediaType === undefined) return undefined
    return {
      absolutePath: path,
      relativePath: relative(relativeRoot, path),
      fileName: basename(path),
      mediaType,
      width: metadata.width,
      height: metadata.height,
      updatedAt: Math.max(0, Math.trunc(fileStat.mtimeMs)),
    }
  } catch {
    // An unreadable raster is omitted without hiding other images under the configured root.
    return undefined
  }
}

async function childDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort((left, right) => IMAGE_COLLATOR.compare(left, right))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw new TeacherQuestionMediaError('storage-failure', '读取试题库目录失败', { cause: error })
  }
}

function discoveredFile(file: ImageFile): DiscoveredQuestionFile {
  return {
    path: file.absolutePath,
    payload: {
      fileName: file.fileName,
      mediaType: file.mediaType,
      width: file.width,
      height: file.height,
    },
  }
}

function configuredRoot(raw: string, label: string): string {
  const value = raw.trim()
  if (value === '') throw new TeacherQuestionMediaError('invalid-request', `请先在 DSH 设置中配置${label}`)
  return resolve(value)
}

function normalizeRelative(value: string): string {
  return value.split(sep).join('/')
}

function parentRelativePath(value: string): string {
  const separator = value.lastIndexOf('/')
  return separator === -1 ? '' : value.slice(0, separator)
}

function topRelativePath(value: string): string {
  const separator = value.indexOf('/')
  return separator === -1 ? value : value.slice(0, separator)
}

function stableId(kind: string, value: string): string {
  return `filesystem-${kind}-${createHash('sha256').update(`${kind}\0${value}`).digest('hex').slice(0, 32)}`
}

function storedImageName(image: TeacherQuestionImage): string {
  return `${String(image.id)}${extensionFor(image.mediaType)}`
}

function extensionFor(mediaType: TeacherQuestionImageMediaType): string {
  return mediaType === 'image/png' ? '.png' : mediaType === 'image/jpeg' ? '.jpg' : '.webp'
}

function mediaTypeFor(path: string): TeacherQuestionImageMediaType | undefined {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return undefined
}

function questionNumber(fileName: string, fallback: number): number {
  const stem = basename(fileName, extname(fileName))
  const match = /(?:^|[_-])q?(\d+)(?:$|[_-])/iu.exec(stem) ?? /q?(\d+)$/iu.exec(stem)
  if (match === null) return fallback
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 && value <= 10_000 ? value : fallback
}

function classDisplayName(item: Pick<TeacherClass, 'grade' | 'name'>): string {
  const grade = item.grade.trim()
  const name = item.name.trim()
  return grade !== '' && !name.includes(grade) ? `${grade}${name}` : name
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
