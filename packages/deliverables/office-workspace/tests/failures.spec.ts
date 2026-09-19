/** Inject filesystem failures at publication and cleanup commit points. */
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createScratch, publishAvailable, publishFiles, removeScratch } from '../src/files.ts'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>()
  return { ...actual, link: vi.fn(actual.link), lstat: vi.fn(actual.lstat) }
})
const actual = await vi.importActual<typeof fs>('node:fs/promises')
const roots: string[] = []
afterEach(async () => {
  vi.mocked(fs.link).mockReset().mockImplementation(actual.link)
  vi.mocked(fs.lstat).mockReset().mockImplementation(actual.lstat)
  await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true })))
})

async function draft() {
  const cwd = await fs.mkdtemp(join(tmpdir(), 'dsh-office-failure-'))
  roots.push(cwd)
  const scratch = await createScratch(cwd)
  await fs.writeFile(join(scratch.directory, 'source.docx'), 'document')
  return { cwd, scratch }
}

it.each(['owned', 'missing', 'replaced'] as const)('rolls back only an %s destination after a later publication fails', async (state) => {
  const { cwd, scratch } = await draft()
  const first = join(cwd, 'first.docx')
  const replacement = join(cwd, 'replacement')
  await fs.writeFile(replacement, 'another owner')
  let count = 0
  vi.mocked(fs.link).mockImplementation(async (source, destination) => {
    if (++count === 1) return actual.link(source, destination)
    if (state !== 'owned') await fs.unlink(first)
    if (state === 'replaced') await fs.rename(replacement, first)
    throw new Error('second publication failed')
  })
  await expect(publishFiles(scratch, [
    { source: 'source.docx', destination: 'first.docx' },
    { source: 'source.docx', destination: 'second.docx' },
  ], new AbortController().signal)).rejects.toThrow('second publication failed')
  expect(await fs.readFile(join(scratch.directory, 'source.docx'), 'utf8')).toBe('document')
  if (state === 'replaced') expect(await fs.readFile(first, 'utf8')).toBe('another owner')
  else await expect(fs.stat(first)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await fs.readdir(cwd)).filter(name => name.startsWith('.dsh-office-export-'))).toEqual([])
})

it('tolerates already-removed staging directories after final publication', async () => {
  const { cwd, scratch } = await draft()
  vi.mocked(fs.link).mockImplementation(async (source, destination) => {
    await actual.link(source, destination)
    await fs.rm(dirname(String(source)), { recursive: true })
  })
  expect(await publishFiles(scratch, [{ source: 'source.docx', destination: 'final.docx' }], new AbortController().signal)).toEqual([join(cwd, 'final.docx')])
})

it('surfaces cleanup access failures and keeps the owned directory', async () => {
  const { scratch } = await draft()
  vi.mocked(fs.lstat).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(removeScratch(scratch)).rejects.toThrow('denied')
  expect(await fs.readFile(join(scratch.directory, 'source.docx'), 'utf8')).toBe('document')
})

it('admits only one publisher when two generations reach the same destination together', async () => {
  const { cwd, scratch: first } = await draft()
  const second = await createScratch(cwd)
  await fs.writeFile(join(second.directory, 'source.docx'), 'second document')
  const bothReady = Promise.withResolvers<undefined>()
  let count = 0
  vi.mocked(fs.link).mockImplementation(async (source, destination) => {
    if (++count === 2) bothReady.resolve(undefined)
    await bothReady.promise
    return actual.link(source, destination)
  })
  const results = await Promise.allSettled([first, second].map(scratch => publishFiles(scratch,
    [{ source: 'source.docx', destination: 'final.docx' }], new AbortController().signal)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(await fs.readFile(join(cwd, 'final.docx'), 'utf8')).toMatch(/^(?:second )?document$/u)
})

it('recovers both documents when another publisher wins the automatic destination race', async () => {
  const { cwd, scratch: first } = await draft()
  const second = await createScratch(cwd)
  await fs.writeFile(join(second.directory, 'source.docx'), 'second document')
  const bothReady = Promise.withResolvers<undefined>()
  let count = 0
  vi.mocked(fs.link).mockImplementation(async (source, destination) => {
    if (++count === 2) bothReady.resolve(undefined)
    await bothReady.promise
    return actual.link(source, destination)
  })
  const results = await Promise.all([first, second].map(scratch => publishAvailable(scratch, ['source.docx'], new AbortController().signal)))
  expect(results.flat().sort()).toEqual([join(cwd, 'source (1).docx'), join(cwd, 'source.docx')])
  expect((await Promise.all(results.flat().map(path => fs.readFile(path, 'utf8')))).sort()).toEqual(['document', 'second document'])
})
