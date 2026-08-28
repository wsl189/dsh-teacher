/** Concurrency package invariant companion behavior. */

import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as ConcurrencyInvariant from '../src/invariant.ts'

describe('concurrency invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ConcurrencyInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-concurrency', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
