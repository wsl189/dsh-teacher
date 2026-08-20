import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/TeacherWorkbench.module.css', import.meta.url)), 'utf8')
const referenceShell = css.slice(css.indexOf('/* Reference question-cutting shell:'))

describe('question workbench theme styles', () => {
  it('uses DSH appearance tokens instead of a standalone application palette', () => {
    expect(referenceShell).toContain('--legacy-bg: var(--dsw-alias-bg-layer-1)')
    expect(referenceShell).toContain('--legacy-text: var(--dsw-alias-label-primary)')
    expect(referenceShell).toContain('--legacy-orange: var(--dsw-alias-brand-primary-new-colorprimary-new-color)')
    expect(referenceShell).toContain('background: var(--dsw-alias-bg-mask-1)')
    expect(referenceShell).not.toMatch(/\brgba?\(/u)
    expect(new Set(referenceShell.match(/#[\da-f]{3,8}\b/giu) ?? [])).toEqual(new Set(['#fff']))
  })
})
