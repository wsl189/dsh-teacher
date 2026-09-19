/** Rebuild the pinned headless Univer archive with GNU tar, patch, and gzip. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = dirname(fileURLToPath(import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dsh-univer-repack-'))
try {
  execFileSync('tar', ['-xzf', join(source, 'dsh-univer-office-0.3.0.tgz'), '-C', temporary])
  const cwd = join(temporary, 'package')
  for (const name of ['runtime.patch', 'headless.patch']) {
    execFileSync('patch', ['--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '-p1', '-i', join(source, name)], { cwd, stdio: 'inherit' })
  }
  for (const path of ['lib/client.js', 'artifacts/viewer']) {
    await rm(join(cwd, path), { recursive: true, force: true })
  }
  const archive = execFileSync('tar', [
    '--sort=name', '--mtime=2026-09-19T00:00:00Z', '--owner=0', '--group=0', '--numeric-owner',
    '-cf', '-', '-C', temporary, 'package',
  ], { maxBuffer: 256 * 1024 * 1024 })
  const output = join(source, 'dsh-univer-office-0.3.0-dsh.8.tgz')
  const { openSync, closeSync } = await import('node:fs')
  const descriptor = openSync(output, 'w')
  try {
    const result = spawnSync('gzip', ['-n', '-9'], { input: archive, stdio: ['pipe', descriptor, 'inherit'] })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`gzip exited with status ${String(result.status)}`)
  } finally {
    closeSync(descriptor)
  }
  process.stdout.write(`${output}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
