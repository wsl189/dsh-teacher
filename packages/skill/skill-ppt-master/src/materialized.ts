/** Lazy materialization for the desktop's archived PPT Master distribution. */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import { x as extractTar } from 'tar'

const COMPLETE_MARKER = '.complete'
const REQUIRED_FILES = [
  'SKILL.md',
  'LICENSE',
  'SPONSORS.md',
  'SPONSORS_CN.md',
  'requirements.txt',
  'scripts/attribution_guard.py',
] as const

const activeMaterializations = new Map<string, Promise<string>>()

/** Inputs for one immutable packaged-skill archive. */
export interface MaterializedSkillOptions {
  /** Absolute trusted archive path supplied by the desktop launcher. */
  readonly archivePath: string
  /** Absolute directory that owns content-addressed materializations. */
  readonly cacheRoot: string
}

/** Validate and normalize archive-backed provider configuration at plugin load. */
export function resolveMaterializedSkillOptions(
  archivePath: string,
  cacheRoot: string,
): MaterializedSkillOptions | undefined {
  const archive = archivePath.trim()
  if (archive.length === 0) return undefined
  if (!isAbsolute(archive)) throw new Error('skill-ppt-master: archivePath must be absolute')
  if (!isAbsolute(cacheRoot)) throw new Error('skill-ppt-master: cacheRoot must be absolute when archivePath is set')
  if (!existsSync(archive)) throw new Error(`skill-ppt-master: archive does not exist: ${archive}`)
  return { archivePath: resolve(archive), cacheRoot: resolve(cacheRoot) }
}

/** Compute a stable archive identity without retaining the archive in memory. */
async function archiveDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), new Writable({
    write(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback()
    },
  }))
  return hash.digest('hex')
}

/** Require the minimum attributed distribution before publishing a cache entry. */
async function validateMaterializedSkill(path: string, digest: string): Promise<void> {
  for (const file of REQUIRED_FILES) await access(join(path, file))
  const marker = await readFile(join(path, '..', COMPLETE_MARKER), 'utf8')
  if (marker !== `${digest}\n`) {
    throw new Error(`skill-ppt-master: cached archive ${basename(path)} has an invalid completion marker`)
  }
}

/** Extract one archive into an atomic content-addressed cache entry. */
async function extractMaterializedSkill(options: MaterializedSkillOptions): Promise<string> {
  const digest = await archiveDigest(options.archivePath)
  const destination = join(options.cacheRoot, digest)
  const payload = join(destination, 'payload')
  try {
    await validateMaterializedSkill(payload, digest)
    return payload
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }

  await mkdir(options.cacheRoot, { recursive: true })
  const temporary = await mkdtemp(join(options.cacheRoot, '.ppt-master-'))
  const temporaryPayload = join(temporary, 'payload')
  try {
    await mkdir(temporaryPayload)
    await extractTar({
      cwd: temporaryPayload,
      file: options.archivePath,
      preservePaths: false,
      strict: true,
    })
    for (const file of REQUIRED_FILES) await access(join(temporaryPayload, file))
    await writeFile(join(temporary, COMPLETE_MARKER), `${digest}\n`, { flag: 'wx' })
    try {
      await rename(temporary, destination)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY'))) {
        throw error
      }
      await validateMaterializedSkill(payload, digest)
    }
    return payload
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/**
 * Materialize a packaged skill once per archive and share concurrent callers.
 * @param options - trusted archive and cache paths resolved at plugin load.
 * @returns the absolute directory containing the complete skill distribution.
 */
export function materializeSkill(options: MaterializedSkillOptions): Promise<string> {
  const key = `${options.archivePath}\0${options.cacheRoot}`
  let operation = activeMaterializations.get(key)
  if (operation !== undefined) return operation
  operation = extractMaterializedSkill(options).catch((error: unknown) => {
    activeMaterializations.delete(key)
    throw error
  })
  activeMaterializations.set(key, operation)
  return operation
}
