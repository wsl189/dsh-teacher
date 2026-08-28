/** Bounded asynchronous mapping behavior. */

import { describe, expect, it, vi } from 'vitest'
import { mapConcurrently } from '../src/index.ts'

describe('mapConcurrently', () => {
  it('bounds in-flight work and projects results in input order', async () => {
    let active = 0
    let maximumActive = 0
    const result = await mapConcurrently([3, 1, 2, 0], 2, async (value) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise(resolve => setTimeout(resolve, value))
      active -= 1
      return value * 2
    })

    expect(maximumActive).toBe(2)
    expect(result).toEqual([6, 2, 4, 0])
  })

  it('stops admission after failure and waits for in-flight work', async () => {
    const firstRelease = Promise.withResolvers<undefined>()
    const secondFailure = Promise.withResolvers<undefined>()
    const failure = new Error('mapper failed')
    const started: number[] = []
    let firstFinished = false
    let failedMapperFinished = false
    let settled = false
    const operation = mapConcurrently([0, 1, 2, 3], 2, async (value) => {
      started.push(value)
      if (value === 0) {
        await firstRelease.promise
        firstFinished = true
        return value
      }
      await secondFailure.promise
      failedMapperFinished = true
      throw failure
    }).finally(() => { settled = true })
    await vi.waitFor(() => { expect(started).toEqual([0, 1]) })

    secondFailure.resolve(undefined)
    await vi.waitFor(() => { expect(failedMapperFinished).toBe(true) })
    expect(settled).toBe(false)
    expect(started).toEqual([0, 1])
    firstRelease.resolve(undefined)

    await expect(operation).rejects.toBe(failure)
    expect(firstFinished).toBe(true)
    expect(started).toEqual([0, 1])
  })

  it('reports the earliest input failure after all admitted failures settle', async () => {
    const firstFailure = new Error('first input failed')
    const secondFailure = new Error('second input failed')
    const releaseFirst = Promise.withResolvers<undefined>()
    const releaseSecond = Promise.withResolvers<undefined>()
    const operation = mapConcurrently([0, 1, 2], 2, async (value) => {
      if (value === 0) {
        await releaseFirst.promise
        throw firstFailure
      }
      await releaseSecond.promise
      throw secondFailure
    })

    releaseSecond.resolve(undefined)
    await Promise.resolve()
    releaseFirst.resolve(undefined)

    await expect(operation).rejects.toBe(firstFailure)
  })

  it('retains undefined results and validates the concurrency limit', async () => {
    await expect(mapConcurrently([1], 0, async value => value)).rejects.toThrow(
      'concurrency must be a positive safe integer',
    )
    await expect(mapConcurrently([1], 1.5, async value => value)).rejects.toThrow(
      'concurrency must be a positive safe integer',
    )
    await expect(mapConcurrently([], 1, async value => value)).resolves.toEqual([])
    await expect(mapConcurrently([undefined], 1, async value => value)).resolves.toEqual([undefined])
  })
})
