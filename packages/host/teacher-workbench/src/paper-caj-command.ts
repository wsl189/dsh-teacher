/** Resolve the default CAJ command from the packaged Windows engine or the Host PATH. */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Select the packaged Windows converter when present, otherwise the installed command.
 * @returns the explicit default command; deployment settings may replace the complete argv.
 */
export function defaultPaperCajCommand(): string[] {
  const executable = fileURLToPath(new URL('../third-party/caj2pdf/bin/win32-x64/caj2pdf.exe', import.meta.url))
  const mutool = fileURLToPath(new URL('../third-party/caj2pdf/bin/win32-x64/mutool.exe', import.meta.url))
  return process.platform === 'win32' && existsSync(executable)
    ? [executable, 'convert', '{input}', '-o', '{output}', '-m', mutool]
    : ['caj2pdf', 'convert', '{input}', '-o', '{output}']
}
