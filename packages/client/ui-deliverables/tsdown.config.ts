import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-deliverables',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { client: { alias: { fflate: 'fflate/browser' } } },
)
