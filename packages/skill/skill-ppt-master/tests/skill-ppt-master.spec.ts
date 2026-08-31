import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillPptMaster from '@deepseek-ai/dsh-skill-ppt-master'

const EXPECTED_FILE_COUNT = 12_939
const EXPECTED_BYTE_COUNT = 79_496_215
const EXPECTED_LICENSE_SHA256 = '80cefc234c1ec12a8cece4344f16300c634fa03df7891686fcf979e3828f0921'

async function inventory(path: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      const nested = await inventory(child)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files++
      bytes += (await stat(child)).size
    }
  }
  return { files, bytes }
}

describe('dsh-skill-ppt-master', () => {
  it('registers and disposes the complete bundled presentation skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillPptMaster)
    const skillPath = fileURLToPath(new URL('../assets/ppt-master/SKILL.md', import.meta.url))
    const resourcePath = fileURLToPath(new URL('../assets/ppt-master/', import.meta.url))

    const [summary] = await ctx.skills.list()
    expect(summary).toBeDefined()
    if (summary === undefined) throw new Error('ppt-master provider returned no summary')
    const { description, ...identity } = summary
    expect(description).toContain('generating editable PPTX decks and slides')
    expect(identity).toEqual({
      name: 'ppt-master',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'ppt-master',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    })
    const loaded = await ctx.skills.get('ppt-master')
    expect(loaded).toMatchObject({
      name: 'ppt-master',
      path: skillPath,
      resourceBase: { kind: 'directory', path: resourcePath },
      metadata: {
        version: '6.1.0',
        license: 'MIT',
        official_repository: 'https://github.com/hugohe3/ppt-master',
      },
    })
    expect(loaded?.content).toContain('# PPT Master Skill')
    expect(loaded?.content).not.toContain('name: ppt-master')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('ships the complete attributed upstream 6.1.0 distribution', async () => {
    const root = fileURLToPath(new URL('../assets/ppt-master/', import.meta.url))
    const license = await readFile(join(root, 'LICENSE'))
    const skill = await readFile(join(root, 'SKILL.md'), 'utf8')

    expect(createHash('sha256').update(license).digest('hex')).toBe(EXPECTED_LICENSE_SHA256)
    expect(skill).toContain('version: "6.1.0"')
    expect(skill).toContain('python3 "${SKILL_DIR}/scripts/attribution_guard.py"')
    await expect(readFile(join(root, 'SPONSORS.md'), 'utf8')).resolves.toContain('Sponsor')
    await expect(readFile(join(root, 'SPONSORS_CN.md'), 'utf8')).resolves.toContain('赞助')
    await expect(readFile(join(root, 'scripts/attribution_guard.py'), 'utf8')).resolves.toContain(
      EXPECTED_LICENSE_SHA256,
    )
    expect(await inventory(root)).toEqual({
      files: EXPECTED_FILE_COUNT,
      bytes: EXPECTED_BYTE_COUNT,
    })
  }, 30_000)
})
