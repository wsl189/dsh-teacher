/** Office generation scratch ownership, final publication, and turn-end cleanup. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { createScratch, ownsOutput, publishFiles, removeScratch, type Scratch } from './files.ts'

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
  const clean = async (work: SessionWork, turn?: number, keepPaused = false): Promise<void> => {
    for (const [directory, owned] of work.directories) {
      if (turn !== undefined && owned.turn !== turn) continue
      if (keepPaused && owned.paused) continue
      await removeScratch(owned.scratch)
      work.directories.delete(directory)
    }
  }
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
      + 'Temporary directories also expire when the current turn ends, including cancellation and errors; publish final files before ending the turn. '
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
            break
          case 'finish':
            if (args.files === undefined || args.files.length === 0) throw new Error('Office finish requires final files; use discard to abandon a draft')
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
    await Promise.all([...sessions.values()].map(work => enqueue(work, () => clean(work))))
    sessions.clear()
  })
}
