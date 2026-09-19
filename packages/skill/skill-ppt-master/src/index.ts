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
  version: '6.4.0',
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
    async get(_candidate, { cwd }): Promise<SkillDefinition> {
      const resourcePath = materialized === undefined
        ? LOOSE_RESOURCE_PATH
        : await materializeSkill(materialized)
      const skillPath = join(resourcePath, 'SKILL.md')
      const body = await loadSkillBody(skillPath)
      const content = cwd === undefined ? body : `${body}
## DSH project workspace

Current session workspace (JSON-encoded path): ${JSON.stringify(cwd)}.

Before creating a presentation, call \`office_workspace\` with \`action: "create"\`. Put every project, script, virtual environment, asset, screenshot, rendered page, report, backup, and draft export inside its returned directory. Temporary directories such as /tmp may be isolated per command or tool; the returned workspace directory is shared across calls.

For every \`project_manager.py init\` call, explicitly pass \`--dir\` with that temporary directory or a directory inside it. Quote paths for the active shell. If \`office_workspace\` is unavailable, allocate one unique temporary subdirectory under the session workspace and remove only that directory after copying the requested final files out.

Keep \`SKILL_DIR\` as the skill resource directory. The script's default project directory is derived from the installed skill's path; changing the shell working directory does not select this workspace.

Keep project-local exports inside the temporary directory until all required checks, including the attribution guard and visual review, finish. Wait for every authoring and rendering process to exit. Then call \`office_workspace\` with \`action: "finish"\`, the returned \`directory\`, and \`files: [{ source, destination }]\` for only the requested final deliverables. It publishes the files without overwriting existing destinations and removes the project and all intermediates. Present only the returned final paths. Include source projects or preview files only when explicitly requested. Never move user originals into the temporary directory.

Before a required user confirmation that spans turns, call \`office_workspace\` action \`pause\`; call \`resume\` with that directory on the next turn before continuing. Paused projects survive a normal waiting turn. Final deliverables belong in the session workspace, outside temporary directories. Presenting a managed temporary file moves it to the workspace; use the returned path. At turn end, cancellation, or errors, remaining Office exports are recovered before cleanup. Use \`finish\` to select the checked finals or \`discard\` to abandon a draft. Do not leave background processes writing into a temporary directory.
`
      return {
        name: 'ppt-master',
        description: DESCRIPTION,
        invocation: INVOCATION,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: resourcePath },
        content,
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
