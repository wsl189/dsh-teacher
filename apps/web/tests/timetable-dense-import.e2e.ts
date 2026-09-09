import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-teacher-workbench'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import { gradeTimetableEntries, gradeTimetableMarkdown } from '../../../packages/host/teacher-workbench/tests/fixtures/grade-timetable.ts'
import { TimetableAgentAdapter } from './timetable-agent-fixture.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

describe('web e2e: dense grade timetable import', () => {
  it('retains all 600 image and workbook slots after closing recognition and navigating away', async () => {
    let extraction = Promise.withResolvers<undefined>()
    let recognition = Promise.withResolvers<undefined>()
    let office = false
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        void extraction.promise.then(() => {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ results: { document: {
            md_content: gradeTimetableMarkdown,
            middle_json: JSON.stringify({
              _backend: office ? 'office' : 'pipeline',
              pdf_info: [{ page_idx: 0, ...(office ? {} : { page_size: [720, 960] }), discarded_blocks: [] }],
            }),
          } } }))
        })
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo
    const scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./teacher-workbench.overlay.yml', import.meta.url)),
      ocrEndpoint: `http://127.0.0.1:${String(address.port)}/file_parse`,
    })
    const browser = await chromium.launch()
    try {
      const adapter = new TimetableAgentAdapter(() => gradeTimetableEntries, true, () => recognition.promise)
      scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['timetable-test'], adapter), 'Timetable model fixture')
      await scaffold.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
        ...scaffold.ctx.agentDefaultModel.currentSelection(), toolProvider: 'timetable-test', toolModel: 'timetable',
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '打开工作台', exact: true }).click()
      await page.getByRole('button', { name: '课程表', exact: true }).click()
      const workbench = page.getByRole('region', { name: '工作台', exact: true })
      expect(scaffold.ctx.agents.list()).toHaveLength(0)
      for (const extension of ['png', 'xlsx']) {
        office = extension === 'xlsx'
        extraction = Promise.withResolvers<undefined>()
        recognition = Promise.withResolvers<undefined>()
        const previousRequests = adapter.requests.length
        await workbench.getByRole('tab', { name: '年级课表' }).click()
        await workbench.locator('input[type="file"]').setInputFiles({
          name: `年级总课表.${extension}`,
          mimeType: extension === 'png' ? 'image/png' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: extension === 'png'
            ? await readFile(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
            : Buffer.from('workbook upload handled by the external OCR fixture'),
        })
        const review = page.getByRole('dialog', { name: '上传并识别课程表' })
        await review.getByText('MinerU 正在提取课程表内容').waitFor()
        await review.getByRole('button', { name: '关闭工作台', exact: true }).click()
        await page.getByRole('button', { name: '学生名册', exact: true }).click()
        extraction.resolve(undefined)
        await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThan(previousRequests) }, { timeout: 20_000 })
        await page.getByRole('button', { name: '课程表', exact: true }).click()
        expect(await review.count()).toBe(0)
        await workbench.getByRole('button', { name: '查看识别进度' }).click()
        await review.getByText('正在识别课程表并整理课程安排').waitFor()
        await review.getByRole('button', { name: '关闭工作台', exact: true }).click()
        if (extension === 'png') {
          const progress = await captureStableAria(page, '[class*="timetableImportNotice"]', scaffold.workspaceCwd)
          await compareOrRefreshGolden(
            fileURLToPath(new URL('./expected/teacher-workbench/timetable-background-progress.expected.md', import.meta.url)),
            progress, webSnapshotMode(),
          )
        }
        await page.getByRole('button', { name: '学生名册', exact: true }).click()
        recognition.resolve(undefined)
        await vi.waitFor(() => { expect(scaffold.ctx.agents.list()).toHaveLength(0) }, { timeout: 20_000 })
        await page.getByRole('button', { name: '课程表', exact: true }).click()
        await workbench.getByRole('button', { name: '查看识别结果' }).waitFor()
        expect(await review.count()).toBe(0)
        if (extension === 'png') {
          const ready = await captureStableAria(page, '[class*="timetableImportNotice"]', scaffold.workspaceCwd)
          await compareOrRefreshGolden(
            fileURLToPath(new URL('./expected/teacher-workbench/timetable-background-ready.expected.md', import.meta.url)),
            ready, webSnapshotMode(),
          )
        }
        await workbench.getByRole('button', { name: '查看识别结果' }).click()
        await review.getByText('识别到 600 节，请确认班级、星期和节次后导入').waitFor({ timeout: 20_000 })
        expect(await review.getByLabel('班级名称').count()).toBe(600)
        expect(await review.getByLabel('班级名称').last().inputValue()).toBe('高一15班')
        expect(await review.getByLabel('节次').last().inputValue()).toBe('8')
        expect(await review.getByLabel('结束时间').last().inputValue()).toBe('17:35')
        const snapshot = await captureStableAria(page, '[class*="timetableImportDialog"] [class*="calendarImportSummary"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(
          fileURLToPath(new URL(`./snapshots/teacher-workbench/timetable-dense-${extension}.expected.md`, import.meta.url)),
          snapshot,
          webSnapshotMode(),
        )
        await review.getByRole('button', { name: '导入 600 节' }).click()
        await review.waitFor({ state: 'hidden', timeout: 20_000 })
        const { value: { state } } = await scaffold.ctx.teacherWorkbench.read({})
        const classes = new Map(state.classes.map(item => [item.id, item]))
        const entries = state.timetableEntries.map(item => ({
          className: classes.get(item.classId)?.name, grade: classes.get(item.classId)?.grade,
          kind: item.kind, weekday: item.weekday, period: item.period, subject: item.subject,
          teacherName: item.teacherName, startTime: item.startTime, endTime: item.endTime, location: item.location,
        }))
        expect(entries).toHaveLength(600)
        expect(entries).toEqual(expect.arrayContaining(gradeTimetableEntries))
        expect(state.classes.every(item => item.usage === 'gradeTimetable')).toBe(true)
        expect(scaffold.ctx.agents.list()).toHaveLength(0)
        await workbench.getByRole('tab', { name: '年级课表' }).click()
        expect(await workbench.locator('tbody td time').count()).toBe(0)
        expect(await workbench.locator('tbody th time').count()).toBe(120)
        const firstPeriod = workbench.locator('tbody tr').first()
        expect(await firstPeriod.getByText('08:00–08:45', { exact: true }).count()).toBe(1)
        await compareOrRefreshGolden(
          fileURLToPath(new URL('./expected/teacher-workbench/timetable-period-time.expected.md', import.meta.url)),
          await captureStableAria(page, 'section[aria-label="课程表"] tbody tr:first-child', scaffold.workspaceCwd),
          webSnapshotMode(),
        )
      }
      const initialRequests = adapter.requests.filter(request => request.messages.every(message => message.content.every(block => block.type !== 'tool-result')))
      expect(initialRequests).toHaveLength(2)
      expect(initialRequests[0]?.tools?.some(tool => tool.name.startsWith('timetable_image_'))).toBe(true)
      expect(initialRequests[1]?.tools?.some(tool => tool.name.startsWith('timetable_image_'))).toBe(false)
      expect(adapter.requests.some(request => request.messages.flatMap(message => message.content)
        .some(block => block.type === 'tool-result' && block.content.some(content => content.type === 'image')))).toBe(true)

    } finally {
      extraction.resolve(undefined)
      recognition.resolve(undefined)
      await browser.close()
      await scaffold.close()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })
})
