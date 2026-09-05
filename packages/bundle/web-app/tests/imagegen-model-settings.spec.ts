import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface ImageRequest {
  mode: 'text' | 'edit'
  model: string
  prompt: string
  size: string
  quality: string
  n: number
  detail: string
  image?: string
}

interface ImageUpstream {
  apiUrl: string
  apiKey: string
  protocol?: 'openai-images' | 'dashscope-image' | 'minimax-image'
}

interface SettingsReader {
  get(namespace: string): unknown
}

interface ImageSelectionReader {
  currentImageSelection(): { provider: string; model: string } | undefined
}

const require = createRequire(import.meta.url)
const entry = pathToFileURL(require.resolve('@dickpy/dsh-imagegen')).href
const imagegen = await import(entry) as {
  generateImage(
    upstream: ImageUpstream,
    request: ImageRequest,
  ): Promise<{ images: Array<{ b64: string; mime: string }> }>
  resolveModelSettingsImageRoute(
    defaultModel: ImageSelectionReader,
    settings: SettingsReader,
  ): {
    provider: string
    providerName: string
    model: string
    endpoint: string
    protocol: string
    credential: string
  }
  selectedImageRuntimeView(
    defaultModel: ImageSelectionReader,
    settings: SettingsReader,
    credentials: { resolve(ref: string): Promise<{ value: string; source: string } | undefined> },
  ): Promise<{
    channels: Array<{
      id: string
      preset: string
      name: string
      apiUrl: string
      protocol: string
      apiKey: string
      models: Array<{ alias: string; id: string }>
    }>
    defaultChannelId: string
  }>
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

function request(overrides: Partial<ImageRequest> = {}): ImageRequest {
  return {
    mode: 'text',
    model: 'image-model',
    prompt: 'draw a classroom',
    size: '1:1',
    quality: 'auto',
    n: 1,
    detail: '',
    ...overrides,
  }
}

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') {
    throw new TypeError('Expected a JSON request body')
  }
  return JSON.parse(init.body) as unknown
}

function settings(protocol = 'openai-images', endpoint = 'https://images.example/v1/images/generations') {
  return {
    get(namespace: string) {
      if (namespace === 'model-service-settings') {
        return {
          providers: {
            supplier: {
              displayName: 'Supplier API',
              apiKeyEnv: 'SUPPLIER_KEY',
              routes: {
                image: {
                  endpoint,
                  protocol,
                  models: [{ id: 'image-model', name: 'Image Model' }],
                },
              },
            },
          },
        }
      }
      return { providers: {} }
    },
  }
}

const selection = { currentImageSelection: () => ({ provider: 'supplier', model: 'image-model' }) }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bundled image generation unified model settings', () => {
  it('resolves the selected exact route and supplier credential on every task', async () => {
    const serviceSettings = settings('minimax-image', 'https://api.minimax.cn/v1/image_generation')
    expect(imagegen.resolveModelSettingsImageRoute(selection, serviceSettings)).toEqual({
      provider: 'supplier',
      providerName: 'Supplier API',
      model: 'image-model',
      endpoint: 'https://api.minimax.cn/v1/image_generation',
      protocol: 'minimax-image',
      credential: 'SUPPLIER_KEY',
    })
    const resolve = vi.fn(async () => ({ value: 'secret', source: 'test' }))
    await expect(imagegen.selectedImageRuntimeView(selection, serviceSettings, { resolve })).resolves.toEqual({
      channels: [{
        id: 'supplier',
        preset: '',
        name: 'Supplier API',
        apiUrl: 'https://api.minimax.cn/v1/image_generation',
        protocol: 'minimax-image',
        apiKey: 'secret',
        models: [{ alias: 'image-model', id: 'image-model' }],
      }],
      defaultChannelId: 'supplier',
    })
    expect(resolve).toHaveBeenCalledWith('SUPPLIER_KEY')
  })

  it('keeps the selected route paired with the credential snapshot', async () => {
    let current: { provider: string; model: string } | undefined = {
      provider: 'supplier',
      model: 'image-model',
    }
    const liveSelection = { currentImageSelection: () => current }
    const resolve = vi.fn(async () => {
      current = undefined
      return { value: 'secret', source: 'test' }
    })

    await expect(imagegen.selectedImageRuntimeView(liveSelection, settings(), { resolve })).resolves.toMatchObject({
      channels: [{ id: 'supplier', apiKey: 'secret', models: [{ id: 'image-model' }] }],
      defaultChannelId: 'supplier',
    })
  })

  it('posts OpenAI Images to the configured complete endpoint', async () => {
    const fetch = vi.fn(async () => Response.json({ data: [{ b64_json: PNG }] }))
    vi.stubGlobal('fetch', fetch)

    await expect(imagegen.generateImage({
      apiUrl: 'https://images.example/custom/generations',
      apiKey: 'secret',
      protocol: 'openai-images',
    }, request())).resolves.toMatchObject({ images: [{ b64: PNG, mime: 'image/png' }] })

    expect(fetch).toHaveBeenCalledWith('https://images.example/custom/generations', expect.objectContaining({
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
    }))
  })

  it('serializes and parses the synchronous DashScope image protocol', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(jsonBody(init)).toEqual({
        model: 'qwen-image-3.0-pro',
        input: { messages: [{ role: 'user', content: [{ text: 'draw a classroom' }] }] },
        parameters: { prompt_extend: true, n: 1, size: '1024*1024' },
      })
      return Response.json({
        output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${PNG}` }] } }] },
      })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(imagegen.generateImage({
      apiUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      apiKey: 'secret',
      protocol: 'dashscope-image',
    }, request({ model: 'qwen-image-3.0-pro' }))).resolves.toMatchObject({
      images: [{ b64: PNG, mime: 'image/png' }],
    })
  })

  it('serializes and parses the MiniMax image protocol', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(jsonBody(init)).toEqual({
        model: 'image-01',
        prompt: 'draw a classroom',
        aspect_ratio: '16:9',
        response_format: 'base64',
        n: 1,
      })
      return Response.json({ data: { image_base64: [PNG] }, base_resp: { status_code: 0 } })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(imagegen.generateImage({
      apiUrl: 'https://api.minimax.cn/v1/image_generation',
      apiKey: 'secret',
      protocol: 'minimax-image',
    }, request({ model: 'image-01', size: '16:9' }))).resolves.toMatchObject({
      images: [{ b64: PNG, mime: 'image/png' }],
    })
  })

  it('fails before network I/O when selection, adapter, or credential is unavailable', async () => {
    expect(() => imagegen.resolveModelSettingsImageRoute(
      { currentImageSelection: () => undefined }, settings(),
    )).toThrow('尚未选择图像生成模型')
    expect(() => imagegen.resolveModelSettingsImageRoute(selection, settings('openai-completions')))
      .toThrow('没有可用请求适配器')
    await expect(imagegen.selectedImageRuntimeView(selection, settings(), {
      resolve: vi.fn(async () => undefined),
    })).rejects.toThrow('没有可用 API 密钥')
  })
})
