/** Filesystem-backed input assembly for conversation-requested Office documents. */

import { basename } from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { TeacherQuestionUploadedDocumentRequest } from './types.ts'

const IMAGE_FILE = /\.(?:png|jpe?g|webp|bmp|gif|tiff?|heic|heif|svg)$/iu
const MAX_DOCUMENT_IMAGES = 120
const MAX_VISITED_DIRECTORIES = 512

interface FolderImage {
  readonly fileName: string
  readonly relativePath: string
  readonly target: FsTarget
  readonly size?: number
}

/** Current byte limits owned by the teacher-workbench document generator. */
export interface FolderDocumentLimits {
  /** Inclusive decoded-byte limit for one source image. */
  readonly maxImageBytes: number
  /** Inclusive decoded-byte limit for all source images. */
  readonly maxBatchBytes: number
}

/**
 * Read a local image directory through the mounted filesystem provider.
 * @param fs - filesystem provider for the calling agent's execution world.
 * @param exec - tool execution carrying the session cwd and cancellation signal.
 * @param kind - requested Office output family.
 * @param directoryPath - absolute path or path relative to the calling session cwd.
 * @param limits - decoded source-image limits enforced by the document generator.
 * @returns an ephemeral upload request ordered later by the authoritative generator.
 */
export async function readFolderDocumentRequest(
  fs: FileSystem,
  exec: ToolExecution,
  kind: 'word' | 'ppt',
  directoryPath: string,
  limits: FolderDocumentLimits,
): Promise<TeacherQuestionUploadedDocumentRequest> {
  const target = await fs.resolve(directoryPath, {
    ...(exec.agent?.session.header.cwd === undefined ? {} : { cwd: exec.agent.session.header.cwd }),
    signal: exec.signal,
  })
  const info = await fs.stat(target, exec.signal)
  if (info === undefined) throw new FsError(`cannot generate a document from "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  if (info.type !== 'directory') {
    throw new FsError(`cannot generate a document from "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY')
  }

  const files: FolderImage[] = []
  const visited = new Set<string>()
  await collectFolderImages(fs, target, target, '', files, visited, exec.signal)
  if (files.length === 0) throw new Error('所选文件夹中没有可用图片')
  if (files.length > MAX_DOCUMENT_IMAGES) throw new Error(`一次最多生成 ${String(MAX_DOCUMENT_IMAGES)} 张图片`)

  const knownBytes = files.reduce((total, file) => total + (file.size ?? 0), 0)
  if (knownBytes > limits.maxBatchBytes) throw new Error('图片总体积超过设置上限')
  const images = []
  let aggregateBytes = 0
  for (const file of files) {
    const bytes = await fs.readBytes(file.target, exec.signal, limits.maxImageBytes)
    aggregateBytes += bytes.byteLength
    if (aggregateBytes > limits.maxBatchBytes) throw new Error('图片总体积超过设置上限')
    images.push({
      fileName: file.fileName,
      relativePath: file.relativePath,
      contentBase64: Buffer.from(bytes).toString('base64'),
    })
  }
  return {
    kind,
    folderName: folderName(directoryPath, target.displayPath),
    images,
  }
}

async function collectFolderImages(
  fs: FileSystem,
  root: FsTarget,
  directory: FsTarget,
  prefix: string,
  files: FolderImage[],
  visited: Set<string>,
  signal: AbortSignal,
): Promise<void> {
  const key = String(directory.targetKey)
  if (visited.has(key)) throw new Error('所选文件夹包含循环目录')
  visited.add(key)
  if (visited.size > MAX_VISITED_DIRECTORIES) throw new Error('所选文件夹包含过多子目录')
  for (const entry of await fs.listDir(directory, signal)) {
    if (!fs.contains(root, entry.target)) throw new Error('所选文件夹包含指向目录外部的路径')
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.type === 'directory') {
      await collectFolderImages(fs, root, entry.target, relativePath, files, visited, signal)
      continue
    }
    if (entry.type === 'file' && IMAGE_FILE.test(entry.name)) {
      files.push({
        fileName: entry.name,
        relativePath,
        target: entry.target,
        ...(entry.size === undefined ? {} : { size: entry.size }),
      })
    }
  }
}

function folderName(requestedPath: string, displayPath: string): string {
  const requested = requestedPath.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
  const display = displayPath.replaceAll('\\', '/').replace(/\/+$/u, '')
  return basename(requested === '' ? display : requested) || 'selected-folder'
}
