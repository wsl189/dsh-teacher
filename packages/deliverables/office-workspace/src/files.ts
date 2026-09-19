/** Private Office scratch directories and exclusive publication of completed files. */
import { constants, type Stats } from 'node:fs'
import { copyFile, link, lstat, mkdtemp, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** A newly allocated directory whose identity guards later cleanup. */
export interface Scratch {
  /** Canonical session workspace. */
  workspace: string
  /** Private directory holding only this generation's intermediate files. */
  directory: string
  /** Filesystem identity recorded at allocation. */
  identity: Stats
}

/** One checked final file and its requested destination. */
export interface OfficeOutput {
  /** Source file inside the generation directory; relative paths start there. */
  source: string
  /** New final file inside the session workspace; relative paths start there. */
  destination: string
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function info(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Allocate an exclusive private directory inside the existing session workspace.
 * @param cwd - absolute session workspace.
 * @returns owned directory and its original filesystem identity.
 */
export async function createScratch(cwd: string): Promise<Scratch> {
  const workspace = await realpath(cwd)
  const directory = await mkdtemp(join(workspace, '.dsh-office-'))
  return { workspace, directory, identity: await lstat(directory) }
}

async function checkScratch(scratch: Scratch): Promise<void> {
  const current = await lstat(scratch.directory)
  if (!current.isDirectory() || current.isSymbolicLink() || !sameFile(current, scratch.identity)) {
    throw new Error('Office temporary directory was replaced; refusing to use or remove its contents')
  }
}

async function removeTree(path: string): Promise<void> {
  const entry = await info(path)
  if (entry === undefined) return
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    await unlink(path)
    return
  }
  for (const name of await readdir(path)) await removeTree(join(path, name))
  await rmdir(path)
}

/**
 * Remove only the allocated directory, unlinking nested symlinks and junctions.
 * @param scratch - directory still owned by this generation.
 */
export async function removeScratch(scratch: Scratch): Promise<void> {
  const current = await info(scratch.directory)
  if (current === undefined) return
  if (current.isSymbolicLink()) {
    await unlink(scratch.directory)
    return
  }
  await checkScratch(scratch)
  await removeTree(scratch.directory)
}

/**
 * Publish a checked set of regular files without replacing any existing path.
 * Failed publication rolls back this call's destinations and retains scratch for retry.
 * @param scratch - source owner and destination workspace.
 * @param outputs - final files selected after content and visual checks.
 * @param signal - cancellation before publication commits.
 * @returns canonical paths of the completed, independently copied files.
 */
export async function publishFiles(scratch: Scratch, outputs: readonly OfficeOutput[], signal: AbortSignal): Promise<string[]> {
  await checkScratch(scratch)
  const selected: Array<{ source: string; destination: string }> = []
  for (const output of outputs) {
    signal.throwIfAborted()
    const sourcePath = resolve(scratch.directory, output.source)
    const source = await realpath(sourcePath)
    const entry = await lstat(sourcePath)
    if (!inside(scratch.directory, source) || !entry.isFile() || entry.size === 0) {
      throw new Error('Office final source must be a non-empty regular file inside its temporary directory')
    }
    const requested = resolve(scratch.workspace, output.destination)
    const parent = await realpath(dirname(requested))
    const destination = join(parent, basename(requested))
    if (!inside(scratch.workspace, destination) || inside(scratch.directory, destination)
      || relative(scratch.workspace, destination).split(sep).some(part => part.startsWith('.dsh-office-'))) {
      throw new Error('Office final destination must be outside temporary directories and inside the session workspace')
    }
    if (selected.some(file => file.destination === destination) || await info(destination) !== undefined) {
      throw new Error(`Office output already exists: ${destination}. Choose a new filename`)
    }
    selected.push({ source, destination })
  }
  const published: Array<{ path: string; identity: Stats }> = []
  try {
    for (const file of selected) {
      signal.throwIfAborted()
      const staging = await mkdtemp(join(dirname(file.destination), '.dsh-office-export-'))
      try {
        const staged = join(staging, 'output')
        await copyFile(file.source, staged, constants.COPYFILE_EXCL)
        const identity = await lstat(staged)
        signal.throwIfAborted()
        // A sibling hard link publishes complete bytes atomically and refuses existing destinations.
        await link(staged, file.destination)
        published.push({ path: file.destination, identity })
      } finally {
        await removeTree(staging)
      }
    }
    signal.throwIfAborted()
    return published.map(file => file.path)
  } catch (error) {
    for (const file of published) {
      const current = await info(file.path)
      if (current !== undefined && sameFile(current, file.identity)) await unlink(file.path)
    }
    throw error
  }
}
