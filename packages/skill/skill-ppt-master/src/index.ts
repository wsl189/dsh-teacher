/**
 * Bundled `ppt-master` skill provider.
 *
 * @module @deepseek-ai/dsh-skill-ppt-master
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
  type SkillSummary,
} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  materializeSkill,
  resolveMaterializedSkillOptions,
} from './materialized.ts'

const PROVIDER_NAME = 'ppt-master'
const LOOSE_RESOURCE_PATH = fileURLToPath(new URL('../assets/ppt-master/', import.meta.url))
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = 'AI-driven presentation workflow for generating editable PPTX decks and slides, reconstructing page visuals, creating reusable Brand/Style/Layout/Deck workspaces, filling native PPTX templates, and enhancing finished PPTX files. Use when the user asks to create, generate, reconstruct, regenerate, beautify, redesign, template, fill, or enhance a presentation, PPT, PPTX, slide deck, or courseware — including adding narration or animation to one — requests a presentation-authored narrated/self-running video, or mentions ppt-master.'
const METADATA = {
  version: '6.1.0',
  copyright: 'Copyright (c) 2025-2026 Hugo He',
  license: 'MIT',
  official_repository: 'https://github.com/hugohe3/ppt-master',
  sponsors: ['SPONSORS.md', 'SPONSORS_CN.md'],
} as const
/** Optional desktop archive and materialization directory. */
export interface Config {
  /** Absolute `.tgz` produced by the desktop packager; empty uses package files directly. */
  archivePath?: string
  /** Absolute cache parent for archive materialization. */
  cacheRoot?: string
}

/** Runtime configuration for source and archived distributions. */
export const Config: Schema<Config> = z.object({
  archivePath: z.string().default(''),
  cacheRoot: z.string().default(''),
})

async function loadSkillBody(path: string): Promise<string> {
  const source = await readFile(path, 'utf8')
  const frontmatterEnd = source.indexOf('\n---\n', 4)
  if (!source.startsWith('---\n') || frontmatterEnd < 0) {
    throw new Error('bundled ppt-master SKILL.md must contain YAML frontmatter')
  }
  return source.slice(frontmatterEnd + 5)
}

function createProvider(config: Config): SkillProvider {
  const configuredCacheRoot = config.cacheRoot?.trim() ?? ''
  if (configuredCacheRoot.length > 0 && !isAbsolute(configuredCacheRoot)) {
    throw new Error('skill-ppt-master: cacheRoot must be absolute')
  }
  const materialized = resolveMaterializedSkillOptions(
    config.archivePath ?? '',
    configuredCacheRoot.length === 0
      ? dshHomePath('cache', 'bundled-skills', 'ppt-master')
      : resolve(configuredCacheRoot),
  )
  const looseSummary = {
    name: 'ppt-master',
    description: DESCRIPTION,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: LOOSE_RESOURCE_PATH },
  } as const satisfies SkillSummary
  const archivedSummary = {
    name: 'ppt-master',
    description: DESCRIPTION,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: {
      kind: 'opaque',
      description: 'packaged PPT Master resources materialized when this skill loads',
    },
  } as const satisfies SkillSummary
  const summary = materialized === undefined ? looseSummary : archivedSummary
  const candidate: SkillCandidate = {
    ...summary,
    rank: BUNDLED_SKILL_RANK,
    locator: materialized ?? LOOSE_RESOURCE_PATH,
    ...materialized === undefined ? { path: join(LOOSE_RESOURCE_PATH, 'SKILL.md') } : {},
    metadata: METADATA,
  }
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([candidate]),
    async get(_candidate): Promise<SkillDefinition> {
      const resourcePath = materialized === undefined
        ? LOOSE_RESOURCE_PATH
        : await materializeSkill(materialized)
      const skillPath = join(resourcePath, 'SKILL.md')
      return {
        name: 'ppt-master',
        description: DESCRIPTION,
        invocation: INVOCATION,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: resourcePath },
        content: await loadSkillBody(skillPath),
        path: skillPath,
        metadata: METADATA,
      }
    },
  }
}

/** Cordis plugin name. */
export const name = 'skill-ppt-master'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled `ppt-master` provider on `ctx.skills`. */
export function apply(ctx: Context, config: Config): void {
  const provider = createProvider(config)
  ctx.skills.registerProvider(() => provider)
}
