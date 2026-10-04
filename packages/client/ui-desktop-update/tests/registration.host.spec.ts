import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
describe('ui-desktop-update Host entry', () => {
  it('keeps the Loader seat inert', () => { expect(apply).not.toThrow() })
})
