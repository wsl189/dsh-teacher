import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillPptMaster from '@deepseek-ai/dsh-skill-ppt-master'

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }))

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: readFileMock,
}))

describe('dsh-skill-ppt-master malformed bundle', () => {
  beforeEach(() => {
    readFileMock.mockReset()
  })

  it.each(['name: ppt-master\n', '---\nname: ppt-master\n'])(
    'rejects SKILL.md without complete YAML frontmatter',
    async (source) => {
      readFileMock.mockResolvedValue(source)
      const ctx = new Context()
      const registryFiber = await ctx.plugin(SkillRegistry)
      const providerFiber = await ctx.plugin(SkillPptMaster)

      await expect(ctx.skills.get('ppt-master')).rejects.toThrow(
        'bundled ppt-master SKILL.md must contain YAML frontmatter',
      )
      await providerFiber.dispose()
      await registryFiber.dispose()
    },
  )
})
