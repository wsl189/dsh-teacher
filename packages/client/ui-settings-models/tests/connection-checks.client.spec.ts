/** Connection verification reuses one model and ignores obsolete responses. */

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ModelCheckResult, ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import type { ModelsWire } from '../src/client/store.ts'
import { settingsSchema } from './settings-schema.client.ts'

const SAVED_PROFILE = { apiKeyEnv: 'SAVED_API_KEY', baseURL: 'https://saved.example/v1', api: 'openai-completions' }
const CODING_PROFILE = { apiKeyEnv: 'CODING_API_KEY', baseURL: 'https://saved.example/coding/v1' }

function harness() {
  const checkModel = vi.fn<ModelsWire['session']['checkModel']>(async request => ({
    ok: true, value: { ...request, sessionId: 'diagnostic' as ModelCheckResult['sessionId'] },
  }))
  let groups: ModelProviderGroup[] = [
    { id: 'saved', name: 'Saved Standard', models: [
      { id: 'first', name: 'First', inputModalities: ['text', 'image'] }, { id: 'second', name: 'Second' },
    ] },
    { id: 'saved-coding', name: 'Saved Coding', models: [{ id: 'first', name: 'First' }] },
  ]
  let namespace: SettingsNamespaceView = {
    ns: 'llm-pi-ai', schema: {}, applies: 'live', secrets: [], revision: 1,
    value: { providers: { saved: SAVED_PROFILE, 'saved-coding': CODING_PROFILE } },
  }
  const wire: ModelsWire = {
    credentials: {
      describe: async () => ({ ok: true, value: {
        SAVED_API_KEY: { configured: true, writable: true }, CODING_API_KEY: { configured: true, writable: true },
      } }),
      set: async () => ({ ok: true, value: undefined }), unset: async () => ({ ok: true, value: undefined }),
    },
    llm: {
      listProviders: async () => ({ ok: true, value: [{ id: 'saved', name: 'Saved Standard' }, { id: 'saved-coding', name: 'Saved Coding' }] }),
      listConfigurableProviders: async () => ({ ok: true, value: ['saved', 'saved-coding'].map(provider => ({
        provider, displayName: provider, settingsNs: namespace.ns, settingsPath: ['providers', provider],
      })) }),
      discoverModels: async () => ({ ok: true, value: [] }),
    },
    settings: {
      update: async () => ({ ok: true, value: namespace }),
      replace: async () => ({ ok: true, value: namespace }),
      describe: async () => ({ ok: true, value: { writable: true, hasDocument: false, namespaces: [namespace] } }),
      mutate: async () => ({ ok: true, value: namespace }),
    },
    session: {
      modelCatalog: async () => ({ ok: true, value: {
        default: { provider: 'saved', model: 'first' }, routableProviders: ['saved', 'saved-coding'], failures: [], groups,
      } }),
      checkModel,
    },
  }
  const mirror = new SettingsDescribeMirror(wire)
  const controller = new ModelsSettingsStore(wire, settingsSchema, mirror)
  onTestFinished(() => { controller.dispose() })
  return {
    controller, mirror, checkModel,
    setGroups: (value: ModelProviderGroup[]) => { groups = value },
    setValue: (value: SettingsNamespaceView['value']) => { namespace = { ...namespace, value } },
  }
}

describe('automatic connection verification', () => {
  it('checks one language model per saved connection and performs no checks merely on load', async () => {
    const { controller, checkModel } = harness()
    await controller.load()
    expect(checkModel).not.toHaveBeenCalled()
    await controller.verifyConnection('saved')
    expect(controller.store.getSnapshot().checks.saved).toMatchObject({ model: 'first', status: 'passed' })
    expect(controller.store.getSnapshot().checks['saved-coding']).toBeUndefined()
    await controller.verifyConnection('saved')
    await controller.verifyConnection('saved', true)
    await controller.verifyConnection('saved-coding')
    expect(checkModel.mock.calls.map(([request]) => request)).toEqual([
      { provider: 'saved', model: 'first' }, { provider: 'saved-coding', model: 'first' },
    ])
  })

  it('retains the tested model across catalog additions, reordering, renaming, and budget edits', async () => {
    const { controller, mirror, checkModel, setGroups, setValue } = harness()
    await controller.load()
    await controller.verifyConnection('saved')
    const passed = controller.store.getSnapshot().checks.saved
    setGroups([{ id: 'saved', name: 'Renamed', models: [
      { id: 'new', name: 'New' }, { id: 'second', name: 'Second' }, { id: 'first', name: 'Renamed First' },
    ] }])
    setValue({ providers: { saved: {
      ...SAVED_PROFILE, displayName: 'Renamed',
      models: [{ id: 'new' }, { id: 'second' }, { id: 'first', contextWindow: 128_000, maxTokens: 32_000 }],
      modelOverrides: { second: { contextWindow: 64_000 } },
    }, 'saved-coding': CODING_PROFILE } })
    await mirror.load()
    await controller.load()
    await controller.verifyConnection('saved')
    expect(controller.store.getSnapshot().checks.saved).toEqual(passed)
    expect(checkModel).toHaveBeenCalledTimes(1)
  })

  it.each([
    { baseURL: 'https://changed.example/v1' },
    { api: 'anthropic-messages' },
    { headers: { 'X-Route': 'changed' } },
  ])('rechecks a changed connection without invalidating another access plan: %j', async (change) => {
    const { controller, mirror, checkModel, setValue } = harness()
    await controller.load()
    await controller.verifyConnection('saved')
    await controller.verifyConnection('saved-coding')
    const coding = controller.store.getSnapshot().checks['saved-coding']
    setValue({ providers: { saved: { ...SAVED_PROFILE, ...change }, 'saved-coding': CODING_PROFILE } })
    await mirror.load()
    await controller.load()
    expect(controller.store.getSnapshot().checks.saved).toBeUndefined()
    expect(controller.store.getSnapshot().checks['saved-coding']).toEqual(coding)
    await controller.verifyConnection('saved')
    expect(checkModel).toHaveBeenCalledTimes(3)
    expect(controller.store.getSnapshot().checks.saved?.status).toBe('passed')
  })

  it('cancels a same-state credential replacement and discards late results from the old key', async () => {
    const { controller, checkModel } = harness()
    await controller.load()
    let finish!: (value: Awaited<ReturnType<typeof checkModel>>) => void
    checkModel.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve }))
    const old = controller.verifyConnection('saved')
    expect(controller.store.getSnapshot().checks.saved?.status).toBe('checking')
    await controller.verifyConnection('saved')
    expect(checkModel).toHaveBeenCalledTimes(1)
    controller.invalidateCredential('SAVED_API_KEY')
    expect(checkModel.mock.calls[0]?.[1]?.aborted).toBe(true)
    await controller.verifyConnection('saved')
    const current = controller.store.getSnapshot().checks.saved
    finish({ ok: true, value: { provider: 'saved', model: 'first', sessionId: 'old' as ModelCheckResult['sessionId'] } })
    await old
    expect(controller.store.getSnapshot().checks.saved).toEqual(current)
    expect(current?.status).toBe('passed')
    expect(checkModel).toHaveBeenCalledTimes(2)
  })

  it('selects another model when the tested model is removed and ignores its pending reply', async () => {
    const { controller, checkModel, setGroups } = harness()
    await controller.load()
    let finish!: (value: Awaited<ReturnType<typeof checkModel>>) => void
    checkModel.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve }))
    const old = controller.verifyConnection('saved')
    setGroups([{ id: 'saved', name: 'Saved', models: [{ id: 'second', name: 'Second' }] }])
    await controller.load()
    expect(checkModel.mock.calls[0]?.[1]?.aborted).toBe(true)
    await controller.verifyConnection('saved')
    finish({ ok: true, value: { provider: 'saved', model: 'first', sessionId: 'old' as ModelCheckResult['sessionId'] } })
    await old
    expect(controller.store.getSnapshot().checks.saved).toMatchObject({ model: 'second', status: 'passed' })
    expect(checkModel.mock.calls.map(([request]) => request.model)).toEqual(['first', 'second'])
    setGroups([])
    await controller.load()
    await controller.verifyConnection('saved')
    expect(controller.store.getSnapshot().checks.saved).toBeUndefined()
    expect(checkModel).toHaveBeenCalledTimes(2)
  })

  it('preserves a failed connection until retry without trying the remaining models', async () => {
    const { controller, checkModel } = harness()
    await controller.load()
    checkModel.mockResolvedValueOnce({ ok: false, error: { code: 'MODEL_NOT_FOUND', message: 'Invalid model id', details: {} } })
    await controller.verifyConnection('saved')
    expect(controller.store.getSnapshot().checks.saved).toMatchObject({ model: 'first', status: 'failed', error: 'Invalid model id' })
    await controller.verifyConnection('saved')
    expect(checkModel).toHaveBeenCalledTimes(1)
    await controller.verifyConnection('saved', true)
    expect(controller.store.getSnapshot().checks.saved?.status).toBe('passed')
    expect(checkModel.mock.calls.map(([request]) => request.model)).toEqual(['first', 'first'])
  })

  it('skips media-only connections, absent providers, and missing credentials', async () => {
    const { controller, checkModel, setGroups } = harness()
    setGroups([])
    await controller.load()
    controller.store.update((s) => {
      s.serviceProviders = [{ provider: 'saved', displayName: 'Saved', apiKeyEnv: 'SAVED_API_KEY', userOwned: true, routes: {
        image: { endpoint: 'https://saved.example/images', protocol: 'openai-images', models: [{ id: 'image', name: 'Image' }] },
        speech: { endpoint: 'https://saved.example/audio', protocol: 'openai-transcription', models: [{ id: 'speech', name: 'Speech' }] },
      } }]
    })
    await controller.verifyConnection('saved')
    await controller.verifyConnection('missing')
    setGroups([{ id: 'saved', name: 'Saved', models: [{ id: 'first', name: 'First' }] }])
    await controller.load()
    controller.store.update((s) => {
      s.rows = s.rows.map(row => ({ ...row, credential: { configured: false, writable: true } }))
    })
    await controller.verifyConnection('saved')
    expect(checkModel).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().checks).toEqual({})
  })

  it('cancels an outstanding request on disposal and prevents subsequent checks', async () => {
    const { controller, checkModel } = harness()
    await controller.load()
    checkModel.mockImplementationOnce(async (_request, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    }))
    const pending = controller.verifyConnection('saved')
    controller.dispose()
    await pending
    await controller.verifyConnection('saved')
    expect(checkModel).toHaveBeenCalledTimes(1)
    expect(checkModel.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(controller.store.getSnapshot().checks.saved?.status).toBe('checking')
  })
})
