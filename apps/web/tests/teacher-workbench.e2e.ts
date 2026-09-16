import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-teacher-workbench'
import type {} from '@deepseek-ai/dsh-settings'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'
import { auditExampleFormulaPalette } from './example-formula-palette-fixture.ts'
import { ExampleCorrectionAdapter } from './example-correction-fixture.ts'
import { TimetableAgentAdapter, smallGradeEntries, studyEntries } from './timetable-agent-fixture.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/teacher-workbench', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./teacher-workbench.overlay.yml', import.meta.url))
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
const QUESTION_SAVE_DIRECTORY_EXPECTED = join(SNAPSHOT_DIR, 'question-save-directory.expected.md')
const QUESTION_ROOT_REFRESH_EXPECTED = join(SNAPSHOT_DIR, 'question-root-refresh.expected.md')
const QUESTION_DIRECTORY_NAMES_EXPECTED = fileURLToPath(new URL('./expected/teacher-workbench/question-directory-names.expected.md', import.meta.url))
const QUESTION_PPT_SCALING_EXPECTED = fileURLToPath(new URL('./expected/teacher-workbench/question-ppt-scaling.expected.json', import.meta.url))
const QUESTION_STUDENT_EXPORT_EXPECTED = fileURLToPath(new URL('./expected/teacher-workbench/question-student-export.expected.md', import.meta.url))
const QUESTION_CUTTING_PROGRESS_EXPECTED = join(SNAPSHOT_DIR, 'question-cutting-progress.expected.md')
const SETTINGS_EXPECTED = join(SNAPSHOT_DIR, 'settings.expected.md')
const CONVERSATION_RETURN_EXPECTED = join(SNAPSHOT_DIR, 'conversation-return.expected.md')
const RASTER_FIXTURE = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const DOCUMENT_DRAFT_EXPECTED = join(SNAPSHOT_DIR, 'document-draft.expected.md')
const DOCUMENT_CONTEXT_EXPECTED = join(SNAPSHOT_DIR, 'document-context.expected.md')
const DOCUMENT_CONTEXT_FIXTURE = join(SNAPSHOT_DIR, 'document-context.session.jsonl')
const FIXED_WORKBENCH_TIME = '2026-08-22T09:30:00+08:00'
const MODE = webSnapshotMode()

function onePagePdfFixture(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let source = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, 'ascii'))
    source += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(source, 'ascii')
  source += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  source += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  source += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`
  return Buffer.from(source, 'ascii')
}

describe('web e2e: durable teacher workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let minerUServer: Server
  let minerUMarkdown = ''
  let minerUImages: Record<string, string> = {}
  let minerUMiddleJson = ''
  let minerUResponseGate: Promise<void> | null = null

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

  async function installExampleProofreader() {
    const proofreader = new ExampleCorrectionAdapter()
    const modelSelection = scaffold.ctx.agentDefaultModel.currentSelection()
    const disposeAdapter = scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter(['example-proofreading-test'], proofreader), 'Example proofreading fixture',
    )
    await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      ...modelSelection, toolProvider: 'example-proofreading-test', toolModel: 'proofreader',
    })
    const recordedInputs: SessionEvent<'user/message'>[] = []
    const recordedHeadings: SessionEvent<'user/message'>[] = []
    const disposeEvents = scaffold.ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text.includes('"mineruMarkdown":'))) {
        recordedInputs.push(event)
      }
      if (event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text.includes('"documentText":'))) {
        recordedHeadings.push(event)
      }
    })
    onTestFinished(async () => {
      disposeEvents()
      await disposeAdapter()
      await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, modelSelection)
    })
    return { proofreader, recordedInputs, recordedHeadings }
  }

  beforeAll(async () => {
    minerUServer = createServer((request, response) => {
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => { chunks.push(chunk) })
      request.on('end', () => {
        void (async () => {
          const upload = Buffer.concat(chunks).toString('latin1')
          if (request.method !== 'POST' || request.url !== '/file_parse' || !upload.includes('return_md') || !upload.includes('effort')) {
            response.writeHead(400).end()
            return
          }
          const responseGate = minerUResponseGate
          const responseMarkdown = minerUMarkdown
          const responseImages = /name="return_images"\r\n\r\ntrue/u.test(upload) ? minerUImages : undefined
          const responseMiddleJson = minerUMiddleJson
          if (responseGate !== null) await responseGate
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({
            results: {
              document: {
                md_content: responseMarkdown,
                images: responseImages,
                ...(responseMiddleJson === '' ? {} : { middle_json: responseMiddleJson }),
              },
            },
          }))
        })().catch((error: unknown) => {
          response.destroy(error instanceof Error ? error : new Error(String(error)))
        })
      })
    })
    await new Promise<void>((resolve) => { minerUServer.listen(0, '127.0.0.1', resolve) })
    const address = minerUServer.address() as AddressInfo
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
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
    await page.clock.setFixedTime(FIXED_WORKBENCH_TIME)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
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
      return primary?.querySelector('button') === button
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
    await page.clock.setFixedTime(Date.now())
    await todayCard.getByRole('button', { name: '添加待办' }).click()
    await todayCard.getByText('批改一班作业', { exact: true }).waitFor({ timeout: 10_000 })
    await page.clock.setFixedTime(FIXED_WORKBENCH_TIME)

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

  it('persists collected examples, Word previews, annotations, and tag search in SQLite', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-example-collection'))
    const { proofreader, recordedInputs, recordedHeadings } = await installExampleProofreader()
    const captureCollection = async (selector: string): Promise<string> => (
      await captureStableAria(page, selector, scaffold.workspaceCwd)
    ).replaceAll(`blob:${scaffold.baseUrl}/`, 'blob:{{webOrigin}}/')
    const expectWordTypography = async (preview: Locator): Promise<void> => {
      const typography = await preview.locator('section.example-word').evaluateAll(sections => sections.flatMap(section =>
        Array.from(section.querySelectorAll('p span, math'))
          .filter(element => element.localName === 'math' || element.closest('[data-word-equation]') === null)
          .map((element) => {
            const style = getComputedStyle(element)
            return { math: element.localName === 'math', family: style.fontFamily, size: style.fontSize, weight: style.fontWeight }
          }),
      ))
      expect(typography.length).toBeGreaterThan(0)
      for (const style of typography) {
        expect(style.family).toContain(style.math ? 'Cambria Math' : 'Times New Roman')
        expect(style.size).toBe('16px')
        expect(style.weight).toBe('400')
      }
    }
    const savedTags = async (index: number): Promise<readonly string[] | undefined> => {
      const catalog = await scaffold.ctx.teacherWorkbench.listExamples({})
      if (!catalog.ok) throw new Error(catalog.error.code)
      return catalog.value.questions[index]?.tags
    }
    const expectSubquestionIndents = async (xml: string): Promise<void> => {
      const indents = await page.evaluate((source) => {
        const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        const document = new DOMParser().parseFromString(source, 'application/xml')
        return Array.from(document.getElementsByTagNameNS(ns, 'p'))
          .filter(paragraph => paragraph.textContent?.startsWith('（i）') || paragraph.textContent?.startsWith('（ii）'))
          .map((paragraph) => {
            const indent = paragraph.getElementsByTagNameNS(ns, 'ind').item(0)
            const keepLines = paragraph.getElementsByTagNameNS(ns, 'keepLines').item(0)
            return [indent?.getAttributeNS(ns, 'left'), indent?.getAttributeNS(ns, 'firstLine'), keepLines?.getAttributeNS(ns, 'val')]
          })
      }, xml)
      expect(indents).toEqual([['480', '0', 'true'], ['480', '0', 'true']])
    }
    minerUMarkdown = '![题目示意图](images/figure.svg)\n【题 4】（2019 人教 $A$ 版必修第二册 P33 探究变式）\n已知 x² − 3x + 2 = 0，求 x。\n提示：尝试因式分解。\n向量与分数：$\\overrightarrow{PA}\\cdot(\\overrightarrow{PB}+\\overrightarrow{PC})=-\\frac{3}{2}$。\n上下标：$x_1^2$。\n校对：点0，$a\\cdot b:c$。\nA.\t$\\mathbf{a}$ B.\t$b$ C.\t$1$ D.\t$2$'
    minerUImages = { 'figure.svg': `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 400 200"><rect width="400" height="200" fill="white"/><path d="M40 170L200 20L360 170Z" fill="none" stroke="black" stroke-width="2"/><path d="M200 20L200 170" stroke="black" stroke-dasharray="5 5"/></svg>').toString('base64')}` }
    const screenshotRoot = fileURLToPath(new URL('../../../.playwright-mcp/example-collection', import.meta.url))
    await mkdir(screenshotRoot, { recursive: true })
    await openModule('典例收集')
    const surface = page.getByRole('region', { name: '工作台', exact: true })
    expect(await surface.locator('header').first().getByText('已保存', { exact: true }).count()).toBe(0)
    await surface.getByRole('button', { name: '添加新题', exact: true }).first().click()
    const directory = surface.getByRole('complementary', { name: '题目目录', exact: true })
    const first = directory.getByRole('button', { name: '1', exact: true })
    await first.waitFor()
    await first.dblclick()
    await surface.getByRole('textbox', { name: '重命名题目', exact: true }).fill('方程例题')
    await surface.getByRole('textbox', { name: '重命名题目', exact: true }).press('Enter')
    await directory.getByRole('button', { name: '方程例题', exact: true }).waitFor()
    await surface.getByLabel('添加图片或 PDF', { exact: true }).filter({ visible: false }).setInputFiles({
      name: 'equation.pdf', mimeType: 'application/pdf', buffer: onePagePdfFixture(),
    })
    await surface.getByRole('link', { name: '下载 Word 文件', exact: true }).waitFor({ timeout: 30_000 })
    await surface.getByText('已知 x² − 3x + 2 = 0，求 x。', { exact: true }).waitFor()
    await surface.locator('math mover').first().waitFor()
    const questionIllustration = surface.getByRole('region', { name: 'Word 预览', exact: true }).locator('section.example-word img')
    await questionIllustration.waitFor()
    await expect.poll(() => questionIllustration.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await questionIllustration.evaluate(image => image.getBoundingClientRect().width <= (image.closest('section')?.clientWidth ?? 0))).toBe(true)
    const figureSize = await questionIllustration.evaluate((image) => {
      const bounds = image.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height, alignment: getComputedStyle(image.closest('p')!).textAlign }
    })
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-figure-size.expected.json'), JSON.stringify(figureSize, null, 2), MODE)
    expect(figureSize).toEqual({ width: 288, height: 144, alignment: 'right' })
    expect(await surface.locator('math mover').count()).toBe(3)
    expect(await surface.locator('math mfrac').count()).toBe(1)
    expect(await surface.locator('math msubsup').count()).toBe(1)
    expect(await surface.getByRole('region', { name: 'Word 预览', exact: true }).innerText()).not.toContain('\\overrightarrow')
    const questionWord = surface.getByRole('region', { name: 'Word 预览', exact: true })
    const choiceTexts = () => questionWord.locator('.example-choice-cell').evaluateAll(cells => cells.map((cell) => {
      const accessible = cell.cloneNode(true) as HTMLElement
      accessible.querySelectorAll('[aria-hidden="true"]').forEach((element) => { element.remove() })
      return accessible.textContent
    }))
    expect(await questionWord.innerText()).toContain('点 O')
    expect(await questionWord.innerText()).not.toContain('点0')
    expect(await questionWord.locator('math').allTextContents()).toContain('a:b:c')
    expect(await choiceTexts()).toEqual(['A. a', 'B. b', 'C. 1', 'D. 2'])
    expect(await questionWord.locator('.example-choice-cell math').count()).toBe(4)
    const boldVariable = questionWord.locator('math mi[mathvariant="bold-italic"]')
    expect(await boldVariable.textContent()).toBe('a')
    expect(await boldVariable.evaluate(letter => getComputedStyle(letter).fontWeight)).toBe('700')
    const expectNativeVariable = async (xml: string): Promise<void> => {
      const letters = await page.evaluate((source) => {
        const namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
        const doc = new DOMParser().parseFromString(source, 'application/xml')
        return Array.from(doc.getElementsByTagNameNS(namespace, 'r')).filter(run =>
          run.getElementsByTagNameNS(namespace, 'sty').item(0)?.getAttributeNS(namespace, 'val') === 'bi',
        ).map(letter => ({ text: letter.textContent, normalText: letter.getElementsByTagNameNS(namespace, 'nor').length > 0 }))
      }, xml)
      expect(letters).toEqual([{ text: 'a', normalText: false }])
    }
    const [questionDownload] = await Promise.all([
      page.waitForEvent('download'),
      questionWord.getByRole('link', { name: '下载 Word 文件', exact: true }).click(),
    ])
    const questionPath = join(screenshotRoot, 'question.docx')
    await questionDownload.saveAs(questionPath)
    expect(strFromU8(unzipSync(await readFile(questionPath))['word/document.xml']!)).toContain('cx="2743200" cy="1371600"')
    await expectNativeVariable(strFromU8(unzipSync(await readFile(questionPath))['word/document.xml']!))
    expect(await questionIllustration.evaluate((image) => {
      const paragraph = image.closest('p')
      return paragraph !== null && paragraph === paragraph.parentElement?.lastElementChild && getComputedStyle(paragraph).textAlign === 'right'
    })).toBe(true)
    expect(proofreader.requests).toHaveLength(2)
    expect(recordedInputs).toHaveLength(1)
    expect(recordedHeadings).toHaveLength(1)
    expect(await questionWord.innerText()).not.toContain('【题 4】')
    expect(await questionWord.innerText()).not.toContain('人教')
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-proofreading.expected.json'), JSON.stringify({
      input: recordedInputs[0]!.data.content.map(block => block.type === 'image'
        ? { type: 'image', mediaType: block.attachment.mediaType, name: block.attachment.name }
        : block),
      tools: proofreader.requests[0]!.tools,
    }, null, 2), MODE)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-heading.expected.json'), JSON.stringify({
      input: recordedHeadings[0]!.data.content.map(block => block.type === 'image'
        ? { type: 'image', mediaType: block.attachment.mediaType, name: block.attachment.name }
        : block),
      tools: proofreader.requests[1]!.tools,
    }, null, 2), MODE)
    await questionWord.getByRole('button', { name: 'AI 校对', exact: true }).click()
    await questionWord.getByRole('link', { name: '下载 Word 文件', exact: true }).waitFor({ timeout: 30_000 })
    expect(proofreader.requests).toHaveLength(4)
    minerUMarkdown = '# 题目解析\n（1）因式分解得 $(x-1)(x-2)=0$，所以 $x_1=1$，$x_2=2$。\n（2）检验：$\\frac{1+2}{3}=1$。\n（i）结合函数图像讨论两个根的位置，并说明它们与横坐标轴交点之间的对应关系，写出完整的推理过程。\n（ii）将所得结果代入原方程，验证两个根。\n![解析示意图](images/figure.svg)'
    minerUImages = { 'figure.svg': `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 400 200"><rect width="400" height="200" fill="white"/><path d="M20 150H380M100 180V20" stroke="black"/><path d="M50 30Q200 270 350 30" fill="none" stroke="blue" stroke-width="2"/></svg>').toString('base64')}` }
    const explanationSource = surface.getByRole('region', { name: '题目解析', exact: true })
    const explanationWord = surface.getByRole('region', { name: '解析 Word 预览', exact: true })
    await surface.getByLabel('添加解析图片或 PDF', { exact: true }).filter({ visible: false }).setInputFiles({
      name: 'solution.pdf', mimeType: 'application/pdf', buffer: onePagePdfFixture(),
    })
    await explanationWord.getByRole('link', { name: '下载解析 Word 文件', exact: true }).waitFor({ timeout: 30_000 })
    const subquestions = explanationWord.locator('p').filter({ hasText: /^（i{1,2}）/u })
    await expect.poll(() => subquestions.count()).toBe(2)
    expect(await subquestions.evaluateAll(paragraphs => paragraphs.map(paragraph => ({
      left: getComputedStyle(paragraph).marginLeft,
      firstLine: getComputedStyle(paragraph).textIndent,
    })))).toEqual([{ left: '32px', firstLine: '0px' }, { left: '32px', firstLine: '0px' }])
    expect(await subquestions.first().evaluate(paragraph =>
      paragraph.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(paragraph).lineHeight),
    )).toBe(true)
    expect(await explanationWord.locator('p').filter({ hasText: /^（2）/u }).evaluate(paragraph =>
      getComputedStyle(paragraph).marginLeft,
    )).toBe('16px')
    await subquestions.first().scrollIntoViewIfNeeded()
    await explanationWord.screenshot({ path: join(screenshotRoot, 'explanation-indent.png'), animations: 'disabled' })
    const [explanationDownload] = await Promise.all([
      page.waitForEvent('download'),
      explanationWord.getByRole('link', { name: '下载解析 Word 文件', exact: true }).click(),
    ])
    expect(explanationDownload.suggestedFilename()).toBe('方程例题-解析.docx')
    const explanationPath = join(screenshotRoot, 'explanation.docx')
    await explanationDownload.saveAs(explanationPath)
    await expectSubquestionIndents(strFromU8(unzipSync(await readFile(explanationPath))['word/document.xml']!))
    await explanationWord.getByText('题目解析', { exact: true }).waitFor()
    await explanationWord.locator('math mfrac').waitFor()
    await expect.poll(() => explanationWord.locator('section.example-word img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expectWordTypography(surface.getByRole('region', { name: 'Word 预览', exact: true }))
    await expectWordTypography(explanationWord)
    expect(await explanationWord.innerText()).not.toContain('\\frac')
    expect(await surface.getByRole('region', { name: 'Word 预览', exact: true }).innerText()).not.toContain('因式分解得')
    await explanationSource.getByRole('link', { name: '下载解析原件', exact: true }).waitFor()
    await explanationSource.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshotRoot, 'explanation.png'), animations: 'disabled' })
    const tagPanel = surface.getByRole('region', { name: '题目标签', exact: true })
    const presetPicker = tagPanel.getByRole('button', { name: '选择预设标签', exact: true })
    const presetDialog = page.getByRole('dialog', { name: '添加预设标签', exact: true })
    for (const name of ['二次方程', '几何']) {
      await surface.getByRole('button', { name: '添加标签', exact: true }).click()
      await presetDialog.getByRole('textbox', { name: '预设标签名称', exact: true }).fill(name)
      await presetDialog.getByRole('textbox', { name: '预设标签名称', exact: true }).press('Enter')
      await presetDialog.waitFor({ state: 'detached' })
    }
    await presetPicker.click()
    expect(await tagPanel.getByRole('checkbox').count()).toBe(0)
    expect(await tagPanel.getByRole('button', { name: '二次方程', exact: true }).getAttribute('aria-pressed')).toBe('false')
    expect(await savedTags(0)).toEqual([])
    await tagPanel.getByRole('button', { name: '二次方程', exact: true }).click()
    await expect.poll(() => savedTags(0)).toEqual(['二次方程'])
    await expect.poll(() => tagPanel.getByRole('button', { name: '二次方程', exact: true }).getAttribute('aria-pressed')).toBe('true')
    expect(await presetPicker.getAttribute('aria-expanded')).toBe('true')
    await tagPanel.getByRole('button', { name: '几何', exact: true }).click()
    await expect.poll(() => savedTags(0)).toEqual(['二次方程', '几何'])
    expect(await presetPicker.getAttribute('aria-expanded')).toBe('true')
    const selectedChips = tagPanel.getByLabel('已选标签', { exact: true }).locator(':scope > span')
    await expect.poll(() => selectedChips.count()).toBe(2)
    const originalTagColors = await selectedChips.evaluateAll(chips => chips.map(chip => getComputedStyle(chip).backgroundColor))
    expect(new Set(originalTagColors).size).toBe(2)
    const selectedPreset = tagPanel.getByRole('button', { name: '二次方程', exact: true })
    const selectedAppearance = await selectedPreset.evaluate((row) => {
      const check = row.querySelector('svg')!
      return {
        background: getComputedStyle(row).backgroundColor,
        checkRightInset: row.getBoundingClientRect().right - check.getBoundingClientRect().right,
      }
    })
    expect(selectedAppearance.background).toBe('rgba(0, 0, 0, 0)')
    expect(selectedAppearance.checkRightInset).toBeLessThan(16)
    const removeGeometry = tagPanel.getByRole('button', { name: '取消标签“几何”', exact: true })
    expect(await removeGeometry.evaluate(button => getComputedStyle(button).opacity)).toBe('0')
    await selectedChips.filter({ hasText: '几何' }).hover()
    expect(await removeGeometry.evaluate(button => getComputedStyle(button).opacity)).toBe('1')
    await page.screenshot({ path: join(screenshotRoot, 'tag-remove.png'), animations: 'disabled' })
    await removeGeometry.click()
    await expect.poll(() => savedTags(0)).toEqual(['二次方程'])
    await presetPicker.click()
    const geometryPreset = tagPanel.getByRole('button', { name: '几何', exact: true })
    expect(await geometryPreset.getAttribute('aria-pressed')).toBe('false')
    expect(await geometryPreset.locator('svg').count()).toBe(0)
    await geometryPreset.click()
    await expect.poll(() => savedTags(0)).toEqual(['二次方程', '几何'])
    await expect.poll(() => selectedChips.count()).toBe(2)
    expect(await selectedChips.evaluateAll(chips => chips.map(chip => getComputedStyle(chip).backgroundColor))).toEqual(originalTagColors)
    await tagPanel.getByRole('button', { name: '几何', exact: true }).click()
    await expect.poll(() => savedTags(0)).toEqual(['二次方程'])
    expect(await presetPicker.getAttribute('aria-expanded')).toBe('true')
    await tagPanel.getByRole('heading', { name: '题目标签', exact: true }).click()
    expect(await presetPicker.getAttribute('aria-expanded')).toBe('false')
    await presetPicker.click()
    await tagPanel.getByRole('button', { name: '二次方程', exact: true }).press('Escape')
    expect(await presetPicker.getAttribute('aria-expanded')).toBe('false')
    await surface.getByRole('textbox', { name: '题目描述', exact: true }).fill('适合讲解因式分解，关注学生的符号错误。')
    expect(await surface.getByRole('region', { name: '题目描述', exact: true }).getByRole('button', { name: '保存', exact: true }).count()).toBe(0)
    expect(await surface.getByRole('button', { name: '手写', exact: true }).count()).toBe(0)
    await expect.poll(async () => {
      const result = await scaffold.ctx.teacherWorkbench.listExamples({})
      return result.ok ? result.value.questions[0]?.description : ''
    }).toBe('适合讲解因式分解，关注学生的符号错误。')
    const saved = await scaffold.ctx.teacherWorkbench.listExamples({})
    expect(saved).toMatchObject({ ok: true, value: { tags: ['二次方程', '几何'], questions: [{ name: '方程例题', description: '适合讲解因式分解，关注学生的符号错误。', documents: { question: { status: 'ready' }, explanation: { status: 'ready' } } }] } })
    if (!saved.ok) throw new Error('collected examples are unavailable')
    const handwriting = [{ points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.6 }, { x: 0.4, y: 0.1 }] }]
    expect(await scaffold.ctx.teacherWorkbench.updateExample({ id: saved.value.questions[0]!.id, handwriting }))
      .toMatchObject({ ok: true })
    expect((await readFile(join(scaffold.harnessHome, 'teacher-workbench/examples.sqlite'))).subarray(0, 16).toString()).toBe('SQLite format 3\0')
    await directory.getByRole('button', { name: '添加新题', exact: true }).click()
    await directory.getByRole('button', { name: '2', exact: true }).waitFor()
    await explanationSource.getByRole('button', { name: '点击添加解析图片或 PDF', exact: false }).waitFor()
    expect(await explanationWord.getByRole('link').count()).toBe(0)
    expect(await surface.getByRole('textbox', { name: '题目描述', exact: true }).inputValue()).toBe('')
    await presetPicker.click()
    expect(await tagPanel.getByRole('button', { name: '二次方程', exact: true }).getAttribute('aria-pressed')).toBe('false')
    await tagPanel.getByRole('button', { name: '二次方程', exact: true }).click()
    await expect.poll(() => savedTags(1)).toEqual(['二次方程'])
    await expect.poll(() => tagPanel.getByRole('button', { name: '二次方程', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await tagPanel.getByRole('button', { name: '二次方程', exact: true }).click()
    await expect.poll(() => savedTags(1)).toEqual([])
    const deleteGeometryPreset = tagPanel.getByRole('button', { name: '删除预设标签“几何”', exact: true })
    expect(await deleteGeometryPreset.evaluate(button => getComputedStyle(button).opacity)).toBe('0')
    await geometryPreset.hover()
    expect(await deleteGeometryPreset.evaluate(button => getComputedStyle(button).opacity)).toBe('1')
    await page.screenshot({ path: join(screenshotRoot, 'tag-preset-remove.png'), animations: 'disabled' })
    await deleteGeometryPreset.click()
    await expect.poll(async () => {
      const result = await scaffold.ctx.teacherWorkbench.listExamples({})
      return result.ok ? result.value.tags : null
    }).toEqual(['二次方程'])
    await geometryPreset.waitFor({ state: 'detached' })
    expect(await savedTags(1)).toEqual([])
    expect(await presetPicker.getAttribute('aria-expanded')).toBe('true')
    await presetPicker.click()
    await page.reload({ waitUntil: 'load' })
    await openModule('典例收集')
    await directory.getByRole('button', { name: '方程例题', exact: false }).first().click()
    await surface.getByText('已知 x² − 3x + 2 = 0，求 x。', { exact: true }).waitFor()
    await explanationWord.getByText('题目解析', { exact: true }).waitFor()
    await explanationWord.locator('math mfrac').waitFor()
    await expect.poll(() => explanationSource.getByRole('img', { name: 'solution.pdf，第 1 页', exact: true })
      .evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await surface.getByRole('textbox', { name: '题目描述', exact: true }).inputValue()).toBe('适合讲解因式分解，关注学生的符号错误。')
    expect(await surface.getByRole('img', { name: '题目描述手写区域', exact: true }).locator('polyline').count()).toBe(1)
    await presetPicker.click()
    expect(await tagPanel.getByRole('button', { name: '二次方程', exact: true }).getAttribute('aria-pressed')).toBe('true')
    expect(await tagPanel.getByRole('button', { name: '几何', exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-tag-presets.expected.md'), await captureCollection('[data-workbench-surface]'), MODE)
    await page.screenshot({ path: join(screenshotRoot, 'tag-presets.png'), animations: 'disabled' })
    await presetPicker.click()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'examples.expected.md'), await captureCollection('[data-workbench-surface]'), MODE)
    await page.screenshot({ path: join(screenshotRoot, 'editor.png'), animations: 'disabled' })
    await surface.getByRole('textbox', { name: '搜索题目', exact: true }).fill('二次方程 符号')
    await surface.getByRole('button', { name: '搜索', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '搜索结果', exact: true })
    await drawer.getByText('已知 x² − 3x + 2 = 0，求 x。', { exact: true }).waitFor()
    await drawer.locator('math mover').first().waitFor()
    expect(await drawer.locator('math mover').count()).toBe(3)
    expect(await drawer.getByRole('button', { name: '打开题目', exact: true }).count()).toBe(1)
    expect(await drawer.getByRole('button', { name: '导出 Word', exact: true }).isDisabled()).toBe(true)
    expect(await drawer.getByRole('checkbox', { name: '选择题目“方程例题”', exact: true }).isChecked()).toBe(false)
    await expectWordTypography(drawer)
    await expect.poll(() => drawer.locator('section.example-word img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const resultDownload = drawer.getByRole('link', { name: '下载 Word 文件', exact: true })
    expect(await resultDownload.evaluate(link => link.nextElementSibling?.textContent)).toBe('打开题目')
    expect(await drawer.getByText('方程例题.docx', { exact: true }).count()).toBe(0)
    const [searchDownload] = await Promise.all([
      page.waitForEvent('download'),
      resultDownload.click(),
    ])
    expect(searchDownload.suggestedFilename()).toBe('方程例题.docx')
    const searchWordPath = join(screenshotRoot, 'search-question.docx')
    await searchDownload.saveAs(searchWordPath)
    await expectNativeVariable(strFromU8(unzipSync(await readFile(searchWordPath))['word/document.xml']!))
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'examples-search.expected.md'), await captureCollection('dialog'), MODE)
    await page.screenshot({ path: join(screenshotRoot, 'search.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await directory.getByRole('button', { name: '2', exact: true }).click()
    minerUMarkdown = '# 第二道题\n计算平方和 $1^2+2^2$。'
    minerUImages = {}
    await surface.getByLabel('添加图片或 PDF', { exact: true }).filter({ visible: false }).setInputFiles(RASTER_FIXTURE)
    await surface.getByRole('img', { name: 'red.png', exact: true }).waitFor()
    await surface.getByRole('link', { name: '下载 Word 文件', exact: true }).waitFor({ timeout: 30_000 })
    const image = surface.getByRole('img', { name: 'red.png', exact: true })
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    minerUMarkdown = '# 第二题解析\n代入计算得 $1+4=5$。'
    await surface.getByLabel('添加解析图片或 PDF', { exact: true }).filter({ visible: false }).setInputFiles(RASTER_FIXTURE)
    await explanationSource.getByRole('img', { name: 'red.png', exact: true }).waitFor()
    await explanationWord.getByRole('link', { name: '下载解析 Word 文件', exact: true }).waitFor({ timeout: 30_000 })
    await surface.getByRole('textbox', { name: '搜索题目', exact: true }).fill('')
    await surface.getByRole('button', { name: '搜索', exact: true }).click()
    await drawer.getByRole('checkbox', { name: '选择题目“2”', exact: true }).check()
    await drawer.getByRole('checkbox', { name: '选择题目“方程例题”', exact: true }).check()
    await drawer.getByRole('checkbox', { name: '选择题目“2”', exact: true }).uncheck()
    await drawer.getByText('已选 1 题', { exact: true }).waitFor()
    await drawer.getByRole('checkbox', { name: '选择题目“2”', exact: true }).check()
    await drawer.getByText('已选 2 题', { exact: true }).waitFor()
    await page.screenshot({ path: join(screenshotRoot, 'export-selection.png'), animations: 'disabled' })
    for (const layout of ['paired', 'grouped'] as const) {
      await drawer.getByRole('button', { name: '导出 Word', exact: true }).click()
      const exporter = page.getByRole('dialog', { name: '导出 Word', exact: true })
      if (layout === 'grouped') await exporter.getByRole('radio', { name: '所有题目在前，解析集中在后', exact: false }).check()
      await compareOrRefreshGolden(
        join(SNAPSHOT_DIR, `example-export-${layout}.expected.md`),
        await captureCollection('dialog[aria-label="导出 Word"]'), MODE,
      )
      await page.screenshot({ path: join(screenshotRoot, `export-${layout}.png`), animations: 'disabled' })
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        exporter.getByRole('button', { name: '导出并下载', exact: true }).click(),
      ])
      expect(download.suggestedFilename()).toBe('典例收集.docx')
      const path = join(screenshotRoot, `export-${layout}.docx`)
      await download.saveAs(path)
      const parts = unzipSync(await readFile(path))
      const xml = strFromU8(parts['word/document.xml']!)
      expect(xml).toContain('w:ascii="Times New Roman"')
      expect(xml).toContain('w:eastAsia="宋体"')
      expect(xml).toContain('w:ascii="Cambria Math"')
      expect(xml).not.toMatch(/w:val="30"|m:val="undefined"/u)
      await expectNativeVariable(xml)
      await expectSubquestionIndents(xml)
      const order = layout === 'paired'
        ? ['已知', '因式分解得', '第二道题', '第二题解析']
        : ['已知', '第二道题', '因式分解得', '第二题解析']
      const positions = order.map(text => xml.indexOf(text))
      expect(positions.every(position => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      expect(xml).toContain('<m:acc>')
      expect(xml).toContain('<m:f>')
      expect((xml.match(/<a:blip\b/gu) ?? []).length).toBe(2)
      expect(Object.keys(parts).filter(name => /^word\/media\/.+\.png$/u.test(name))).toHaveLength(2)
      expect(xml).not.toContain('![')
      expect((xml.match(/<w:sectPr>/gu) ?? []).length).toBe(layout === 'grouped' ? 2 : 1)
      expect(xml).not.toContain('题目与解析')
      expect(xml).not.toContain('【题 4】')
      expect(xml).not.toContain('人教')
      expect(xml).not.toContain('题目 1')
      expect(xml).not.toContain('解析 1')
      expect(xml).not.toContain('适合讲解因式分解，关注学生的符号错误。')
      await exporter.waitFor({ state: 'detached' })
    }
    await page.keyboard.press('Escape')
    await directory.getByRole('button', { name: '2', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '删除题目', exact: true }).click()
    await page.getByRole('dialog', { name: '删除题目', exact: true }).getByRole('button', { name: '删除', exact: true }).click()
    await directory.getByRole('button', { name: '2', exact: true }).waitFor({ state: 'detached' })
    await directory.getByRole('button', { name: '方程例题', exact: false }).first().click()
    await questionWord.getByRole('button', { name: '放大Word 预览', exact: true }).click()
    const questionEditor = page.getByRole('dialog', { name: 'Word 预览大窗口', exact: true })
    const content = questionEditor.getByRole('textbox', { name: '编辑 Word 内容', exact: true })
    await content.waitFor()
    expect(await content.getByRole('img', { name: '题目配图', exact: true }).evaluate((image) => {
      const bounds = image.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height, alignment: getComputedStyle(image.closest('p')!).textAlign }
    })).toEqual(figureSize)
    await content.press('ControlOrMeta+a')
    await questionEditor.getByRole('combobox', { name: '字体', exact: true }).selectOption('Arial')
    await questionEditor.getByRole('button', { name: '保存', exact: true }).click()
    await questionEditor.getByText('已保存', { exact: true }).waitFor()
    await questionEditor.getByRole('button', { name: '关闭预览', exact: true }).click()
    await expect.poll(choiceTexts).toEqual(['A. a', 'B. b', 'C. 1', 'D. 2'])
    expect(await questionWord.locator('img').count()).toBe(1)
    expect(await questionWord.getByText('预览加载失败，请重新打开此题。', { exact: true }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('preserves formula structures when an IME confirms set letters', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-formula-ime'))
    await installExampleProofreader()
    await openModule('典例收集')
    const surface = page.getByRole('region', { name: '工作台', exact: true })
    const directory = surface.getByRole('complementary', { name: '题目目录', exact: true })
    await directory.getByRole('button', { name: '添加新题', exact: true }).click()
    const catalog = await scaffold.ctx.teacherWorkbench.listExamples({})
    if (!catalog.ok) throw new Error(catalog.error.code)
    const created = catalog.value.questions.at(-1)!
    const id = created.id
    await directory.getByRole('button', { name: String(created.number), exact: true }).waitFor()
    await directory.getByRole('button', { name: String(created.number), exact: true }).click()
    onTestFinished(async () => {
      await scaffold.ctx.teacherWorkbench.deleteExample({ id })
      await page.reload({ waitUntil: 'load' })
    })
    minerUMarkdown = '补集：$A$'
    minerUImages = {}
    await surface.getByLabel('添加图片或 PDF', { exact: true }).filter({ visible: false }).setInputFiles({
      name: 'formula-ime.png', mimeType: 'image/png', buffer: await readFile(RASTER_FIXTURE),
    })
    const word = surface.getByRole('region', { name: 'Word 预览', exact: true })
    await word.getByText('补集：', { exact: true }).waitFor({ timeout: 30_000 })
    await word.getByRole('button', { name: '放大Word 预览', exact: true }).click()
    const expanded = page.getByRole('dialog', { name: 'Word 预览大窗口', exact: true })
    const editor = expanded.getByLabel('编辑 Word 内容', { exact: true })
    const dialog = page.getByRole('dialog', { name: '公式编辑器', exact: true })
    const field = dialog.locator('math-field')
    const value = () => field.evaluate(element => (element as HTMLElement & { value: string }).value)
    const cdp = await page.context().newCDPSession(page)
    onTestFinished(async () => { await cdp.detach() })
    const results = []
    for (const item of [
      { name: '补集全集', symbol: '补集', seed: 'A', text: 'U', replace: false },
      { name: '补集替换全集', symbol: '补集', seed: 'A', text: 'U', replace: true },
      { name: '补集多个字母', symbol: '补集', seed: 'A', text: 'UV', replace: false },
      { name: '下标', symbol: '下标', seed: 'A', text: 'n', replace: false },
      { name: '乘方', symbol: '乘方', seed: 'A', text: 'n', replace: false },
      { name: '分数', symbol: '分数', seed: 'A', text: 'n', replace: false },
      { name: '平方根', symbol: '平方根', seed: '', text: 'x', replace: false },
      { name: 'n 次根式', symbol: 'n 次根式', seed: 'A', text: 'n', replace: false },
      { name: '绝对值', symbol: '绝对值', seed: '', text: 'x', replace: false },
      { name: '帽号', symbol: '帽号', seed: '', text: 'U', replace: false },
    ]) {
      const variants = []
      for (const input of ['keyboard', 'ime']) {
        await editor.locator('[data-equation]').first().dblclick()
        await field.press('ControlOrMeta+a')
        if (item.seed) await field.pressSequentially(item.seed)
        else await field.press('Backspace')
        await field.press('ControlOrMeta+a')
        await dialog.getByRole('button', { name: item.symbol, exact: true }).click()
        if (item.replace) {
          await field.pressSequentially('V')
          await field.press('Shift+ArrowLeft')
        }
        const before = await value()
        if (input === 'keyboard') await field.pressSequentially(item.text)
        else {
          await cdp.send('Input.imeSetComposition', { text: item.text, selectionStart: item.text.length, selectionEnd: item.text.length })
          await page.keyboard.down('Enter')
          await page.keyboard.insertText(item.text)
          await page.keyboard.up('Enter')
        }
        const latex = await value()
        expect(latex, item.name).not.toContain('\\placeholder')
        if (item.replace) {
          await field.press('ControlOrMeta+z')
          expect(await value(), `${item.name}: undo ${input}`).toBe(before)
          await field.press('ControlOrMeta+y')
          expect(await value(), `${item.name}: redo ${input}`).toBe(latex)
        }
        await dialog.getByRole('button', { name: '应用公式', exact: true }).click()
        const mathml = await editor.locator('[data-equation] math').first().innerHTML()
        variants.push({ latex, mathml })
      }
      expect(variants[1], item.name).toEqual(variants[0])
      results.push({ name: item.name, latex: variants[0]!.latex })
    }
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/teacher-workbench/example-formula-ime.expected.json', import.meta.url)),
      JSON.stringify(results, null, 2), MODE)
    await expanded.getByRole('button', { name: '保存', exact: true }).click()
    await expanded.getByText('已保存', { exact: true }).waitFor()
    await expanded.getByRole('button', { name: '关闭预览', exact: true }).click()
  }, 120_000)

  it('combines ordered question and explanation fragments and opens full document previews', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-example-fragments'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '浅色', exact: true }).click()
    await page.keyboard.press('Escape')
    onTestFinished(async () => { await page.emulateMedia({ colorScheme: 'light' }) })
    const { recordedInputs } = await installExampleProofreader()
    await openModule('典例收集')
    const surface = page.getByRole('region', { name: '工作台', exact: true })
    const directory = surface.getByRole('complementary', { name: '题目目录', exact: true })
    const catalog = await scaffold.ctx.teacherWorkbench.listExamples({})
    if (!catalog.ok) throw new Error(catalog.error.code)
    const number = Math.max(0, ...catalog.value.questions.map(row => row.number)) + 1
    await directory.getByRole('button', { name: '添加新题', exact: true }).click()
    await directory.getByRole('button', { name: String(number), exact: true }).dblclick()
    await surface.getByRole('textbox', { name: '重命名题目', exact: true }).fill('长题拼接')
    await surface.getByRole('textbox', { name: '重命名题目', exact: true }).press('Enter')
    await directory.getByRole('button', { name: '长题拼接', exact: true }).waitFor()
    const saved = await scaffold.ctx.teacherWorkbench.listExamples({})
    if (!saved.ok) throw new Error(saved.error.code)
    const id = saved.value.questions.find(row => row.name === '长题拼接')!.id
    onTestFinished(async () => { await scaffold.ctx.teacherWorkbench.deleteExample({ id }) })
    const screenshotRoot = fileURLToPath(new URL('../../../.playwright-mcp/example-fragments', import.meta.url))
    await mkdir(screenshotRoot, { recursive: true })
    const pixels = await readFile(RASTER_FIXTURE)
    const top = { name: '上半题.png', mimeType: 'image/png', buffer: pixels }
    const bottom = { name: '下半题.png', mimeType: 'image/png', buffer: pixels }
    const middle = { name: '中间页.pdf', mimeType: 'application/pdf', buffer: onePagePdfFixture() }
    const upload = surface.getByLabel('添加图片或 PDF', { exact: true }).filter({ visible: false })
    expect(await upload.getAttribute('multiple')).not.toBeNull()
    await upload.setInputFiles([bottom, middle, top])
    const order = page.getByRole('dialog', { name: '排列上传文件', exact: true })
    await order.getByRole('button', { name: '取消', exact: true }).click()
    expect(recordedInputs).toHaveLength(0)
    await upload.setInputFiles([bottom, middle, top])
    await order.getByRole('button', { name: '移除中间页.pdf', exact: true }).click()
    await order.getByLabel('继续添加', { exact: true }).filter({ visible: false }).setInputFiles(middle)
    await order.getByRole('button', { name: '上移上半题.png', exact: true }).click()
    await order.getByRole('button', { name: '上移中间页.pdf', exact: true }).click()
    const names = await order.getByRole('listitem').allTextContents()
    expect(names).toEqual(['1上半题.png', '2中间页.pdf', '3下半题.png'])
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'example-source-order.expected.md'),
      await captureStableAria(page, 'dialog[aria-label="排列上传文件"]', scaffold.workspaceCwd), MODE,
    )
    await page.screenshot({ path: join(screenshotRoot, 'upload-order.png'), animations: 'disabled' })
    minerUImages = {}
    minerUMarkdown = '已知点0，按顺序完成下面的小问。\n' + Array.from({ length: 40 }, (_, index) =>
      `（${String(index + 1)}）求 $\\frac{${String(index + 1)}}{2}$ 的值，并写出推理过程。`,
    ).join('\n') + '\n最后一小问：说明结论。'
    await order.getByRole('button', { name: '上传并转换', exact: true }).click()
    const word = surface.getByRole('region', { name: 'Word 预览', exact: true })
    await word.getByText('最后一小问：说明结论。', { exact: true }).waitFor({ timeout: 30_000 })
    expect(recordedInputs).toHaveLength(1)
    expect(recordedInputs[0]!.data.content.filter(block => block.type === 'image')).toHaveLength(3)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-continuation-input.expected.json'), JSON.stringify(
      recordedInputs[0]!.data.content.map(block => block.type === 'image'
        ? { type: 'image', mediaType: block.attachment.mediaType, name: block.attachment.name }
        : block), null, 2,
    ), MODE)
    expect(await word.innerText()).toContain('点 O')
    const source = await scaffold.ctx.teacherWorkbench.readExampleFile({ id, document: 'question', kind: 'source' })
    if (!source.ok) throw new Error(source.error.code)
    expect(source.value).toMatchObject({ name: '长题拼接-原件.pdf', mediaType: 'application/pdf' })
    const sourcePanel = surface.getByRole('region', { name: '题目原件', exact: true })
    await expect.poll(() => sourcePanel.getByRole('img').evaluateAll(images => images.map((image) => {
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) return []
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }))).toEqual([[255, 0, 0], [255, 255, 255], [255, 0, 0]])
    expect(await sourcePanel.locator('iframe').count()).toBe(0)
    const enlarge = word.getByRole('button', { name: '放大Word 预览', exact: true })
    await enlarge.click()
    const expanded = page.getByRole('dialog', { name: 'Word 预览大窗口', exact: true })
    await expanded.getByText('最后一小问：说明结论。', { exact: true }).waitFor()
    expect((await expanded.boundingBox())!.width).toBeGreaterThan(1000)
    expect((await expanded.boundingBox())!.height).toBeGreaterThan(700)
    expect(await expanded.locator('math mfrac').count()).toBe(40)
    const scroll = expanded.getByLabel('编辑 Word 内容', { exact: true }).locator('..').locator('..')
    expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await expanded.getByText('最后一小问：说明结论。', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshotRoot, 'question-word-expanded.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expanded.waitFor({ state: 'detached' })
    await expect.poll(() => enlarge.evaluate(element => element === document.activeElement)).toBe(true)
    const [download] = await Promise.all([
      page.waitForEvent('download'), word.getByRole('link', { name: '下载 Word 文件', exact: true }).click(),
    ])
    const wordPath = join(screenshotRoot, 'question.docx')
    await download.saveAs(wordPath)
    const xml = strFromU8(unzipSync(await readFile(wordPath))['word/document.xml']!)
    expect(xml).toContain('最后一小问：说明结论。')
    expect((xml.match(/<m:f>/gu) ?? []).length).toBe(40)
    await surface.getByRole('button', { name: '放大题目原件', exact: true }).click()
    const original = page.getByRole('dialog', { name: '题目原件大窗口', exact: true })
    await original.getByRole('img', { name: '长题拼接-原件.pdf，第 3 页', exact: true }).waitFor()
    expect((await original.getByRole('img').first().boundingBox())!.width).toBeGreaterThan(1000)
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'example-expanded-pdf.expected.md'),
      (await captureStableAria(page, 'dialog[aria-label="题目原件大窗口"]', scaffold.workspaceCwd))
        .replaceAll(`blob:${scaffold.baseUrl}/`, 'blob:{{webOrigin}}/'), MODE,
    )
    await original.getByRole('button', { name: '关闭预览', exact: true }).click()
    minerUMarkdown = '解析开头：按原题条件计算。\n计算结果为 $\\frac{3}{2}$。\n解析末尾：检验所有条件。'
    const explanationUpload = surface.getByLabel('添加解析图片或 PDF', { exact: true }).filter({ visible: false })
    await explanationUpload.setInputFiles([
      { ...middle, name: '解析上.pdf' }, { ...middle, name: '解析下.pdf' },
    ])
    await order.getByRole('button', { name: '上传并转换', exact: true }).click()
    const explanation = surface.getByRole('region', { name: '解析 Word 预览', exact: true })
    await explanation.getByText('解析末尾：检验所有条件。', { exact: true }).waitFor({ timeout: 30_000 })
    expect(recordedInputs).toHaveLength(2)
    expect(recordedInputs[1]!.data.content.filter(block => block.type === 'image')).toHaveLength(2)
    const [explanationDownload] = await Promise.all([
      page.waitForEvent('download'), explanation.getByRole('link', { name: '下载解析 Word 文件', exact: true }).click(),
    ])
    await explanationDownload.saveAs(join(screenshotRoot, 'explanation.docx'))
    await explanation.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
    const expandedExplanation = page.getByRole('dialog', { name: '解析 Word 预览大窗口', exact: true })
    await expandedExplanation.locator('math mfrac').waitFor()
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'example-expanded-word.expected.md'),
      (await captureStableAria(page, 'dialog[aria-label="解析 Word 预览大窗口"]', scaffold.workspaceCwd))
        .replaceAll(`blob:${scaffold.baseUrl}/`, 'blob:{{webOrigin}}/'), MODE,
    )
    await page.screenshot({ path: join(screenshotRoot, 'explanation-word-expanded.png'), animations: 'disabled' })
    const editor = expandedExplanation.getByRole('textbox', { name: '编辑 Word 内容', exact: true })
    const selectedFont = expandedExplanation.getByRole('combobox', { name: '字体', exact: true })
    const initialChinese = await editor.locator('p').first().screenshot({
      animations: 'disabled', caret: 'hide', style: '::selection { color: inherit; background: transparent; }',
    })
    const selectedTextBounds = await editor.locator('p').first().evaluate((paragraph) => {
      const text = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode()
      if (text === null || !text.textContent?.startsWith('解析开头')) throw new Error('Missing explanation text')
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 2)
      const bounds = range.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    })
    await page.mouse.move(selectedTextBounds.x + 1, selectedTextBounds.y + selectedTextBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      selectedTextBounds.x + selectedTextBounds.width - 1, selectedTextBounds.y + selectedTextBounds.height / 2, { steps: 5 },
    )
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('解析')
    await expect.poll(() => selectedFont.inputValue()).toBe('宋体')
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-initial-fonts.expected.json'), JSON.stringify({
      selected: await selectedFont.inputValue(),
      rendered: await editor.locator('[data-word-font]').first().evaluate((node) => {
        const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode()
        if (text === null || text.parentElement === null) throw new Error('Missing rendered Chinese text')
        return {
          western: node.getAttribute('data-word-font'), eastAsian: node.getAttribute('data-word-east-asian-font'),
          fontFamily: getComputedStyle(text.parentElement).fontFamily,
        }
      }),
    }, null, 2), MODE)
    await selectedFont.selectOption('宋体')
    const reappliedChinese = await editor.locator('p').first().screenshot({
      animations: 'disabled', caret: 'hide', style: '::selection { color: inherit; background: transparent; }',
    })
    await writeFile(join(screenshotRoot, 'initial-chinese-font.png'), initialChinese)
    await writeFile(join(screenshotRoot, 'reapplied-chinese-font.png'), reappliedChinese)
    expect(reappliedChinese.equals(initialChinese)).toBe(true)
    await expandedExplanation.getByRole('button', { name: '撤销', exact: true }).click()
    await selectedFont.selectOption('楷体')
    await expect.poll(() => selectedFont.inputValue()).toBe('楷体')
    await expandedExplanation.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => selectedFont.inputValue()).toBe('宋体')
    await editor.press('ControlOrMeta+a')
    await expect.poll(() => selectedFont.inputValue()).toBe('')
    expect(await selectedFont.locator('option:checked').textContent()).toBe('混合字体')
    await selectedFont.selectOption('楷体')
    await expandedExplanation.getByRole('combobox', { name: '字号', exact: true }).selectOption({ label: '三号' })
    await expandedExplanation.getByRole('button', { name: '加粗', exact: true }).click()
    await expandedExplanation.getByRole('combobox', { name: '行间距', exact: true }).selectOption('1.5')
    await editor.locator('[data-equation]').first().dblclick()
    const formulaEditor = page.getByRole('dialog', { name: '公式编辑器', exact: true })
    expect(await formulaEditor.locator('math-field [part="virtual-keyboard-toggle"]').isVisible()).toBe(false)
    await formulaEditor.locator('math-field [part="menu-toggle"]').click()
    const formulaMenu = page.getByRole('menu').filter({ visible: true })
    await formulaMenu.getByRole('menuitem', { name: '插入矩阵', exact: true }).waitFor()
    expect(await formulaMenu.getByRole('menuitem', { name: /剪切|复制|粘贴|全选/ }).count()).toBe(0)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-formula-menu.expected.md'),
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), MODE)
    await formulaMenu.getByRole('menuitem', { name: '插入', exact: true }).hover()
    await page.getByText('绝对值', { exact: true }).waitFor()
    expect(await page.getByText('微积分', { exact: true }).isVisible()).toBe(true)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-formula-insert.expected.md'),
      await captureStableAria(page, '[role="menu"]:has-text("微积分")', scaffold.workspaceCwd), MODE)
    await page.keyboard.press('Tab')
    await expect.poll(() => formulaMenu.count()).toBe(0)
    await formulaEditor.locator('math-field').press('ControlOrMeta+a')
    await formulaEditor.locator('math-field').pressSequentially('-4/3')
    await formulaEditor.locator('math-field').press('ControlOrMeta+a')
    await formulaEditor.locator('math-field [part="menu-toggle"]').click()
    await formulaMenu.getByRole('menuitem', { name: '颜色', exact: true }).hover()
    await page.getByRole('menuitemcheckbox', { name: 'blue', exact: true }).click()
    await expect.poll(() => formulaMenu.count()).toBe(0)
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    expect(await editor.locator('math mfrac').allTextContents()).toEqual(['43'])
    await expandedExplanation.getByRole('button', { name: '撤销', exact: true }).click()
    expect(await editor.locator('math mfrac').allTextContents()).toEqual(['32'])
    await expandedExplanation.getByRole('button', { name: '重做', exact: true }).click()
    expect(await editor.locator('math mfrac').allTextContents()).toEqual(['43'])
    await editor.press('ControlOrMeta+End')
    await editor.press('Enter')
    expect(await editor.locator('p').count()).toBe(4)
    await page.keyboard.insertText('手动补充：')
    await expandedExplanation.getByRole('button', { name: '加粗', exact: true }).click()
    await expandedExplanation.getByRole('button', { name: '公式编辑器', exact: true }).click()
    expect(await formulaEditor.getByText('使用下方符号键盘输入，也可以直接输入 LaTeX。', { exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-formula-symbols.expected.md'),
      await captureStableAria(page, 'dialog[aria-label="公式编辑器"]', scaffold.workspaceCwd), MODE)
    await page.screenshot({ path: join(screenshotRoot, 'formula-symbols.png'), animations: 'disabled' })
    const mathfield = formulaEditor.locator('math-field')
    const highlightTheme = async (colorScheme: 'light' | 'dark') => {
      await page.emulateMedia({ colorScheme })
      expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light')
      await mathfield.press('ControlOrMeta+a')
      await mathfield.press('Backspace')
      await formulaEditor.getByRole('button', { name: '平方根', exact: true }).click()
      await mathfield.pressSequentially('x^2')
      const context = mathfield.locator('.ML__contains-highlight')
      await context.waitFor()
      let contextBackground = ''
      await expect.poll(async () => {
        contextBackground = await context.evaluate(element => getComputedStyle(element).backgroundColor)
        return contextBackground
      }).not.toBe('')
      await mathfield.screenshot({ path: join(screenshotRoot, `formula-context-${colorScheme}.png`), animations: 'disabled' })
      await mathfield.press('ControlOrMeta+a')
      const selection = mathfield.locator('.ML__selection').first()
      await selection.waitFor()
      const colors = {
        field: await mathfield.evaluate(element => ({
          background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color,
        })),
        context: contextBackground,
        selection: await selection.evaluate(element => getComputedStyle(element).backgroundColor),
        selectedText: await mathfield.locator('.ML__selected').first().evaluate(element => getComputedStyle(element).color),
      }
      await mathfield.screenshot({ path: join(screenshotRoot, `formula-selection-${colorScheme}.png`), animations: 'disabled' })
      return colors
    }
    const lightHighlights = await highlightTheme('light')
    const darkSystemHighlights = await highlightTheme('dark')
    expect(darkSystemHighlights).toEqual(lightHighlights)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-formula-highlights.expected.json'),
      JSON.stringify(darkSystemHighlights, null, 2), MODE)
    await page.emulateMedia({ colorScheme: 'light' })
    await mathfield.press('Backspace')
    const accents = formulaEditor.getByRole('group', { name: '常用帽子', exact: true })
    expect(await accents.getByRole('button').count()).toBe(8)
    const enteredLatex = () => mathfield.evaluate(element => (element as HTMLElement & { value: string }).value)
    for (const [label, command] of [['帽号', 'hat'], ['宽帽号', 'widehat'], ['横线', 'bar'], ['长横线', 'overline'], ['波浪号', 'tilde'], ['向量箭头', 'vec'], ['单点', 'dot'], ['双点', 'ddot']] as const) {
      await mathfield.press('ControlOrMeta+a')
      await mathfield.press('Backspace')
      await accents.getByRole('button', { name: label, exact: true }).click()
      await mathfield.pressSequentially('a')
      expect((await enteredLatex()).replaceAll(' ', '')).toBe(`\\${command}{a}`)
    }
    await mathfield.press('ControlOrMeta+a')
    await mathfield.pressSequentially('a')
    const letterFont = 'KaTeX_Math'
    await expect.poll(() => mathfield.locator('.ML__mathit').evaluate(element => getComputedStyle(element).fontFamily)).toBe(letterFont)
    await mathfield.press('ControlOrMeta+a')
    await mathfield.locator('[part="menu-toggle"]').click()
    await formulaMenu.getByRole('menuitem', { name: '字体样式', exact: true }).hover()
    await page.getByRole('menuitemcheckbox', { name: '加粗', exact: true }).click()
    await expect.poll(() => formulaMenu.count()).toBe(0)
    expect(await mathfield.locator('.ML__mathbfit').evaluate(element => ({ family: getComputedStyle(element).fontFamily, weight: getComputedStyle(element).fontWeight }))).toEqual({ family: letterFont, weight: '700' })
    await mathfield.screenshot({ path: join(screenshotRoot, 'formula-letter-bold.png'), animations: 'disabled' })
    await mathfield.locator('[part="menu-toggle"]').click()
    await formulaMenu.getByRole('menuitem', { name: '字体样式', exact: true }).hover()
    await page.getByRole('menuitemcheckbox', { name: '加粗', exact: true }).click()
    await expect.poll(() => formulaMenu.count()).toBe(0)
    expect(await mathfield.locator('.ML__mathit').evaluate(element => getComputedStyle(element).fontWeight)).toBe('400')
    for (const enabled of [true, false]) {
      await mathfield.locator('[part="menu-toggle"]').click()
      await formulaMenu.getByRole('menuitem', { name: '颜色', exact: true }).hover()
      await page.getByRole('menuitemcheckbox', { name: 'blue', exact: true }).click()
      await expect.poll(() => formulaMenu.count()).toBe(0)
      expect((await enteredLatex()).includes('blue')).toBe(enabled)
    }
    await mathfield.press('ControlOrMeta+a')
    await accents.getByRole('button', { name: '帽号', exact: true }).click()
    expect(await enteredLatex()).toContain('hat')
    expect(await enteredLatex()).toContain('a')
    await mathfield.press('ControlOrMeta+a')
    await mathfield.press('Backspace')
    const romanNumbers = formulaEditor.getByRole('group', { name: '罗马数字', exact: true })
    expect(await romanNumbers.getByRole('button').count()).toBe(8)
    await romanNumbers.getByRole('button', { name: '罗马数字 ii', exact: true }).click()
    await mathfield.pressSequentially('+')
    await formulaEditor.getByRole('button', { name: '平方根', exact: true }).click()
    await mathfield.pressSequentially('x')
    await mathfield.press('ArrowRight')
    await mathfield.pressSequentially('+')
    await formulaEditor.getByRole('button', { name: '分数', exact: true }).click()
    await formulaEditor.getByRole('button', { name: '阿尔法 α', exact: true }).click()
    await page.keyboard.press('Tab')
    await formulaEditor.getByRole('button', { name: '西塔 θ', exact: true }).click()
    await mathfield.press('End')
    await mathfield.pressSequentially('+AB')
    await mathfield.press('Shift+ArrowLeft')
    await mathfield.press('Shift+ArrowLeft')
    await formulaEditor.getByRole('button', { name: '有向线段', exact: true }).click()
    await mathfield.press('End')
    await mathfield.pressSequentially('+AB')
    await formulaEditor.getByRole('button', { name: '平行 ⫽', exact: true }).click()
    await mathfield.pressSequentially('CD+')
    await formulaEditor.locator('math-field [part="menu-toggle"]').click()
    await formulaMenu.getByRole('menuitem', { name: '大括号方程组', exact: true }).click()
    await formulaMenu.waitFor({ state: 'hidden' })
    await mathfield.pressSequentially('x+y=3')
    await mathfield.press('Tab')
    await mathfield.pressSequentially('x-y=1')
    await mathfield.screenshot({ path: join(screenshotRoot, 'equation-system-input.png'), animations: 'disabled' })
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    expect(await editor.locator('[data-equation] math').count()).toBe(2)
    expect(await editor.locator('[data-equation] math').last().locator('mfrac').textContent()).toBe('αθ')
    expect(await editor.locator('[data-equation] math').last().locator('mover').textContent()).toBe('AB→')
    const insertedEquation = editor.locator('[data-equation]').last()
    expect(await insertedEquation.locator('math mtext').allTextContents()).toEqual(['ii', '\u00a0⫽\u00a0'])
    expect((await insertedEquation.locator('math').textContent())?.replaceAll('\u00a0', '')).toContain('AB⫽CD')
    expect(await insertedEquation.locator('math mtable mtr').allTextContents()).toEqual(['x+y=3', 'x−y=1'])
    expect(await insertedEquation.locator('math mo').allTextContents()).toContain('{')
    expect(await insertedEquation.locator('msqrt').textContent()).toBe('x')
    await page.evaluate(async () => { await document.fonts.ready })
    expect(await insertedEquation.locator('.katex-html .sqrt svg').count()).toBe(1)
    const equationShot = { animations: 'disabled' as const, caret: 'hide' as const,
      style: '.ProseMirror-selectednode { outline: none !important; } ::selection { background: transparent; color: inherit; }' }
    const normalEquation = await insertedEquation.screenshot({ ...equationShot, path: join(screenshotRoot, 'equation-normal.png') })
    await insertedEquation.screenshot({ ...equationShot, path: join(screenshotRoot, 'equation-large.png'),
      style: `${equationShot.style} .katex { font-size: 32pt !important; }`,
    })
    await insertedEquation.click()
    await expandedExplanation.getByRole('button', { name: '加粗', exact: true }).click()
    expect(await insertedEquation.locator('math').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    const boldEquation = await insertedEquation.screenshot({ ...equationShot, path: join(screenshotRoot, 'equation-bold.png') })
    expect(boldEquation.equals(normalEquation)).toBe(false)
    await expandedExplanation.getByRole('button', { name: '加粗', exact: true }).click()
    expect((await insertedEquation.screenshot(equationShot)).equals(normalEquation)).toBe(true)
    await expandedExplanation.getByRole('button', { name: '加粗', exact: true }).click()
    await insertedEquation.dblclick()
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    expect(await insertedEquation.locator('math').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    expect(await editor.locator('[data-equation]').evaluateAll(nodes => nodes.every((node) => {
      const bounds = node.getBoundingClientRect()
      return bounds.width > 0 && bounds.height > 0
    }))).toBe(true)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-formula-applied.expected.md'),
      await captureStableAria(page, 'dialog[aria-label="解析 Word 预览大窗口"]', scaffold.workspaceCwd), MODE)
    await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
    await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-word-edited.expected.md'),
      await captureStableAria(page, 'dialog[aria-label="解析 Word 预览大窗口"]', scaffold.workspaceCwd), MODE)
    const edited = await scaffold.ctx.teacherWorkbench.readExampleWordEditor({ id, document: 'explanation' })
    if (!edited.ok) throw new Error(edited.error.code)
    expect(edited.value.paragraphs[0]).toMatchObject({ lineSpacing: 1.5, content: [
      { kind: 'text', format: { eastAsiaFont: '楷体', size: 16, bold: true } },
    ] })
    expect(edited.value.equations).toHaveLength(2)
    expect(edited.value.equations[0]!.latex.replaceAll(' ', '')).toContain(String.raw`\frac{4}{3}`)
    expect(edited.value.equations[0]!.latex).toContain('\\textcolor{#0000ff}')
    expect(edited.value.equations[1]!.latex.replaceAll(' ', '')).toBe(String.raw`\text{ii}+\sqrt{x}+\frac{\alpha}{\theta}+\overrightarrow{AB}+AB\text{⫽}CD+\begin{cases}x+y=3\\x-y=1\end{cases}`)
    expect(edited.value.equations[1]!.mathml).toContain('<mtable')
    expect(edited.value.paragraphs.at(-1)?.content.at(-1)).toMatchObject({ kind: 'equation', bold: true })
    expect(await insertedEquation.locator('math').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    const editedDownload = await scaffold.ctx.teacherWorkbench.readExampleFile({ id, document: 'explanation', kind: 'word' })
    if (!editedDownload.ok) throw new Error(editedDownload.error.code)
    expect(strFromU8(unzipSync(Buffer.from(editedDownload.value.contentBase64, 'base64'))['word/document.xml']!)).toContain('<w:color w:val="0000FF"')
    await writeFile(join(screenshotRoot, 'edited.docx'), Buffer.from(editedDownload.value.contentBase64, 'base64'))
    await page.screenshot({ path: join(screenshotRoot, 'edited-expanded.png'), animations: 'disabled' })
    await expandedExplanation.getByRole('button', { name: '关闭预览', exact: true }).click()
    await word.getByRole('button', { name: '放大Word 预览', exact: true }).click()
    const formattedQuestion = page.getByRole('dialog', { name: 'Word 预览大窗口', exact: true })
    await formattedQuestion.getByRole('textbox', { name: '编辑 Word 内容', exact: true }).press('ControlOrMeta+a')
    await formattedQuestion.getByRole('combobox', { name: '字体', exact: true }).selectOption('Arial')
    await formattedQuestion.getByRole('combobox', { name: '字号', exact: true }).selectOption({ label: '四号' })
    await formattedQuestion.getByRole('button', { name: '斜体', exact: true }).click()
    await formattedQuestion.getByRole('button', { name: '下划线', exact: true }).click()
    await formattedQuestion.getByRole('button', { name: '右对齐', exact: true }).click()
    await formattedQuestion.getByRole('button', { name: '增加缩进', exact: true }).click()
    await formattedQuestion.getByRole('combobox', { name: '行间距', exact: true }).selectOption('2')
    await formattedQuestion.getByRole('button', { name: '关闭预览', exact: true }).click()
    const unsaved = page.getByRole('dialog', { name: '有未保存的修改', exact: true })
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-unsaved-word.expected.md'),
      await captureStableAria(page, 'dialog[aria-label="有未保存的修改"]', scaffold.workspaceCwd), MODE)
    await unsaved.screenshot({ path: join(screenshotRoot, 'unsaved-word-dialog.png'), animations: 'disabled' })
    await unsaved.getByRole('button', { name: '继续', exact: true }).click()
    await formattedQuestion.getByText('有未保存的修改', { exact: true }).waitFor()
    await formattedQuestion.getByRole('button', { name: '关闭预览', exact: true }).click()
    await unsaved.getByRole('button', { name: '保存并关闭', exact: true }).click()
    await formattedQuestion.waitFor({ state: 'hidden' })
    const savedQuestion = await scaffold.ctx.teacherWorkbench.readExampleWordEditor({ id, document: 'question' })
    if (!savedQuestion.ok) throw new Error(savedQuestion.error.code)
    expect(savedQuestion.value.paragraphs[0]).toMatchObject({ alignment: 'right', indent: 12, lineSpacing: 2 })
    expect(savedQuestion.value.paragraphs[0]?.content[0]).toMatchObject({
      kind: 'text', format: { font: 'Arial', size: 14, italic: true, underline: true },
    })
    const questionFile = await scaffold.ctx.teacherWorkbench.readExampleFile({ id, document: 'question', kind: 'word' })
    if (!questionFile.ok) throw new Error(questionFile.error.code)
    const editedParagraphs = async (bytes: Uint8Array) => page.evaluate((source) => {
      const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      const document = new DOMParser().parseFromString(source, 'application/xml')
      return Array.from(document.getElementsByTagNameNS(namespace, 'p'))
        .filter(paragraph => paragraph.getElementsByTagNameNS(namespace, 'pStyle').item(0)
          ?.getAttributeNS(namespace, 'val')?.startsWith('DshExampleEdited'))
        .map(paragraph => new XMLSerializer().serializeToString(paragraph))
    }, strFromU8(unzipSync(bytes)['word/document.xml']!))
    const questionParagraphs = await editedParagraphs(Buffer.from(questionFile.value.contentBase64, 'base64'))
    const explanationParagraphs = await editedParagraphs(Buffer.from(editedDownload.value.contentBase64, 'base64'))
    expect(questionParagraphs).not.toHaveLength(0)
    expect(explanationParagraphs).not.toHaveLength(0)
    await surface.getByRole('button', { name: '放大题目解析', exact: true }).click()
    const explanationOriginal = page.getByRole('dialog', { name: '题目解析大窗口', exact: true })
    await explanationOriginal.getByRole('img', { name: '长题拼接-解析原件.pdf，第 2 页', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.reload({ waitUntil: 'load' })
    await openModule('典例收集')
    await directory.getByRole('button', { name: '长题拼接', exact: false }).first().click()
    await word.getByText('最后一小问：说明结论。', { exact: true }).waitFor()
    await explanation.getByText('解析末尾：检验所有条件。', { exact: true }).waitFor()
    expect(await explanation.locator('math mfrac').allTextContents()).toEqual(['43', 'αθ'])
    expect(await explanation.locator('.katex-html').first().locator('[style]').evaluateAll(elements => elements.some(element => (element as HTMLElement).style.color === 'rgb(0, 0, 255)'))).toBe(true)
    expect(await explanation.locator('math mtable mtr').allTextContents()).toEqual(['x+y=3', 'x−y=1'])
    expect(await explanation.locator('math').last().locator('mtext').allTextContents()).toEqual(['ii', '\u00a0⫽\u00a0'])
    expect((await explanation.locator('math').last().textContent())?.replaceAll('\u00a0', '')).toContain('AB⫽CD')
    expect(await explanation.locator('math').last().evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    expect(await explanation.locator('.katex-html').last().locator('.boldsymbol').count()).toBeGreaterThan(0)
    await sourcePanel.getByRole('img', { name: '长题拼接-原件.pdf，第 3 页', exact: true }).waitFor()
    expect(recordedInputs).toHaveLength(2)
    await surface.getByRole('textbox', { name: '搜索题目', exact: true }).fill('')
    await surface.getByRole('button', { name: '搜索', exact: true }).click()
    const searchResults = page.getByRole('dialog', { name: '搜索结果', exact: true })
    await searchResults.getByRole('checkbox', { name: '选择题目“长题拼接”', exact: true }).check()
    for (const layout of ['paired', 'grouped'] as const) {
      await searchResults.getByRole('button', { name: '导出 Word', exact: true }).click()
      const exporter = page.getByRole('dialog', { name: '导出 Word', exact: true })
      if (layout === 'grouped') await exporter.getByRole('radio', { name: '所有题目在前，解析集中在后', exact: false }).check()
      const [download] = await Promise.all([
        page.waitForEvent('download'), exporter.getByRole('button', { name: '导出并下载', exact: true }).click(),
      ])
      const path = join(screenshotRoot, `search-edited-${layout}.docx`)
      await download.saveAs(path)
      expect(await editedParagraphs(await readFile(path))).toEqual([...questionParagraphs, ...explanationParagraphs])
      await exporter.waitFor({ state: 'detached' })
    }
    await searchResults.getByRole('button', { name: '关闭搜索结果', exact: true }).click()
    await surface.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
    await page.evaluate(async () => { await document.fonts.ready })
    const formulaLayout = async (formula: Locator) => formula.evaluate(element => ({
      font: getComputedStyle(element).fontFamily,
      color: getComputedStyle(element).color,
      bases: [...element.querySelectorAll('.base')].map((base) => {
        const bounds = base.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height }
      }),
      radicalFills: [...element.querySelectorAll('.sqrt svg')].map(svg => getComputedStyle(svg).fill),
      strutMinHeights: [...new Set([...element.querySelectorAll('.pstrut')].map(strut => getComputedStyle(strut).minHeight))],
    }))
    const cardFormula = await formulaLayout(explanation.locator('.katex').last())
    const expandedFormula = await formulaLayout(editor.locator('.katex').last())
    expect(cardFormula.font).toBe(expandedFormula.font)
    expect(cardFormula.radicalFills).toEqual(expandedFormula.radicalFills.map(() => cardFormula.color))
    expect(cardFormula.strutMinHeights).toEqual(expandedFormula.strutMinHeights)
    expect(cardFormula.bases).toHaveLength(expandedFormula.bases.length)
    for (const [index, base] of cardFormula.bases.entries()) {
      expect(base.width).toBeCloseTo(expandedFormula.bases[index]!.width, 1)
      expect(base.height).toBeCloseTo(expandedFormula.bases[index]!.height, 1)
    }
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/teacher-workbench/example-formula-layout.expected.json', import.meta.url)),
      JSON.stringify({ font: cardFormula.font, radicalFills: cardFormula.radicalFills,
        strutMinHeights: cardFormula.strutMinHeights, baseCount: cardFormula.bases.length }, null, 2), MODE,
    )
    await editor.locator('[data-equation]').last().dblclick()
    await mathfield.press('End')
    await mathfield.pressSequentially('+1')
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    expect(await formulaEditor.count()).toBe(0)
    expect(await editor.locator('[data-equation] math').last().textContent().then(text => text?.replaceAll(/\s/gu, ''))).toContain('⫽')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '放弃', exact: true }).click()
    await explanation.screenshot({ path: join(screenshotRoot, 'formula-card-layout.png'), animations: 'disabled' })
    expect(recordedInputs).toHaveLength(2)
    await explanation.getByRole('button', { name: 'AI 校对', exact: true }).click()
    await explanation.getByText('解析末尾：检验所有条件。', { exact: true }).waitFor({ timeout: 30_000 })
    expect(recordedInputs).toHaveLength(3)
    expect(recordedInputs[2]!.data.content.filter(block => block.type === 'image')).toHaveLength(2)
    for (const layout of ['paired', 'grouped'] as const) {
      const exported = await scaffold.ctx.teacherWorkbench.exportExamplesWord({ ids: [id], layout })
      if (!exported.ok) throw new Error(exported.error.code)
      const bytes = Buffer.from(exported.value.contentBase64, 'base64')
      await writeFile(join(screenshotRoot, `export-${layout}.docx`), bytes)
      const xml = strFromU8(unzipSync(bytes)['word/document.xml']!)
      expect(xml.indexOf('解析开头')).toBeGreaterThan(xml.indexOf('最后一小问'))
      expect(xml).toContain('解析末尾：检验所有条件。')
      expect((xml.match(/<m:f>/gu) ?? []).length).toBe(41)
      expect(xml).not.toMatch(/上半题|下半题|中间页|解析上|解析下/u)
    }
    expect(recordedInputs).toHaveLength(3)
    await surface.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
    await editor.locator('[data-equation]').last().dblclick()
    await mathfield.press('ControlOrMeta+a')
    await mathfield.press('Backspace')
    await mathfield.pressSequentially('b=(1,-')
    await formulaEditor.getByRole('button', { name: '平方根', exact: true }).click()
    await mathfield.pressSequentially('3')
    await mathfield.press('End')
    await mathfield.press('ControlOrMeta+a')
    await mathfield.locator('[part="menu-toggle"]').click()
    await formulaMenu.getByRole('menuitem', { name: '字体样式', exact: true }).hover()
    await page.getByRole('menuitemcheckbox', { name: '加粗', exact: true }).click()
    await expect.poll(() => formulaMenu.count()).toBe(0)
    expect(await enteredLatex()).toContain('\\mathbfit')
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    await formulaEditor.waitFor({ state: 'detached' })
    await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
    await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
    await expandedExplanation.getByRole('button', { name: '关闭预览', exact: true }).click()
    await surface.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
    expect(await editor.locator('math mi[mathvariant="bold-italic"]').first().textContent()).toBe('b')
    await editor.locator('[data-equation]').last().dblclick()
    await mathfield.press('End')
    await mathfield.pressSequentially('+1')
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    await formulaEditor.waitFor({ state: 'detached' })
    await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
    await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'example-formula-bold-saved.expected.md'),
      await captureStableAria(page, 'dialog[aria-label="解析 Word 预览大窗口"]', scaffold.workspaceCwd), MODE)
    await page.screenshot({ path: join(screenshotRoot, 'formula-bold-saved.png'), animations: 'disabled' })
    const boldDownload = await scaffold.ctx.teacherWorkbench.readExampleFile({ id, document: 'explanation', kind: 'word' })
    if (!boldDownload.ok) throw new Error(boldDownload.error.code)
    const boldParagraphs = await editedParagraphs(Buffer.from(boldDownload.value.contentBase64, 'base64'))
    expect(boldParagraphs.join('')).toContain('m:val="bi"')
    for (const layout of ['paired', 'grouped'] as const) {
      const exported = await scaffold.ctx.teacherWorkbench.exportExamplesWord({ ids: [id], layout })
      if (!exported.ok) throw new Error(exported.error.code)
      expect(await editedParagraphs(Buffer.from(exported.value.contentBase64, 'base64'))).toEqual([...questionParagraphs, ...boldParagraphs])
    }
    await editor.locator('[data-equation]').last().dblclick()
    await mathfield.press('ControlOrMeta+a')
    await mathfield.press('Backspace')
    await formulaEditor.getByRole('button', { name: '补集', exact: true }).click()
    await mathfield.pressSequentially('U')
    await mathfield.press('Tab')
    await mathfield.pressSequentially('A')
    await mathfield.press('End')
    for (const [button, left, right] of [
      ['真子集 ⫋', 'A', 'B'], ['真包含 ⫌', 'A', 'B'], ['子集 ⊆', 'A', 'B'], ['包含 ⊇', 'A', 'B'],
      ['小于等于 ⩽', 'a', 'b'], ['大于等于 ⩾', 'a', 'b'],
      ['任意 ∀', '', 'x'], ['存在 ∃', '', 'x'], ['不存在 ∄', '', 'x'],
      ['不平行 ∦', 'AB', 'CD'], ['圆 ⊙', '', 'O'], ['平行四边形 ▱', '', 'ABCD'],
    ] as const) {
      await mathfield.pressSequentially(`;${left}`)
      await formulaEditor.getByRole('button', { name: button, exact: true }).click()
      await mathfield.pressSequentially(right)
    }
    await mathfield.pressSequentially(';')
    await formulaEditor.getByRole('button', { name: '二阶导数', exact: true }).click()
    await mathfield.pressSequentially('x')
    await mathfield.press('End')
    await mathfield.screenshot({ path: join(screenshotRoot, 'set-geometry-symbols-input.png'), animations: 'disabled' })
    const paletteLatex = await enteredLatex()
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    await expect.poll(() => formulaEditor.count(), { message: paletteLatex }).toBe(0)
    const symbolText = '∁UA;A⫋B;A⫌B;A⊆B;A⊇B;a⩽b;a⩾b;∀x;∃x;∄x;AB⫽⃥CD;⊙O;▱ABCD;f′′(x)'
    const previewSymbolText = () => editor.locator('[data-equation] math').last().textContent().then(text => text?.replaceAll(/\s/gu, ''))
    expect(await previewSymbolText()).toBe(symbolText)
    await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
    await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
    await expandedExplanation.getByRole('button', { name: '关闭预览', exact: true }).click()
    await surface.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
    expect(await previewSymbolText()).toBe(symbolText)
    await editor.locator('[data-equation]').last().dblclick()
    await mathfield.press('End')
    await mathfield.pressSequentially('+1')
    await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
    await formulaEditor.waitFor({ state: 'detached' })
    await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
    await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
    expect(await previewSymbolText()).toBe(`${symbolText}+1`)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/teacher-workbench/example-set-geometry-symbols.expected.md', import.meta.url)),
      await captureStableAria(page, 'dialog[aria-label="解析 Word 预览大窗口"]', scaffold.workspaceCwd), MODE,
    )
    const symbolDownload = await scaffold.ctx.teacherWorkbench.readExampleFile({ id, document: 'explanation', kind: 'word' })
    if (!symbolDownload.ok) throw new Error(symbolDownload.error.code)
    const symbolBytes = Buffer.from(symbolDownload.value.contentBase64, 'base64')
    const symbolParagraphs = await editedParagraphs(symbolBytes)
    expect(await page.evaluate((xml) => {
      const document = new DOMParser().parseFromString(xml, 'application/xml')
      return [...document.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath')].at(-1)?.textContent?.replaceAll(/\s/gu, '')
    }, strFromU8(unzipSync(symbolBytes)['word/document.xml']!))).toBe(`${symbolText}+1`)
    for (const layout of ['paired', 'grouped'] as const) {
      const exported = await scaffold.ctx.teacherWorkbench.exportExamplesWord({ ids: [id], layout })
      if (!exported.ok) throw new Error(exported.error.code)
      expect(await editedParagraphs(Buffer.from(exported.value.contentBase64, 'base64'))).toEqual([...questionParagraphs, ...symbolParagraphs])
    }
    const symbolWeights: Record<string, string[]> = {}
    for (const [button, glyph] of [['小于等于 ⩽', '⩽'], ['真子集 ⫋', '⫋'], ['平行四边形 ▱', '▱'], ['平行 ⫽', '⫽']] as const) {
      await editor.locator('[data-equation]').last().dblclick()
      await mathfield.press('ControlOrMeta+a')
      await mathfield.press('Backspace')
      await formulaEditor.getByRole('button', { name: button, exact: true }).click()
      await mathfield.pressSequentially(';')
      await formulaEditor.getByRole('button', { name: button, exact: true }).click()
      await mathfield.press('Home')
      if (glyph === '⫽' || glyph === '⫋') await mathfield.press('ArrowRight')
      await mathfield.press('Shift+ArrowRight')
      for (const enabled of [true, false, true]) {
        await mathfield.locator('[part="menu-toggle"]').click()
        await formulaMenu.getByRole('menuitem', { name: '字体样式', exact: true }).hover()
        await page.getByRole('menuitemcheckbox', { name: '加粗', exact: true }).click()
        await expect.poll(() => formulaMenu.count()).toBe(0)
        const toggledLatex = await enteredLatex()
        expect(/\\(?:mathbf|mathbfit|textbf)\b/u.test(toggledLatex), `${button}: ${toggledLatex}`).toBe(enabled)
      }
      const styledLatex = await enteredLatex()
      await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
      await expect.poll(() => formulaEditor.count(), { message: styledLatex }).toBe(0)
      const appearance = () => editor.locator('[data-equation]').last().evaluate((element, symbol) => {
        return [...element.querySelectorAll('.katex-html span')]
          .filter(node => node.childElementCount === 0 && node.textContent?.includes(symbol))
          .map(node => ({ weight: getComputedStyle(node).fontWeight, family: getComputedStyle(node).fontFamily }))
      }, glyph)
      const applied = await appearance()
      expect(applied.map(symbol => symbol.weight), `${button}: ${styledLatex}`).toEqual(['700', '400'])
      expect(applied[0]!.family).toBe(applied[1]!.family)
      await editor.locator('[data-equation]').last().screenshot({ path: join(screenshotRoot, `bold-symbol-${glyph}.png`), animations: 'disabled' })
      await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
      await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
      await expandedExplanation.getByRole('button', { name: '关闭预览', exact: true }).click()
      await surface.getByRole('button', { name: '放大解析 Word 预览', exact: true }).click()
      expect(await appearance()).toEqual(applied)
      await editor.locator('[data-equation]').last().dblclick()
      await mathfield.press('End')
      await mathfield.pressSequentially('+1')
      await formulaEditor.getByRole('button', { name: '应用公式', exact: true }).click()
      await formulaEditor.waitFor({ state: 'detached' })
      expect(await appearance()).toEqual(applied)
      await expandedExplanation.getByRole('button', { name: '保存', exact: true }).click()
      await expandedExplanation.getByText('已保存', { exact: true }).waitFor()
      const styledDownload = await scaffold.ctx.teacherWorkbench.readExampleFile({ id, document: 'explanation', kind: 'word' })
      if (!styledDownload.ok) throw new Error(styledDownload.error.code)
      const styledBytes = Buffer.from(styledDownload.value.contentBase64, 'base64')
      expect(await page.evaluate(({ xml, symbol }) => {
        const document = new DOMParser().parseFromString(xml, 'application/xml')
        return [...document.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'r')]
          .filter(run => run.textContent?.includes(symbol))
          .map(run => run.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'b').length > 0)
      }, { xml: strFromU8(unzipSync(styledBytes)['word/document.xml']!), symbol: glyph })).toEqual([true, false])
      const styledParagraphs = await editedParagraphs(styledBytes)
      for (const layout of ['paired', 'grouped'] as const) {
        const exported = await scaffold.ctx.teacherWorkbench.exportExamplesWord({ ids: [id], layout })
        if (!exported.ok) throw new Error(exported.error.code)
        expect(await editedParagraphs(Buffer.from(exported.value.contentBase64, 'base64'))).toEqual([...questionParagraphs, ...styledParagraphs])
      }
      symbolWeights[glyph] = applied.map(symbol => symbol.weight)
    }
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/teacher-workbench/example-bold-symbols.expected.md', import.meta.url)),
      `${await captureStableAria(page, 'dialog[aria-label="解析 Word 预览大窗口"]', scaffold.workspaceCwd)}\n\n${JSON.stringify(symbolWeights, null, 2)}`, MODE,
    )
    const completePalette = await auditExampleFormulaPalette(page, scaffold, { id, document: 'explanation' }, screenshotRoot)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/teacher-workbench/example-complete-palette.expected.json', import.meta.url)), JSON.stringify(completePalette, null, 2), MODE)
    await expandedExplanation.getByRole('button', { name: '关闭预览', exact: true }).click()
    expect(tripwire.pageErrors).toEqual([])
  }, 900_000)

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

  it('distinguishes microphone permission denial from device startup failure', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-voice-error'))
    await openModule('日常管理')
    await page.evaluate(() => {
      Object.defineProperty(window.navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      })
    })
    const todoPanel = page.locator('section[aria-labelledby="daily-todo-title"]')
    await todoPanel.getByRole('button', { name: '开始语音输入' }).click()
    const alert = page.getByRole('alert')
    await alert.waitFor({ timeout: 10_000 })
    expect(await todoPanel.getByRole('button', { name: '麦克风访问被拒绝，请在地址栏的网站权限和系统隐私设置中允许麦克风访问' }).count()).toBe(1)
    await compareOrRefreshGolden(
      VOICE_ERROR_EXPECTED,
      await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd),
      MODE,
    )
    await openModule('典例收集')
    const description = page.getByRole('region', { name: '题目描述', exact: true })
    if (await description.count() === 0) {
      await page.getByRole('complementary', { name: '题目目录', exact: true })
        .getByRole('button', { name: '添加新题', exact: true }).click()
    }
    await page.evaluate(() => {
      Object.defineProperty(window.navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: () => Promise.reject(new DOMException('device could not start', 'NotReadableError')),
      })
    })
    await description.getByRole('button', { name: '开始语音输入' }).click()
    await description.getByRole('button', { name: '麦克风无法启动，请检查是否被其他程序占用，并确认系统中的输入设备可用' }).waitFor()
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'example-voice-error.expected.md'),
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
    const physicalClassDirectory = join(
      scaffold.harnessHome,
      'teacher-workbench',
      'students',
      '未分学年',
      '高一(1)班',
    )
    expect((await stat(physicalClassDirectory)).isDirectory()).toBe(true)
    expect((await stat(join(physicalClassDirectory, '张同学'))).isDirectory()).toBe(true)
    expect((await stat(join(physicalClassDirectory, '李同学'))).isDirectory()).toBe(true)
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
        destination: { kind: 'source-folder' },
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
    expect((await stat(join(
      scaffold.harnessHome,
      'teacher-workbench',
      'students',
      '未分学年',
      '高一(1)班',
      student.name,
      '月考',
    ))).isDirectory()).toBe(true)

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
    const directSaveDirectory = join(
      scaffold.harnessHome,
      'teacher-workbench',
      'segments',
      '模拟题库',
      '八月题库',
    )
    expect((await stat(directSaveDirectory)).isDirectory()).toBe(true)
    const libraryDocument = await scaffold.ctx.teacherWorkbench.read({})
    const directSaveFolder = libraryDocument.value.state.questionLibraryFolders.find(item => item.name === '八月题库')
    if (directSaveFolder === undefined) throw new Error('direct-save library folder is missing')

    await page.locator('[data-question-workbench] input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
      name: '默认目录试卷.pdf',
      mimeType: 'application/pdf',
      buffer: onePagePdfFixture(),
    })
    const pageRangeDialog = page.getByRole('dialog', { name: '选择页码范围' })
    await pageRangeDialog.waitFor({ timeout: 10_000 })
    const saveDirectory = pageRangeDialog.getByLabel('保存目录')
    expect(await saveDirectory.inputValue()).toBe('')
    const directoryOptions = await saveDirectory.locator('option').allTextContents()
    expect(directoryOptions).toContain('不选择（按 PDF 名新建文件夹）')
    expect(directoryOptions).toContain('模拟题库 / 八月题库')
    expect(directoryOptions).not.toContain('模拟题库')
    await compareOrRefreshGolden(
      QUESTION_SAVE_DIRECTORY_EXPECTED,
      await captureStableAria(page, '[role="dialog"][aria-label="选择页码范围"]', scaffold.workspaceCwd),
      MODE,
    )
    await pageRangeDialog.getByRole('button', { name: '关闭工作台' }).click()
    await pageRangeDialog.waitFor({ state: 'hidden', timeout: 10_000 })

    const directSaved = await scaffold.ctx.teacherWorkbench.saveQuestionBatch({
      destination: { kind: 'library-folder', folderId: directSaveFolder.id },
      name: '目录直存验证',
      sourceName: '目录直存验证.pdf',
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
    if (!directSaved.ok || directSaved.value.batchId === undefined) throw new Error('direct-save batch failed')
    const directBatch = directSaved.value.document.state.questionBatches.find(item => item.id === directSaved.value.batchId)
    if (directBatch === undefined) throw new Error('direct-save batch is missing')
    expect(directBatch.images[0]!.fileName).toBe('第1题.png')
    expect((await stat(join(directSaveDirectory, '第1题.png'))).isFile()).toBe(true)
    await expect(stat(join(directSaveDirectory, '目录直存验证'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directSaveDirectory, String(directBatch.id)))).rejects.toMatchObject({ code: 'ENOENT' })

    const directSaveFolderButton = bankFolders.getByRole('button', { name: '八月题库', exact: true })
    await expect.poll(async () => directSaveFolderButton.locator('small').textContent(), { timeout: 10_000 }).toBe('1')
    expect(await bankFolders.getByText('目录直存验证', { exact: true }).count()).toBe(0)
    await directSaveFolderButton.click()
    const directBatchImages = page.getByRole('complementary', { name: '试题库图片' })
    await directBatchImages.getByRole('button', { name: '第 1 题', exact: true }).waitFor({ timeout: 10_000 })
    await directSaveFolderButton.click()
    await directBatchImages.waitFor({ state: 'hidden', timeout: 10_000 })
    const directSaveDelete = directSaveFolderButton.locator('..').getByRole('button', {
      name: '删除目录“八月题库”',
    })
    await directSaveFolderButton.hover()
    let directSaveConfirmation = ''
    page.once('dialog', async (dialog) => {
      directSaveConfirmation = dialog.message()
      await dialog.accept()
    })
    await directSaveDelete.click()
    expect(directSaveConfirmation).toBe('确认删除目录“八月题库”及其下全部内容吗？')
    await directSaveFolderButton.waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(stat(directSaveDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directSaveDirectory, '..', `${String(directBatch.images[0]!.id)}.png`)))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const deletedDirectoryDocument = await scaffold.ctx.teacherWorkbench.read({})
    expect(deletedDirectoryDocument.value.state.questionBatches.some(item => item.id === directBatch.id)).toBe(false)

    const automaticDirectoryButton = bankFolders.getByRole('button', { name: 'layout', exact: true })
    await automaticDirectoryButton.click()
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

    await automaticDirectoryButton.click()
    await bankImages.waitFor({ state: 'hidden', timeout: 10_000 })
    await bankFolders.getByRole('button', { name: '关闭工作台' }).click()
    await page.getByRole('button', { name: '试题图片库', exact: true }).click()
    await bankFolders.waitFor({ timeout: 10_000 })
    await automaticDirectoryButton.click()
    await bankImages.waitFor({ timeout: 10_000 })
    expect(await bankImages.getByRole('button', { name: '另存为' }).isDisabled()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('preserves existing question-directory names when saving images and creating children', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-directory-names'))
    const segmentsRoot = join(scaffold.harnessHome, 'question directory names')
    const directoryName = '期中\u3000数学（卷）'
    const directory = join(segmentsRoot, directoryName)
    const raster = await readFile(RASTER_FIXTURE)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, '第1题.png'), raster)
    await scaffold.ctx.settings.update('teacher-workbench', { segmentsRoot })
    const discovered = await scaffold.ctx.teacherWorkbench.browseQuestionMedia({})
    if (!discovered.ok) throw new Error(discovered.error.message)
    const folder = discovered.value.questionLibraryFolders.find(item => item.name === directoryName)!
    const saved = await scaffold.ctx.teacherWorkbench.saveQuestionBatch({
      destination: { kind: 'library-folder', folderId: folder.id },
      name: '继续切题', sourceName: '继续切题.pdf', pageRange: '1',
      images: [{ questionNo: 2, fileName: '第2题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: raster.toString('base64') }],
    })
    if (!saved.ok) throw new Error(saved.error.message)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('试题切割')
    await page.getByRole('region', { name: '工作台', exact: true }).getByRole('button', { name: '试题图片库', exact: true }).click()
    const folders = page.getByRole('complementary', { name: '试题图片库' })
    const folderButton = folders.locator(`button[aria-label="${directoryName}"]`)
    await expect.poll(() => folderButton.count()).toBe(1)
    await folderButton.click()
    const images = page.getByRole('complementary', { name: '试题库图片' })
    await images.getByRole('button', { name: '第 2 题', exact: true }).waitFor({ timeout: 10_000 })
    await folderButton.click({ clickCount: 2 })
    const dialog = page.getByRole('dialog', { name: '新建文件夹' })
    await dialog.getByLabel('目录名').fill('新练习')
    await dialog.getByRole('button', { name: '新建', exact: true }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    await folders.getByRole('button', { name: '新练习', exact: true }).waitFor({ timeout: 10_000 })
    expect(await folderButton.count()).toBe(1)
    expect(await readdir(segmentsRoot)).toEqual([directoryName])
    expect((await readdir(directory)).sort()).toEqual(['新练习', '第1题.png', '第2题.png'])
    expect(await readFile(join(directory, '第1题.png'))).toEqual(raster)
    await compareOrRefreshGolden(
      QUESTION_DIRECTORY_NAMES_EXPECTED,
      await captureStableAria(page, 'aside[aria-label="试题图片库"]', scaffold.workspaceCwd),
      MODE,
    )
  })

  it('exports uploaded question pictures with proportional scaling and equal side margins', async () => {
    const original = await readFile(RASTER_FIXTURE)
    const result = await scaffold.ctx.teacherWorkbench.generateUploadedQuestionDocument({
      kind: 'ppt',
      folderName: '等比例缩放验证',
      images: [{ fileName: '第1题.png', relativePath: '第1题.png', contentBase64: original.toString('base64') }],
    })
    if (!result.ok) throw new Error(result.error.message)
    const parts = unzipSync(Buffer.from(result.value.contentBase64, 'base64'))
    const slide = strFromU8(parts['ppt/slides/slide1.xml']!)
    const picture = slide.slice(slide.indexOf('<p:pic>'))
    const image = Buffer.from(parts['ppt/media/image-1-1.png']!)
    const presentation = strFromU8(parts['ppt/presentation.xml']!)
    const offset = /<a:off x="(\d+)" y="(\d+)"\/>/u.exec(picture)!
    const extent = /<a:ext cx="(\d+)" cy="(\d+)"\/>/u.exec(picture)!
    const slideSize = /<p:sldSz cx="(\d+)" cy="(\d+)"/u.exec(presentation)!
    const leftMargin = Number(offset[1])
    const rightMargin = Number(slideSize[1]) - leftMargin - Number(extent[1])
    expect(rightMargin).toBe(leftMargin)
    expect(image.readUInt32BE(16)).toBe(original.readUInt32BE(16))
    expect(image.readUInt32BE(20)).toBe(original.readUInt32BE(20))
    expect(Number(extent[2]) / Number(extent[1])).toBeCloseTo(original.readUInt32BE(20) / original.readUInt32BE(16), 6)
    expect(picture).not.toContain('<a:srcRect')
    await compareOrRefreshGolden(QUESTION_PPT_SCALING_EXPECTED, JSON.stringify({
      fileName: result.value.fileName,
      originalPixels: { width: original.readUInt32BE(16), height: original.readUInt32BE(20) },
      embeddedPixels: { width: image.readUInt32BE(16), height: image.readUInt32BE(20) },
      slideEmu: { width: Number(slideSize[1]), height: Number(slideSize[2]) },
      pictureEmu: { x: Number(offset[1]), y: Number(offset[2]), width: Number(extent[1]), height: Number(extent[2]) },
      crop: /<a:srcRect[^>]*\/>/u.exec(picture)?.[0] ?? null,
    }, null, 2), MODE)
  })

  it('accumulates student folder subtrees into Word and PowerPoint with one active save picker', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-student-export'))
    const studentsRoot = join(scaffold.harnessHome, 'student-export', 'students')
    const classDirectory = join(studentsRoot, '2026', '高一', '回归班')
    const raster = await readFile(RASTER_FIXTURE)
    for (const path of [
      '甲同学/根目录.png',
      '甲同学/月考/第1题.png',
      '甲同学/月考/第一周/第2题.png',
      '甲同学/月考/第一周/订正/第3题.png',
      '甲同学/周练/其他目录.png',
      '乙同学/月考/其他学生.png',
      ...Array.from({ length: 120 }, (_, index) => `甲同学/周练/加练/第${String(index + 4)}题.png`),
    ]) {
      const segments = path.split('/')
      await mkdir(join(classDirectory, ...segments.slice(0, -1)), { recursive: true })
      await writeFile(join(classDirectory, path), raster)
    }
    await scaffold.ctx.settings.update('teacher-workbench', { studentsRoot })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('试题切割')
    await page.getByRole('complementary', { name: '学生目录' })
      .getByRole('button', { name: '高一回归班', exact: true }).dblclick()
    const classDrawer = page.getByRole('complementary', { name: '学生列表' })
    await classDrawer.getByRole('button', { name: '甲同学', exact: true }).dblclick()
    await classDrawer.getByRole('button', { name: '月考', exact: true }).click()
    const studentImages = page.getByRole('complementary', { name: '学生图片' })
    await expect.poll(() => studentImages.getByRole('checkbox', { name: '选择' }).count()).toBe(3)
    for (const name of ['第1题.png', '第2题.png', '第3题.png']) {
      expect(await studentImages.getByRole('button', { name, exact: true }).count()).toBe(1)
    }
    for (const name of ['根目录.png', '其他目录.png', '其他学生.png']) {
      expect(await studentImages.getByRole('button', { name, exact: true }).count()).toBe(0)
    }
    const subtreeAria = await captureStableAria(page, 'aside[aria-label="学生图片"]', scaffold.workspaceCwd)
    await studentImages.getByRole('button', { name: '全选', exact: true }).click()
    await studentImages.getByRole('button', { name: '临时保存', exact: true }).click()
    await studentImages.getByText('该学生已暂存 3 张', { exact: true }).waitFor()
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('试题切割')
    await page.getByRole('complementary', { name: '学生目录' })
      .getByRole('button', { name: '高一回归班', exact: true }).dblclick()
    await classDrawer.getByRole('button', { name: '甲同学', exact: true }).dblclick()
    await classDrawer.getByRole('button', { name: '月考', exact: true }).click()
    await studentImages.getByText('该学生已暂存 3 张', { exact: true }).waitFor()

    const destination = join(scaffold.harnessHome, ' 保存目录 含空格\u00a0')
    await mkdir(destination)
    const chooseDestination = async (): Promise<Locator> => {
      const picker = page.getByRole('dialog', { name: '选择保存目录（运行 DSH 的电脑）', exact: true })
      await picker.getByRole('button', { name: '编辑路径' }).click()
      const pathInput = picker.getByRole('textbox', { name: '编辑路径' })
      await pathInput.fill(destination)
      await pathInput.press('Enter')
      return picker
    }
    const saveDialogAria: string[] = []
    let cancelledSaveAria = ''
    let failedWriteAria = ''
    let accumulatedAria = ''
    for (const kind of ['word', 'ppt'] as const) {
      if (kind === 'ppt') {
        await classDrawer.getByRole('button', { name: '月考', exact: true }).click()
        await expect.poll(() => studentImages.getByRole('checkbox', { name: '选择' }).count()).toBe(3)
      }
      await studentImages.getByRole('button', { name: '全选', exact: true }).click()
      await studentImages.getByRole('button', { name: '临时保存', exact: true }).click()
      await studentImages.getByText('该学生已暂存 3 张', { exact: true }).waitFor()
      await classDrawer.getByRole('button', { name: '周练', exact: true }).click()
      await expect.poll(() => studentImages.getByRole('checkbox', { name: '选择' }).count()).toBe(121)
      await studentImages.getByRole('button', { name: '全选', exact: true }).click()
      await studentImages.getByRole('button', { name: '临时保存', exact: true }).click()
      await studentImages.getByText('该学生已暂存 124 张', { exact: true }).waitFor()
      if (kind === 'word') accumulatedAria = await captureStableAria(
        page, 'aside[aria-label="学生图片"] [class*="legacyTemporarySelection"]', scaffold.workspaceCwd,
      )
      await classDrawer.getByRole('button', { name: kind === 'word' ? 'Word' : 'PPT', exact: true }).click()
      if (kind === 'word') await page.getByRole('button', { name: '确认生成', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '批量生成成功' })
      await dialog.waitFor({ timeout: 20_000 })
      const save = dialog.getByRole('button', { name: '保存', exact: true })
      await save.click()
      const picker = page.getByRole('dialog', { name: '选择保存目录（运行 DSH 的电脑）', exact: true })
      await picker.waitFor()
      expect(await save.isDisabled()).toBe(true)
      expect(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled()).toBe(true)
      expect(await dialog.getByRole('button', { name: '直接下载', exact: true }).count()).toBe(0)
      saveDialogAria.push(await captureStableAria(page, '[role="dialog"][aria-label="批量生成成功"]', scaffold.workspaceCwd))
      await picker.getByRole('button', { name: '取消', exact: true }).click()
      await expect.poll(() => save.isDisabled()).toBe(false)
      await dialog.getByText('已取消选择保存目录。文件仍可重新保存。', { exact: true }).waitFor()
      if (kind === 'word') cancelledSaveAria = await captureStableAria(page, '[role="dialog"][aria-label="批量生成成功"]', scaffold.workspaceCwd)
      await save.click()
      await chooseDestination()
      if (kind === 'word') await rm(destination, { recursive: true })
      await picker.getByRole('button', { name: '保存到此文件夹', exact: true }).click()
      if (kind === 'word') {
        await dialog.getByText(/保存目录不存在，请重新选择/u).waitFor()
        expect(await save.isDisabled()).toBe(false)
        failedWriteAria = await captureStableAria(page, '[role="dialog"][aria-label="批量生成成功"]', scaffold.workspaceCwd)
        await mkdir(destination)
        await writeFile(join(destination, '甲同学.docx'), 'existing document')
        await save.click()
        await chooseDestination()
        await picker.getByRole('button', { name: '保存到此文件夹', exact: true }).click()
      }
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      await page.getByText(`已保存 1 个文件到：${destination}`, { exact: true }).waitFor()
    }
    expect((await readdir(destination)).sort()).toEqual(['甲同学.docx', '甲同学.pptx', '甲同学_1.docx'])
    expect(await readFile(join(destination, '甲同学.docx'), 'utf8')).toBe('existing document')
    const word = unzipSync(await readFile(join(destination, '甲同学_1.docx')))
    expect(strFromU8(word['word/document.xml']!).match(/r:embed=/gu)).toHaveLength(124)
    const ppt = unzipSync(await readFile(join(destination, '甲同学.pptx')))
    expect(Object.keys(ppt).filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name))).toHaveLength(124)
    await studentImages.getByRole('checkbox', { name: '选择' }).first().check()
    await studentImages.getByRole('button', { name: '临时保存', exact: true }).click()
    await studentImages.getByText('该学生已暂存 1 张', { exact: true }).waitFor()
    await studentImages.getByRole('button', { name: '清空暂存', exact: true }).click()
    await studentImages.getByText('该学生已暂存 0 张', { exact: true }).waitFor()
    expect(await classDrawer.getByRole('button', { name: 'Word', exact: true }).isDisabled()).toBe(true)
    expect(await classDrawer.getByRole('button', { name: 'PPT', exact: true }).isDisabled()).toBe(true)
    expect(await studentImages.getByRole('button', { name: '其他目录.png', exact: true }).count()).toBe(1)
    await compareOrRefreshGolden(QUESTION_STUDENT_EXPORT_EXPECTED, [
      '# Student folder subtree', subtreeAria,
      '# Accumulated across sibling folders', accumulatedAria,
      '# Word save in progress', saveDialogAria[0],
      '# Directory selection not completed', cancelledSaveAria,
      '# Failed write retained for retry', failedWriteAria,
      '# PowerPoint save in progress', saveDialogAria[1],
      '# Saved files', '甲同学.docx: existing document preserved', '甲同学_1.docx: 124 images', '甲同学.pptx: 124 slides',
      '# Cleared selection', await captureStableAria(
        page, 'aside[aria-label="学生图片"] [class*="legacyTemporarySelection"]', scaffold.workspaceCwd,
      ),
    ].join('\n\n'), MODE)
    expect(tripwire.pageErrors).toEqual([])
  })

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
    const previousStudentNames = document.value.state.students
      .filter(student => student.classId === rosterClass.id)
      .map(student => student.name)
    const previousLibraryFolderNames = document.value.state.questionLibraryFolders.map(folder => folder.name)

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
    await scaffold.ctx.settings.update('teacher-workbench', { segmentsRoot, studentsRoot })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openModule('试题切割')
    const hierarchy = page.getByRole('complementary', { name: '学生目录' })
    await hierarchy.getByRole('button', { name: rosterClass.name, exact: true }).dblclick()
    const classDrawer = page.getByRole('complementary', { name: '学生列表' })
    await classDrawer.waitFor({ timeout: 10_000 })
    for (const name of previousStudentNames) {
      if (name !== directoryStudentName) {
        expect(await classDrawer.getByRole('button', { name, exact: true }).count()).toBe(0)
      }
    }
    const directoryStudent = classDrawer.getByRole('button', { name: directoryStudentName, exact: true })
    await directoryStudent.click()
    const studentImages = page.getByRole('complementary', { name: '学生图片' })
    await studentImages.getByRole('button', { name: '新路径学生题.png', exact: true }).waitFor({ timeout: 10_000 })
    await studentImages.locator('img').first().waitFor({ timeout: 10_000 })
    await studentImages.getByRole('checkbox', { name: '选择' }).check()
    await studentImages.getByRole('button', { name: '临时保存', exact: true }).click()
    await page.getByText('已临时保存 1 张图片', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await classDrawer.getByRole('button', { name: 'Word', exact: true }).isDisabled()).toBe(false)
    expect(await classDrawer.getByRole('button', { name: 'PPT', exact: true }).isDisabled()).toBe(false)
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

    await classDrawer.getByRole('button', { name: '第二周订正', exact: true }).click()
    await studentImages.waitFor({ timeout: 10_000 })
    await expect.poll(async () => await studentImages
      .getByRole('button', { name: '新路径学生题.png', exact: true })
      .count()).toBe(0)
    await studentImages.getByRole('button', { name: '试题图片库' }).click()
    const bankFolders = page.getByRole('complementary', { name: '试题图片库' })
    const currentLibraryNames = new Set(['新路径试卷', '月考', '第一次', '套题甲', '空目录', '下一层'])
    for (const name of previousLibraryFolderNames) {
      if (!currentLibraryNames.has(name)) {
        expect(await bankFolders.getByRole('button', { name, exact: true }).count()).toBe(0)
      }
    }
    const batchDirectoryFolder = bankFolders.getByRole('button', { name: '新路径试卷', exact: true })
    await batchDirectoryFolder.waitFor({ timeout: 10_000 })
    await batchDirectoryFolder.click({ force: true })
    expect(await bankFolders.getByRole('button', { name: '新路径试卷 1', exact: true }).count()).toBe(0)
    const bankImages = page.getByRole('complementary', { name: '试题库图片' })
    const scannedQuestion = bankImages.getByRole('button', { name: '第 7 题', exact: true })
    await scannedQuestion.waitFor({ timeout: 10_000 })
    await bankImages.locator('img').first().waitFor({ timeout: 10_000 })
    expect(await bankImages.getByRole('button', { name: '删除', exact: true }).count()).toBe(1)
    await scannedQuestion.click()
    const imageEditor = page.getByRole('dialog', { name: '图片编辑' })
    await imageEditor.getByRole('button', { name: '覆盖', exact: true }).waitFor({ timeout: 10_000 })
    await imageEditor.locator('header').getByRole('button', { name: '关闭工作台', exact: true }).click()
    await bankImages.getByRole('checkbox', { name: '选择' }).check()
    await bankImages.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByText('试题已分发到学生目录', { exact: true }).waitFor({ timeout: 10_000 })
    const assignedCurrentRootImage = join(studentDirectory, '第二周订正', '新路径试卷_7.png')
    await expect.poll(async () => await readFile(assignedCurrentRootImage), { timeout: 10_000 }).toEqual(raster)
    const libraryMonthFolder = bankFolders.getByRole('button', { name: '月考', exact: true })
    await libraryMonthFolder.waitFor({ timeout: 10_000 })
    const [libraryMonthBox, libraryMonthMarkerBox] = await Promise.all([
      libraryMonthFolder.boundingBox(),
      bankFolders.getByRole('button', { name: '展开目录“月考”', exact: true }).boundingBox(),
    ])
    if (libraryMonthBox === null || libraryMonthMarkerBox === null) throw new Error('question-library folder marker has no layout box')
    expect(libraryMonthMarkerBox.x - libraryMonthBox.x).toBeGreaterThanOrEqual(10)
    expect(libraryMonthMarkerBox.x - libraryMonthBox.x).toBeLessThanOrEqual(20)
    await bankFolders.getByRole('button', { name: '展开目录“月考”', exact: true }).click()
    const firstExamFolder = bankFolders.getByRole('button', { name: '第一次', exact: true })
    await firstExamFolder.waitFor({ timeout: 10_000 })
    await bankFolders.getByRole('button', { name: '展开目录“第一次”', exact: true }).click()
    const nestedBatchFolder = bankFolders.getByRole('button', { name: '套题甲', exact: true })
    await nestedBatchFolder.waitFor({ timeout: 10_000 })
    await nestedBatchFolder.click()
    expect(await bankFolders.getByRole('button', { name: '套题甲 1', exact: true }).count()).toBe(0)
    await bankImages.getByRole('button', { name: '第 8 题', exact: true }).waitFor({ timeout: 10_000 })
    await bankImages.getByRole('img', { name: '第 8 题', exact: true }).waitFor({ timeout: 10_000 })
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
    await bankFolders.getByRole('button', { name: '展开目录“空目录”', exact: true }).click()
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

  it('keeps consecutive PDF cuts running across workbench and conversation navigation', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-question-cutting-progress'))
    await openModule('试题切割')
    const originalMarkdown = minerUMarkdown
    const originalMiddleJson = minerUMiddleJson
    let releaseMinerU: (() => void) | undefined
    minerUMarkdown = ''
    minerUMiddleJson = ''
    minerUResponseGate = new Promise<void>((resolve) => { releaseMinerU = resolve })
    const pdfInput = page.locator('[data-question-workbench] input[type="file"][accept="application/pdf,.pdf"]')

    try {
      for (const [index, name] of ['后台切割甲.pdf', '后台切割乙.pdf'].entries()) {
        await pdfInput.setInputFiles({
          name,
          mimeType: 'application/pdf',
          buffer: onePagePdfFixture(),
        })
        const pageRangeDialog = page.getByRole('dialog', { name: '选择页码范围' })
        await pageRangeDialog.waitFor({ timeout: 10_000 })
        if (index === 0) await pageRangeDialog.getByRole('textbox').fill('1')
        await pageRangeDialog.getByRole('button', { name: '确认切割' }).click()
        await pageRangeDialog.waitFor({ state: 'hidden', timeout: 10_000 })
      }

      let progressArea = page.getByRole('main', { name: '试题切割进度' })
      const firstJob = progressArea.getByRole('listitem', { name: '后台切割甲.pdf' })
      const secondJob = progressArea.getByRole('listitem', { name: '后台切割乙.pdf' })
      await firstJob.getByText('正在提取 PDF 版面', { exact: true }).waitFor({ timeout: 10_000 })
      await secondJob.getByText('等待切割', { exact: true }).waitFor({ timeout: 10_000 })
      expect(await firstJob.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
      expect(await secondJob.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
      await compareOrRefreshGolden(
        QUESTION_CUTTING_PROGRESS_EXPECTED,
        await captureStableAria(page, 'main[aria-label="试题切割进度"]', scaffold.workspaceCwd),
        MODE,
      )

      await openModule('日常备课')
      await openModule('试题切割')
      progressArea = page.getByRole('main', { name: '试题切割进度' })
      await progressArea.getByRole('listitem', { name: '后台切割甲.pdf' }).waitFor({ timeout: 10_000 })
      await progressArea.getByRole('listitem', { name: '后台切割乙.pdf' }).waitFor({ timeout: 10_000 })

      await showConversation()
      await openModule('试题切割')
      progressArea = page.getByRole('main', { name: '试题切割进度' })
      await progressArea.getByRole('listitem', { name: '后台切割甲.pdf' }).waitFor({ timeout: 10_000 })
      await progressArea.getByRole('listitem', { name: '后台切割乙.pdf' }).waitFor({ timeout: 10_000 })
    } finally {
      releaseMinerU?.()
      minerUResponseGate = null
      minerUMarkdown = originalMarkdown
      minerUMiddleJson = originalMiddleJson
    }

    const progressArea = page.getByRole('main', { name: '试题切割进度' })
    await expect.poll(
      () => progressArea.getByText('切割失败', { exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(2)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('links the normal timetable while isolating Grade OCR classes', async () => {
    const selection = scaffold.ctx.agentDefaultModel.currentSelection()
    const disposeModel = scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter(['timetable-test'], new TimetableAgentAdapter(() => smallGradeEntries)), 'Timetable model fixture',
    )
    await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      ...selection, toolProvider: 'timetable-test', toolModel: 'timetable',
    })
    onTestFinished(async () => {
      await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, selection)
      await disposeModel()
    })
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
    expect(await weekCourse.locator('time').count()).toBe(0)
    const periodHeading = workbench.getByRole('rowheader', { name: '第 1 节 11:50' })
    expect(await periodHeading.locator('time').evaluate(element => getComputedStyle(element).fontSize)).toBe('12px')
    const subjectBox = await weekCourse.locator('strong').boundingBox()
    const labelBox = await periodHeading.locator('span').boundingBox()
    const timeBox = await periodHeading.locator('time').boundingBox()
    if (subjectBox === null || labelBox === null || timeBox === null) throw new Error('Timetable subject, period, and time must be visible')
    expect(timeBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height)
    expect(timeBox.x + timeBox.width).toBeLessThan(subjectBox.x)
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
    const selection = scaffold.ctx.agentDefaultModel.currentSelection()
    const disposeModel = scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter(['timetable-test'], new TimetableAgentAdapter(() => studyEntries)), 'Timetable model fixture',
    )
    await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      ...selection, toolProvider: 'timetable-test', toolModel: 'timetable',
    })
    onTestFinished(async () => {
      await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, selection)
      await disposeModel()
    })
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
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), {
      timeout: 10_000,
    }).toContain('questionCropPadding: 18')
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('teacherName: 王老师')
    expect(document).toContain('schoolName: 海淀中学')
    expect(document).toContain('defaultSubject: 数学')
    expect(document).toContain('weatherLocation: 浦东新区, 上海市')
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
    const input = composer.locator('[data-composer-input]')
    await composer.getByText('已识别', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await input.textContent()).toBe('')
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
      ...(MODE === 'record' ? {} : { replayFixture: DOCUMENT_CONTEXT_FIXTURE, paceMs: 10 }),
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
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
    const input = composer.locator('[data-composer-input]')
    expect(await input.textContent()).toBe('')
    await input.fill('请总结这份教学计划')
    const settled = scaffold.whenTurnSettled()
    await composer.getByRole('button', { name: '发送消息' }).click()
    await settled
    const conversationScroll = page.locator('[data-conversation-scroll]')
    await conversationScroll.getByText('mineru-ocr', { exact: true }).first().waitFor({
      state: 'attached',
      timeout: 10_000,
    })
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
