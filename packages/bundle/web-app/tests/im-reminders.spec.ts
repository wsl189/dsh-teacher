/** Exercise the shipped IM reminder bridge with synthetic platform transports. */

import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('@xmanrui/dsh-im'))
const moduleUrl = (path: string) => pathToFileURL(join(root, path)).href

interface Controller {
  initialize(): Promise<unknown>
  status(): { bots: readonly { botId: string; connected: boolean; bot: { name: string } }[] }
  sendConnectionTest(botId: string, text?: string): Promise<unknown>
  close(): Promise<void>
}

interface Gateway {
  listTargets(): Promise<readonly { channel: string; botId: string; label: string; connected: boolean }[]>
  send(request: { channel: string; botId: string; text: string }): Promise<void>
}

const { createMobileNotifications } = await import(moduleUrl('plugin-src/host/mobile-notifications.mjs')) as {
  createMobileNotifications: () => {
    gateway: Gateway
    register(channel: string, controller: Pick<Controller, 'status' | 'sendConnectionTest'>): () => void
  }
}

const CHANNELS = [
  ['qq', 'qq/qq-controller.mjs', 'QqController'],
  ['feishu', 'feishu/multi-bot-controller.mjs', 'MultiBotDshFeishuController'],
  ['weixin', 'weixin/weixin-controller.mjs', 'WeixinController'],
  ['dingtalk', 'dingtalk/dingtalk-controller.mjs', 'DingtalkController'],
  ['wecom', 'wecom/wecom-controller.mjs', 'WecomController'],
  ['slack', 'slack/slack-controller.mjs', 'SlackController'],
  ['whatsapp', 'whatsapp/whatsapp-controller.mjs', 'WhatsappController'],
  ['telegram', 'shared/token-bot-controller.mjs', 'TokenBotController'],
  ['discord', 'shared/token-bot-controller.mjs', 'TokenBotController'],
] as const

describe('bundled IM workbench reminders', () => {
  it('projects only bot identities and reflects live changes and registration disposal', async () => {
    const notifications = createMobileNotifications()
    const bot = { botId: 'qq-course', connected: false, bot: { name: '课程助手', secret: 'private-secret' }, route: 'private-user' }
    const controller = { status: () => ({ bots: [bot] }), sendConnectionTest: vi.fn() }
    const unregister = notifications.register('qq', controller)
    await expect(notifications.gateway.listTargets()).resolves.toEqual([
      { channel: 'qq', botId: 'qq-course', label: '课程助手 · qq-course', connected: false },
    ])
    bot.connected = true
    bot.bot.name = '课程提醒'
    expect(await notifications.gateway.listTargets()).toEqual([
      { channel: 'qq', botId: 'qq-course', label: '课程提醒 · qq-course', connected: true },
    ])
    const replacement = { status: () => ({ bots: [] }), sendConnectionTest: vi.fn() }
    const removeReplacement = notifications.register('qq', replacement)
    unregister()
    await notifications.gateway.send({ channel: 'qq', botId: 'qq-course', text: '提醒' })
    expect(replacement.sendConnectionTest).toHaveBeenCalledWith('qq-course', '提醒')
    expect(controller.sendConnectionTest).not.toHaveBeenCalled()
    removeReplacement()
    await expect(notifications.gateway.listTargets()).resolves.toEqual([])
    await expect(notifications.gateway.send({ channel: 'qq', botId: 'qq-course', text: '提醒' }))
      .rejects.toThrow('Reminder channel is unavailable')
  })

  it.each([
    { channel: 'office', botId: 'bot', text: '提醒' },
    { channel: 'qq', botId: '', text: '提醒' },
    { channel: 'qq', botId: 'bot', text: '  ' },
  ])('rejects an invalid reminder before delivery: %j', async (request) => {
    const notifications = createMobileNotifications()
    const send = vi.fn()
    notifications.register('qq', { status: () => ({ bots: [] }), sendConnectionTest: send })
    await expect(notifications.gateway.send(request)).rejects.toThrow('A reminder requires')
    expect(send).not.toHaveBeenCalled()
  })

  it.each(CHANNELS)('delivers custom text through the %s controller and preserves connection tests', async (channel, path, name) => {
    const modules = await import(moduleUrl(`src/channels/${path}`)) as Record<string, new (options: object) => Controller>
    const ControllerClass = modules[name]!
    const config = {
      id: 'bot-course', botId: 'bot-course', appId: '1234567890', secretRef: 'test-secret',
      tokenRef: 'test-token', botTokenRef: 'test-bot-token', appTokenRef: 'test-app-token',
      clientId: 'ding-course', remoteBotId: 'wecom-course', accountId: 'wx-course', accountJid: 'teacher@example.test',
      platformId: 'platform-course', name: '课程助手', botName: '课程助手', activated: true,
      approvedSenders: [],
    }
    const runtime = {
      start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
      sendConnectionTest: vi.fn(async (_text: string) => ({ sent: true })),
      status: {
        ready: true, harnessReachable: true, connectionState: 'connected',
        qqConnectionState: 'connected', feishuLongConnectionState: 'connected',
        weixinConnectionState: 'connected', dingtalkConnectionState: 'connected', wecomConnectionState: 'connected',
      },
    }
    const controller = new ControllerClass({
      credentials: { resolve: async () => ({ value: 'test-secret' }), set: vi.fn(), unset: vi.fn() },
      configStore: {
        list: () => [config], get: (id: string) => id === config.botId ? config : undefined,
        getBot: (id: string) => id === config.botId ? config : undefined,
        getByClientId: () => config, save: vi.fn(), remove: vi.fn(),
      },
      createRuntime: () => runtime,
      qrAuth: { start: vi.fn(), poll: vi.fn() }, api: { beginLogin: vi.fn(), pollLogin: vi.fn() },
      deviceAuth: { start: vi.fn(), poll: vi.fn() }, registerApp: vi.fn(), verifyApp: vi.fn(),
      descriptor: { key: channel, label: channel, connectionLabel: channel },
      inspectToken: vi.fn(), deriveIdentity: vi.fn(), maskPlatformId: (id: string) => id,
      authPath: () => 'unused-auth-path', createSession: vi.fn(),
    })
    onTestFinished(() => controller.close())
    await controller.initialize()
    const notifications = createMobileNotifications()
    notifications.register(channel, controller)
    await expect(notifications.gateway.listTargets()).resolves.toHaveLength(1)
    await notifications.gateway.send({ channel, botId: config.botId, text: '⏰ 截止前交材料' })
    expect(runtime.sendConnectionTest).toHaveBeenLastCalledWith('⏰ 截止前交材料')
    await controller.sendConnectionTest(config.botId)
    expect(runtime.sendConnectionTest.mock.calls.at(-1)?.[0]).toMatch(/连接测试成功|connection test/i)
    const before = runtime.sendConnectionTest.mock.calls.length
    await expect(notifications.gateway.send({ channel, botId: 'missing-bot', text: '提醒' })).rejects.toThrow()
    expect(runtime.sendConnectionTest).toHaveBeenCalledTimes(before)
    runtime.status.ready = false
    await expect(notifications.gateway.send({ channel, botId: config.botId, text: '提醒' })).rejects.toThrow()
    expect(runtime.sendConnectionTest).toHaveBeenCalledTimes(before)
  })

  it('sends QQ reminders to the private owner or remembered user and propagates platform rejection', async () => {
    const { QqRuntime } = await import(moduleUrl('src/channels/qq/qq-runtime.mjs')) as {
      QqRuntime: new (options: object) => {
        start(): Promise<unknown>
        stop(): Promise<unknown>
        sendConnectionTest(text: string): Promise<unknown>
      }
    }
    const { rememberConnectionTestTarget } = await import(moduleUrl('src/channels/shared/connection-test.mjs')) as {
      rememberConnectionTestTarget: (state: object, target: object) => boolean
    }
    const state = {}
    const events = new EventEmitter()
    const sendText = vi.fn(async (_target: object, _text: string) => undefined)
    const bot = {
      on: events.on.bind(events), use: vi.fn(), sendText,
      start: async () => { events.emit('ready') }, stop: vi.fn(),
    }
    const runtime = new QqRuntime({
      config: { botId: 'qq-course', appId: '1234567890', ownerUserOpenid: 'owner-private-id' },
      appSecret: 'synthetic-secret', state,
      harness: { ensureRunning: async () => true }, createBot: () => bot,
    })
    onTestFinished(() => runtime.stop().then(() => undefined))
    await runtime.start()
    await runtime.sendConnectionTest('事项提醒')
    expect(sendText).toHaveBeenLastCalledWith({ scope: 'c2c', targetId: 'owner-private-id' }, '事项提醒')
    rememberConnectionTestTarget(state, { scope: 'c2c', targetId: 'recent-private-id' })
    await runtime.sendConnectionTest('第二条提醒')
    expect(sendText).toHaveBeenLastCalledWith({ scope: 'c2c', targetId: 'recent-private-id' }, '第二条提醒')
    const rejected = new Error('platform rejected delivery')
    sendText.mockRejectedValueOnce(rejected)
    await expect(runtime.sendConnectionTest('第三条提醒')).rejects.toBe(rejected)
  })
})
