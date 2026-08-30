/**
 * IPC-controlled `dsh web` backend for the Electron desktop distribution.
 * It binds only loopback on an OS-assigned port, reports the ready URL to its
 * parent, and disposes the complete plugin tree before disconnecting.
 * @module @deepseek-ai/dsh/desktop-backend
 */

import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { runProfile } from './profile-boot.ts'

/** Parent-to-backend IPC request. */
export interface DesktopBackendRequest {
  /** The only supported request asks the whole profile tree to dispose. */
  type: 'shutdown'
}

/** Backend-to-parent readiness or fatal-startup message. */
export type DesktopBackendMessage =
  | { type: 'ready'; url: string }
  | { type: 'fatal'; message: string }

/** Whether an unknown IPC value is the supported shutdown request. */
function isShutdownRequest(value: unknown): value is DesktopBackendRequest {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'shutdown'
}

/** Send a typed message when the backend owns an IPC parent channel. */
function send(message: DesktopBackendMessage): void {
  process.send?.(message)
}

/**
 * Boot the desktop Web profile and serve until the parent asks for shutdown.
 * @returns once the profile tree has disposed and the IPC channel is closed.
 */
export async function runDesktopBackend(): Promise<void> {
  if (process.send === undefined) {
    throw new Error('desktop backend must be launched with an IPC channel')
  }

  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [],
    args: ['--no-open', '--port', '0'],
  })
  const server = ctx.get('webServer')
  if (server === undefined) {
    await shutdown.shutdown(1)
    throw new Error('desktop backend started without the webServer service')
  }
  const connection = ctx.get('connection')
  if (connection === undefined) {
    await shutdown.shutdown(1)
    throw new Error('desktop backend started without the connection service')
  }

  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopping ??= shutdown.shutdown(0).finally(() => {
      if (process.connected) process.disconnect()
    })
    return stopping
  }
  process.on('message', (message: unknown) => {
    if (isShutdownRequest(message)) void stop()
  })
  process.once('disconnect', () => { void stop() })
  const baseUrl = `http://127.0.0.1:${String(server.port)}`
  send({ type: 'ready', url: connection.authenticatedUrl(baseUrl) })
}

if (import.meta.main) {
  void runDesktopBackend().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    send({ type: 'fatal', message })
    process.stderr.write(`dsh desktop backend: ${message}\n`)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
