/** Safe physical-directory mutations below the configured question-media roots. */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  TeacherQuestionMediaError,
  validateQuestionDirectoryName,
  type TeacherQuestionMediaConfig,
} from './question-media.ts'
import type {
  TeacherQuestionMediaDirectoryCreateRequest,
  TeacherQuestionMediaDirectoryDeleteRequest,
  TeacherQuestionMediaDirectoryRenameRequest,
  TeacherQuestionMediaDirectoryTarget,
} from './types.ts'

/** One scanned directory retained only on the Host for later safe mutation. */
export interface DiscoveredQuestionDirectory {
  /** Configured root sampled during discovery. */
  readonly root: string
  /** Absolute directory path found below that root. */
  readonly path: string
}

/** Current-root directory deletion prepared as a reversible physical detach. */
export interface PreparedDiscoveredQuestionDirectoryDelete {
  /** Permanently remove the detached directory after related durable state commits. */
  commit(): Promise<void>
  /** Restore the directory when related durable state cannot commit. */
  rollback(): Promise<void>
}

/**
 * Build the lookup key shared by directory discovery and mutations.
 * @param target - opaque student or library directory identity.
 * @returns process-local map key.
 */
export function discoveredQuestionDirectoryTargetKey(target: TeacherQuestionMediaDirectoryTarget): string {
  return `${target.kind}:${String(target.id)}`
}

/**
 * Create one physical directory below a configured-root parent.
 * @param config - current question-media roots.
 * @param directories - directories retained by the latest successful scan.
 * @param request - opaque parent and one safe path segment.
 * @returns when the new directory exists.
 */
export async function createDiscoveredQuestionDirectory(
  config: TeacherQuestionMediaConfig,
  directories: ReadonlyMap<string, DiscoveredQuestionDirectory>,
  request: TeacherQuestionMediaDirectoryCreateRequest,
): Promise<void> {
  const name = validateQuestionDirectoryName(request.name)
  const parent = request.parent.kind === 'library-root'
    ? await resolveLibraryRoot(config.segmentsRoot)
    : await resolveDiscoveredQuestionDirectory(config, directories, request.parent)
  try {
    await mkdir(join(parent, name))
  } catch (error) {
    throw directoryMutationError(error, '新建目录失败')
  }
}

/**
 * Rename one physical directory selected from the latest scan.
 * @param config - current question-media roots.
 * @param directories - directories retained by the latest successful scan.
 * @param request - opaque target and one safe replacement segment.
 * @returns when the directory has its new name.
 */
export async function renameDiscoveredQuestionDirectory(
  config: TeacherQuestionMediaConfig,
  directories: ReadonlyMap<string, DiscoveredQuestionDirectory>,
  request: TeacherQuestionMediaDirectoryRenameRequest,
): Promise<void> {
  const name = validateQuestionDirectoryName(request.name)
  const target = await resolveDiscoveredQuestionDirectory(config, directories, request.target)
  if (basename(target) === name) return
  const destination = join(resolve(target, '..'), name)
  try {
    await assertMissing(destination)
    await rename(target, destination)
  } catch (error) {
    throw directoryMutationError(error, '重命名目录失败')
  }
}

/**
 * Delete one physical directory selected from the latest scan.
 * @param config - current question-media roots.
 * @param directories - directories retained by the latest successful scan.
 * @param request - opaque configured-root directory target.
 * @returns when the directory and all descendants are removed.
 */
export async function deleteDiscoveredQuestionDirectory(
  config: TeacherQuestionMediaConfig,
  directories: ReadonlyMap<string, DiscoveredQuestionDirectory>,
  request: TeacherQuestionMediaDirectoryDeleteRequest,
): Promise<void> {
  const prepared = await prepareDiscoveredQuestionDirectoryDelete(config, directories, request)
  await prepared.commit()
}

/**
 * Detach one current-root directory so a related durable mutation can commit atomically.
 * @param config - current question-media roots.
 * @param directories - directories retained by the latest successful scan.
 * @param request - opaque configured-root directory target.
 * @returns commit and rollback operations for the detached directory.
 */
export async function prepareDiscoveredQuestionDirectoryDelete(
  config: TeacherQuestionMediaConfig,
  directories: ReadonlyMap<string, DiscoveredQuestionDirectory>,
  request: TeacherQuestionMediaDirectoryDeleteRequest,
): Promise<PreparedDiscoveredQuestionDirectoryDelete> {
  const target = await resolveDiscoveredQuestionDirectory(config, directories, request.target)
  const root = configuredRoot(
    request.target.kind === 'library-folder' ? config.segmentsRoot : config.studentsRoot,
    request.target.kind === 'library-folder' ? '试题切割目录' : '学生目录',
  )
  const backup = join(root, `.deleted-${request.target.kind}-${String(request.target.id)}-${randomUUID()}`)
  try {
    await assertMissing(backup)
    await rename(target, backup)
  } catch (error) {
    throw directoryMutationError(error, '删除目录失败')
  }
  return {
    commit: async () => { await rm(backup, { recursive: true, force: true }) },
    rollback: async () => { await rename(backup, target) },
  }
}

async function resolveLibraryRoot(raw: string): Promise<string> {
  const configured = configuredRoot(raw, '试题切割目录')
  try {
    await mkdir(configured, { recursive: true })
    return await realpath(configured)
  } catch (error) {
    throw new TeacherQuestionMediaError('storage-failure', '读取试题库目录失败', { cause: error })
  }
}

/**
 * Resolve and revalidate one scanned directory against the current configured root.
 * @param config - current question-media roots.
 * @param directories - directories retained by the latest successful scan.
 * @param target - opaque scanned target.
 * @returns real path strictly below its current configured root.
 */
export async function resolveDiscoveredQuestionDirectory(
  config: TeacherQuestionMediaConfig,
  directories: ReadonlyMap<string, DiscoveredQuestionDirectory>,
  target: TeacherQuestionMediaDirectoryTarget,
): Promise<string> {
  const discovered = directories.get(discoveredQuestionDirectoryTargetKey(target))
  if (discovered === undefined) throw new TeacherQuestionMediaError('not-found', '目录已变化，请刷新后重试')
  const expectedRoot = configuredRoot(
    target.kind === 'library-folder' ? config.segmentsRoot : config.studentsRoot,
    target.kind === 'library-folder' ? '试题切割目录' : '学生目录',
  )
  if (discovered.root !== expectedRoot) throw new TeacherQuestionMediaError('not-found', '目录设置已变化，请刷新后重试')
  try {
    const [root, path, entry] = await Promise.all([
      realpath(expectedRoot),
      realpath(discovered.path),
      lstat(discovered.path),
    ])
    const pathFromRoot = relative(root, path)
    if (entry.isSymbolicLink() || !entry.isDirectory() || !isStrictDescendant(pathFromRoot)) {
      throw new TeacherQuestionMediaError('invalid-request', '目标目录不在当前配置根目录下')
    }
    return path
  } catch (error) {
    if (error instanceof TeacherQuestionMediaError) throw error
    throw directoryMutationError(error, '读取目标目录失败')
  }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
  throw new TeacherQuestionMediaError('invalid-request', '同名目录已存在')
}

function configuredRoot(raw: string, label: string): string {
  const value = raw.trim()
  if (value === '') throw new TeacherQuestionMediaError('invalid-request', `请先在 DSH 设置中配置${label}`)
  return resolve(value)
}

function isStrictDescendant(pathFromRoot: string): boolean {
  return pathFromRoot !== ''
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
}

function directoryMutationError(error: unknown, fallback: string): TeacherQuestionMediaError {
  if (error instanceof TeacherQuestionMediaError) return error
  if (isNodeError(error) && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')) {
    return new TeacherQuestionMediaError('invalid-request', '同名目录已存在', { cause: error })
  }
  if (isNodeError(error) && error.code === 'ENOENT') {
    return new TeacherQuestionMediaError('not-found', '目录已变化，请刷新后重试', { cause: error })
  }
  return new TeacherQuestionMediaError('storage-failure', fallback, { cause: error })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
