/** Content-addressed source documents and generated workbench artifacts. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import type {
  TeacherQuestionDocumentPayload,
  TeacherWorkbenchSourceId,
  TeacherWorkbenchSourceReference,
  TeacherWorkbenchSourceStageRequest,
} from './types.ts'

const SOURCE_ID = /^sha256:([a-f0-9]{64})$/u

/** Filesystem policy for conversation-uploaded workbench sources and generated documents. */
export interface TeacherWorkbenchSourceConfig {
  /** Private root containing content-addressed uploaded files. */
  readonly sourcesRoot: string
  /** Private root receiving agent-generated Office files. */
  readonly generatedRoot: string
  /** Maximum decoded bytes admitted from one browser upload. */
  readonly maxSourceDocumentBytes: number
}

/** Stable source-storage failure surfaced by the Remote and agent tool. */
export class TeacherWorkbenchSourceError extends Error {
  /**
   * @param code - stable failure family.
   * @param message - user-safe diagnostic.
   * @param options - optional cause.
   */
  constructor(
    readonly code: 'invalid-request' | 'file-too-large' | 'storage-failure',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TeacherWorkbenchSourceError'
  }
}

/**
 * Persist one browser upload and return its content-addressed identity.
 * @param config - source-storage policy.
 * @param request - display metadata and base64 file bytes.
 * @returns verified source metadata with an opaque content identity.
 */
export async function stageWorkbenchSource(
  config: TeacherWorkbenchSourceConfig,
  request: TeacherWorkbenchSourceStageRequest,
): Promise<TeacherWorkbenchSourceReference> {
  if (config.sourcesRoot.trim() === '') throw new TeacherWorkbenchSourceError('storage-failure', '工作台源文件目录未配置')
  const name = safeDisplayName(request.name)
  if (request.mediaType.trim() === '') throw new TeacherWorkbenchSourceError('invalid-request', '文件类型不能为空')
  const bytes = decodeBase64(request.contentBase64)
  if (bytes.byteLength === 0) throw new TeacherWorkbenchSourceError('invalid-request', '文件内容不能为空')
  if (bytes.byteLength > config.maxSourceDocumentBytes) {
    throw new TeacherWorkbenchSourceError('file-too-large', '文件超过工作台源文件大小限制')
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  const id = `sha256:${digest}` as TeacherWorkbenchSourceId
  const target = sourcePath(config.sourcesRoot, digest)
  try {
    await mkdir(join(config.sourcesRoot, 'objects', digest.slice(0, 2)), { recursive: true, mode: 0o700 })
    await mkdir(join(config.sourcesRoot, 'tmp'), { recursive: true, mode: 0o700 })
    const temporary = join(config.sourcesRoot, 'tmp', randomUUID())
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await rename(temporary, target)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      })
    }
    const stored = new Uint8Array(await readFile(target))
    if (createHash('sha256').update(stored).digest('hex') !== digest) {
      throw new TeacherWorkbenchSourceError('storage-failure', '已保存的源文件完整性校验失败')
    }
  } catch (error) {
    if (error instanceof TeacherWorkbenchSourceError) throw error
    throw new TeacherWorkbenchSourceError('storage-failure', '无法保存工作台源文件', { cause: error })
  }
  return Object.freeze({ id, name, mediaType: request.mediaType, bytes: bytes.byteLength })
}

/**
 * Read and verify one staged source by opaque identity.
 * @param config - source-storage policy.
 * @param id - content-addressed source identity.
 * @returns verified source bytes.
 */
export async function readWorkbenchSource(
  config: TeacherWorkbenchSourceConfig,
  id: TeacherWorkbenchSourceId,
): Promise<Uint8Array> {
  if (config.sourcesRoot.trim() === '') throw new TeacherWorkbenchSourceError('storage-failure', '工作台源文件目录未配置')
  const match = SOURCE_ID.exec(String(id))
  if (match?.[1] === undefined) throw new TeacherWorkbenchSourceError('invalid-request', '工作台源文件编号无效')
  try {
    const bytes = new Uint8Array(await readFile(sourcePath(config.sourcesRoot, match[1])))
    if (createHash('sha256').update(bytes).digest('hex') !== match[1]) {
      throw new TeacherWorkbenchSourceError('storage-failure', '工作台源文件完整性校验失败')
    }
    return bytes
  } catch (error) {
    if (error instanceof TeacherWorkbenchSourceError) throw error
    throw new TeacherWorkbenchSourceError('storage-failure', '无法读取工作台源文件', { cause: error })
  }
}

/**
 * Save one generated Word or PowerPoint artifact below the configured output root.
 * @param config - generated-output storage policy.
 * @param artifact - generated file name, media type, and base64 bytes.
 * @returns absolute path to the saved artifact.
 */
export async function saveGeneratedArtifact(
  config: TeacherWorkbenchSourceConfig,
  artifact: TeacherQuestionDocumentPayload,
): Promise<string> {
  if (config.generatedRoot.trim() === '') throw new TeacherWorkbenchSourceError('storage-failure', '工作台生成目录未配置')
  const fileName = safeDisplayName(artifact.fileName)
  const bytes = decodeBase64(artifact.contentBase64)
  await mkdir(config.generatedRoot, { recursive: true, mode: 0o700 })
  const target = contained(config.generatedRoot, `${Date.now()}-${randomUUID().slice(0, 8)}-${fileName}`)
  try {
    await writeFile(target, bytes, { mode: 0o600, flag: 'wx' })
    return target
  } catch (error) {
    throw new TeacherWorkbenchSourceError('storage-failure', '无法保存生成的文档', { cause: error })
  }
}

function sourcePath(root: string, digest: string): string {
  return contained(root, join('objects', digest.slice(0, 2), digest))
}

function contained(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new TeacherWorkbenchSourceError('invalid-request', '文件路径超出工作台目录')
  }
  return target
}

function safeDisplayName(value: string): string {
  const leaf = basename(value.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 255)
  if (leaf === '' || leaf === '.' || leaf === '..') throw new TeacherWorkbenchSourceError('invalid-request', '文件名无效')
  return leaf
}

function decodeBase64(value: string): Uint8Array {
  if (value === '' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new TeacherWorkbenchSourceError('invalid-request', '文件内容不是有效的 base64')
  }
  const buffer = Buffer.from(value, 'base64')
  if (buffer.toString('base64') !== value) throw new TeacherWorkbenchSourceError('invalid-request', '文件内容不是规范 base64')
  return new Uint8Array(buffer)
}
