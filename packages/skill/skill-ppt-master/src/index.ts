/**
 * Bundled `ppt-master` skill provider.
 *
 * @module @deepseek-ai/dsh-skill-ppt-master
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
  type SkillSummary,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'ppt-master'
const SKILL_BODY_URL = new URL('../assets/ppt-master/SKILL.md', import.meta.url)
const SKILL_PATH = fileURLToPath(SKILL_BODY_URL)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/ppt-master/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = 'AI-driven presentation workflow for generating editable PPTX decks and slides, reconstructing page visuals, creating reusable Brand/Style/Layout/Deck workspaces, filling native PPTX templates, and enhancing finished PPTX files. Use when the user asks to create, generate, reconstruct, regenerate, beautify, redesign, template, fill, or enhance a presentation, PPT, PPTX, slide deck, or courseware — including adding narration or animation to one — requests a presentation-authored narrated/self-running video, or mentions ppt-master.'
const METADATA = {
  version: '6.1.0',
  copyright: 'Copyright (c) 2025-2026 Hugo He',
  license: 'MIT',
  official_repository: 'https://github.com/hugohe3/ppt-master',
  sponsors: ['SPONSORS.md', 'SPONSORS_CN.md'],
} as const
const SUMMARY = {
  name: 'ppt-master',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
} as const satisfies SkillSummary
const CANDIDATE: SkillCandidate = {
  ...SUMMARY,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
  path: SKILL_PATH,
  metadata: METADATA,
}

async function loadSkillBody(): Promise<string> {
  const source = await readFile(SKILL_BODY_URL, 'utf8')
  const frontmatterEnd = source.indexOf('\n---\n', 4)
  if (!source.startsWith('---\n') || frontmatterEnd < 0) {
    throw new Error('bundled ppt-master SKILL.md must contain YAML frontmatter')
  }
  return source.slice(frontmatterEnd + 5)
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      ...SUMMARY,
      content: await loadSkillBody(),
      path: SKILL_PATH,
      metadata: METADATA,
    }
  },
}

/** Cordis plugin name. */
export const name = 'skill-ppt-master'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled `ppt-master` provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
