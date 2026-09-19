/** Publication preserves originals and cleanup removes only owned scratch. */
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createScratch, publishFiles, removeScratch } from '../src/files.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-office-test-'))
  roots.push(path)
  return path
}

describe('Office scratch files', () => {
  it('publishes all requested formats and removes nested intermediates while keeping originals', async () => {
    const cwd = await workspace()
    await writeFile(join(cwd, 'original.docx'), 'user original')
    const scratch = await createScratch(cwd)
    const sibling = await createScratch(cwd)
    await mkdir(join(scratch.directory, 'screens'))
    await writeFile(join(scratch.directory, 'screens', 'view.png'), 'QA preview')
    await writeFile(join(scratch.directory, 'author.js'), 'authoring script')
    const files = ['report.docx', 'scores.xlsx', 'lesson.pptx'].map(name => ({ source: name, destination: name }))
    for (const file of files) await writeFile(join(scratch.directory, file.source), `final ${file.source}`)
    expect(await publishFiles(scratch, files, new AbortController().signal)).toEqual(files.map(file => join(cwd, file.destination)))
    await removeScratch(scratch)
    expect((await readdir(cwd)).sort()).toEqual([sibling.directory.slice(cwd.length + 1), 'original.docx', ...files.map(file => file.destination)].sort())
    for (const file of files) expect(await readFile(join(cwd, file.destination), 'utf8')).toBe(`final ${file.source}`)
    expect(await readFile(join(cwd, 'original.docx'), 'utf8')).toBe('user original')
    await removeScratch(scratch)
    await removeScratch(sibling)
  })

  it('rejects an existing destination before publishing any file and retains drafts for retry', async () => {
    const cwd = await workspace()
    const scratch = await createScratch(cwd)
    await writeFile(join(scratch.directory, 'report.docx'), 'checked report')
    await writeFile(join(cwd, 'existing.docx'), 'user original')
    await expect(publishFiles(scratch, [
      { source: 'report.docx', destination: 'new.docx' },
      { source: 'report.docx', destination: 'existing.docx' },
    ], new AbortController().signal)).rejects.toThrow('already exists')
    expect(await readdir(cwd)).not.toContain('new.docx')
    expect(await readFile(join(cwd, 'existing.docx'), 'utf8')).toBe('user original')
    expect(await readFile(join(scratch.directory, 'report.docx'), 'utf8')).toBe('checked report')
  })

  it('refuses empty, outside, symlinked and directory sources, duplicate targets, and temporary destinations', async () => {
    const cwd = await workspace()
    const outside = await workspace()
    const scratch = await createScratch(cwd)
    await writeFile(join(cwd, 'original.docx'), 'original')
    await writeFile(join(scratch.directory, 'report.docx'), 'report')
    await writeFile(join(scratch.directory, 'empty.docx'), '')
    await symlink(cwd, join(scratch.directory, 'linked'), 'junction')
    await symlink(outside, join(cwd, 'outside'), 'junction')
    for (const source of ['empty.docx', '..', '../original.docx', 'linked/original.docx']) {
      await expect(publishFiles(scratch, [{ source, destination: 'result.docx' }], new AbortController().signal)).rejects.toThrow('non-empty regular file')
    }
    for (const destination of [join(scratch.directory, 'result.docx'), outside, 'outside/result.docx']) {
      await expect(publishFiles(scratch, [{ source: 'report.docx', destination }], new AbortController().signal)).rejects.toThrow('final destination')
    }
    await expect(publishFiles(scratch, [
      { source: 'report.docx', destination: 'duplicate.docx' },
      { source: 'report.docx', destination: 'duplicate.docx' },
    ], new AbortController().signal)).rejects.toThrow('already exists')
    await removeScratch(scratch)
    expect(await readFile(join(cwd, 'original.docx'), 'utf8')).toBe('original')
    expect(await readdir(outside)).toEqual([])
  })

  it('unlinks a replaced root junction but refuses to remove a replacement real directory', async () => {
    const cwd = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'keep.txt'), 'keep')
    const scratch = await createScratch(cwd)
    await rm(scratch.directory, { recursive: true })
    await symlink(outside, scratch.directory, 'junction')
    await removeScratch(scratch)
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
    const replaced = await createScratch(cwd)
    await rename(replaced.directory, `${replaced.directory}-moved`)
    await mkdir(replaced.directory)
    await writeFile(join(replaced.directory, 'keep.txt'), 'new owner')
    await expect(removeScratch(replaced)).rejects.toThrow('was replaced')
    expect(await readFile(join(replaced.directory, 'keep.txt'), 'utf8')).toBe('new owner')
  })

  it('keeps concurrent generation directories disjoint and publishes one winner for a shared destination', async () => {
    const cwd = await workspace()
    const drafts = await Promise.all([createScratch(cwd), createScratch(cwd)])
    await Promise.all(drafts.map((draft, index) => writeFile(join(draft.directory, 'result.xlsx'), `draft ${index}`)))
    const results = await Promise.allSettled(drafts.map(draft => publishFiles(draft, [{ source: 'result.xlsx', destination: 'final.xlsx' }], new AbortController().signal)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await readFile(join(cwd, 'final.xlsx'), 'utf8')).toMatch(/^draft [01]$/u)
    expect((await readdir(cwd)).filter(name => name.startsWith('.dsh-office-export-'))).toEqual([])
    await Promise.all(drafts.map(removeScratch))
    expect(await readdir(cwd)).toEqual(['final.xlsx'])
  })

  it('refuses canceled publication without deleting its sources', async () => {
    const cwd = await workspace()
    const scratch = await createScratch(cwd)
    await writeFile(join(scratch.directory, 'report.docx'), 'report')
    await expect(publishFiles(scratch, [{ source: 'report.docx', destination: 'report.docx' }], AbortSignal.abort())).rejects.toThrow()
    expect(await readdir(cwd)).toEqual([scratch.directory.slice(cwd.length + 1)])
  })
})
