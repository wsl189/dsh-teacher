import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-teacher-workbench'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/teacher-workbench', import.meta.url))
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const WORKBENCH_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const DAILY_EXPECTED = join(SNAPSHOT_DIR, 'daily.expected.md')
const REMINDER_EXPECTED = join(SNAPSHOT_DIR, 'reminder.expected.md')
const LEDGER_EXPECTED = join(SNAPSHOT_DIR, 'ledger.expected.md')
const VOICE_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'voice-error.expected.md')
const WEATHER_COMPACT_EXPECTED = join(SNAPSHOT_DIR, 'weather-compact.expected.md')
const WEATHER_EXPECTED = join(SNAPSHOT_DIR, 'weather.expected.md')
const CALENDAR_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'calendar-import.expected.md')
const ROSTER_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'roster-import.expected.md')
const SCORE_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'score-import.expected.md')
const HEADTEACHER_FAMILY_EXPECTED = join(SNAPSHOT_DIR, 'headteacher-family.expected.md')
const HEADTEACHER_RECORD_EXPECTED = join(SNAPSHOT_DIR, 'headteacher-record.expected.md')
const HEADTEACHER_SEATING_EXPECTED = join(SNAPSHOT_DIR, 'headteacher-seating.expected.md')
const TIMETABLE_EXPECTED = join(SNAPSHOT_DIR, 'timetable.expected.md')
const TIMETABLE_CLASS_DELETE_EXPECTED = join(SNAPSHOT_DIR, 'timetable-class-delete.expected.md')
const TIMETABLE_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'timetable-import.expected.md')
const STUDY_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'study-import.expected.md')
const QUESTION_DRAWERS_EXPECTED = join(SNAPSHOT_DIR, 'question-drawers.expected.md')
const QUESTION_ROOT_REFRESH_EXPECTED = join(SNAPSHOT_DIR, 'question-root-refresh.expected.md')
const SETTINGS_EXPECTED = join(SNAPSHOT_DIR, 'settings.expected.md')
const CONVERSATION_RETURN_EXPECTED = join(SNAPSHOT_DIR, 'conversation-return.expected.md')
const RASTER_FIXTURE = fileURLToPath(new URL('../../../examples/acp-agent/tests/snapshots/read-image/workspace/red.png', import.meta.url))
const DOCUMENT_DRAFT_EXPECTED = join(SNAPSHOT_DIR, 'document-draft.expected.md')
const DOCUMENT_CONTEXT_EXPECTED = join(SNAPSHOT_DIR, 'document-context.expected.md')
const DOCUMENT_CONTEXT_FIXTURE = join(SNAPSHOT_DIR, 'document-context.session.jsonl')
const MODE = webSnapshotMode()

describe('web e2e: durable teacher workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let minerUServer: Server
  let minerUMarkdown = ''
  let minerUMiddleJson = ''

  async function openModule(name: string): Promise<void> {
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    const module = page.getByRole('button', { name, exact: true }).first()
    if (!(await module.isVisible())) await page.getByRole('button', { name: '打开工作台' }).click()
    await module.click()
    await workbench.waitFor({ timeout: 10_000 })
  }

  async function showConversation(): Promise<void> {
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    if (!(await workbench.isVisible())) return
    const currentSession = page.locator('[role="treeitem"][aria-selected="true"]').last()
    await currentSession.waitFor({ timeout: 10_000 })
    await currentSession.click()
    await workbench.waitFor({ state: 'hidden', timeout: 10_000 })
  }

  beforeAll(async () => {
    minerUServer = createServer((request, response) => {
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => { chunks.push(chunk) })
      request.on('end', () => {
        const upload = Buffer.concat(chunks).toString('latin1')
        if (request.method !== 'POST' || request.url !== '/file_parse' || !upload.includes('return_md') || !upload.includes('effort')) {
          response.writeHead(400).end()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          results: {
            document: {
              md_content: minerUMarkdown,
              ...(minerUMiddleJson === '' ? {} : { middle_json: minerUMiddleJson }),
            },
          },
        }))
      })
    })
    await new Promise<void>((resolve) => { minerUServer.listen(0, '127.0.0.1', resolve) })
    const address = minerUServer.address() as AddressInfo
    scaffold = await launchWebScaffold({
      ocrEndpoint: `http://127.0.0.1:${String(address.port)}/file_parse`,
    })
    scaffold.ctx.provide('mobileNotifications', {
      listTargets: async () => [{
        channel: 'weixin',
        botId: 'workbench-e2e-bot' as never,
        label: '测试微信机器人',
        connected: true,
      }],
      send: async () => undefined,
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      locale: ZH_BROWSER_LOCALE,
    })
    await page.clock.setFixedTime('2026-08-22T09:30:00+08:00')
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'document-upload')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve) => { minerUServer?.close(() => { resolve() }) })
  })

  it('places Workbench in the first sidebar action row without a New Session capsule', async () => {
    const newSession = page.getByRole('button', { name: '新建会话', exact: true })
    const workbench = page.getByRole('button', { name: '打开工作台', exact: true })
    expect(await newSession.count()).toBe(1)
    expect(await workbench.evaluate((button) => {
      const primary = button.closest('[class*="primarySections"]')
      return primary?.previousElementSibling?.getAttribute('class')?.includes('logoRow') ?? false
    })).toBe(true)
    await compareOrRefreshGolden(
      SIDEBAR_EXPECTED,
      await captureStableAria(page, '[data-sidebar-root]', scaffold.workspaceCwd),
      MODE,
    )
  })

  it('persists daily tasks, memos, and dated calendar items', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-daily'))
    await openModule('日常管理')
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    const todayCard = workbench.locator('section[aria-labelledby="daily-todo-title"]')
    const importantCard = workbench.locator('section[aria-labelledby="daily-todo-important-title"]')
    await todayCard.waitFor({ timeout: 10_000 })
    const todoWidths = await workbench.locator('[data-todo-category]').evaluateAll(cards => (
      cards.map(card => card.getBoundingClientRect().width)
    ))
    expect(todoWidths).toHaveLength(3)
    expect(Math.max(...todoWidths) - Math.min(...todoWidths)).toBeLessThan(1)
    const deadlinePickerWidths = await workbench.locator('[data-todo-deadline-picker]').evaluateAll(pickers => (
      pickers.map(picker => picker.getBoundingClientRect().width)
    ))
    expect(deadlinePickerWidths).toHaveLength(3)
    expect(deadlinePickerWidths.every(width => Math.abs(width - 32) < 1)).toBe(true)
    await todayCard.getByLabel('新增今日待办').fill('批改一班作业')
    await todayCard.getByRole('button', { name: '截止时间' }).click()
    const deadlineEditor = page.getByRole('dialog', { name: '设置截止时间与提醒' })
    await deadlineEditor.getByLabel('截止时间').fill('2099-08-18T18:30')
    await deadlineEditor.getByRole('checkbox', { name: '发送手机机器人提醒' }).check()
    await deadlineEditor.getByLabel('提醒方式').selectOption('repeat')
    const frequency = deadlineEditor.getByLabel('提醒频率')
    await frequency.fill('4')
    await deadlineEditor.getByText('请输入 5 分钟到 365 天内、可换算为整分钟的提醒频率。').waitFor()
    expect(await deadlineEditor.getByRole('button', { name: '保存' }).isDisabled()).toBe(true)
    await frequency.fill('')
    expect(await frequency.inputValue()).toBe('')
    await deadlineEditor.getByLabel('时间单位').selectOption('hours')
    await frequency.fill('2')
    await compareOrRefreshGolden(
      REMINDER_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await deadlineEditor.getByRole('button', { name: '保存' }).click()
    await deadlineEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    await todayCard.getByRole('button', { name: '添加待办' }).click()
    await todayCard.getByText('批改一班作业', { exact: true }).waitFor({ timeout: 10_000 })

    await importantCard.getByLabel('新增重要事项').fill('准备公开课')
    await importantCard.getByRole('button', { name: '添加待办' }).click()
    await importantCard.getByText('准备公开课', { exact: true }).waitFor({ timeout: 10_000 })
    await importantCard.getByRole('button', { name: '更改“准备公开课”的颜色标记，当前为蓝色' }).click()
    await importantCard.getByRole('group', { name: '选择事项标记颜色' }).getByRole('button', { name: '红色' }).click()
    await importantCard.getByRole('button', { name: '更改“准备公开课”的颜色标记，当前为红色' }).waitFor({ timeout: 10_000 })
    expect(await todayCard.getByText('准备公开课', { exact: true }).count()).toBe(0)
    expect(await todayCard.getByRole('button', { name: /颜色标记/ }).count()).toBe(0)

    const notesPanel = workbench.locator('section[aria-labelledby="daily-notes-title"]')
    await notesPanel.getByRole('button', { name: '添加备忘录' }).click()
    const noteEditor = page.getByRole('dialog', { name: '添加备忘录' })
    await noteEditor.getByLabel('备忘录内容').fill('下节课增加小组讨论')
    await noteEditor.getByRole('button', { name: '保存' }).click()
    await noteEditor.waitFor({ state: 'hidden', timeout: 10_000 })

    const ledgerPanel = workbench.locator('section[aria-labelledby="daily-ledger-title"]')
    await ledgerPanel.getByRole('button', { name: '放大板块' }).click()
    await ledgerPanel.getByRole('button', { name: '添加账本分类' }).click()
    const categoryEditor = page.getByRole('dialog', { name: '添加账本分类' })
    await categoryEditor.getByLabel('分类名称').fill('住房费用')
    await categoryEditor.getByRole('button', { name: '保存' }).click()
    await categoryEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    const housingLedger = ledgerPanel.getByRole('article', { name: '住房费用' })
    await housingLedger.getByLabel('账目说明').fill('八月物业费')
    await housingLedger.getByLabel('金额（元）').fill('286.50')
    await housingLedger.getByLabel('发生时间').fill('2026-08-20T19:30')
    await housingLedger.getByRole('button', { name: '添加明细' }).click()
    await housingLedger.getByText('八月物业费', { exact: true }).waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      LEDGER_EXPECTED,
      await captureStableAria(page, 'section[aria-labelledby="daily-ledger-title"]', scaffold.workspaceCwd),
      MODE,
    )
    await ledgerPanel.getByRole('button', { name: '恢复日常管理布局' }).click()

    await compareOrRefreshGolden(
      DAILY_EXPECTED,
      await captureStableAria(page, '[class*="dailyBoard"]', scaffold.workspaceCwd),
      MODE,
    )

    const calendarPanel = workbench.locator('section[aria-labelledby="daily-calendar-title"]')
    await calendarPanel.getByRole('button', { name: '放大板块' }).click()
    await expectExpandedCalendarHeadingLayout(calendarPanel)
    await calendarPanel.getByRole('button', { name: '添加当日事项' }).click()
    const calendarEditor = page.getByRole('dialog', { name: '添加当日事项' })
    await calendarEditor.getByLabel('日期').fill('2026-08-20')
    await calendarEditor.getByLabel('时间').fill('09:00')
    await calendarEditor.getByLabel('事项名称').fill('年级教研会')
    await calendarEditor.getByLabel('详细内容').fill('第一会议室')
    await calendarEditor.getByRole('button', { name: '保存' }).click()
    await calendarEditor.waitFor({ state: 'hidden', timeout: 10_000 })

    await expect.poll(async () => (await scaffold.ctx.teacherWorkbench.read({})).value.state.dailyTodos.length, {
      timeout: 10_000,
    }).toBe(2)
    const saved = await scaffold.ctx.teacherWorkbench.read({})
    expect(saved.value.state.dailyTodos).toMatchObject([{
      title: '批改一班作业', dueAt: '2099-08-18T18:30', completed: false,
      category: 'today', color: 'blue',
      reminder: {
        channel: 'weixin', botId: 'workbench-e2e-bot', botLabel: '测试微信机器人',
        rule: { kind: 'repeat', everyMinutes: 120 },
      },
    }, {
      title: '准备公开课', dueAt: '', completed: false,
      category: 'important', color: 'red',
    }])
    expect(saved.value.state.quickNotes).toMatchObject([{ content: '下节课增加小组讨论' }])
    expect(saved.value.state.ledgerCategories).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '住房费用' }),
    ]))
    expect(saved.value.state.ledgerEntries).toMatchObject([{
      description: '八月物业费', amountCents: 28_650, occurredAt: '2026-08-20T19:30',
    }])
    expect(saved.value.state.calendarItems).toMatchObject([{
      date: '2026-08-20', time: '09:00', title: '年级教研会', details: '第一会议室',
    }])

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('日常管理')
    await page.getByText('批改一班作业', { exact: true }).waitFor({ timeout: 10_000 })
    const reloadedTodayCard = page.locator('section[aria-labelledby="daily-todo-title"]')
    const reloadedImportantCard = page.locator('section[aria-labelledby="daily-todo-important-title"]')
    expect(await reloadedTodayCard.getByText('准备公开课', { exact: true }).count()).toBe(0)
    expect(await reloadedTodayCard.getByRole('button', { name: /颜色标记/ }).count()).toBe(0)
    await reloadedImportantCard.getByText('准备公开课', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await reloadedImportantCard.getByText('批改一班作业', { exact: true }).count()).toBe(0)
    expect(await page.getByText('下节课增加小组讨论', { exact: true }).count()).toBe(1)
    const reloadedLedger = page.locator('section[aria-labelledby="daily-ledger-title"]')
    await reloadedLedger.getByText('1 笔 · ¥286.50', { exact: true }).waitFor({ timeout: 10_000 })
    const compactCalendar = page.locator('section[aria-labelledby="daily-calendar-title"]')
    expect(await compactCalendar.getByRole('button', { name: /^2026-08-20.*1 项安排$/ }).count()).toBe(1)
    expect(await compactCalendar.locator('i[class*="calendarEventCount"]').count()).toBe(0)
    await showConversation()
    await page.locator('[data-composer-card]').waitFor({ timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('returns to the conversation when the current Session is reselected', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-conversation-return'))
    await openModule('日常管理')
    await showConversation()
    await page.locator('[data-composer-card]').waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      CONVERSATION_RETURN_EXPECTED,
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
  })

  it('announces a denied microphone request from every voice command', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-voice-error'))
    await openModule('日常管理')
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      })
    })
    const todoPanel = page.locator('section[aria-labelledby="daily-todo-title"]')
    await todoPanel.getByRole('button', { name: '开始语音输入' }).click()
    const alert = page.getByRole('alert')
    await alert.waitFor({ timeout: 10_000 })
    expect(await todoPanel.getByRole('button', { name: '麦克风权限未开启' }).count()).toBe(1)
    await compareOrRefreshGolden(
      VOICE_ERROR_EXPECTED,
      await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd),
      MODE,
    )
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('reviews a MinerU school calendar before one durable import', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-calendar-import'))
    await openModule('日常管理')
    const calendarPanel = page.locator('section[aria-labelledby="daily-calendar-title"]')
    await calendarPanel.getByRole('button', { name: '放大板块' }).click()
    minerUMarkdown = '<h1>2026年8月份工作安排</h1><table><tr><th></th><th colspan="3">周五</th><th colspan="3">周六</th><th>备注</th></tr><tr><th></th><th>内容</th><th>负责人</th><th>部门</th><th>内容</th><th>负责人</th><th>部门</th><th></th></tr><tr><td rowspan="2">第1周</td><td colspan="3">8月21日</td><td colspan="3">8月22日</td><td rowspan="2">月度说明</td></tr><tr><td>1. 年级教研会</td><td>郑</td><td>研</td><td>2. 家长开放日</td><td>李</td><td>德</td></tr></table>'
    await calendarPanel.locator('input[type="file"]').setInputFiles({
      name: 'school-calendar.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('keyless workbook fixture'),
    })
    const review = page.getByRole('dialog', { name: '上传并识别校历' })
    await review.getByText('识别到 2 项，请确认后导入').waitFor({ timeout: 10_000 })
    await review.getByLabel('事项名称').first().fill('年级教研会（已复核）')
    await compareOrRefreshGolden(
      CALENDAR_IMPORT_EXPECTED,
      await captureStableAria(page, '[class*="calendarImportDialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await review.getByRole('button', { name: '导入 2 项' }).click()
    await review.waitFor({ state: 'hidden', timeout: 10_000 })
    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.teacherWorkbench.read({})
      return snapshot.value.state.calendarItems.filter(item => item.date === '2026-08-21' || item.date === '2026-08-22')
    }, { timeout: 10_000 }).toMatchObject([
      { date: '2026-08-21', title: '年级教研会（已复核）' },
      { date: '2026-08-22', title: '家长开放日' },
    ])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('persists roster work across a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-roster'))
    await openModule('学生名册')
    const workbench = page.getByRole('region', { name: '工作台', exact: true })

    await workbench.getByRole('button', { name: '新建班级' }).click()
    const classEditor = page.getByRole('dialog', { name: '新建班级' })
    await classEditor.getByLabel('班级名称').fill('高一（1）班')
    await classEditor.getByLabel('年级').fill('高一')
    await classEditor.getByLabel('学科').fill('数学')
    await classEditor.getByRole('button', { name: '保存' }).click()
    await classEditor.waitFor({ state: 'hidden', timeout: 10_000 })

    await workbench.getByRole('button', { name: '添加学生' }).click()
    const studentEditor = page.getByRole('dialog', { name: '添加学生' })
    await studentEditor.getByLabel('姓名').fill('张同学')
    await studentEditor.getByLabel('学号').fill('001')
    await studentEditor.getByLabel('监护人').fill('张女士')
    await studentEditor.getByRole('button', { name: '保存' }).click()
    await studentEditor.waitFor({ state: 'hidden', timeout: 10_000 })

    minerUMarkdown = `
| 姓名 | 学号 | 性别 | 监护人 | 电话 |
| --- | --- | --- | --- | --- |
| 李同学 | 002 | 女 | 李女士 | 13800000000 |
`
    await workbench.locator('input[type="file"]').setInputFiles({
      name: '高一一班名册.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('workbook-fixture'),
    })
    const rosterReview = page.getByRole('dialog', { name: '上传并识别学生名册' })
    await rosterReview.getByText('高一一班名册.xlsx · 识别到 1 名学生，请确认后导入').waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      ROSTER_IMPORT_EXPECTED,
      await captureStableAria(page, '[class*="calendarImportDialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await rosterReview.getByRole('button', { name: '导入 1 名学生' }).click()
    await rosterReview.waitFor({ state: 'hidden', timeout: 10_000 })
    await workbench.getByText('李同学', { exact: true }).waitFor({ timeout: 10_000 })

    const saved = await scaffold.ctx.teacherWorkbench.read({})
    expect(saved.value.state.classes).toMatchObject([{ name: '高一（1）班', subject: '数学' }])
    expect(saved.value.state.students).toMatchObject([
      { name: '张同学', studentNumber: '001' },
      { name: '李同学', studentNumber: '002' },
    ])
    await compareOrRefreshGolden(
      WORKBENCH_EXPECTED,
      await captureStableAria(page, '[data-workbench-surface]', scaffold.workspaceCwd),
      MODE,
    )

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('学生名册')
    await page.getByRole('heading', { name: '高一（1）班' }).waitFor({ timeout: 10_000 })
    expect(await page.getByText('张同学', { exact: true }).count()).toBe(1)
    expect(await page.getByText('李同学', { exact: true }).count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('shows eight workbench modules before scrolling', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-module-viewport'))
    const moduleList = page.locator('[class*="sidebarModules"]')
    const workbenchTrigger = page.getByRole('button', { name: '打开工作台', exact: true })
    if (await workbenchTrigger.getAttribute('aria-expanded') !== 'true') await workbenchTrigger.click()
    const moduleListLayout = await moduleList.evaluate((element) => {
      const viewport = element.getBoundingClientRect()
      const fullyVisible = [...element.querySelectorAll('button')].filter((button) => {
        const item = button.getBoundingClientRect()
        return item.top >= viewport.top && item.bottom <= viewport.bottom
      }).length
      return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, fullyVisible }
    })
    expect(moduleListLayout).toMatchObject({ clientHeight: 288, fullyVisible: 8 })
    expect(moduleListLayout.scrollHeight).toBeGreaterThan(moduleListLayout.clientHeight)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('persists the five headteacher workspaces through the real Web transport', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-headteacher'))
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    const current = await scaffold.ctx.teacherWorkbench.read({})
    const rosterClass = current.value.state.classes.find(item => item.usage === 'roster')
    if (rosterClass === undefined) {
      await openModule('学生名册')
      await workbench.getByRole('button', { name: '新建班级' }).click()
      const classEditor = page.getByRole('dialog', { name: '新建班级' })
      await classEditor.getByLabel('班级名称').fill('高一（1）班')
      await classEditor.getByLabel('年级').fill('高一')
      await classEditor.getByLabel('学科').fill('数学')
      await classEditor.getByRole('button', { name: '保存' }).click()
      await classEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    }
    if (rosterClass === undefined || current.value.state.students.every(student => student.classId !== rosterClass.id)) {
      await openModule('学生名册')
      await workbench.getByRole('button', { name: '添加学生' }).click()
      const studentEditor = page.getByRole('dialog', { name: '添加学生' })
      await studentEditor.getByLabel('姓名').fill('张同学')
      await studentEditor.getByLabel('学号').fill('001')
      await studentEditor.getByRole('button', { name: '保存' }).click()
      await studentEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    }

    await openModule('家校沟通')
    await workbench.getByLabel('重点时间（可选）').fill('9月1日 8:00')
    await workbench.getByRole('button', { name: '生成可编辑初稿' }).click()
    await workbench.getByRole('button', { name: '保存', exact: true }).click()
    await workbench.locator('[class*="savedNotices"]').getByText('放假通知', { exact: true }).waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      HEADTEACHER_FAMILY_EXPECTED,
      await captureStableAria(page, '[class*="communicationView"]', scaffold.workspaceCwd),
      MODE,
    )

    for (const [moduleName, title] of [
      ['班级记录', '班级日常巡查'],
      ['谈话记录', '学生谈心谈话'],
      ['班级总结', '第一周班级总结'],
    ] as const) {
      await openModule(moduleName)
      await workbench.getByRole('button', { name: '新建记录' }).click()
      const editor = page.getByRole('dialog', { name: '新建记录' })
      await editor.getByLabel('标题').fill(title)
      await editor.getByRole('button', { name: '保存记录' }).click()
      await editor.waitFor({ state: 'hidden', timeout: 10_000 })
      await workbench.getByText(title, { exact: true }).waitFor({ timeout: 10_000 })
      if (moduleName === '班级记录') {
        await compareOrRefreshGolden(
          HEADTEACHER_RECORD_EXPECTED,
          await captureStableAria(page, '[class*="structuredRecords"]', scaffold.workspaceCwd),
          MODE,
        )
      }
    }

    await openModule('排座位')
    await workbench.getByRole('button', { name: '随机分配', exact: true }).click()
    await workbench.getByText('已随机分配；空位保留，可继续任意拖拽调整', { exact: true }).waitFor({ timeout: 10_000 })
    await workbench.getByRole('button', { name: '重置', exact: true }).click()
    await workbench.getByText('已恢复适合当前班级人数的 5 排 × 6 列布局', { exact: true }).waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      HEADTEACHER_SEATING_EXPECTED,
      await captureStableAria(page, '[class*="seatingView"]', scaffold.workspaceCwd),
      MODE,
    )

    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.teacherWorkbench.read({})
      return {
        notices: snapshot.value.state.notices.length,
        records: snapshot.value.state.records.filter((record) => {
          const template = snapshot.value.state.templates.find(candidate => candidate.id === record.templateId)
          return template?.kind === 'class' || template?.kind === 'talk' || template?.kind === 'summary'
        }).length,
        seatingLayouts: snapshot.value.state.seatingLayouts.length,
      }
    }, { timeout: 10_000 }).toEqual({ notices: 1, records: 3, seatingLayouts: 1 })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('班级总结')
    await page.getByText('第一周班级总结', { exact: true }).waitFor({ timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('recognizes and imports a roster-matched score sheet', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-score-import'))
    await openModule('成绩分析')
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    minerUMarkdown = `
<table>
  <tr><th>姓名</th><th>学号</th><th>语文</th><th>数学</th></tr>
  <tr><td>张同学</td><td>001</td><td>88</td><td>95</td></tr>
  <tr><td>李同学</td><td>002</td><td>92</td><td>90</td></tr>
</table>
`
    await workbench.locator('input[type="file"]').setInputFiles({
      name: '期中成绩.jpg',
      mimeType: 'image/jpeg',
      buffer: await readFile(RASTER_FIXTURE),
    })
    const scoreReview = page.getByRole('dialog', { name: '上传并识别成绩表' })
    await scoreReview.getByText('期中成绩.jpg · 匹配到 2 名学生，请确认后导入').waitFor({ timeout: 10_000 })
    await scoreReview.getByLabel('考试日期').fill('2026-08-22')
    await compareOrRefreshGolden(
      SCORE_IMPORT_EXPECTED,
      await captureStableAria(page, '[class*="calendarImportDialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await scoreReview.getByRole('button', { name: '导入 2 条成绩' }).click()
    await scoreReview.waitFor({ state: 'hidden', timeout: 10_000 })
    await workbench.getByRole('strong').filter({ hasText: /^183$/u }).waitFor({ timeout: 10_000 })
    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.teacherWorkbench.read({})
      return snapshot.value.state.exams.map(exam => ({ name: exam.name, date: exam.date, entries: exam.entries }))
    }, { timeout: 10_000 }).toMatchObject([{
      name: '期中成绩',
      date: '2026-08-22',
      entries: [
        { scores: { 语文: 88, 数学: 95 } },
        { scores: { 语文: 92, 数学: 90 } },
      ],
    }])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('centers the question hierarchy and switches image drawers without overlap', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-question-drawers'))
    let document = await scaffold.ctx.teacherWorkbench.read({})
    let rosterClass = document.value.state.classes.find(item => item.usage === 'roster')
    let student = document.value.state.students.find(item => item.classId === rosterClass?.id)

    if (rosterClass === undefined || student === undefined) {
      await openModule('学生名册')
      const workbench = page.getByRole('region', { name: '工作台', exact: true })
      await workbench.getByRole('button', { name: '新建班级' }).click()
      const classEditor = page.getByRole('dialog', { name: '新建班级' })
      await classEditor.getByLabel('班级名称').fill('高一（1）班')
      await classEditor.getByLabel('年级').fill('高一')
      await classEditor.getByLabel('学科').fill('数学')
      await classEditor.getByRole('button', { name: '保存' }).click()
      await classEditor.waitFor({ state: 'hidden', timeout: 10_000 })
      await workbench.getByRole('button', { name: '添加学生' }).click()
      const studentEditor = page.getByRole('dialog', { name: '添加学生' })
      await studentEditor.getByLabel('姓名').fill('张同学')
      await studentEditor.getByRole('button', { name: '保存' }).click()
      await studentEditor.waitFor({ state: 'hidden', timeout: 10_000 })
      document = await scaffold.ctx.teacherWorkbench.read({})
      rosterClass = document.value.state.classes.find(item => item.usage === 'roster')
      student = document.value.state.students.find(item => item.classId === rosterClass?.id)
    }
    if (rosterClass === undefined || student === undefined) throw new Error('question drawer roster setup failed')

    let batch = document.value.state.questionBatches.find(item => item.name === '布局验证试卷')
    if (batch === undefined) {
      const saved = await scaffold.ctx.teacherWorkbench.saveQuestionBatch({
        name: '布局验证试卷',
        sourceName: 'layout.pdf',
        pageRange: '1',
        images: [{
          questionNo: 1,
          fileName: '第1题.png',
          mediaType: 'image/png',
          width: 1,
          height: 1,
          contentBase64: (await readFile(RASTER_FIXTURE)).toString('base64'),
        }],
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) throw new Error(saved.error.message)
      batch = saved.value.document.state.questionBatches.find(item => item.name === '布局验证试卷')
    }
    if (batch === undefined) throw new Error('question drawer batch setup failed')
    const assigned = await scaffold.ctx.teacherWorkbench.assignQuestions({
      studentId: student.id,
      imageIds: batch.images.map(image => image.id),
    })
    expect(assigned.ok).toBe(true)

    await openModule('试题切割')
    const hierarchy = page.getByRole('complementary', { name: '学生目录' })
    const classButton = hierarchy.getByRole('button', { name: rosterClass.name, exact: true })
    const classRow = classButton.locator('..')
    const classDelete = classRow.getByRole('button', { name: '删除' })
    await classButton.hover()
    const [classButtonBox, classDeleteBox] = await Promise.all([classButton.boundingBox(), classDelete.boundingBox()])
    if (classButtonBox === null || classDeleteBox === null) throw new Error('question class controls have no layout box')
    expect(Math.abs((classDeleteBox.y + classDeleteBox.height / 2) - (classButtonBox.y + classButtonBox.height / 2))).toBeLessThan(1)

    await classButton.dblclick()
    const classDrawer = page.getByRole('complementary', { name: '学生列表' })
    await classDrawer.waitFor({ timeout: 10_000 })
    const studentButton = classDrawer.getByRole('button', { name: student.name, exact: true })
    await studentButton.click({ clickCount: 3 })
    const folderDialog = page.getByRole('dialog', { name: '新建子目录' })
    await folderDialog.waitFor({ timeout: 10_000 })
    await folderDialog.getByLabel('目录名').fill('月考')
    await folderDialog.getByRole('button', { name: '新建' }).click()
    const folderButton = classDrawer.getByRole('button', { name: '月考', exact: true })
    await folderButton.waitFor({ timeout: 10_000 })

    for (const button of [studentButton, folderButton]) {
      const label = button.locator('[class*="legacyHierarchyName"]')
      const [buttonBox, labelBox] = await Promise.all([button.boundingBox(), label.boundingBox()])
      if (buttonBox === null || labelBox === null) throw new Error('question hierarchy label has no layout box')
      expect(Math.abs((labelBox.x + labelBox.width / 2) - (buttonBox.x + buttonBox.width / 2))).toBeLessThan(1)
    }
    const folderRow = folderButton.locator('..')
    const addFromLibrary = folderRow.getByRole('button', { name: '从试题库添加' })
    expect(await addFromLibrary.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('nowrap')

    const documentWithFolder = await scaffold.ctx.teacherWorkbench.read({})
    const folder = documentWithFolder.value.state.questionFolders
      .find(item => item.studentId === student.id && item.name === '月考')
    if (folder === undefined) throw new Error('question drawer folder setup failed')
    const assignedToFolder = await scaffold.ctx.teacherWorkbench.assignQuestions({
      studentId: student.id,
      folderId: folder.id,
      imageIds: batch.images.map(image => image.id),
    })
    expect(assignedToFolder.ok).toBe(true)
    const assignedDocument = await scaffold.ctx.teacherWorkbench.read({})
    const temporarySaved = await scaffold.ctx.teacherWorkbench.saveTemporaryQuestionSelection({
      studentId: student.id,
      assignmentIds: assignedDocument.value.state.questionAssignments
        .filter(item => item.studentId === student.id)
        .map(item => item.id),
    })
    expect(temporarySaved.ok).toBe(true)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('试题切割')
    await classButton.dblclick()
    await classDrawer.waitFor({ timeout: 10_000 })

    await studentButton.click()
    const studentImages = page.getByRole('complementary', { name: '学生图片' })
    await studentImages.waitFor({ timeout: 10_000 })
    await studentImages.getByRole('button', { name: '第1题.png', exact: true }).nth(1).waitFor({ timeout: 10_000 })
    expect(await studentImages.getByRole('button', { name: '第1题.png', exact: true }).count()).toBe(2)
    expect(await studentImages.getByText(/已保存 1 次 · 最近：/u).count()).toBe(2)
    await studentButton.dblclick()
    await folderButton.waitFor({ timeout: 10_000 })
    await studentImages.getByRole('button', { name: '试题图片库' }).click()
    const bankFolders = page.getByRole('complementary', { name: '试题图片库' })
    await bankFolders.waitFor({ timeout: 10_000 })
    expect(await page.getByRole('complementary', { name: '试题库图片' }).count()).toBe(0)
    expect(await studentImages.count()).toBe(0)
    expect(await page.locator('[data-question-workbench]').getByRole('button', { name: '设置', exact: true }).count()).toBe(0)

    await bankFolders.getByRole('button', { name: '新建文件夹' }).click()
    let libraryFolderDialog = page.getByRole('dialog', { name: '新建文件夹' })
    await libraryFolderDialog.getByLabel('目录名').fill('模拟题库')
    await libraryFolderDialog.getByRole('button', { name: '新建' }).click()
    const libraryFolder = bankFolders.getByRole('button', { name: '模拟题库', exact: true })
    await libraryFolder.waitFor({ timeout: 10_000 })
    await libraryFolder.dblclick()
    libraryFolderDialog = page.getByRole('dialog', { name: '新建文件夹' })
    await libraryFolderDialog.getByLabel('目录名').fill('八月')
    await libraryFolderDialog.getByRole('button', { name: '新建' }).click()
    const nestedLibraryFolder = bankFolders.getByRole('button', { name: '八月', exact: true })
    await nestedLibraryFolder.waitFor({ timeout: 10_000 })
    await nestedLibraryFolder.click({ clickCount: 3 })
    const renameFolderDialog = page.getByRole('dialog', { name: '重命名目录' })
    await renameFolderDialog.getByLabel('目录名').fill('八月题库')
    await renameFolderDialog.getByRole('button', { name: '保存' }).click()
    await bankFolders.getByRole('button', { name: '八月题库', exact: true }).waitFor({ timeout: 10_000 })

    const batchButton = bankFolders.getByRole('button', { name: /布局验证试卷/u })
    await batchButton.click()
    const bankImages = page.getByRole('complementary', { name: '试题库图片' })
    await bankImages.waitFor({ timeout: 10_000 })
    expect(await studentImages.count()).toBe(0)
    const [classDrawerBox, bankImagesBox] = await Promise.all([classDrawer.boundingBox(), bankImages.boundingBox()])
    if (classDrawerBox === null || bankImagesBox === null) throw new Error('question drawers have no layout box')
    expect(classDrawerBox.x + classDrawerBox.width).toBeLessThanOrEqual(bankImagesBox.x)
    await classDrawer.getByRole('button', { name: '关闭工作台' }).click()
    await classDrawer.waitFor({ state: 'hidden', timeout: 10_000 })
    await compareOrRefreshGolden(
      QUESTION_DRAWERS_EXPECTED,
      await captureStableAria(page, '[data-question-workbench]', scaffold.workspaceCwd),
      MODE,
    )

    await batchButton.click()
    await bankImages.waitFor({ state: 'hidden', timeout: 10_000 })
    await bankFolders.getByRole('button', { name: '关闭工作台' }).click()
    await page.getByRole('button', { name: '试题图片库', exact: true }).click()
    await bankFolders.waitFor({ timeout: 10_000 })
    await batchButton.click()
    await bankImages.waitFor({ timeout: 10_000 })
    expect(await bankImages.getByRole('button', { name: '另存为' }).isDisabled()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('shows images discovered below newly configured question roots', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-question-roots'))
    let document = await scaffold.ctx.teacherWorkbench.read({})
    let rosterClass = document.value.state.classes.find(item => item.usage === 'roster')
    if (rosterClass === undefined) {
      await openModule('学生名册')
      const workbench = page.getByRole('region', { name: '工作台', exact: true })
      await workbench.getByRole('button', { name: '新建班级' }).click()
      const classEditor = page.getByRole('dialog', { name: '新建班级' })
      await classEditor.getByLabel('班级名称').fill('高一（1）班')
      await classEditor.getByLabel('年级').fill('高一')
      await classEditor.getByLabel('学科').fill('数学')
      await classEditor.getByRole('button', { name: '保存' }).click()
      await classEditor.waitFor({ state: 'hidden', timeout: 10_000 })
      document = await scaffold.ctx.teacherWorkbench.read({})
      rosterClass = document.value.state.classes.find(item => item.usage === 'roster')
    }
    if (rosterClass === undefined) throw new Error('question root roster setup failed')

    const segmentsRoot = join(scaffold.harnessHome, 'external-question-media', 'segments')
    const studentsRoot = join(scaffold.harnessHome, 'external-question-media', 'students')
    const batchDirectory = join(segmentsRoot, '新路径试卷')
    const nestedBatchDirectory = join(segmentsRoot, '月考', '第一次', '套题甲')
    const emptyLibraryDirectory = join(segmentsRoot, '空目录', '下一层')
    const academicYear = rosterClass.academicYear?.trim() || '2026'
    const grade = rosterClass.grade.trim() || '高一'
    const classDirectoryName = rosterClass.name.startsWith(grade)
      ? rosterClass.name.slice(grade.length)
      : rosterClass.name
    const directoryStudentName = '目录学生'
    const studentDirectory = join(
      studentsRoot,
      academicYear,
      grade,
      classDirectoryName,
      directoryStudentName,
      '月考',
      '第一周',
    )
    const raster = await readFile(RASTER_FIXTURE)
    await mkdir(batchDirectory, { recursive: true })
    await writeFile(join(batchDirectory, '新路径试卷_7.png'), raster)
    await mkdir(nestedBatchDirectory, { recursive: true })
    await writeFile(join(nestedBatchDirectory, '月考_8.png'), raster)
    await mkdir(emptyLibraryDirectory, { recursive: true })
    await mkdir(studentDirectory, { recursive: true })
    await writeFile(join(studentDirectory, '新路径学生题.png'), raster)
    await Promise.all([
      utimes(batchDirectory, 1, 1),
      utimes(join(segmentsRoot, '月考'), 2, 2),
      utimes(join(segmentsRoot, '空目录'), 3, 3),
    ])
    await scaffold.ctx.settings.update(settingsNamespace('teacher-workbench'), { segmentsRoot, studentsRoot })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('试题切割')
    const hierarchy = page.getByRole('complementary', { name: '学生目录' })
    await hierarchy.getByRole('button', { name: rosterClass.name, exact: true }).dblclick()
    const classDrawer = page.getByRole('complementary', { name: '学生列表' })
    await classDrawer.waitFor({ timeout: 10_000 })
    const directoryStudent = classDrawer.getByRole('button', { name: directoryStudentName, exact: true })
    await directoryStudent.click()
    const studentImages = page.getByRole('complementary', { name: '学生图片' })
    await studentImages.getByRole('button', { name: '新路径学生题.png', exact: true }).waitFor({ timeout: 10_000 })
    await studentImages.locator('img').first().waitFor({ timeout: 10_000 })
    await directoryStudent.click({ clickCount: 2 })
    const studentMonthFolder = classDrawer.getByRole('button', { name: '月考', exact: true })
    await studentMonthFolder.waitFor({ timeout: 10_000 })
    await studentMonthFolder.click({ clickCount: 2 })
    const firstWeekFolder = classDrawer.getByRole('button', { name: '第一周', exact: true })
    await firstWeekFolder.waitFor({ timeout: 10_000 })
    await firstWeekFolder.click({ clickCount: 3 })
    let directoryDialog = page.getByRole('dialog', { name: '新建子目录' })
    await directoryDialog.getByLabel('目录名').fill('第二周')
    await directoryDialog.getByRole('button', { name: '新建' }).click()
    await directoryDialog.waitFor({ state: 'hidden', timeout: 10_000 })
    const secondWeekFolder = classDrawer.getByRole('button', { name: '第二周', exact: true })
    await secondWeekFolder.waitFor({ timeout: 10_000 })
    await secondWeekFolder.click({ clickCount: 4 })
    directoryDialog = page.getByRole('dialog', { name: '重命名目录' })
    await directoryDialog.getByLabel('目录名').fill('第二周订正')
    await directoryDialog.getByRole('button', { name: '保存' }).click()
    await directoryDialog.waitFor({ state: 'hidden', timeout: 10_000 })
    await classDrawer.getByRole('button', { name: '第二周订正', exact: true }).waitFor({ timeout: 10_000 })
    expect((await stat(join(studentDirectory, '第二周订正'))).isDirectory()).toBe(true)

    await studentImages.getByRole('button', { name: '试题图片库' }).click()
    const bankFolders = page.getByRole('complementary', { name: '试题图片库' })
    const batchDirectoryFolder = bankFolders.getByRole('button', { name: /^▸ 新路径试卷/u })
    await batchDirectoryFolder.waitFor({ timeout: 10_000 })
    await batchDirectoryFolder.click()
    const batchButton = bankFolders.getByRole('button', { name: '新路径试卷 1', exact: true })
    await batchButton.waitFor({ timeout: 10_000 })
    await batchButton.click()
    const bankImages = page.getByRole('complementary', { name: '试题库图片' })
    await bankImages.getByRole('button', { name: '第 7 题', exact: true }).waitFor({ timeout: 10_000 })
    await bankImages.locator('img').first().waitFor({ timeout: 10_000 })
    const libraryMonthFolder = bankFolders.getByRole('button', { name: /^▸ 月考/u })
    await libraryMonthFolder.waitFor({ timeout: 10_000 })
    const [libraryMonthBox, libraryMonthMarkerBox] = await Promise.all([
      libraryMonthFolder.boundingBox(),
      libraryMonthFolder.locator('[aria-hidden="true"]').boundingBox(),
    ])
    if (libraryMonthBox === null || libraryMonthMarkerBox === null) throw new Error('question-library folder marker has no layout box')
    expect(libraryMonthMarkerBox.x - libraryMonthBox.x).toBeGreaterThanOrEqual(10)
    expect(libraryMonthMarkerBox.x - libraryMonthBox.x).toBeLessThanOrEqual(20)
    await libraryMonthFolder.click()
    const firstExamFolder = bankFolders.getByRole('button', { name: /^[▸▾] 第一次/u })
    await firstExamFolder.waitFor({ timeout: 10_000 })
    await firstExamFolder.click()
    const nestedBatchFolder = bankFolders.getByRole('button', { name: /^▸ 套题甲/u })
    await nestedBatchFolder.waitFor({ timeout: 10_000 })
    await nestedBatchFolder.click()
    await bankFolders.getByRole('button', { name: '套题甲 1', exact: true }).waitFor({ timeout: 10_000 })
    await firstExamFolder.click({ clickCount: 2 })
    directoryDialog = page.getByRole('dialog', { name: '新建文件夹' })
    await directoryDialog.getByLabel('目录名').fill('第二次')
    await directoryDialog.getByRole('button', { name: '新建' }).click()
    await directoryDialog.waitFor({ state: 'hidden', timeout: 10_000 })
    const secondExamFolder = bankFolders.getByRole('button', { name: '第二次', exact: true })
    await secondExamFolder.waitFor({ timeout: 10_000 })
    await secondExamFolder.click({ clickCount: 3 })
    directoryDialog = page.getByRole('dialog', { name: '重命名目录' })
    await directoryDialog.getByLabel('目录名').fill('第二次月考')
    await directoryDialog.getByRole('button', { name: '保存' }).click()
    await directoryDialog.waitFor({ state: 'hidden', timeout: 10_000 })
    await bankFolders.getByRole('button', { name: '第二次月考', exact: true }).waitFor({ timeout: 10_000 })
    expect((await stat(join(nestedBatchDirectory, '..', '第二次月考'))).isDirectory()).toBe(true)
    const emptyFolder = bankFolders.getByRole('button', { name: /^▸ 空目录/u })
    await emptyFolder.click()
    await bankFolders.getByRole('button', { name: '下一层', exact: true }).waitFor({ timeout: 10_000 })

    const liveStudentDirectory = join(
      studentsRoot,
      academicYear,
      grade,
      classDirectoryName,
      directoryStudentName,
      '实时新增学生目录',
    )
    const liveLibraryDirectory = join(segmentsRoot, '实时新增图片目录')
    await Promise.all([
      mkdir(liveStudentDirectory, { recursive: true }),
      mkdir(liveLibraryDirectory, { recursive: true }),
    ])
    const liveStudentFolder = classDrawer.getByRole('button', { name: '实时新增学生目录', exact: true })
    const liveLibraryFolder = bankFolders.getByRole('button', { name: '实时新增图片目录', exact: true })
    await Promise.all([
      liveStudentFolder.waitFor({ timeout: 10_000 }),
      liveLibraryFolder.waitFor({ timeout: 10_000 }),
    ])
    await compareOrRefreshGolden(
      QUESTION_ROOT_REFRESH_EXPECTED,
      await captureStableAria(page, '[data-question-workbench]', scaffold.workspaceCwd),
      MODE,
    )
    const liveStudentDelete = liveStudentFolder.locator('..').getByRole('button', { name: '删除', exact: true })
    await liveStudentFolder.hover()
    expect(await liveStudentDelete.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    page.once('dialog', async (dialog) => { await dialog.accept() })
    await liveStudentDelete.click()
    await liveStudentFolder.waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(stat(liveStudentDirectory)).rejects.toMatchObject({ code: 'ENOENT' })

    const liveLibraryDelete = liveLibraryFolder.locator('..').getByRole('button', { name: '删除目录“实时新增图片目录”' })
    await liveLibraryFolder.hover()
    expect(await liveLibraryDelete.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    page.once('dialog', async (dialog) => { await dialog.accept() })
    await liveLibraryDelete.click()
    await liveLibraryFolder.waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(stat(liveLibraryDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('links the normal timetable while isolating Grade OCR classes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-timetable'))
    await openModule('课程表')
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
    const weekday = await page.evaluate(() => new Date().getDay())
    const weekdayLabel = weekdays[weekday]
    if (weekdayLabel === undefined) throw new Error(`Unexpected weekday index: ${String(weekday)}`)

    expect(await workbench.getByRole('combobox', { name: '选择班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '选择班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '添加班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '识别课程表' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '添加课程' }).count()).toBe(0)
    await workbench.getByRole('tab', { name: '本周课表' }).click()
    expect(await workbench.getByRole('button', { name: '添加班级' }).count()).toBe(1)
    expect(await workbench.getByRole('button', { name: '添加课程', exact: true }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '选择班级' }).isDisabled()).toBe(true)
    await workbench.getByRole('button', { name: '添加班级' }).click()
    const timetableClassEditor = page.getByRole('dialog', { name: '添加班级' })
    await timetableClassEditor.getByLabel('班级名称').fill('高一（1）班')
    await timetableClassEditor.getByLabel('年级').fill('高一')
    expect(await timetableClassEditor.getByLabel('学科').count()).toBe(0)
    await timetableClassEditor.getByRole('button', { name: '保存' }).click()
    await timetableClassEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    expect(await workbench.getByRole('button', { name: '选择班级' }).isEnabled()).toBe(true)

    await workbench.getByRole('button', { name: `添加课程：第 1 节 · ${weekdayLabel}` }).click()
    const editor = page.getByRole('dialog', { name: '添加课程' })
    expect(await editor.getByLabel('班级名称').inputValue()).toBe('高一（1）班')
    expect(await editor.getByLabel('年级').inputValue()).toBe('高一')
    expect(await editor.getByLabel('星期').locator('option:checked').textContent()).toBe(weekdayLabel)
    expect(await editor.getByLabel('节次').inputValue()).toBe('1')
    await editor.getByRole('textbox', { name: '课程', exact: true }).fill('数学')
    await editor.getByLabel('开始时间').fill('11:50')
    await editor.getByLabel('任课教师').fill('王老师')
    await editor.getByLabel('地点').fill('101教室')
    await editor.getByRole('button', { name: '保存' }).click()
    await editor.waitFor({ state: 'hidden', timeout: 10_000 })
    await workbench.getByText('数学', { exact: true }).waitFor({ timeout: 10_000 })

    await workbench.getByRole('tab', { name: '本周课表' }).click()
    expect(await workbench.getByRole('button', { name: '删除班级' }).count()).toBe(1)
    await compareOrRefreshGolden(
      TIMETABLE_CLASS_DELETE_EXPECTED,
      await captureStableAria(page, 'section[aria-label="课程表"] [class*="moduleToolbar"]', scaffold.workspaceCwd),
      MODE,
    )
    const weekCourse = workbench.getByRole('button', { name: /数学/ })
    expect(await workbench.getByRole('button', { name: '编辑' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '删除', exact: true }).count()).toBe(0)
    expect(await weekCourse.locator('strong').evaluate(element => getComputedStyle(element).fontSize)).toBe('14px')
    expect(await weekCourse.locator('span').evaluate(element => getComputedStyle(element).fontSize)).toBe('13px')
    expect(await weekCourse.locator('time').evaluate(element => getComputedStyle(element).fontSize)).toBe('12px')
    expect(await weekCourse.locator('time').evaluate(element => getComputedStyle(element).fontWeight)).toBe('500')
    const subjectBox = await weekCourse.locator('strong').boundingBox()
    const timeBox = await weekCourse.locator('time').boundingBox()
    if (subjectBox === null || timeBox === null) throw new Error('Timetable subject and time must be visible')
    expect(timeBox.x).toBeGreaterThan(subjectBox.x + subjectBox.width)
    expect(await weekCourse.locator('..').evaluate(element => getComputedStyle(element).borderLeftWidth)).toBe('1px')
    await weekCourse.click()
    const linkedEditor = page.getByRole('dialog', { name: '编辑课程' })
    await linkedEditor.getByRole('textbox', { name: '课程', exact: true }).fill('化学')
    await linkedEditor.getByRole('button', { name: '保存' }).click()
    await linkedEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    await workbench.getByRole('tab', { name: '今日课表' }).click()
    await workbench.getByText('化学', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await workbench.getByRole('button', { name: '选择班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '添加班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '识别课程表' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '添加课程' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '编辑' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '删除' }).count()).toBe(0)
    expect(await workbench.getByRole('columnheader', { name: '上课班级' }).count()).toBe(1)
    expect(await workbench.getByRole('columnheader', { name: '地点' }).count()).toBe(0)
    expect(await workbench.getByText('高一（1）班', { exact: true }).count()).toBe(1)
    expect(await workbench.getByText('101教室', { exact: true }).count()).toBe(0)
    const teacherFilter = workbench.getByRole('textbox', { name: '筛选教师姓名' })
    await teacherFilter.fill('王老师')
    const teacherToggle = workbench.getByRole('checkbox', { name: '仅显示' })
    await teacherToggle.check()
    expect(await teacherToggle.isChecked()).toBe(true)
    await teacherToggle.uncheck()
    await compareOrRefreshGolden(
      TIMETABLE_EXPECTED,
      await captureStableAria(page, 'section[aria-label="课程表"]', scaffold.workspaceCwd),
      MODE,
    )

    expect(await workbench.getByRole('button', { name: '识别课程表' }).count()).toBe(0)
    for (const name of ['本周课表', '年级课表', '早晚自习'] as const) {
      await workbench.getByRole('tab', { name }).click()
      expect(await workbench.getByRole('button', { name: '识别课程表' }).count()).toBe(1)
    }
    await workbench.getByRole('tab', { name: '年级课表' }).click()
    minerUMarkdown = '<table><tr><td rowspan="2">星期班级早读</td><td colspan="3">星期一</td><td colspan="3">星期二</td></tr><tr><td>1</td><td>2</td><td>1</td><td>2</td><td>1</td><td></td></tr><tr><td>第一节</td><td>数学张三</td><td>语文李四</td><td>1</td><td>英语王五</td><td>物理赵六</td><td>1</td></tr><tr><td>第二节</td><td>英语王五</td><td>数学张三</td><td>2</td><td>语文李四</td><td>生物钱七</td><td>2</td></tr></table>'
    minerUMiddleJson = JSON.stringify({
      pdf_info: [{
        page_idx: 0,
        page_size: [720, 405],
        discarded_blocks: [{ type: 'text', lines: [{ spans: [{ type: 'text', content: '高三年' }] }] }],
      }],
    })
    await workbench.locator('input[type="file"]').setInputFiles({
      name: '年级课表.jpg',
      mimeType: 'image/jpeg',
      buffer: await readFile(RASTER_FIXTURE),
    })
    const review = page.getByRole('dialog', { name: '上传并识别课程表' })
    await review.getByText('识别到 8 节，请确认班级、星期和节次后导入').waitFor({ timeout: 10_000 })
    expect(await review.getByRole('checkbox', { name: '选择“数学”' }).first().isChecked()).toBe(true)
    await review.getByLabel('课程').first().fill('数学（已复核）')
    await compareOrRefreshGolden(
      TIMETABLE_IMPORT_EXPECTED,
      await captureStableAria(page, '[class*="timetableImportDialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await review.getByRole('button', { name: '导入 8 节' }).click()
    await review.waitFor({ state: 'hidden', timeout: 10_000 })
    await workbench.getByText('数学（已复核）', { exact: true }).waitFor({ timeout: 10_000 })
    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.teacherWorkbench.read({})
      return {
        classes: snapshot.value.state.classes
          .filter(item => item.usage !== 'roster')
          .map(item => ({ name: item.name, usage: item.usage })),
        gradeEntries: snapshot.value.state.timetableEntries.filter((item) => {
          const owner = snapshot.value.state.classes.find(candidate => candidate.id === item.classId)
          return owner?.usage === 'gradeTimetable'
        }).map(item => item.subject).sort(),
      }
    }, { timeout: 10_000 }).toEqual({
      classes: [
        { name: '高一（1）班', usage: 'timetable' },
        { name: '高三（1）班', usage: 'gradeTimetable' },
        { name: '高三（2）班', usage: 'gradeTimetable' },
      ],
      gradeEntries: ['数学（已复核）', '语文', '英语', '物理', '英语', '数学', '语文', '生物'].sort(),
    })

    for (const name of ['本周课表', '早晚自习'] as const) {
      await workbench.getByRole('tab', { name }).click()
      await workbench.getByRole('button', { name: '选择班级' }).click()
      expect(await page.getByRole('menuitem', { name: '高一（1）班' }).count()).toBe(1)
      expect(await page.getByRole('menuitem', { name: '高三（2）班' }).count()).toBe(0)
      await page.keyboard.press('Escape')
    }
    await openModule('试题切割')
    expect(await workbench.getByRole('button', { name: '高三（2）班' }).count()).toBe(0)

    await openModule('课程表')
    await workbench.getByRole('tab', { name: '本周课表' }).click()
    let confirmation = ''
    page.once('dialog', async (dialog) => {
      confirmation = dialog.message()
      await dialog.accept()
    })
    await workbench.getByRole('button', { name: '删除班级' }).click()
    await expect.poll(() => confirmation).toBe('确认删除班级“高一（1）班”及其全部课程安排吗？')
    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.teacherWorkbench.read({})
      return {
        normalClasses: snapshot.value.state.classes.filter(item => item.usage === 'timetable').length,
        orphanedEntries: snapshot.value.state.timetableEntries.filter((entry) => {
          return snapshot.value.state.classes.every(owner => owner.id !== entry.classId)
        }).length,
      }
    }, { timeout: 10_000 }).toEqual({ normalClasses: 0, orphanedEntries: 0 })
    await expect.poll(
      () => workbench.getByRole('button', { name: '选择班级' }).isDisabled(),
      { timeout: 10_000 },
    ).toBe(true)
    expect(await workbench.getByRole('button', { name: '删除班级' }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('recognizes class-column morning and evening study arrangements', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-study-import'))
    await openModule('课程表')
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    await workbench.getByRole('tab', { name: '早晚自习' }).click()
    minerUMiddleJson = ''
    minerUMarkdown = `25-26学年第一学期高二早读安排表

<table><tr><td>班级</td><td>高二1班</td><td>高二2班</td></tr><tr><td>星期一</td><td>王俊茹</td><td>蔡晓瑜</td></tr><tr><td>星期二（英）</td><td>江海莲</td><td>王勇</td></tr></table>

25-26学年第一学期高二晚自习安排表（2025.8.31）

<table><tr><td>班级</td><td>高二1班</td><td>高二2班</td></tr><tr><td>星期一</td><td>江海莲</td><td>蔡晓瑜*</td></tr><tr><td>星期二</td><td>王俊茹</td><td>王勇</td></tr></table>`
    await workbench.locator('input[type="file"]').setInputFiles({
      name: '早读安排.jpg',
      mimeType: 'image/jpeg',
      buffer: await readFile(RASTER_FIXTURE),
    })
    const review = page.getByRole('dialog', { name: '上传并识别课程表' })
    await review.getByText('识别到 8 节，请确认班级、星期和节次后导入').waitFor({ timeout: 10_000 })
    expect(await review.getByLabel('班级名称').first().inputValue()).toBe('高二1班')
    expect(await review.getByLabel('任课教师').nth(5).inputValue()).toBe('蔡晓瑜')
    await compareOrRefreshGolden(
      STUDY_IMPORT_EXPECTED,
      await captureStableAria(page, '[class*="timetableImportDialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await review.getByRole('button', { name: '导入 8 节' }).click()
    await review.waitFor({ state: 'hidden', timeout: 10_000 })
    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.teacherWorkbench.read({})
      const classes = new Map(snapshot.value.state.classes.map(item => [item.id, item]))
      return {
        classes: snapshot.value.state.classes
          .filter(item => item.usage === 'timetable' && item.grade === '高二')
          .map(item => item.name),
        entries: snapshot.value.state.timetableEntries
          .filter(item => classes.get(item.classId)?.grade === '高二')
          .map(item => [item.kind, item.subject, item.teacherName]),
      }
    }, { timeout: 10_000 }).toEqual({
      classes: ['高二1班', '高二2班'],
      entries: [
        ['morningStudy', '早读', '王俊茹'],
        ['morningStudy', '早读', '蔡晓瑜'],
        ['morningStudy', '英语', '江海莲'],
        ['morningStudy', '英语', '王勇'],
        ['eveningStudy', '晚自习', '江海莲'],
        ['eveningStudy', '晚自习', '蔡晓瑜'],
        ['eveningStudy', '晚自习', '王俊茹'],
        ['eveningStudy', '晚自习', '王勇'],
      ],
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('lays out teacher settings in full-width groups', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-settings-layout'))
    await showConversation()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    const settingsGroup = settings.locator('[class*="settingsGroup"]').filter({ hasText: '教师工作台' })
    const [groupBox, headBox, sectionsBox] = await Promise.all([
      settingsGroup.boundingBox(),
      settingsGroup.locator('[class*="settingsHead"]').boundingBox(),
      settingsGroup.locator('[class*="settingsSections"]').boundingBox(),
    ])
    if (groupBox === null || headBox === null || sectionsBox === null) throw new Error('teacher settings layout has no box')
    expect(headBox.y + headBox.height).toBeLessThanOrEqual(sectionsBox.y)
    expect(Math.abs(groupBox.x - sectionsBox.x)).toBeLessThan(1)
    expect(Math.abs(groupBox.width - sectionsBox.width)).toBeLessThan(1)
    await compareOrRefreshGolden(
      SETTINGS_EXPECTED,
      await captureStableAria(page, '[class*="settingsGroup"]', scaffold.workspaceCwd),
      MODE,
    )
    await settings.getByRole('button', { name: '关闭' }).click()
    await settings.waitFor({ state: 'hidden', timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('stores workbench parameters through General settings', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-settings'))
    await showConversation()

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    for (const [label, value] of [
      ['教师姓名', '王老师'],
      ['学校名称', '海淀中学'],
      ['默认学科', '数学'],
      ['天气地点', '浦东新区, 上海市'],
      ['满分', '150'],
      ['优秀线', '120'],
      ['及格线', '90'],
      ['切题清晰度倍率', '2.5'],
      ['切题边距', '18'],
    ] as const) {
      const input = settings.getByLabel(label)
      await input.fill(value)
      await input.blur()
    }
    await settings.getByLabel('语音识别语言').selectOption('en-US')

    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), {
      timeout: 10_000,
    }).toContain('speechLanguage: en-US')
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('teacherName: 王老师')
    expect(document).toContain('schoolName: 海淀中学')
    expect(document).toContain('defaultSubject: 数学')
    expect(document).toContain('weatherLocation: 浦东新区, 上海市')
    expect(document).toContain('speechLanguage: en-US')
    expect(document).toContain('scoreFullMark: 150')
    expect(document).toContain('excellentScore: 120')
    expect(document).toContain('passScore: 90')
    expect(document).toContain('questionRenderScale: 2.5')
    expect(document).toContain('questionCropPadding: 18')

    const originalFetch = globalThis.fetch
    globalThis.fetch = teacherWeatherFetch
    try {
      await settings.getByRole('button', { name: '关闭' }).click()
      await settings.waitFor({ state: 'hidden', timeout: 10_000 })
      await openModule('日常管理')
      const weatherSummary = page.locator('[data-daily-weather-summary]')
      await weatherSummary.getByText('少云', { exact: true }).waitFor({ timeout: 10_000 })
      await expectHeadingWeatherLayout(weatherSummary)
      await expectCompactCalendarLayout(page.locator('section[aria-labelledby="daily-calendar-title"]'))
      await compareOrRefreshGolden(
        WEATHER_COMPACT_EXPECTED,
        await captureStableAria(page, '[data-daily-weather-summary]', scaffold.workspaceCwd),
        MODE,
      )
      await weatherSummary.click()
      const weatherPanel = page.locator('section[aria-labelledby="daily-weather-title"]')
      await weatherPanel.getByRole('heading', { name: '未来 12 小时' }).waitFor({ timeout: 10_000 })
      await compareOrRefreshGolden(
        WEATHER_EXPECTED,
        await captureStableAria(page, 'section[aria-labelledby="daily-weather-title"]', scaffold.workspaceCwd),
        MODE,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps extracted document text out of the ordinary conversation draft', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-document-draft'))
    await showConversation()
    minerUMarkdown = '# 教学计划\n\n第一章：函数与图像'
    const composer = page.locator('[data-composer-card]')
    const uploadButton = composer.getByRole('button', { name: '上传文件并用 MinerU OCR 识别' })
    await uploadButton.waitFor({ timeout: 10_000 })
    const documentInput = composer.locator('input[type="file"][accept*=".docx"]')
    await documentInput.setInputFiles({
      name: 'lesson-plan.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('keyless document fixture'),
    })
    const input = composer.locator('textarea')
    await composer.getByText('已识别', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await input.inputValue()).toBe('')
    await input.fill('请总结这份教学计划')
    await compareOrRefreshGolden(
      DOCUMENT_DRAFT_EXPECTED,
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})

describe('web e2e: hidden MinerU conversation context', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let minerUServer: Server

  beforeAll(async () => {
    minerUServer = createServer((request, response) => {
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => { chunks.push(chunk) })
      request.on('end', () => {
        const upload = Buffer.concat(chunks).toString('latin1')
        if (request.method !== 'POST' || request.url !== '/file_parse' || !upload.includes('return_md')) {
          response.writeHead(400).end()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          results: { document: { md_content: '# 教学计划\n\n第一章：函数与图像' } },
        }))
      })
    })
    await new Promise<void>((resolve) => { minerUServer.listen(0, '127.0.0.1', resolve) })
    const address = minerUServer.address() as AddressInfo
    scaffold = await launchWebScaffold({
      ocrEndpoint: `http://127.0.0.1:${String(address.port)}/file_parse`,
      ...(MODE === 'record' ? {} : { replayFixture: DOCUMENT_CONTEXT_FIXTURE }),
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'document-context')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve) => { minerUServer?.close(() => { resolve() }) })
  })

  it('injects one uploaded document before the visible prompt', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-document-context'))
    const composer = page.locator('[data-composer-card]')
    await composer.locator('input[type="file"][accept*=".docx"]').setInputFiles({
      name: 'lesson-plan.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('keyless document fixture'),
    })
    await composer.getByText('已识别', { exact: true }).waitFor({ timeout: 10_000 })
    const input = composer.locator('textarea')
    expect(await input.inputValue()).toBe('')
    await input.fill('请总结这份教学计划')
    const settled = scaffold.whenTurnSettled()
    await composer.getByRole('button', { name: '发送消息' }).click()
    await settled
    const conversationScroll = page.locator('[data-conversation-scroll]')
    await conversationScroll.getByText('mineru-ocr', { exact: true }).waitFor({ timeout: 10_000 })
    await conversationScroll.getByText('请总结这份教学计划', { exact: true }).waitFor({ timeout: 10_000 })
    await conversationScroll.getByText('已收到教学计划。', { exact: true }).waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      DOCUMENT_CONTEXT_EXPECTED,
      await captureStableAria(page, '[data-conversation-scroll]', scaffold.workspaceCwd),
      MODE,
    )
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})

async function expectHeadingWeatherLayout(summary: Locator): Promise<void> {
  const metrics = await summary.evaluate((element) => {
    const container = element.parentElement
    const clock = element.querySelector<HTMLElement>('[class*="liveClock"]')
      ?? element.querySelector<HTMLElement>('[class*="weatherHeadingClock"]')
    const forecast = element.querySelector<HTMLElement>('[class*="weatherHeadingForecast"]')
    if (container == null || clock == null || forecast == null) return null
    const containerRect = container.getBoundingClientRect()
    const summaryRect = element.getBoundingClientRect()
    const clockRect = clock.getBoundingClientRect()
    const forecastRect = forecast.getBoundingClientRect()
    return {
      rightAligned: Math.abs(summaryRect.right - containerRect.right) <= 1
        && getComputedStyle(element).textAlign === 'right',
      contentContained: clockRect.left >= summaryRect.left
        && forecastRect.right <= summaryRect.right,
      noOverflow: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
      timeBeforeWeather: clockRect.right <= forecastRect.left,
    }
  })
  expect(metrics).toEqual({
    rightAligned: true,
    contentContained: true,
    noOverflow: true,
    timeBeforeWeather: true,
  })
}

async function expectCompactCalendarLayout(calendarPanel: Locator): Promise<void> {
  const [calendarBox, daysBox] = await Promise.all([
    calendarPanel.boundingBox(),
    calendarPanel.locator('[class*="calendarDays"]').boundingBox(),
  ])
  expect(calendarBox).not.toBeNull()
  expect(daysBox).not.toBeNull()
  expect(calendarBox!.height).toBeGreaterThanOrEqual(216)
  expect(daysBox!.height).toBeGreaterThanOrEqual(100)
}

async function expectExpandedCalendarHeadingLayout(calendarPanel: Locator): Promise<void> {
  const heading = calendarPanel.locator('[class*="calendarSelectedHeading"]')
  const [lunarBox, actionsBox] = await Promise.all([
    heading.locator('h3').boundingBox(),
    heading.locator('[class*="calendarHeadingActions"]').boundingBox(),
  ])
  expect(lunarBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  expect(lunarBox!.height).toBeLessThanOrEqual(24)
  expect(actionsBox!.y).toBeGreaterThanOrEqual(lunarBox!.y + lunarBox!.height)
}

function teacherWeatherFetch(input: URL | RequestInfo): Promise<Response> {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname === 'nominatim.openstreetmap.org') {
    return Promise.resolve(Response.json([{
      display_name: '浦东新区, 上海市, 中国',
      lat: '31.2232671',
      lon: '121.5397849',
    }]))
  }
  if (url.hostname === 'api.open-meteo.com') {
    return Promise.resolve(Response.json({
      timezone: 'Asia/Shanghai',
      current: {
        time: '2026-08-18T08:00',
        temperature_2m: 30.2,
        apparent_temperature: 34.1,
        relative_humidity_2m: 72,
        precipitation: 0.1,
        weather_code: 2,
        wind_speed_10m: 8.4,
      },
      hourly: {
        time: Array.from({ length: 12 }, (_, index) => `2026-08-18T${String(index + 8).padStart(2, '0')}:00`),
        temperature_2m: Array.from({ length: 12 }, (_, index) => 30 + index / 10),
        precipitation_probability: Array.from({ length: 12 }, (_, index) => index),
        weather_code: Array.from({ length: 12 }, () => 2),
      },
      daily: {
        temperature_2m_max: [36.2],
        temperature_2m_min: [28.3],
        precipitation_probability_max: [45.2],
        sunrise: ['2026-08-18T05:20'],
        sunset: ['2026-08-18T18:31'],
      },
    }))
  }
  return Promise.resolve(new Response('', { status: 404 }))
}
