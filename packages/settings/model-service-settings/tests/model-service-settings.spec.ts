import { describe, expect, it, vi } from 'vitest'
import {
  Config,
  assertModelServiceSettings,
  findModelServiceRoute,
  type ModelServiceSettings,
} from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

const settings = (): ModelServiceSettings => ({
  providers: {
    'zhipu-cn': {
      displayName: 'Zhipu',
      apiKeyEnv: 'ZHIPU_CN_API_KEY',
      routes: {
        speech: {
          endpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions',
          protocol: 'openai-audio-transcriptions',
          models: [{ id: 'glm-asr-2512', name: 'GLM-ASR-2512' }],
        },
      },
    },
  },
})

describe('model-service settings', () => {
  it('validates and resolves an exact typed route', () => {
    const parsed = Config(settings())
    expect(() => { assertModelServiceSettings(parsed) }).not.toThrow()
    expect(findModelServiceRoute(parsed, 'zhipu-cn', 'glm-asr-2512', 'speech')).toEqual({
      provider: parsed.providers['zhipu-cn'],
      route: parsed.providers['zhipu-cn']?.routes?.speech,
      model: { id: 'glm-asr-2512', name: 'GLM-ASR-2512' },
    })
    expect(findModelServiceRoute(parsed, 'zhipu-cn', 'glm-asr-2512', 'image')).toBeUndefined()
  })

  it('rejects mismatched protocols, unsafe endpoints, and ambiguous model ids', () => {
    const wrongProtocol = settings()
    wrongProtocol.providers['zhipu-cn']!.routes!.speech!.protocol = 'openai-images'
    expect(() => { assertModelServiceSettings(wrongProtocol) }).toThrow(/cannot use protocol/)

    const unsafeEndpoint = settings()
    unsafeEndpoint.providers['zhipu-cn']!.routes!.speech!.endpoint = 'http://example.com/transcriptions'
    expect(() => { assertModelServiceSettings(unsafeEndpoint) }).toThrow(/must use HTTPS/)

    const duplicate = settings()
    duplicate.providers['zhipu-cn']!.routes!.image = {
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
      protocol: 'openai-images',
      models: [{ id: 'glm-asr-2512' }],
    }
    expect(() => { assertModelServiceSettings(duplicate) }).toThrow(/repeats model/)
  })

  it('registers its explained empty invariant companion', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, installer: () => void) => {
      installer()
      return dispose
    })
    await expect(invariant.apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-model-service-settings', expect.any(Function))
  })
})
