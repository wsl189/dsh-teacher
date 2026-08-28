/**
 * Bounded asynchronous work admission with ordered result projection.
 * @module @deepseek-ai/dsh-concurrency
 */

/**
 * Map inputs with a fixed upper bound on in-flight work.
 *
 * Results retain input order. After a mapper rejects, no new input is admitted,
 * every mapper already in flight is allowed to settle, and the rejection with
 * the smallest input index is rethrown.
 *
 * @param inputs - input values in result order.
 * @param concurrency - positive safe-integer upper bound on simultaneous mapper calls.
 * @param mapper - asynchronous operation for one admitted input.
 * @returns one result per input in the same order as `inputs`.
 */
export async function mapConcurrently<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError('concurrency must be a positive safe integer')
  }
  const outputs = new Array<Output>(inputs.length)
  const failures: Array<{ readonly index: number; readonly error: unknown }> = []
  let nextIndex = 0
  let stopped = false
  const workers = Array.from({ length: Math.min(inputs.length, concurrency) }, async () => {
    while (!stopped) {
      const index = nextIndex
      nextIndex += 1
      if (index >= inputs.length) return
      const input = inputs[index] as Input
      try {
        outputs[index] = await mapper(input)
      } catch (error) {
        failures.push({ index, error })
        stopped = true
      }
    }
  })
  await Promise.all(workers)
  const firstFailure = failures.sort((left, right) => left.index - right.index)[0]
  if (firstFailure !== undefined) throw firstFailure.error
  return outputs
}
