/** IPC readiness handling for the desktop backend child process. */

import type { ChildProcess } from 'node:child_process'

/** Backend-to-parent readiness or fatal-startup message. */
export type BackendMessage =
  | { type: 'ready'; url: string }
  | { type: 'fatal'; message: string }

/** Warning sink for a bounded backend stop. */
export interface BackendStopLogger {
  /** Report a graceful-stop timeout or IPC delivery failure. */
  warn(message: string): void
}

/** Validate a child IPC payload and its private-loopback URL. */
export function parseBackendMessage(value: unknown): BackendMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'fatal' && typeof candidate.message === 'string') {
    return { type: 'fatal', message: candidate.message }
  }
  if (candidate.type !== 'ready' || typeof candidate.url !== 'string') return undefined
  let url: URL
  try {
    url = new URL(candidate.url)
  } catch {
    return undefined
  }
  const tokens = url.searchParams.getAll('token')
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === ''
    || url.pathname !== '/' || url.hash !== '' || tokens.length !== 1
    || !/^[A-Za-z0-9_-]{43}$/u.test(tokens[0] ?? '')) return undefined
  return { type: 'ready', url: url.href }
}

/**
 * Wait for explicit backend readiness without imposing a wall-clock deadline.
 * A first installed launch may spend an unbounded but observable interval in
 * antivirus scanning or plugin initialization; process failure and exit remain
 * terminal and settle this wait immediately.
 * @param child - forked desktop backend with an IPC channel.
 * @returns the validated private-loopback launch URL.
 */
export function waitForBackendReady(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      child.off('error', onError)
      child.off('exit', onExit)
      child.off('message', onMessage)
      action()
    }
    const onError = (error: Error): void => { settle(() => { reject(error) }) }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      settle(() => { reject(new Error(`desktop backend exited before ready (${String(code ?? signal)})`)) })
    }
    const onMessage = (value: unknown): void => {
      const message = parseBackendMessage(value)
      if (message === undefined) return
      if (message.type === 'fatal') {
        settle(() => { reject(new Error(message.message)) })
        return
      }
      settle(() => { resolve(message.url) })
    }
    child.once('error', onError)
    child.once('exit', onExit)
    child.on('message', onMessage)
  })
}

/**
 * Ask the backend to dispose its tree, then terminate it when the caller's
 * latency bound expires.
 * @param child - live desktop backend with an IPC channel.
 * @param timeoutMs - maximum graceful-disposal interval before termination.
 * @param logger - warning sink for forced or undeliverable stops.
 * @returns after the child exits or reports a process error.
 */
export function stopBackendProcess(
  child: ChildProcess,
  timeoutMs: number,
  logger: BackendStopLogger,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn('desktop backend did not stop in time; terminating it')
      child.kill()
    }, timeoutMs)
    const done = (): void => {
      clearTimeout(timeout)
      child.off('exit', done)
      child.off('error', done)
      resolve()
    }
    child.once('exit', done)
    child.once('error', done)
    child.send({ type: 'shutdown' }, (error) => {
      if (error !== null) {
        logger.warn(`could not request desktop backend shutdown: ${error.message}`)
        child.kill()
      }
    })
  })
}
