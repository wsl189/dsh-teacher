import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { c as createTar } from 'tar'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillPptMaster from '@deepseek-ai/dsh-skill-ppt-master'

const roots: string[] = []
const FILES = [
  'SKILL.md',
  'LICENSE',
  'SPONSORS.md',
  'SPONSORS_CN.md',
  'requirements.txt',
  'scripts/attribution_guard.py',
] as const

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function archivedFixture(): Promise<{ archivePath: string; cacheRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ppt-master-archive-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(join(source, 'scripts'), { recursive: true })
  for (const file of FILES) {
    const content = file === 'SKILL.md'
      ? '---\nname: ppt-master\n---\n# PPT Master Skill\n'
      : `${file}\n`
    await writeFile(join(source, file), content)
  }
  const archivePath = join(root, 'ppt-master.tgz')
  await createTar({ cwd: source, file: archivePath, gzip: true, portable: true }, [...FILES])
  return { archivePath, cacheRoot: join(root, 'cache') }
}

describe('archived PPT Master distribution', () => {
  it('keeps discovery cheap and materializes an immutable directory when loaded', async () => {
    const fixture = await archivedFixture()
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillPptMaster, fixture)

    const [summary] = await ctx.skills.list()
    expect(summary?.resourceBase).toEqual({
      kind: 'opaque',
      description: 'packaged PPT Master resources materialized when this skill loads',
    })
    await expect(access(fixture.cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    const loaded = await ctx.skills.get('ppt-master')
    expect(loaded?.content).toContain('# PPT Master Skill')
    expect(loaded?.resourceBase?.kind).toBe('directory')
    if (loaded?.resourceBase?.kind !== 'directory') throw new Error('skill did not materialize a directory')
    await expect(readFile(join(loaded.resourceBase.path, 'LICENSE'), 'utf8')).resolves.toBe('LICENSE\n')
    expect(loaded.path).toBe(join(loaded.resourceBase.path, 'SKILL.md'))
  })

  it('rejects relative archive and cache paths at plugin load', async () => {
    const fixture = await archivedFixture()
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await expect(ctx.plugin(SkillPptMaster, {
      archivePath: 'ppt-master.tgz',
      cacheRoot: fixture.cacheRoot,
    })).rejects.toThrow('archivePath must be absolute')
    await expect(ctx.plugin(SkillPptMaster, {
      archivePath: fixture.archivePath,
      cacheRoot: 'relative-cache',
    })).rejects.toThrow('cacheRoot must be absolute')
  })
})
