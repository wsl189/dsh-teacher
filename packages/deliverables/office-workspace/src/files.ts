/** Private Office scratch directories and exclusive publication of completed files. */
import { constants, lstatSync, realpathSync, type Stats } from 'node:fs'
import { copyFile, link, lstat, mkdtemp, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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

/**
 * Check a tool output against the allocated directory, including existing symlink parents.
 * Missing descendants are allowed; replaced, missing, or inaccessible owners are refused.
 * @param scratch - directory allocated to the calling session.
 * @param cwd - base for workspace-relative tool paths.
 * @param output - requested file or directory, which need not exist yet.
 * @returns whether the resolved output stays inside the original temporary directory.
 */
export function ownsOutput(scratch: Scratch, cwd: string, output: string): boolean {
  try {
    const current = lstatSync(scratch.directory)
    if (!current.isDirectory() || current.isSymbolicLink() || !sameFile(current, scratch.identity)) return false
    let ancestor = resolve(cwd, output)
    const suffix: string[] = []
    while (lstatSync(ancestor, { throwIfNoEntry: false }) === undefined) {
      suffix.unshift(basename(ancestor))
      ancestor = dirname(ancestor)
    }
    const target = resolve(realpathSync(ancestor), ...suffix)
    return target === scratch.directory || inside(scratch.directory, target)
  } catch (_error) {
    // Unreadable paths and dangling symlinks cannot establish ownership.
    return false
  }
}

/**
 * Check that an existing directory still has its allocated identity.
 * @param scratch - directory whose consumers are about to release files or change contents.
 * @returns false for an already removed directory; replacement and access failures throw.
 */
export async function checkScratch(scratch: Scratch): Promise<boolean> {
  const current = await info(scratch.directory)
  if (current === undefined) return false
  if (!current.isDirectory() || current.isSymbolicLink() || !sameFile(current, scratch.identity)) {
    throw new Error('Office temporary directory was replaced; refusing to use or remove its contents')
  }
  return true
}

/**
 * Find recoverable Office exports only inside the allocated directory, without following links.
 * PDF previews, native projects, and other intermediate files are not selected automatically.
 * @param scratch - generation whose unselected exports must survive automatic cleanup.
 * @returns non-empty Word, Excel, and PowerPoint files in stable path order.
 */
export async function recoverableFiles(scratch: Scratch): Promise<string[]> {
  if (!await checkScratch(scratch)) return []
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const entry = await lstat(path)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(path)
      else if (entry.isFile() && entry.size > 0 && /\.(?:docx|xlsx|pptx)$/iu.test(name)) files.push(path)
    }
  }
  await visit(scratch.directory)
  return files
}

/**
 * Move selected files to the workspace root, adding numeric suffixes on name conflicts.
 * Existing files are never replaced, including when another publisher wins a destination race.
 * Sources are removed only after the complete set has been copied successfully.
 * @param scratch - source owner and destination workspace.
 * @param sources - selected regular files inside the owned directory.
 * @param signal - cancellation before the complete publication commits.
 * @returns workspace paths in the same order as sources.
 */
export async function publishAvailable(scratch: Scratch, sources: readonly string[], signal: AbortSignal): Promise<string[]> {
  for (;;) {
    signal.throwIfAborted()
    const outputs: OfficeOutput[] = []
    for (const source of sources) {
      const extension = extname(source)
      const stem = basename(source, extension)
      let destination = join(scratch.workspace, `${stem}${extension}`)
      let suffix = 0
      // Batch names must also remain distinct on case-insensitive filesystems.
      while (outputs.some(file => file.destination.normalize('NFC').toLowerCase() === destination.normalize('NFC').toLowerCase())
        || await info(destination) !== undefined) {
        signal.throwIfAborted()
        destination = join(scratch.workspace, `${stem} (${++suffix})${extension}`)
      }
      outputs.push({ source, destination })
    }
    let files: string[]
    try {
      files = await publishFiles(scratch, outputs, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      continue
    }
    for (const source of new Set(sources)) await unlink(resolve(scratch.directory, source))
    return files
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
  if (!await checkScratch(scratch)) {
    throw Object.assign(new Error('Office temporary directory no longer exists'), { code: 'ENOENT' })
  }
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
      throw Object.assign(new Error(`Office output already exists: ${destination}. Choose a new filename`), { code: 'EEXIST' })
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
