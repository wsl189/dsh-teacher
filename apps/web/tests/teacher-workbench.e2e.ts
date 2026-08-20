import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-teacher-workbench'
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
const WORKBENCH_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const DAILY_EXPECTED = join(SNAPSHOT_DIR, 'daily.expected.md')
const VOICE_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'voice-error.expected.md')
const WEATHER_COMPACT_EXPECTED = join(SNAPSHOT_DIR, 'weather-compact.expected.md')
const WEATHER_EXPECTED = join(SNAPSHOT_DIR, 'weather.expected.md')
const CALENDAR_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'calendar-import.expected.md')
const TIMETABLE_EXPECTED = join(SNAPSHOT_DIR, 'timetable.expected.md')
const TIMETABLE_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'timetable-import.expected.md')
const STUDY_IMPORT_EXPECTED = join(SNAPSHOT_DIR, 'study-import.expected.md')
const DOCUMENT_DRAFT_EXPECTED = join(SNAPSHOT_DIR, 'document-draft.expected.md')
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
    scaffold = await launchWebScaffold({ ocrEndpoint: `http://127.0.0.1:${String(address.port)}/file_parse` })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      locale: ZH_BROWSER_LOCALE,
    })
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

  it('persists daily tasks, quick notes, and dated calendar items', async () => {
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
    await todayCard.getByLabel('截止时间').fill('2026-08-18T18:30')
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
    await notesPanel.getByRole('button', { name: '添加随记' }).click()
    const noteEditor = page.getByRole('dialog', { name: '添加随记' })
    await noteEditor.getByLabel('随记内容').fill('下节课增加小组讨论')
    await noteEditor.getByRole('button', { name: '保存' }).click()
    await noteEditor.waitFor({ state: 'hidden', timeout: 10_000 })

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
      title: '批改一班作业', dueAt: '2026-08-18T18:30', completed: false,
      category: 'today', color: 'blue',
    }, {
      title: '准备公开课', dueAt: '', completed: false,
      category: 'important', color: 'red',
    }])
    expect(saved.value.state.quickNotes).toMatchObject([{ content: '下节课增加小组讨论' }])
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
    const compactCalendar = page.locator('section[aria-labelledby="daily-calendar-title"]')
    expect(await compactCalendar.getByRole('button', { name: /^2026-08-20.*1 项安排$/ }).count()).toBe(1)
    expect(await compactCalendar.locator('i[class*="calendarEventCount"]').count()).toBe(0)
    await showConversation()
    await page.locator('[data-composer-card]').waitFor({ timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

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

    const saved = await scaffold.ctx.teacherWorkbench.read({})
    expect(saved.value.state.classes).toMatchObject([{ name: '高一（1）班', subject: '数学' }])
    expect(saved.value.state.students).toMatchObject([{ name: '张同学', studentNumber: '001' }])
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
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('links the normal timetable while isolating Grade OCR classes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-teacher-workbench-timetable'))
    await openModule('课程表')
    const workbench = page.getByRole('region', { name: '工作台', exact: true })
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
    const weekday = new Date().getDay()
    const weekdayLabel = weekdays[weekday]
    if (weekdayLabel === undefined) throw new Error(`Unexpected weekday index: ${String(weekday)}`)

    expect(await workbench.getByRole('combobox', { name: '选择班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '选择班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '添加班级' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '识别课程表' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '添加课程' }).count()).toBe(0)
    await workbench.getByRole('tab', { name: '本周课表' }).click()
    expect(await workbench.getByRole('button', { name: '添加班级' }).count()).toBe(1)
    expect(await workbench.getByRole('button', { name: '选择班级' }).isDisabled()).toBe(true)
    await workbench.getByRole('button', { name: '添加班级' }).click()
    const timetableClassEditor = page.getByRole('dialog', { name: '添加班级' })
    await timetableClassEditor.getByLabel('班级名称').fill('高一（1）班')
    await timetableClassEditor.getByLabel('年级').fill('高一')
    await timetableClassEditor.getByLabel('学科').fill('数学')
    await timetableClassEditor.getByRole('button', { name: '保存' }).click()
    await timetableClassEditor.waitFor({ state: 'hidden', timeout: 10_000 })
    expect(await workbench.getByRole('button', { name: '选择班级' }).isEnabled()).toBe(true)

    await workbench.getByRole('button', { name: '添加课程' }).click()
    const editor = page.getByRole('dialog', { name: '添加课程' })
    await editor.getByLabel('班级名称').fill('高一（1）班')
    await editor.getByLabel('年级').fill('高一')
    await editor.getByLabel('星期').selectOption({ label: weekdayLabel })
    await editor.getByLabel('节次').fill('1')
    await editor.getByRole('textbox', { name: '课程', exact: true }).fill('数学')
    await editor.getByLabel('开始时间').fill('11:50')
    await editor.getByLabel('任课教师').fill('王老师')
    await editor.getByLabel('地点').fill('101教室')
    await editor.getByRole('button', { name: '保存' }).click()
    await editor.waitFor({ state: 'hidden', timeout: 10_000 })
    await workbench.getByText('数学', { exact: true }).waitFor({ timeout: 10_000 })

    await workbench.getByRole('tab', { name: '本周课表' }).click()
    const weekCourse = workbench.getByRole('button', { name: /数学/ })
    expect(await workbench.getByRole('button', { name: '编辑' }).count()).toBe(0)
    expect(await workbench.getByRole('button', { name: '删除' }).count()).toBe(0)
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
      buffer: Buffer.from('keyless timetable fixture'),
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
        classes: snapshot.value.state.classes.map(item => ({ name: item.name, usage: item.usage })),
        gradeEntries: snapshot.value.state.timetableEntries.filter((item) => {
          const owner = snapshot.value.state.classes.find(candidate => candidate.id === item.classId)
          return owner?.usage === 'gradeTimetable'
        }).map(item => item.subject).sort(),
      }
    }, { timeout: 10_000 }).toEqual({
      classes: [
        { name: '高一（1）班', usage: 'roster' },
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
    expect(await workbench.getByRole('button', { name: '高一（1）班' }).count()).toBe(1)
    expect(await workbench.getByRole('button', { name: '高三（2）班' }).count()).toBe(0)
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
      buffer: Buffer.from('keyless study fixture'),
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

  it('extracts an uploaded document into the ordinary conversation draft', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-document-draft'))
    await showConversation()
    minerUMarkdown = '# 教学计划\n\n第一章：函数与图像'
    const composer = page.locator('[data-composer-card]')
    await composer.getByRole('button', { name: '添加图片或文档' }).waitFor({ timeout: 10_000 })
    await composer.locator('input[type="file"]').setInputFiles({
      name: 'lesson-plan.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('keyless document fixture'),
    })
    const input = composer.locator('textarea')
    await expect.poll(() => input.inputValue(), { timeout: 10_000 }).toContain('<document name="lesson-plan.docx">')
    expect(await input.inputValue()).toContain('# 教学计划\n\n第一章：函数与图像')
    await compareOrRefreshGolden(
      DOCUMENT_DRAFT_EXPECTED,
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
      MODE,
    )
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
