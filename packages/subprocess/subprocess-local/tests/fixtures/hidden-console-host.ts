/** Isolated Windows host without a console, matching an Electron backend. */

import koffi from 'koffi'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { isNullPtr } from '@deepseek-ai/dsh-win32-process'
import type { NativePtr } from '@deepseek-ai/dsh-win32-process'

const shell = process.argv[2]
if (shell === undefined) throw new Error('expected a PowerShell executable')

const kernel32 = koffi.load('kernel32.dll')
const getConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', []) as () => NativePtr
const freeConsole = kernel32.func('__stdcall', 'FreeConsole', 'int', []) as () => number
if (!isNullPtr(getConsoleWindow()) && freeConsole() === 0) throw new Error('FreeConsole failed')
if (!isNullPtr(getConsoleWindow())) throw new Error('fixture host still has a console')

const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleWindow {
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr window);
}
'@
$window = [ConsoleWindow]::GetConsoleWindow()
[Console]::Out.Write((@{
  visible = [ConsoleWindow]::IsWindowVisible($window)
  input = [Console]::In.ReadToEnd()
} | ConvertTo-Json -Compress))
[Console]::Error.Write('captured-stderr')
exit 37
`
const request: SubprocessSpawnSpec = {
  argv: [shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
  cwd: process.cwd(),
  stdio: {
    stdin: { data: 'captured-stdin' },
    stdout: { maxBytes: 4096 },
    stderr: { maxBytes: 4096 },
  },
  graceMs: 3000,
}
const ctx = new Context()
const fiber = await ctx.plugin(LocalSubprocessRuntime)
try {
  const runtime = ctx.subprocess as LocalSubprocessRuntime
  runtime.internals.spawn = () => { throw new Error('native Windows Job support is required') }
  const handle = runtime.spawn(request)
  const outcome = await handle.done
  await handle.waitForExit()
  process.stdout.write(JSON.stringify({
    outcome,
    stdout: handle.collected.stdout?.readFrom(0).text,
    stderr: handle.collected.stderr?.readFrom(0).text,
  }))
} finally {
  await fiber.dispose()
}
