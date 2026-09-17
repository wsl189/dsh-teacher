import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillPptMaster from '@deepseek-ai/dsh-skill-ppt-master'

const EXPECTED_FILE_COUNT = 12_981
const EXPECTED_BYTE_COUNT = 83_654_741
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
      path: skillPath,
      resourceBase: { kind: 'directory', path: resourcePath },
    })
    const loaded = await ctx.skills.get('ppt-master')
    expect(loaded).toMatchObject({
      name: 'ppt-master',
      path: skillPath,
      resourceBase: { kind: 'directory', path: resourcePath },
      metadata: {
        version: '6.4.0',
        license: 'MIT',
        official_repository: 'https://github.com/hugohe3/ppt-master',
      },
    })
    expect(loaded?.content).toContain('# PPT Master Skill')
    expect(loaded?.content).not.toContain('name: ppt-master')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('adds each session workspace while preserving the upstream instructions and resource directory', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillPptMaster)
      const skillPath = fileURLToPath(new URL('../assets/ppt-master/SKILL.md', import.meta.url))
      const source = await readFile(skillPath, 'utf8')
      const upstreamBody = source.replace(/^---\n[\s\S]*?\n---\n/u, '')
      const baseline = await ctx.skills.get('ppt-master')
      expect(baseline?.content).toBe(upstreamBody)

      const [first, second] = await Promise.all([
        ctx.skills.get('ppt-master', { cwd: '/workspaces/presentation draft' }),
        ctx.skills.get('ppt-master', { cwd: String.raw`C:\Workspaces\Presentation review` }),
      ])
      expect(first?.content.startsWith(upstreamBody)).toBe(true)
      expect(second?.content.startsWith(upstreamBody)).toBe(true)
      expect(first?.resourceBase).toEqual(baseline?.resourceBase)
      expect(second?.resourceBase).toEqual(baseline?.resourceBase)
      expect(second?.content).toContain(String.raw`"C:\\Workspaces\\Presentation review"`)
      expect(second?.content).not.toContain('/workspaces/presentation draft')
      expect(first?.content).not.toContain('Presentation review')
      expect(first?.content.slice(upstreamBody.length)).toMatchInlineSnapshot(`
        "
        ## DSH project workspace

        Current session workspace (JSON-encoded path): "/workspaces/presentation draft".

        Temporary directories such as /tmp may be isolated per command or tool. Keep reusable scripts, virtual environments, and other files needed across calls or tools under the session workspace.

        For every \`project_manager.py init\` call, explicitly pass \`--dir\` with the absolute workspace path or a directory inside it. Use another project location only when the user explicitly requests it and the session permits writing there. Quote paths for the active shell.

        Keep \`SKILL_DIR\` as the skill resource directory. The script's default project directory is derived from the installed skill's path; changing the shell working directory does not select this workspace.

        Keep the exporter's default project-local output to preserve its backup behavior, unless the user explicitly requests a different output path. Follow the selected workflow and its required checks, including the attribution guard.
        "
      `)
      expect((await ctx.skills.get('ppt-master'))?.content).toBe(upstreamBody)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ships the complete attributed upstream 6.4.0 distribution', async () => {
    const root = fileURLToPath(new URL('../assets/ppt-master/', import.meta.url))
    const license = await readFile(join(root, 'LICENSE'))
    const skill = await readFile(join(root, 'SKILL.md'), 'utf8')

    expect(createHash('sha256').update(license).digest('hex')).toBe(EXPECTED_LICENSE_SHA256)
    expect(skill).toContain('version: "6.4.0"')
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
