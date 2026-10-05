/** Host converters produce paper previews in private temporary directories. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-office-to-pdf'
import type { OfficeSourceKey } from '@deepseek-ai/dsh-office-to-pdf'
import type {} from '@deepseek-ai/dsh-subprocess'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TeacherPaperFile, TeacherPaperFormat, TeacherPaperResult, TeacherPaperSourceId } from './paper-types.ts'

/** Explicit deployment choices resolved by the workbench settings owner. */
export interface PaperPreviewOptions {
  /** Executable and arguments; {input} and {output} are replaced without a shell. */
  readonly cajCommand: readonly string[]
  readonly timeoutMs: number
  readonly maxBytes: number
}

/**
 * Generate a bounded PDF preview without altering its stored source.
 * @param ctx - Host converter and subprocess services.
 * @param source - saved Word or CAJ original; its identity changes on replacement.
 * @param options - command, deadline, and output limit selected by deployment settings.
 * @param signal - workbench service lifetime.
 * @returns PDF preview or a stable failure; the original is retained in either case.
 */
export async function renderPaperPreview(
  ctx: Context,
  source: TeacherPaperFile & { readonly id: TeacherPaperSourceId; readonly format: TeacherPaperFormat },
  options: PaperPreviewOptions,
  signal: AbortSignal,
): Promise<TeacherPaperResult<TeacherPaperFile>> {
  const bytes = Buffer.from(source.contentBase64, 'base64')
  const name = `${source.name.replace(/\.[^.]+$/u, '')}.pdf`
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)])
  try {
    if (source.format === 'doc' || source.format === 'docx') {
      const office = ctx.get('officeToPdf')
      if (office === undefined) return unavailable()
      const result = await office.convert({
        extension: source.format, priority: 'foreground',
        source: {
          key: brandString<OfficeSourceKey>(`paper:${source.id}`), version: source.id, bytes: bytes.length,
          read: () => Promise.resolve({ bytes, version: source.id }),
        },
      }, deadline)
      return { ok: true, value: { name, mediaType: 'application/pdf', contentBase64: Buffer.from(result.pdf).toString('base64') } }
    }
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined || options.cajCommand.length === 0) return unavailable()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-paper-preview-'))
    try {
      const input = join(directory, 'source.caj')
      const output = join(directory, 'preview.pdf')
      await writeFile(input, bytes, { flag: 'wx', mode: 0o600 })
      const child = subprocess.spawn({
        argv: options.cajCommand.map(argument => argument.replaceAll('{input}', input).replaceAll('{output}', output)),
        cwd: directory, signal: deadline, graceMs: 2_000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 8_192 }, stderr: { maxBytes: 8_192 } },
      })
      const result = await child.done
      deadline.throwIfAborted()
      if (result.exitCode !== 0) throw new Error('CAJ preview converter failed')
      const info = await stat(output)
      if (info.size > options.maxBytes) return { ok: false, error: { code: 'file-too-large', message: 'Paper preview exceeds its byte limit' } }
      const pdf = await readFile(output)
      return { ok: true, value: { name, mediaType: 'application/pdf', contentBase64: pdf.toString('base64') } }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    return missing ? unavailable() : { ok: false, error: { code: 'preview-failed', message: 'The paper preview could not be generated' } }
  }
}

function unavailable(): TeacherPaperResult<never> {
  return { ok: false, error: { code: 'preview-unavailable', message: 'The paper preview converter is unavailable' } }
}
