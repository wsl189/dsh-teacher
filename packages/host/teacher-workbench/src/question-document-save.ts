/** Writes generated Office bytes into an operator-selected Host directory. */

import { open, stat, unlink, type FileHandle } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import type { TeacherQuestionDocumentSaveRequest } from './types.ts'
import { TeacherQuestionMediaError } from './question-media.ts'

/**
 * Save one Office file without replacing an existing file or creating a parent directory.
 * @param request - absolute destination directory and canonical Office artifact bytes.
 * @returns the actual absolute file path, including any collision suffix.
 */
export async function saveQuestionDocument(request: TeacherQuestionDocumentSaveRequest): Promise<string> {
  const { directory, artifact } = request
  if (!isAbsolute(directory) || directory.includes('\0')) {
    throw new TeacherQuestionMediaError('invalid-request', '保存目录必须是完整的绝对路径')
  }
  const extension = extname(artifact.fileName).toLowerCase()
  if (!['.docx', '.pptx'].includes(extension) || /[\\/:*?"<>|\x00-\x1f]/u.test(artifact.fileName)) {
    throw new TeacherQuestionMediaError('invalid-request', '文件名必须是不含路径的 Word 或 PowerPoint 文件名')
  }
  const bytes = Buffer.from(artifact.contentBase64, 'base64')
  if (bytes.toString('base64') !== artifact.contentBase64 || bytes.length < 4
    || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new TeacherQuestionMediaError('invalid-request', '生成文件的内容无效，请重新生成')
  }
  if (!(await stat(directory)).isDirectory()) {
    throw new TeacherQuestionMediaError('invalid-request', '保存位置必须是已存在的文件夹')
  }
  const stem = artifact.fileName.slice(0, -extension.length)
  for (let suffix = 0; ; suffix += 1) {
    const path = join(directory, suffix === 0 ? artifact.fileName : `${stem}_${suffix}${extension}`)
    let file: FileHandle
    try {
      file = await open(path, 'wx')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue
      throw error
    }
    try {
      await file.writeFile(bytes)
      await file.sync()
      await file.close()
      return path
    } catch (error) {
      await file.close().catch(() => { /* A failed close may already have closed the descriptor. */ })
      await unlink(path)
      throw error
    }
  }
}
