import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { saveQuestionDocument } from '../src/question-document-save.ts'

const disk = vi.hoisted(() => ({ full: false }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args)
    if (disk.full) {
      disk.full = false
      const write = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await write('partial file')
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      })
    }
    return handle
  } }
})

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function destination(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'question-office-save-'))
  roots.push(root)
  const path = join(root, ' 学生 作业\u00a0\u3000')
  await mkdir(path)
  return path
}

function artifact(extension: string) {
  const bytes = Buffer.from(zipSync({ 'content.xml': strToU8('<document>试题</document>') }))
  return { fileName: `张三.${extension}`, mediaType: 'application/octet-stream', contentBase64: bytes.toString('base64') }
}

describe('saving question Office documents to a selected Host path', () => {
  it.each(['docx', 'pptx'])('writes every %s byte to a directory whose name contains spaces', async (extension) => {
    const directory = await destination()
    const generated = artifact(extension)
    const path = await saveQuestionDocument({ directory, artifact: generated })
    expect(path).toBe(join(directory, generated.fileName))
    expect((await readFile(path)).toString('base64')).toBe(generated.contentBase64)
    expect(await readdir(directory)).toEqual([generated.fileName])
  })

  it('preserves existing files and gives concurrent saves distinct names', async () => {
    const directory = await destination()
    const generated = artifact('docx')
    const original = join(directory, generated.fileName)
    await writeFile(original, 'existing document')
    const paths = await Promise.all(Array.from({ length: 3 }, () => saveQuestionDocument({ directory, artifact: generated })))
    expect(new Set(paths).size).toBe(3)
    expect(await readFile(original, 'utf8')).toBe('existing document')
    for (const path of paths) expect((await readFile(path)).toString('base64')).toBe(generated.contentBase64)
  })

  it('retains the artifact for retry when the chosen directory disappears', async () => {
    const directory = await destination()
    await rm(directory, { recursive: true })
    const request = { directory, artifact: artifact('pptx') }
    await expect(saveQuestionDocument(request)).rejects.toMatchObject({ code: 'ENOENT' })
    await mkdir(directory)
    const path = await saveQuestionDocument(request)
    expect((await readFile(path)).toString('base64')).toBe(request.artifact.contentBase64)
  })

  it('removes an incomplete file after disk failure and can retry the retained bytes', async () => {
    const directory = await destination()
    const request = { directory, artifact: artifact('docx') }
    disk.full = true
    await expect(saveQuestionDocument(request)).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(await readdir(directory)).toEqual([])
    const path = await saveQuestionDocument(request)
    expect((await readFile(path)).toString('base64')).toBe(request.artifact.contentBase64)
  })

  it('refuses relative paths, path-bearing names, non-Office names, and malformed bytes without creating files', async () => {
    const directory = await destination()
    const generated = artifact('docx')
    await expect(saveQuestionDocument({ directory: 'relative', artifact: generated })).rejects.toMatchObject({ code: 'invalid-request' })
    for (const fileName of ['../file.docx', 'folder\\file.pptx', 'script.exe']) {
      await expect(saveQuestionDocument({ directory, artifact: { ...generated, fileName } })).rejects.toMatchObject({ code: 'invalid-request' })
    }
    for (const contentBase64 of ['', 'not base64', 'dGV4dA==', `${generated.contentBase64}\n`]) {
      await expect(saveQuestionDocument({ directory, artifact: { ...generated, contentBase64 } })).rejects.toMatchObject({ code: 'invalid-request' })
    }
    expect(await readdir(directory)).toEqual([])
  })
})
