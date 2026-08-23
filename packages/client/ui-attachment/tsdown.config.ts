import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-attachment',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {
    clientAlias: {
      fflate: 'fflate/browser',
      jszip: 'jszip/dist/jszip.min.js',
    },
  },
)
