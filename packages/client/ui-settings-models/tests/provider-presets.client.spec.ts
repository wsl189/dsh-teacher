/** Product provider-preset inventory and endpoint coupling. */
import { describe, expect, it } from 'vitest'
import {
  PRESET_PROVIDER_IDS,
  PROVIDER_SUPPLIERS,
  joinRequestURL,
  providerAccessPreset,
  providerSupplierPreset,
} from '../src/client/provider-presets.ts'

function hasModelSeed(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const candidates: unknown[] = value
  return candidates.some(candidate => (
    typeof candidate === 'object' && candidate !== null
    && 'id' in candidate && typeof candidate.id === 'string'
  ))
}

describe('domestic provider presets', () => {
  it('groups unique access routes under the five product suppliers', () => {
    expect(PROVIDER_SUPPLIERS.map(supplier => supplier.id)).toEqual([
      'zhipu',
      'kimi',
      'deepseek',
      'qwen',
      'minimax',
    ])
    const routes = PROVIDER_SUPPLIERS.flatMap(supplier => supplier.access)
    expect(new Set(routes.map(route => route.provider)).size).toBe(routes.length)
    expect([...PRESET_PROVIDER_IDS]).toEqual(routes.map(route => route.provider))
    for (const route of routes) {
      expect(providerAccessPreset(route.provider)).toBe(route)
      expect(providerSupplierPreset(route.provider)?.access).toContain(route)
      expect(route.settingsPath.at(-1)).toBe(route.settingsNs === 'llm-deepseek'
        ? undefined
        : route.provider)
    }
  })

  it('keeps standard and subscription credentials in independent profiles', () => {
    expect(providerAccessPreset('zhipu-cn')?.settingsPath)
      .not.toEqual(providerAccessPreset('zai-coding-cn')?.settingsPath)
    expect(providerAccessPreset('moonshotai-cn')?.settingsPath)
      .not.toEqual(providerAccessPreset('kimi-coding')?.settingsPath)
    expect(providerAccessPreset('qwen-cn')?.settingsPath)
      .not.toEqual(providerAccessPreset('qwen-coding-cn')?.settingsPath)
    expect(providerAccessPreset('qwen-coding-cn')?.settingsPath)
      .not.toEqual(providerAccessPreset('qwen-token-plan-cn')?.settingsPath)
    expect(providerAccessPreset('minimax-cn')?.settingsPath)
      .not.toEqual(providerAccessPreset('minimax-token-plan-cn')?.settingsPath)
  })

  it('couples each supported protocol to its complete official request URL', () => {
    const endpoint = (provider: string, api: string): string => {
      const protocol = providerAccessPreset(provider)?.protocols.find(item => item.api === api)
      if (protocol === undefined) throw new Error(`missing ${provider}/${api}`)
      return joinRequestURL(protocol.baseURL, protocol.requestPath)
    }
    expect(endpoint('zhipu-cn', 'openai-completions'))
      .toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(endpoint('zhipu-cn', 'anthropic-messages'))
      .toBe('https://open.bigmodel.cn/api/anthropic/v1/messages')
    expect(endpoint('zai-coding-cn', 'anthropic-messages'))
      .toBe('https://open.bigmodel.cn/api/anthropic/v1/messages')
    expect(endpoint('moonshotai-cn', 'openai-completions'))
      .toBe('https://api.moonshot.cn/v1/chat/completions')
    expect(providerAccessPreset('moonshotai-cn')?.protocols.map(protocol => protocol.api))
      .toEqual(['openai-completions'])
    expect(endpoint('kimi-coding', 'anthropic-messages'))
      .toBe('https://api.kimi.com/coding/v1/messages')
    expect(endpoint('deepseek-official', 'openai-completions'))
      .toBe('https://api.deepseek.com/chat/completions')
    expect(endpoint('qwen-cn', 'openai-completions'))
      .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(endpoint('qwen-cn', 'openai-responses'))
      .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/responses')
    expect(endpoint('qwen-cn', 'anthropic-messages'))
      .toBe('https://dashscope.aliyuncs.com/apps/anthropic/v1/messages')
    expect(endpoint('qwen-coding-cn', 'anthropic-messages'))
      .toBe('https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages')
    expect(endpoint('qwen-token-plan-cn', 'openai-responses'))
      .toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses')
    expect(endpoint('minimax-cn', 'anthropic-messages'))
      .toBe('https://api.minimaxi.com/anthropic/v1/messages')
  })

  it('publishes official capability routes for direct image and speech assignment', () => {
    const requestType = (provider: string, type: 'image' | 'speech') =>
      providerAccessPreset(provider)?.requestTypes.find(candidate => candidate.id === type)
    expect(requestType('zhipu-cn', 'image')?.models?.map(model => model.id)).toEqual(['glm-image'])
    expect(requestType('zhipu-cn', 'speech')?.protocols?.map(protocol => (
      joinRequestURL(protocol.baseURL, protocol.requestPath)
    ))).toEqual(['https://open.bigmodel.cn/api/paas/v4/audio/transcriptions'])
    expect(requestType('qwen-cn', 'image')?.models?.map(model => model.id)).toEqual([
      'qwen-image-3.0-pro',
      'qwen-image-3.0',
    ])
    expect(requestType('qwen-cn', 'speech')?.protocols?.map(protocol => (
      joinRequestURL(protocol.baseURL, protocol.requestPath)
    ))).toEqual(['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'])
    expect(requestType('qwen-cn', 'speech')?.models?.map(model => model.id))
      .toEqual(['qwen3-asr-flash'])
    expect(requestType('qwen-token-plan-cn', 'speech')).toBeUndefined()
    expect(requestType('minimax-cn', 'image')?.models?.map(model => model.id)).toEqual(['image-01'])
    expect(providerAccessPreset('minimax-cn')?.requestTypes.map(type => type.id))
      .toEqual(['chat', 'vision', 'image'])
    expect(requestType('minimax-cn', 'speech')).toBeUndefined()
    expect(requestType('moonshotai-cn', 'image')).toBeUndefined()
    expect(requestType('deepseek-official', 'speech')).toBeUndefined()
  })

  it('seeds every product-declared route with a usable protocol, endpoint, and model directory', () => {
    const declared = PROVIDER_SUPPLIERS.flatMap(supplier => supplier.access)
      .filter(route => route.declared === true)
    expect(declared.length).toBeGreaterThan(0)
    for (const route of declared) {
      const profile = route.initialProfile
      expect(profile).toBeDefined()
      expect(profile?.['api']).toBe(route.protocols[0]?.api)
      expect(profile?.['baseURL']).toBe(route.protocols[0]?.baseURL)
      expect(hasModelSeed(profile?.['models'])).toBe(true)
    }
  })

  it('seeds only current official model ids and input capabilities', () => {
    expect(providerAccessPreset('zhipu-cn')?.initialProfile?.['models']).toEqual([
      { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'] },
      { id: 'glm-5-turbo', name: 'GLM-5 Turbo', input: ['text'] },
      { id: 'glm-5v-turbo', name: 'GLM-5V Turbo', input: ['text', 'image'] },
    ])
    expect(providerAccessPreset('minimax-token-plan-cn')?.initialProfile?.['models']).toEqual([
      { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', contextWindow: 204_800, input: ['text'] },
      {
        id: 'MiniMax-M2.7-highspeed',
        name: 'MiniMax-M2.7 Highspeed',
        contextWindow: 204_800,
        input: ['text'],
      },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', contextWindow: 204_800, input: ['text'] },
    ])
  })

  it('joins customized base URLs without duplicate separators', () => {
    expect(joinRequestURL(' https://gateway.example/v1/// ', '///responses'))
      .toBe('https://gateway.example/v1/responses')
    expect(joinRequestURL('   ', '/responses')).toBe('')
  })
})
