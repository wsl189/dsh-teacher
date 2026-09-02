// Web e2e scenario: the Models settings page end to end through the real
// wire. It keeps use-case selectors separate from provider access, configures
// the MiniMax standard route from the domestic-supplier workspace, and stores
// a typed key write-only under the derived `MINIMAX_CN_API_KEY` reference.
// The scenario also covers provider-native authentication, request-route
// edits, model discovery, a hand-declared provider, and both deletion states.
// Configuration uses settings/credentials/llm-domain traffic only, so a stray
// model stream fails loud because the adapter registry is empty.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/models-settings', import.meta.url))
const EMPTY_EXPECTED = join(SNAPSHOT_DIR, 'empty.expected.md')
const IMAGE_INPUT_DRAFT_EXPECTED = join(SNAPSHOT_DIR, 'image-input-draft.expected.md')
const CONFIGURED_EXPECTED = join(SNAPSHOT_DIR, 'configured.expected.md')
const DECLARED_EXPECTED = join(SNAPSHOT_DIR, 'declared.expected.md')
const DECLARED_EDIT_EXPECTED = join(SNAPSHOT_DIR, 'declared-edit.expected.md')
const MODEL_PICKER_EXPECTED = join(SNAPSHOT_DIR, 'model-picker.expected.md')
const NATIVE_DELETE_EXPECTED = join(SNAPSHOT_DIR, 'native-delete.expected.md')
const DELETE_EXPECTED = join(SNAPSHOT_DIR, 'delete.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: Models settings page configures supplier and custom routes', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps direct assignments in Use cases and provider-owned configuration in Service access', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-voice-model'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '插件', exact: true }).click()
    await dialog.getByRole('tab', { name: '连接平台', exact: true }).click()
    await dialog.getByRole('tab', { name: 'QQ', exact: true }).click()
    await dialog.getByRole('region', { name: 'QQ 设置' }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByLabel('ASR Base URL').count()).toBe(0)
    await dialog.getByRole('button', { name: '模型' }).click()
    await dialog.getByText('先配置供应商接入，再为不同使用场景选择已接入的模型。').waitFor({ timeout: 10_000 })
    await dialog.getByRole('tab', { name: '使用场景', exact: true }).click()

    const defaultModel = dialog.getByRole('combobox', { name: '默认对话模型' })
    const toolModel = dialog.getByRole('combobox', { name: '工具模型' })
    const imageAssignment = dialog.getByRole('combobox', { name: '生图模型' })
    const speechAssignment = dialog.getByRole('combobox', { name: '语音识别模型' })
    await imageAssignment.waitFor({ timeout: 10_000 })
    await speechAssignment.waitFor({ timeout: 10_000 })
    const defaultBox = await defaultModel.boundingBox()
    const toolBox = await toolModel.boundingBox()
    const imageBox = await imageAssignment.boundingBox()
    const voiceBox = await speechAssignment.boundingBox()
    expect(defaultBox).not.toBeNull()
    expect(toolBox).not.toBeNull()
    expect(imageBox).not.toBeNull()
    expect(voiceBox).not.toBeNull()
    expect(toolBox!.y).toBe(defaultBox!.y)
    expect(imageBox!.y).toBeGreaterThan(defaultBox!.y)
    expect(voiceBox!.y).toBe(imageBox!.y)
    expect(await imageAssignment.isDisabled()).toBe(true)
    expect(await speechAssignment.isDisabled()).toBe(true)
    expect(await dialog.getByRole('button', { name: '添加提供方', exact: true }).count()).toBe(0)
    expect(await dialog.getByText('渠道', { exact: true }).count()).toBe(0)
    expect(await dialog.getByLabel('ASR Base URL').count()).toBe(0)
    expect(await dialog.locator('summary:visible').filter({ hasText: '更多设置' }).count()).toBe(0)

    await dialog.getByRole('tab', { name: '服务接入', exact: true }).click()
    await dialog.getByRole('button', { name: '添加提供方', exact: true }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('button', { name: '展开: 生图模型' }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: '展开设置: 语音模型' }).count()).toBe(0)
    expect(await dialog.getByLabel('ASR Base URL').count()).toBe(0)
    expect(await dialog.getByText('渠道', { exact: true }).count()).toBe(0)

    await dialog.getByRole('button', { name: /智谱 GLM 标准 API 与 GLM Coding Plan/u }).click()
    await dialog.getByRole('button', { name: /配置 .*zhipu-cn/u }).click()
    await dialog.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('zhipu-speech-e2e-key')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByRole('button', { name: /编辑 .*zhipu-cn/u }).waitFor({ timeout: 10_000 })

    await dialog.getByRole('tab', { name: '使用场景', exact: true }).click()
    await expect.poll(async () => imageAssignment.locator('option').allTextContents(), { timeout: 10_000 })
      .toContain('GLM-Image (glm-image)')
    await expect.poll(async () => speechAssignment.locator('option').allTextContents(), { timeout: 10_000 })
      .toContain('GLM-ASR-2512 (glm-asr-2512)')
    await imageAssignment.selectOption(JSON.stringify(['zhipu-cn', 'glm-image']))
    await dialog.getByText('生图模型已保存。', { exact: true }).waitFor({ timeout: 10_000 })
    await speechAssignment.selectOption(JSON.stringify(['zhipu-cn', 'glm-asr-2512']))
    await dialog.getByText('语音识别模型已保存。', { exact: true }).waitFor({ timeout: 10_000 })

    const settings = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(settings).toContain('zhipu-cn:')
    expect(settings).toContain('imageProvider: zhipu-cn')
    expect(settings).toContain('imageModel: glm-image')
    expect(settings).toContain('speechProvider: zhipu-cn')
    expect(settings).toContain('speechModel: glm-asr-2512')
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8').catch(() => ''),
      { timeout: 10_000 },
    ).toContain('ZHIPU_CN_API_KEY: zhipu-speech-e2e-key')
    expect(await page.content()).not.toContain('zhipu-speech-e2e-key')

    expect(await dialog.getByLabel('ASR Base URL').count()).toBe(0)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('opens the MiniMax standard route from the supplier workspace', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-empty'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '模型' }).click()
    await dialog.getByText('先配置供应商接入，再为不同使用场景选择已接入的模型。').waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: /MiniMax 标准 API 与 Token Plan/u }).click()
    const access = dialog.getByLabel('接入方式')
    await expect.poll(async () => access.locator('option').allTextContents(), { timeout: 10_000 })
      .toEqual(['标准 API', 'MiniMax Token Plan'])
    await dialog.getByRole('button', { name: /配置 .*minimax-cn/u }).click()
    await dialog.getByRole('textbox', { name: 'API 密钥', exact: true }).waitFor({ timeout: 10_000 })
    const editor = dialog.locator('[data-scroll-region="provider-editor"]')
    const scroll = await editor.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: style.overflowY,
        overscrollBehaviorY: style.overscrollBehaviorY,
      }
    })
    expect(scroll.overflowY).toBe('auto')
    expect(scroll.overscrollBehaviorY).toBe('contain')
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EMPTY_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('keeps an unfinished preset model reachable while its input type changes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-image-input-draft'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '添加模型' }).click()
    await dialog.getByRole('button', { name: '容量 1' }).click()

    const input = dialog.getByLabel('输入类型 1')
    await input.selectOption('image')
    await expect.poll(async () => dialog.getByLabel('模型类型').inputValue()).toBe('vision')
    expect(await input.inputValue()).toBe('image')
    expect(await dialog.getByLabel('模型 ID 1').inputValue()).toBe('')

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(IMAGE_INPUT_DRAFT_EXPECTED, snapshot, MODE)

    await input.selectOption('text')
    await expect.poll(async () => dialog.getByLabel('模型类型').inputValue()).toBe('chat')
    expect(await dialog.getByLabel('输入类型 1').inputValue()).toBe('text')

    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.getByRole('button', { name: /配置 .*minimax-cn/u }).click()
    await dialog.getByRole('textbox', { name: 'API 密钥', exact: true }).waitFor({ timeout: 10_000 })
  }, 60_000)

  it('refuses a key no HTTP header can carry before anything is written', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-illegal-key'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    const key = dialog.getByLabel('API 密钥')
    const save = dialog.getByRole('button', { name: '保存', exact: true })

    // A key no HTTP header can carry would save cleanly and fail the first
    // turn with a ByteString TypeError; the form names the offending field
    // instead.
    await key.fill('sk-\u{1F600}minimax')
    await dialog.getByText('该 API 密钥格式错误，请检查。').waitFor({ timeout: 10_000 })
    await expect.poll(async () => save.isEnabled(), { timeout: 10_000 }).toBe(false)

    // Clearing it restores submit: an empty field means "keep what is stored",
    // never a refusal, or editing any other setting would demand the key.
    await key.fill('')
    await expect.poll(async () => save.isEnabled(), { timeout: 10_000 }).toBe(true)
    expect(await dialog.getByText('该 API 密钥格式错误，请检查。').count()).toBe(0)
  }, 60_000)

  it('saves a blank key as a reference-free provider-native profile', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-native-auth'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByRole('button', { name: '编辑 minimax-cn' }).waitFor({ timeout: 10_000 })
    await dialog.getByText('已保存 minimax-cn。', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('img', { name: 'API 密钥已配置' }).count()).toBe(0)
    expect(await dialog.getByRole('img', { name: 'API 密钥缺失' }).count()).toBe(0)
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('minimax-cn: {}')
    expect(document).not.toContain('MINIMAX_CN_API_KEY')
  }, 60_000)

  it('describes reference-free deletion without claiming a credential exists', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-native-delete'))
    const settingsDialog = page.getByRole('dialog', { name: '设置' })
    await settingsDialog.getByRole('button', { name: '删除 minimax-cn', exact: true }).click()
    const deleteDialog = page.getByRole('dialog', { name: '删除 minimax-cn？' })
    await deleteDialog.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label*="minimax-cn"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(NATIVE_DELETE_EXPECTED, snapshot, MODE)
    await deleteDialog.getByRole('button', { name: '取消', exact: true }).click()
  }, 60_000)

  it('stores the key under the derived reference and keeps the route live', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-add'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '编辑 minimax-cn' }).click()
    await dialog.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('sk-e2e-minimax')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    // The profile lands in settings.yaml with only the derived reference, the
    // key value lands in the harness home's .credentials.yaml, the dormant route
    // registers, and the topology frame invalidates the page into the row.
    await expect.poll(
      async () => dialog.getByRole('textbox', { name: 'API 密钥', exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await dialog.getByRole('img', { name: 'API 密钥已配置' }).waitFor({ timeout: 10_000 })
    await dialog.getByText('已保存 minimax-cn。', { exact: true }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('minimax-cn:')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    expect(document).not.toContain('sk-e2e-minimax')
    const credentialFile = join(scaffold.harnessHome, '.credentials.yaml')
    await expect.poll(
      async () => readFile(credentialFile, 'utf8').catch(() => ''),
      { timeout: 10_000 },
    ).toContain('MINIMAX_CN_API_KEY: sk-e2e-minimax')
    expect(await page.content()).not.toContain('sk-e2e-minimax')
  }, 60_000)

  it('applies a customized-settings field as a merge patch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-customized'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '编辑 minimax-cn' }).click()
    const url = dialog.getByLabel('API 地址')
    await url.waitFor({ timeout: 10_000 })
    await url.fill('https://gateway.minimax.example/v1')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    // The editor closes back to the route summary; the write merged into the
    // stored profile beside the reference.
    await expect.poll(async () => dialog.getByLabel('API 地址').count(), { timeout: 10_000 }).toBe(0)
    await dialog.getByText('已保存 minimax-cn。', { exact: true }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('baseURL: https://gateway.minimax.example/v1')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONFIGURED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('selects and clears the discovered model catalog in one action', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-picker'))
    const settingsDialog = page.getByRole('dialog', { name: '设置' })
    await settingsDialog.getByRole('button', { name: '编辑 minimax-cn' }).click()
    await settingsDialog.getByRole('button', { name: '获取可用模型' }).click()

    const picker = page.getByRole('dialog', { name: '选择要添加的模型' })
    await picker.waitFor({ timeout: 10_000 })
    const boxes = picker.getByRole('checkbox')
    const count = await boxes.count()
    expect(count).toBeGreaterThan(0)
    expect(await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(
      Array.from({ length: count }, () => true),
    )

    await picker.getByRole('button', { name: '取消全选' }).click()
    expect(await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(
      Array.from({ length: count }, () => false),
    )
    await picker.getByRole('button', { name: '全选' }).waitFor()
    const snapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label="选择要添加的模型"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(MODEL_PICKER_EXPECTED, snapshot, MODE)

    await picker.getByRole('button', { name: '全选' }).click()
    expect(await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(
      Array.from({ length: count }, () => true),
    )
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await settingsDialog.getByRole('button', { name: '取消', exact: true }).click()
  }, 60_000)

  it('declares a route the adapter does not ship', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-declare'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    const declare = dialog.getByRole('button', { name: '添加自定义提供方' })
    await expect.poll(async () => declare.isEnabled(), { timeout: 10_000 }).toBe(true)
    await declare.click()
    await dialog.getByLabel('Provider ID').fill('acme-gateway')
    await dialog.getByLabel('显示名称').fill('Acme Gateway')
    await dialog.getByLabel('完整请求地址').fill('https://gateway.acme.example/v1/chat/completions')
    // No reasoning effort on a provider card at all: effort is a per-model
    // capability, the models under one provider disagree about it, and a
    // switch in the composer already records provider+model+effort together.
    expect(await dialog.getByLabel('推理强度').count()).toBe(0)
    await dialog.getByRole('button', { name: '添加模型' }).click()
    await dialog.getByRole('button', { name: '容量 1' }).click()
    await dialog.getByLabel('输入类型 1').selectOption('image')
    await expect.poll(async () => dialog.getByLabel('模型类型').inputValue()).toBe('vision')
    expect(await dialog.getByLabel('输入类型 1').inputValue()).toBe('image')
    await dialog.getByLabel('模型 ID 1').fill('acme-large')
    await dialog.getByRole('button', { name: '创建提供方', exact: true }).click()

    const row = dialog.getByText('Acme Gateway', { exact: true }).first()
    await row.waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('acme-gateway:')
    expect(document).toMatch(/input:\n\s+- text\n\s+- image/)

    // The tag follows the adapter's installed catalog: this route is in no
    // catalog, so its identity remains visibly custom after it is configured.
    const rowCard = (name: string) => dialog.locator('li').filter({ hasText: name }).first()
    await expect.poll(async () => rowCard('Acme Gateway').getByText('自定义').count(), { timeout: 10_000 }).toBe(1)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DECLARED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('selects tool and image models only from live configured routes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-tool-model'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('tab', { name: '使用场景', exact: true }).click()
    const toolModel = dialog.getByRole('combobox', { name: '工具模型' })
    await toolModel.waitFor({ timeout: 10_000 })
    await expect.poll(async () => toolModel.locator('option').allTextContents(), { timeout: 10_000 })
      .toContain('acme-large')
    await toolModel.selectOption(JSON.stringify(['acme-gateway', 'acme-large']))
    await dialog.getByText('工具模型已保存。', { exact: true }).waitFor({ timeout: 10_000 })

    const imageModel = dialog.getByRole('combobox', { name: '生图模型' })
    await expect.poll(async () => imageModel.locator('option').allTextContents(), { timeout: 10_000 })
      .toContain('MiniMax Image-01 (image-01)')
    await imageModel.selectOption(JSON.stringify(['minimax-cn', 'image-01']))
    await dialog.getByText('生图模型已保存。', { exact: true }).waitFor({ timeout: 10_000 })

    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('toolProvider: acme-gateway')
    expect(document).toContain('toolModel: acme-large')
    expect(document).toContain('imageProvider: minimax-cn')
    expect(document).toContain('imageModel: image-01')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('reopens the name and protocol a declared route was created with', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-declared-identity'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('tab', { name: '服务接入', exact: true }).click()
    await dialog.getByRole('button', { name: '编辑 Acme Gateway (acme-gateway)' }).click()
    await dialog.getByText('模型目录与高级设置').click()
    // The create card asked this route for a name and a protocol because
    // nothing can default them; the editor reaches the same two fields rather
    // than sending the user to settings.yaml for what only this route names.
    const protocol = dialog.getByLabel('API 协议')
    await protocol.waitFor({ timeout: 10_000 })
    expect(await protocol.inputValue()).toBe('openai-completions')
    const name = dialog.getByLabel('显示名称', { exact: true })
    expect(await name.inputValue()).toBe('Acme Gateway')
    await dialog.getByRole('button', { name: '容量 1' }).click()
    expect(await dialog.getByLabel('输入类型 1').inputValue()).toBe('image')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DECLARED_EDIT_EXPECTED, snapshot, MODE)

    await protocol.selectOption('anthropic-messages')
    await name.fill('Acme 网关')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => dialog.getByLabel('API 协议').count(), { timeout: 10_000 }).toBe(0)
    // The adapter re-resolved the route under the new protocol and re-registered
    // it under the new name: an unserviceable profile would have been refused
    // at the write instead, and a rename that did not re-register would leave
    // the old label on the row.
    await dialog.getByText('Acme 网关', { exact: true }).first().waitFor({ timeout: 10_000 })
    // The status line names the route as the refreshed directory reports it;
    // the target captured when the card opened still carries the old name.
    await dialog.getByText('已保存 Acme 网关 (acme-gateway)。', { exact: true }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('api: anthropic-messages')
    expect(document).toContain('displayName: Acme 网关')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('confirms an identified provider deletion before removing its profile and key', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-delete'))
    const settingsDialog = page.getByRole('dialog', { name: '设置' })
    await settingsDialog.getByRole('button', { name: '删除 minimax-cn', exact: true }).click()
    const deleteDialog = page.getByRole('dialog', { name: '删除 minimax-cn？' })
    await deleteDialog.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label*="minimax-cn"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(DELETE_EXPECTED, snapshot, MODE)

    await deleteDialog.getByRole('button', { name: '取消', exact: true }).click()
    expect(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).toContain('minimax-cn:')
    await settingsDialog.getByRole('button', { name: '删除 minimax-cn', exact: true }).click()
    await page.getByRole('dialog', { name: '删除 minimax-cn？' })
      .getByRole('button', { name: '删除 minimax-cn', exact: true }).click()
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).not.toContain('minimax-cn:')
    expect(await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8'))
      .not.toContain('MINIMAX_CN_API_KEY')
    await expect.poll(
      async () => page.getByRole('dialog', { name: '删除 minimax-cn？' }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'configured.expected.md', 'declared-edit.expected.md', 'declared.expected.md',
      'delete.expected.md', 'empty.expected.md', 'image-input-draft.expected.md', 'model-picker.expected.md',
      'native-delete.expected.md',
    ])
  })
})
