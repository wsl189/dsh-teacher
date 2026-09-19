/** Office generation scratch ownership, final publication, and turn-end cleanup. */
import type { Context } from '@deepseek-ai/cordis'
import { resolve, sep } from 'node:path'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-tool-present'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { checkScratch, createScratch, ownsOutput, publishAvailable, publishFiles, recoverableFiles, removeScratch, type Scratch } from './files.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Release cached file handles before owned Office files are copied or removed.
     * Listeners must finish writes and close handles; rejection preserves the directory.
     * Subsequent edits may reopen the files until the owner removes the project.
     * @param directory - canonical temporary directory whose allocated identity was verified.
     * @mode serial
     */
    'office-workspace/releasing'(directory: string): Promise<void> | void
  }
}

/** Stable Loader identity. */
export const name = 'office-workspace'
/** Tool execution, current turn, and file policy. */
export const inject = ['tools', 'sessionProjections', 'sandboxPolicy']

interface OwnedScratch {
  turn: number
  paused: boolean
  scratch: Scratch
}

interface SessionWork {
  tail: Promise<void>
  directories: Map<string, OwnedScratch>
}

function enqueue<T>(work: SessionWork, operation: () => Promise<T>): Promise<T> {
  const result = work.tail.then(operation)
  work.tail = result.then(() => undefined, () => undefined)
  return result
}

function univerOutput(name: string, args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  let key: string
  switch (name) {
    case 'univer_new': key = 'file'; break
    case 'univer_screenshot':
    case 'univer_export':
    case 'univer_print_pdf': key = 'output'; break
    case 'univer_resources':
      if (!('action' in args) || args.action !== 'export') return undefined
      key = 'output'
      break
    default: return undefined
  }
  const output = (args as Record<string, unknown>)[key]
  return typeof output === 'string' ? output : undefined
}

/**
 * Register one shared workspace tool for Office and PPT Master generation.
 * Each turn owns only directories allocated through this tool; final files survive cleanup.
 * @param ctx - host services for tool registration and session policy.
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  const sessions = new Map<Session, SessionWork>()
  const workFor = (session: Session): SessionWork => {
    let work = sessions.get(session)
    if (work === undefined) {
      work = { tail: Promise.resolve(), directories: new Map() }
      sessions.set(session, work)
    }
    return work
  }
  const release = async (scratch: Scratch): Promise<void> => {
    if (await checkScratch(scratch)) await ctx.serial('office-workspace/releasing', scratch.directory)
  }
  const clean = async (work: SessionWork, turn?: number, keepPaused = false): Promise<void> => {
    const failures: unknown[] = []
    for (const [directory, owned] of work.directories) {
      if (turn !== undefined && owned.turn !== turn) continue
      if (keepPaused && owned.paused) continue
      try {
        await release(owned.scratch)
        const sources = await recoverableFiles(owned.scratch)
        if (sources.length > 0) {
          const files = await publishAvailable(owned.scratch, sources, new AbortController().signal)
          ctx.logger.warn(`Office exports saved to workspace before temporary cleanup: ${files.join(', ')}`)
        }
        await removeScratch(owned.scratch)
        work.directories.delete(directory)
      } catch (error) {
        failures.push(new Error(`${directory}: ${String(error)}`, { cause: error }))
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, failures.map(String).join('; '))
  }
  ctx.on('deliverables/prepare', async ({ session, cwd, signal: callerSignal }, next) => {
    const selected = await next()
    const work = sessions.get(session)
    if (work === undefined) return selected
    return enqueue(work, async () => {
      const signal = AbortSignal.any([callerSignal, lifetime.signal])
      signal.throwIfAborted()
      const boundary = ctx.sessionProjections.stateOf(session, 'turnBoundary')
      const files = selected.map(file => ({ ...file }))
      const groups = new Map<OwnedScratch, typeof files>()
      for (const file of files) {
        const owned = [...work.directories.values()].find(item => ownsOutput(item.scratch, cwd, file.path))
        if (owned === undefined) {
          if (resolve(cwd, file.path).split(sep).some(part => part.startsWith('.dsh-office-'))) {
            throw new Error('Cannot present an Office temporary file not owned by this session')
          }
          continue
        }
        if (owned.paused || boundary?.openTurnStartSeq == null || owned.turn !== boundary.lastTurn) {
          throw new Error('Resume the paused Office project before presenting its files')
        }
        if (ctx.sandboxPolicy.resolve({ session }).mode === 'read-only') throw new Error('Office generation requires workspace-write file access')
        const group = groups.get(owned) ?? []
        group.push(file)
        groups.set(owned, group)
      }
      for (const [owned, group] of groups) {
        await release(owned.scratch)
        const paths = await publishAvailable(owned.scratch, group.map(file => resolve(cwd, file.path)), signal)
        for (const [index, file] of group.entries()) file.path = paths[index] as string
      }
      return files
    })
  })
  ctx.tools.guard((exec) => {
    const output = univerOutput(exec.name, exec.arguments)
    if (output === undefined) return undefined
    const session = exec.agent?.session
    const cwd = session?.header.cwd
    const work = session === undefined ? undefined : sessions.get(session)
    const boundary = session === undefined ? undefined : ctx.sessionProjections.stateOf(session, 'turnBoundary')
    if (cwd !== undefined && work !== undefined && boundary !== undefined && boundary.openTurnStartSeq !== null) {
      for (const owned of work.directories.values()) {
        if (!owned.paused && owned.turn === boundary.lastTurn && ownsOutput(owned.scratch, cwd, output)) return undefined
      }
    }
    return 'Univer output must be inside an active Office temporary directory owned by this session. '
      + 'Call office_workspace with action="create" and use its returned directory for .univer files, screenshots, resources, PDFs, and Office exports. '
      + 'Resume a paused project before writing. After checks, call office_workspace with action="finish" to publish only the requested final files, including .univer files when requested.'
  })
  ctx.tools.register(defineTool({
    name: 'office_workspace',
    description: 'Manage temporary files for Word, Excel, and PowerPoint generation, including PPT Master. '
      + 'Call create before authoring. Put scripts, screenshots, rendered pages, .univer files, project folders, backups, and draft exports inside the returned directory. '
      + 'After finishing all content and visual checks and waiting for every authoring/rendering process to exit, call finish with only the requested final files. '
      + 'It copies completed files to new workspace destinations and removes all intermediates. Call discard to abandon a draft. '
      + 'Before waiting for user choices across turns, call pause to retain the temporary project; call resume on the next turn before continuing work. '
      + 'Presenting selected temporary files also moves them to the workspace; use the returned paths. '
      + 'At turn end, cancellation, or errors, remaining non-empty DOCX, XLSX, and PPTX exports are recovered to the workspace before cleanup; failed recovery retains the source directory. '
      + 'Paused projects survive a normally completed turn while awaiting the user. '
      + 'Use present on the returned final paths. Never place user originals in temporary directories.',
    parameters: {
      action: { type: 'string', enum: ['create', 'finish', 'discard', 'pause', 'resume'], required: true },
      directory: { type: 'string', description: 'Exact directory returned by create; required for every other action.' },
      files: {
        type: 'array', description: 'Required for finish: checked final files only.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            source: { type: 'string', required: true, description: 'File inside the temporary directory; relative paths start there.' },
            destination: { type: 'string', required: true, description: 'New final path inside the session workspace; parent must exist. Existing files are never replaced.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          directory: { type: 'string', required: true },
          files: { type: 'array', items: { type: 'string' }, required: true },
          cleaned: { type: 'boolean', required: true },
          paused: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined || session.header.cwd === undefined) throw new Error('Office workspace requires an agent with a workspace')
      const boundary = ctx.sessionProjections.stateOf(session, 'turnBoundary')
      if (boundary === undefined || boundary.openTurnStartSeq === null) throw new Error('Office workspace requires an open turn')
      const cwd = session.header.cwd
      const work = workFor(session)
      return enqueue(work, async () => {
        const signal = AbortSignal.any([exec.signal, lifetime.signal])
        signal.throwIfAborted()
        if (ctx.sandboxPolicy.resolve({ session }).mode === 'read-only') throw new Error('Office generation requires workspace-write file access')
        if (args.action === 'create') {
          const scratch = await createScratch(cwd)
          work.directories.set(scratch.directory, { scratch, turn: boundary.lastTurn, paused: false })
          signal.throwIfAborted()
          return { directory: scratch.directory, files: [], cleaned: false, paused: false }
        }
        const owned = args.directory === undefined ? undefined : work.directories.get(args.directory)
        if (owned === undefined) throw new Error('Office temporary directory is not owned by this session')
        if (args.action !== 'resume' && args.action !== 'discard'
          && (owned.turn !== boundary.lastTurn || owned.paused)) throw new Error('Resume the paused Office project before continuing in this turn')
        let files: string[] = []
        switch (args.action) {
          case 'resume':
            if (!owned.paused) throw new Error('Office resume requires a paused temporary project')
            owned.turn = boundary.lastTurn
            owned.paused = false
            return { directory: owned.scratch.directory, files, cleaned: false, paused: false }
          case 'pause':
            owned.paused = true
            return { directory: owned.scratch.directory, files, cleaned: false, paused: true }
          case 'discard':
            await release(owned.scratch)
            break
          case 'finish':
            if (args.files === undefined || args.files.length === 0) throw new Error('Office finish requires final files; use discard to abandon a draft')
            await release(owned.scratch)
            files = await publishFiles(owned.scratch, args.files, signal)
            break
          /* v8 ignore next 2 -- defineTool validates the closed action enum before execution. */
          default: assertNever(args.action)
        }
        await removeScratch(owned.scratch)
        work.directories.delete(owned.scratch.directory)
        return { directory: owned.scratch.directory, files, cleaned: true, paused: false }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Office workspace: ${args.action}`, kind: 'execute' }),
  }))
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const work = sessions.get(session)
    if (work === undefined) return
    void enqueue(work, () => clean(work, event.data.turn, event.data.reason.kind === 'completed')).catch((error: unknown) => {
      ctx.logger.warn(`Office temporary cleanup failed: ${String(error)}`)
    })
  })
  ctx.on('session/disposed', (session) => {
    const work = sessions.get(session)
    if (work === undefined) return
    void enqueue(work, () => clean(work)).then(() => { sessions.delete(session) }).catch((error: unknown) => {
      ctx.logger.warn(`Office temporary cleanup failed: ${String(error)}`)
    })
  })
  ctx.effect(() => async () => {
    lifetime.abort()
    const settled = await Promise.allSettled([...sessions.values()].map(work => enqueue(work, () => clean(work))))
    sessions.clear()
    const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
    if (failures.length > 0) throw new AggregateError(failures, failures.map(String).join('; '))
  })
}
