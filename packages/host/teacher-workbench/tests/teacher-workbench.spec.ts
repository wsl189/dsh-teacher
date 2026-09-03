import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { PDFDocument, rgb } from 'pdf-lib'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as ToolTeacherWorkbench from '../../tool-teacher-workbench/src/index.ts'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import TeacherWorkbenchService, {
  INITIAL_TEACHER_WORKBENCH_STATE,
  teacherWorkbenchStateSchema,
} from '../src/index.ts'
import type { MobileNotificationGateway } from '../src/mobile-reminders.ts'
import type {
  TeacherCalendarItemId,
  TeacherClass,
  TeacherClassId,
  TeacherClassUsage,
  TeacherDailyTodoId,
  TeacherExamId,
  TeacherLessonResourceId,
  TeacherLedgerCategoryId,
  TeacherLedgerEntryId,
  TeacherRecordId,
  TeacherRecordTemplateId,
  TeacherQuickNoteId,
  TeacherQuestionBatchId,
  TeacherQuestionFolderId,
  TeacherQuestionLibraryFolderId,
  TeacherStudentId,
  TeacherTimetableEntryId,
  TeacherWorkbenchState,
} from '../src/types.ts'

class MemorySettings extends SettingsProvider {
  private storedDocument: Record<string, unknown> = {}

  override get writable(): boolean {
    return true
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storedDocument))
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedDocument = { ...this.storedDocument, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function harness(
  pool = new MemoryMediaPool(),
  config?: ConstructorParameters<typeof TeacherWorkbenchService>[1],
  withSettings = false,
) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (withSettings) await ctx.plugin(MemorySettings)
  let resolvedConfig = config
  if (resolvedConfig === undefined) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-teacher-workbench-default-'))
    temporaryRoots.push(root)
    resolvedConfig = testConfig(root)
  }
  const fiber = await ctx.plugin(TeacherWorkbenchService, resolvedConfig)
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 32 * 1024 * 1024,
      maxImagesPerMessage: 8,
      maxMessageImageBytes: 32 * 1024 * 1024,
      maxImagePixels: 16_000_000,
      maxImageDimension: 8_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
      const metadata = await sharp(input.data).metadata()
      return {
        attachmentId: 'question-image-test' as never,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: metadata.width,
        height: metadata.height,
        ...input.name === undefined ? {} : { name: input.name },
      }
    },
  } as never)
  ctx.provide('llm', {
    resolveModelInfo: (_provider: string, model: string) => Promise.resolve({
      inputModalities: model === 'text-only' ? ['text'] : ['text', 'image'],
    }),
  } as never)
  await ctx.plugin(ToolTeacherWorkbench)
  return { ctx, fiber, pool, service: ctx.teacherWorkbench }
}

function testConfig(root: string): ConstructorParameters<typeof TeacherWorkbenchService>[1] {
  return {
    geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
    geocodingCacheEntries: 16,
    segmentsRoot: join(root, 'segments'),
    studentsRoot: join(root, 'students'),
    sourcesRoot: join(root, 'sources'),
    generatedRoot: join(root, 'generated'),
    maxSourceDocumentBytes: 8 * 1024 * 1024,
    maxQuestionImageBytes: 1024 * 1024,
    maxQuestionBatchBytes: 4 * 1024 * 1024,
    maxTimetableSourceCharacters: 120_000,
    maxTimetableEntries: 1_000,
    timetableAgentTimeoutMs: 120_000,
    timetableVisionAgentTimeoutMs: 45_000,
    maxQuestionLayoutPages: 50,
    questionSegmentationBatchPages: 20,
    questionSegmentationBatchCandidates: 300,
    questionSegmentationConcurrency: 4,
    maxQuestionWidthOutlierExcessRatio: 0.5,
    maxQuestionLayoutElements: 5_000,
    maxQuestionSourceChunkCharacters: 18_000,
    maxQuestionCompactBoundaryCharacters: 12_000,
    questionSegmentationInlineEvidence: false,
    maxQuestionCompactBoundaryOutputTokens: 32_768,
    maxQuestionCompactReviewOutputTokens: 32_768,
    maxSegmentedQuestions: 300,
    maxQuestionBoundarySubmissions: 3,
    maxQuestionBoundaryAgentRuns: 2,
    maxQuestionRejectedToolCalls: 3,
    maxQuestionAutoOwnedGapRatio: 0.18,
    minQuestionRepeatedImagePages: 3,
    questionRepeatedImagePositionToleranceRatio: 0.015,
    maxQuestionRecutAttempts: 2,
    maxQuestionVisionImagesPerToolCall: 4,
    questionSegmentationAgentTimeoutMs: 90_000,
  }
}

async function callTool(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent?: { readonly id: string; readonly session?: Agent['session'] },
) {
  return ctx.tools.execute({
    callId: ToolCallId(`teacher-${randomCallId++}`),
    name,
    arguments: arguments_,
    signal: new AbortController().signal,
    ...(agent === undefined ? {} : { agent: agent as never }),
  })
}

function promptAgent(text: string): Agent {
  const session = Session.create(SessionId(`teacher-prompt-${String(randomCallId)}`))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return { id: session.id, session } as Agent
}

function imageAgent(model = 'vision'): Agent {
  const session = Session.create(SessionId(`teacher-image-${String(randomCallId)}`))
  return { id: session.id, session, options: { provider: 'test', model } } as Agent
}

let randomCallId = 0

const contexts: Context[] = []
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  await Promise.all(temporaryRoots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
  vi.unstubAllGlobals()
})

function classItem(id: string, name: string, usage: TeacherClassUsage = 'roster'): TeacherClass {
  return { id: id as TeacherClassId, usage, name, grade: '高一', subject: '数学' }
}

function withClasses(...classes: TeacherClass[]): TeacherWorkbenchState {
  return { ...INITIAL_TEACHER_WORKBENCH_STATE, classes }
}

describe('TeacherWorkbenchService', () => {
  it('defaults compact question children to 32K output without a child deadline', () => {
    expect(TeacherWorkbenchService.Config({} as never)).toMatchObject({
      maxQuestionCompactBoundaryOutputTokens: 32_768,
      maxQuestionCompactReviewOutputTokens: 32_768,
      questionSegmentationAgentTimeoutMs: 0,
    })
    expect(() => TeacherWorkbenchService.Config({
      maxQuestionCompactBoundaryOutputTokens: 32_769,
    } as never)).toThrow()
    expect(() => TeacherWorkbenchService.Config({
      maxQuestionCompactReviewOutputTokens: 32_769,
    } as never)).toThrow()
  })

  it('registers ordinary-conversation tools and applies daily, timetable, roster, and score mutations', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    expect(b.ctx.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining([
      'teacher_workbench_read',
      'teacher_daily_management',
      'teacher_timetable',
      'teacher_student_roster',
      'teacher_score_analysis',
      'teacher_question_workbench',
      'teacher_question_image_read',
    ]))

    const rosterClass = await callTool(b.ctx, 'teacher_student_roster', {
      action: 'save_class', data: { name: '高一（1）班', grade: '高一', subject: '数学' },
    })
    expect(rosterClass.isError).toBe(false)
    const rosterClassId = (rosterClass.value as { createdIds: string[] }).createdIds[0]!
    const imported = await callTool(b.ctx, 'teacher_student_roster', {
      action: 'import_students',
      data: {
        classId: rosterClassId,
        students: [
          { name: '张三', studentNumber: '001', gender: '男', extras: { 特长: '绘画' } },
          { name: '李四', studentNumber: '002' },
        ],
      },
    })
    const studentIds = (imported.value as { createdIds: string[] }).createdIds
    expect(studentIds).toHaveLength(2)
    const temporaryStudent = await callTool(b.ctx, 'teacher_student_roster', {
      action: 'save_student', data: { classId: rosterClassId, name: '临时学生', studentNumber: '003' },
    })
    const temporaryStudentId = (temporaryStudent.value as { createdIds: string[] }).createdIds[0]!
    await callTool(b.ctx, 'teacher_student_roster', {
      action: 'save_student', data: { id: temporaryStudentId, classId: rosterClassId, name: '临时学生（已核对）', studentNumber: '003' },
    })
    await callTool(b.ctx, 'teacher_student_roster', { action: 'delete_student', data: { id: temporaryStudentId } })
    await callTool(b.ctx, 'teacher_score_analysis', {
      action: 'save_exam',
      data: {
        classId: rosterClassId,
        name: '期中考试',
        date: '2026-08-22',
        entries: [
          { studentNumber: '001', scores: { 数学: 98 } },
          { studentName: '李四', scores: { 数学: 91 } },
        ],
      },
    })
    const timetableClass = await callTool(b.ctx, 'teacher_timetable', {
      action: 'save_class', data: { view: 'week', name: '高一（1）班', grade: '高一' },
    })
    expect(timetableClass.value).toMatchObject({ confirmation: { section: 'timetable', view: 'week' } })
    const timetableClassId = (timetableClass.value as { createdIds: string[] }).createdIds[0]!
    const timetableImport = await callTool(b.ctx, 'teacher_timetable', {
      action: 'import_entries',
      data: {
        view: 'week',
        entries: [{
          classId: timetableClassId,
          className: '高一（1）班',
          kind: 'lesson', weekday: 1, period: 1, subject: '语文', teacherName: '王老师',
        }],
      },
    })
    expect(timetableImport.value).toMatchObject({
      summary: 'Imported 1 week timetable entries',
      confirmation: { view: 'week', classIds: [timetableClassId] },
    })
    const savedEntry = await callTool(b.ctx, 'teacher_timetable', {
      action: 'save_entry',
      data: {
        view: 'grade', className: '高一年级', kind: 'morningStudy',
        weekday: 2, period: 1, subject: '英语早读', startTime: '07:30', endTime: '08:00',
      },
    })
    expect(savedEntry.value).toMatchObject({ confirmation: { view: 'grade' } })
    const savedEntryId = (savedEntry.value as { createdIds: string[] }).createdIds.at(-1)!
    const autoTimetableClassId = (savedEntry.value as { createdIds: string[] }).createdIds[0]!
    await callTool(b.ctx, 'teacher_timetable', { action: 'delete_entry', data: { id: savedEntryId } })
    await callTool(b.ctx, 'teacher_timetable', { action: 'delete_class', data: { id: autoTimetableClassId } })
    const todo = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo',
      data: { title: '批改作业', dueAt: '2026-08-22T18:30', color: 'orange' },
    }, promptAgent('重要：批改作业'))
    const todoId = (todo.value as { createdIds: string[] }).createdIds[0]!
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo', data: { id: todoId, title: '批改数学作业', completed: true },
    })
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_calendar_item', data: { date: '2026-08-23', time: '09:00', title: '教研会' },
    }, promptAgent('日历：8月23日教研会'))
    const note = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_note', data: { content: '联系家长' },
    }, promptAgent('备忘录：联系家长'))
    const noteId = (note.value as { createdIds: string[] }).createdIds[0]!
    const category = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_ledger_category', data: { name: '班费' },
    }, promptAgent('账单：新增班费分类'))
    const categoryId = (category.value as { createdIds: string[] }).createdIds[0]!
    const ledger = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_ledger_entry',
      data: { categoryId, description: '打印材料', amountCents: 1250, occurredAt: '2026-08-22T10:00' },
    }, promptAgent('账单：打印材料12.5元'))
    const ledgerId = (ledger.value as { createdIds: string[] }).createdIds[0]!
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'import_calendar_items',
      data: { items: [{ date: '2026-08-24', title: '升旗仪式' }, { date: '2026-08-25', time: '14:00', title: '集体备课' }] },
    }, promptAgent('日历：导入升旗仪式和集体备课'))
    const read = await callTool(b.ctx, 'teacher_workbench_read', { section: 'scores', class_id: rosterClassId })
    expect(read.value).toMatchObject({
      classes: [{ id: rosterClassId }],
      students: [{ name: '张三' }, { name: '李四' }],
      exams: [{ name: '期中考试', entries: [{ scores: { 数学: 98 } }, { scores: { 数学: 91 } }] }],
    })
    const daily = await callTool(b.ctx, 'teacher_workbench_read', { section: 'daily' })
    const calendarId = (daily.value as { calendarItems: Array<{ id: string; title: string }> }).calendarItems.find(item => item.title === '教研会')!.id
    await callTool(b.ctx, 'teacher_daily_management', { action: 'delete_calendar_item', data: { id: calendarId } })
    await callTool(b.ctx, 'teacher_daily_management', { action: 'delete_ledger_entry', data: { id: ledgerId } })
    await callTool(b.ctx, 'teacher_daily_management', { action: 'delete_ledger_category', data: { id: categoryId } })
    await callTool(b.ctx, 'teacher_daily_management', { action: 'delete_note', data: { id: noteId } })
    await callTool(b.ctx, 'teacher_daily_management', { action: 'delete_todo', data: { id: todoId } })
    const examId = (read.value as { exams: Array<{ id: string }> }).exams[0]!.id
    await callTool(b.ctx, 'teacher_score_analysis', { action: 'delete_exam', data: { id: examId } })
    await callTool(b.ctx, 'teacher_timetable', { action: 'delete_class', data: { id: timetableClassId } })
    await callTool(b.ctx, 'teacher_student_roster', { action: 'delete_class', data: { id: rosterClassId } })
  })

  it('validates every new daily destination against the current user message', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const tool = b.ctx.tools.schemas().find(candidate => candidate.name === 'teacher_daily_management')
    expect(tool?.description).toContain('If a new item has no routing word')

    const unclassified = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo', data: { title: '明天必须处理', category: 'urgent' },
    }, promptAgent('明天必须处理'))
    expect(unclassified.isError).toBe(true)

    const legacyNoteKeyword = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_note', data: { content: '旧关键词' },
    }, promptAgent('随记：旧关键词'))
    expect(legacyNoteKeyword.isError).toBe(true)

    const speechConfusion = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_note', data: { content: '语音误识别' },
    }, promptAgent('随机：语音误识别'))
    expect(speechConfusion.isError).toBe(true)

    const noteAsTodo = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo', data: { title: '买牛奶' },
    }, promptAgent('备忘录：买牛奶'))
    expect(noteAsTodo.isError).toBe(true)
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_note', data: { content: '买牛奶' },
    }, promptAgent('备忘录：买牛奶'))
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_note', data: { content: '联系家长' },
    }, promptAgent('备忘：联系家长'))
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo', data: { title: '明确今日待办' },
    }, promptAgent('待办：明确今日待办'))
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo', data: { title: '明确紧急事项' },
    }, promptAgent('紧急：明确紧急事项'))
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo', data: { title: '明确重要事项' },
    }, promptAgent('重要：明确重要事项'))

    expect((await b.service.read({})).value.state.dailyTodos.map(item => item.category)).toEqual([
      'today', 'urgent', 'important',
    ])
    expect((await b.service.read({})).value.state.quickNotes.map(item => item.content)).toEqual(['买牛奶', '联系家长'])
  })

  it('persists agent-created reminders only for notification targets returned by the daily read', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const gateway: MobileNotificationGateway = {
      listTargets: async () => [{
        channel: 'weixin',
        botId: 'weixin-primary' as never,
        label: '家用微信机器人',
        connected: true,
      }],
      send: async () => undefined,
    }
    b.ctx.provide('mobileNotifications', gateway)

    const before = await callTool(b.ctx, 'teacher_workbench_read', { section: 'daily' })
    expect(before.value).toMatchObject({
      notificationTargets: [{ channel: 'weixin', botId: 'weixin-primary', label: '家用微信机器人' }],
    })

    const saved = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_todo',
      data: {
        title: '吃饭',
        dueAt: '2099-08-22T12:45',
        reminder: {
          channel: 'weixin',
          botId: 'weixin-primary',
          rule: { kind: 'once', minutesBefore: 0 },
        },
      },
    }, promptAgent('待办：吃饭，并用微信机器人提醒'))
    expect(saved.isError).toBe(false)
    const todoId = (saved.value as { createdIds: string[] }).createdIds[0]!
    expect((await b.service.read({})).value.state.dailyTodos).toMatchObject([{
      id: todoId,
      reminder: {
        channel: 'weixin',
        botId: 'weixin-primary',
        botLabel: '家用微信机器人',
        dueAtUtc: new Date('2099-08-22T12:45').toISOString(),
        rule: { kind: 'once', minutesBefore: 0 },
      },
    }])

    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_note',
      data: {
        content: '联系家长',
        remindAt: '2099-08-22T18:00',
        reminder: {
          channel: 'weixin',
          botId: 'weixin-primary',
          rule: { kind: 'once', minutesBefore: 10 },
        },
      },
    }, promptAgent('备忘录：联系家长，并用微信机器人提醒'))
    const categoryId = (await b.service.read({})).value.state.ledgerCategories[0]!.id
    await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_ledger_entry',
      data: {
        categoryId,
        description: '续交车险',
        amountCents: 120_000,
        occurredAt: '2099-08-01T10:00',
        remindAt: '2099-08-23T18:00',
        reminder: {
          channel: 'weixin',
          botId: 'weixin-primary',
          rule: { kind: 'repeat', everyMinutes: 60 },
        },
      },
    }, promptAgent('账本：记录续交车险，并用微信机器人重复提醒'))
    expect((await b.service.read({})).value.state).toMatchObject({
      quickNotes: [{
        remindAt: '2099-08-22T18:00',
        reminder: { botId: 'weixin-primary', rule: { kind: 'once', minutesBefore: 10 } },
      }],
      ledgerEntries: [{
        remindAt: '2099-08-23T18:00',
        reminder: { botId: 'weixin-primary', rule: { kind: 'repeat', everyMinutes: 60 } },
      }],
    })

    const invented = await callTool(b.ctx, 'teacher_daily_management', {
      action: 'save_calendar_item',
      data: {
        date: '2099-08-23',
        time: '09:00',
        title: '体检',
        reminder: {
          channel: 'weixin',
          botId: 'weixin-bot',
          rule: { kind: 'once', minutesBefore: 30 },
        },
      },
    }, promptAgent('日历：体检，并用微信机器人提醒'))
    expect(invented.isError).toBe(true)
    expect((await b.service.read({})).value.state.calendarItems).toEqual([])
  })

  it('keeps weekly and grade timetable catalogs distinct and rejects duplicate imported slots', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const gradeClass = await callTool(b.ctx, 'teacher_timetable', {
      action: 'save_class', data: { view: 'grade', name: '高三（11）班', grade: '高三' },
    })
    const gradeClassId = (gradeClass.value as { createdIds: string[] }).createdIds[0]!

    const crossed = await callTool(b.ctx, 'teacher_timetable', {
      action: 'save_entry',
      data: {
        view: 'week', classId: gradeClassId, className: '高三（11）班', kind: 'lesson',
        weekday: 1, period: 1, subject: '数学',
      },
    })
    expect(crossed.isError).toBe(true)

    const duplicate = await callTool(b.ctx, 'teacher_timetable', {
      action: 'import_entries',
      data: {
        view: 'week',
        entries: [
          { className: '高三（11）班', kind: 'lesson', weekday: 1, period: 1, subject: '数学', startTime: '08:00' },
          { className: '高三（11）班', kind: 'lesson', weekday: 1, period: 1, subject: '语文', startTime: '14:00' },
        ],
      },
    })
    expect(duplicate.isError).toBe(true)

    const imported = await callTool(b.ctx, 'teacher_timetable', {
      action: 'import_entries',
      data: {
        view: 'week',
        entries: [
          { className: '高三（11）班', kind: 'lesson', weekday: 1, period: 1, subject: '数学', startTime: '08:00' },
          { className: '高三（11）班', kind: 'lesson', weekday: 1, period: 5, subject: '语文', startTime: '14:00' },
        ],
      },
    })
    expect(imported.value).toMatchObject({
      summary: 'Imported 2 week timetable entries',
      confirmation: { section: 'timetable', view: 'week', entryIds: [expect.any(String), expect.any(String)] },
    })
    const document = (await b.service.read({})).value
    expect(document.state.classes.filter(item => item.name === '高三（11）班')).toMatchObject([
      { id: gradeClassId, usage: 'gradeTimetable' },
      { usage: 'timetable' },
    ])
    const weekClass = document.state.classes.find(item => item.name === '高三（11）班' && item.usage === 'timetable')!
    expect(document.state.timetableEntries.filter(item => item.classId === weekClass.id).map(item => item.period)).toEqual([1, 5])
  })

  it('stages uploaded PDFs as verified content-addressed workbench sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-source-'))
    temporaryRoots.push(root)
    const b = await harness(undefined, {
      geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
      geocodingCacheEntries: 16,
      segmentsRoot: join(root, 'segments'),
      studentsRoot: join(root, 'students'),
      sourcesRoot: join(root, 'sources'),
      generatedRoot: join(root, 'generated'),
      maxSourceDocumentBytes: 8 * 1024 * 1024,
      maxQuestionImageBytes: 1024 * 1024,
      maxQuestionBatchBytes: 4 * 1024 * 1024,
      maxTimetableSourceCharacters: 120_000,
      maxTimetableEntries: 1_000,
      timetableAgentTimeoutMs: 120_000,
      timetableVisionAgentTimeoutMs: 45_000,
      maxQuestionLayoutPages: 50,
      questionSegmentationBatchPages: 20,
      questionSegmentationBatchCandidates: 300,
      questionSegmentationConcurrency: 4,
      maxQuestionWidthOutlierExcessRatio: 0.5,
      maxQuestionLayoutElements: 5_000,
      maxQuestionSourceChunkCharacters: 18_000,
      maxQuestionCompactBoundaryCharacters: 12_000,
      questionSegmentationInlineEvidence: false,
      maxQuestionCompactBoundaryOutputTokens: 32_768,
      maxQuestionCompactReviewOutputTokens: 32_768,
      maxSegmentedQuestions: 300,
      maxQuestionBoundarySubmissions: 3,
      maxQuestionBoundaryAgentRuns: 2,
      maxQuestionRejectedToolCalls: 3,
      maxQuestionAutoOwnedGapRatio: 0.18,
      minQuestionRepeatedImagePages: 3,
      questionRepeatedImagePositionToleranceRatio: 0.015,
      maxQuestionRecutAttempts: 2,
      maxQuestionVisionImagesPerToolCall: 4,
      questionSegmentationAgentTimeoutMs: 120_000,
    })
    contexts.push(b.ctx)
    const bytes = Uint8Array.of(37, 80, 68, 70, 45, 49)
    const result = await b.service.stageSource({
      name: '试卷.pdf',
      mediaType: 'application/pdf',
      contentBase64: Buffer.from(bytes).toString('base64'),
    })
    expect(result).toMatchObject({ ok: true, value: { name: '试卷.pdf', bytes: bytes.length } })
    if (!result.ok) throw new Error(result.error.message)
    const hash = String(result.value.id).slice('sha256:'.length)
    await expect(readFile(join(root, 'sources', 'objects', hash.slice(0, 2), hash))).resolves.toEqual(Buffer.from(bytes))
  })

  it('cuts a staged PDF through MinerU geometry and persists rendered question images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-segment-source-'))
    temporaryRoots.push(root)
    const config: ConstructorParameters<typeof TeacherWorkbenchService>[1] = {
      geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
      geocodingCacheEntries: 16,
      segmentsRoot: join(root, 'segments'),
      studentsRoot: join(root, 'students'),
      sourcesRoot: join(root, 'sources'),
      generatedRoot: join(root, 'generated'),
      maxSourceDocumentBytes: 8 * 1024 * 1024,
      maxQuestionImageBytes: 8 * 1024 * 1024,
      maxQuestionBatchBytes: 16 * 1024 * 1024,
      maxTimetableSourceCharacters: 120_000,
      maxTimetableEntries: 1_000,
      timetableAgentTimeoutMs: 120_000,
      timetableVisionAgentTimeoutMs: 45_000,
      maxQuestionLayoutPages: 50,
      questionSegmentationBatchPages: 20,
      questionSegmentationBatchCandidates: 300,
      questionSegmentationConcurrency: 4,
      maxQuestionWidthOutlierExcessRatio: 0.5,
      maxQuestionLayoutElements: 5_000,
      maxQuestionSourceChunkCharacters: 18_000,
      maxQuestionCompactBoundaryCharacters: 12_000,
      questionSegmentationInlineEvidence: false,
      maxQuestionCompactBoundaryOutputTokens: 32_768,
      maxQuestionCompactReviewOutputTokens: 32_768,
      maxSegmentedQuestions: 300,
      maxQuestionBoundarySubmissions: 3,
      maxQuestionBoundaryAgentRuns: 2,
      maxQuestionRejectedToolCalls: 3,
      maxQuestionAutoOwnedGapRatio: 0.18,
      minQuestionRepeatedImagePages: 3,
      questionRepeatedImagePositionToleranceRatio: 0.015,
      maxQuestionRecutAttempts: 2,
      maxQuestionVisionImagesPerToolCall: 4,
      questionSegmentationAgentTimeoutMs: 120_000,
    }
    const b = await harness(undefined, config)
    contexts.push(b.ctx)
    const pdf = await PDFDocument.create()
    pdf.addPage([200, 300])
    const pdfPage = pdf.addPage([200, 300])
    pdfPage.drawText('1. question', { x: 20, y: 260, size: 16 })
    pdfPage.drawRectangle({ x: 130, y: 220, width: 30, height: 30, color: rgb(1, 0, 0) })
    pdf.addPage([200, 300])
    const bytes = await pdf.save()
    const staged = await b.service.stageSource({
      name: 'paper.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from(bytes).toString('base64'),
    })
    if (!staged.ok) throw new Error(staged.error.message)
    const extractLayout = vi.fn(async (request: { readonly contentBase64: string }) => {
      const batchPdf = await PDFDocument.load(Buffer.from(request.contentBase64, 'base64'))
      return {
        ok: true as const,
        value: {
          name: 'paper.pdf', provider: 'mineru' as const,
          pages: Array.from({ length: batchPdf.getPageCount() }, (_, pageIndex) => ({
            pageIndex,
            width: 200,
            height: 300,
            elements: pageIndex === 1
              ? [{ type: 'text' as const, text: '1. question', bbox: [20, 20, 180, 80] as const }]
              : [],
          })),
        },
      }
    })
    b.ctx.provide('ocr', {
      layoutLimits: () => ({ ok: true, value: { maxFileBytes: 8 * 1024 * 1024, maxPagesPerRequest: 4 } }),
      layout: extractLayout,
    } as never)
    const segmentQuestions = vi.spyOn(b.service, 'segmentQuestions').mockResolvedValue({
      ok: true,
      value: {
        groupCount: 1,
        groups: [{ groupIndex: 0, corePageIndexes: [1], inspectionPageIndexes: [0, 1, 2] }],
        maxConcurrentGroups: 1,
        maxSaveBatchBytes: 16 * 1024 * 1024,
        maxRecutAttempts: 2,
        maxQuestionWidthRatio: 0.7,
        questions: [{
          sourceHeadId: 'p1e0' as never,
          questionNo: 1,
          headPageIndex: 1,
          groupIndex: 0,
          regions: [{
            pageIndex: 1, left: 20, top: 0, right: 80, rightLimit: 200, bottom: 120,
            excludedAreas: [[100, 0, 200, 120]], pageWidth: 200, pageHeight: 300,
          }],
        }, {
          sourceHeadId: 'p1e1' as never,
          questionNo: 2,
          headPageIndex: 1,
          groupIndex: 0,
          regions: [{
            pageIndex: 1, left: 120, top: 0, right: 180, rightLimit: 200, bottom: 120,
            excludedAreas: [[130, 50, 145, 80]], pageWidth: 200, pageHeight: 300,
          }],
        }],
      },
    })
    const reviewQuestionCrops = vi.spyOn(b.service, 'reviewQuestionCrops').mockImplementation(request => Promise.resolve({
      ok: true,
      value: { decision: 'accepted', affectedQuestionIds: [], questions: request.questions },
    }))
    const missingDestination = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'segment_pdf',
      data: {
        sourceId: staged.value.id,
        sourceName: 'paper.pdf',
      },
    }, promptAgent('请帮我切题'))
    expect(missingDestination.isError).toBe(true)
    expect(missingDestination.content.find(block => block.type === 'text')?.text)
      .toContain('has no default save destination')
    const guessedDestination = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'segment_pdf',
      data: {
        sourceId: staged.value.id,
        sourceName: 'paper.pdf',
        destinationKind: 'library-root',
      },
    }, promptAgent('请帮我切题'))
    expect(guessedDestination.isError).toBe(true)
    expect(guessedDestination.content.find(block => block.type === 'text')?.text)
      .toContain('does not explicitly name the question-library root')
    const cut = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'segment_pdf',
      data: {
        sourceId: staged.value.id,
        sourceName: 'paper.pdf',
        destinationKind: 'library-root',
        pageRange: '2',
        batchName: '自动切题',
        padding: 8,
      },
    }, promptAgent('请帮我切题并保存到试题图片库根目录'))
    expect(cut.isError).toBe(false)
    expect(extractLayout).toHaveBeenCalledOnce()
    expect(segmentQuestions).toHaveBeenCalledWith(expect.objectContaining({
      corePageIndexes: [1],
      pages: [
        expect.objectContaining({ pageIndex: 0 }),
        expect.objectContaining({ pageIndex: 1 }),
        expect.objectContaining({ pageIndex: 2 }),
      ],
      pagePreviews: [
        expect.objectContaining({ pageIndex: 0 }),
        expect.objectContaining({ pageIndex: 1 }),
        expect.objectContaining({ pageIndex: 2 }),
      ],
    }))
    const result = cut.value as {
      batchId: TeacherQuestionBatchId
      questionCount: number
      groupCount: number
      unverifiedGroupCount: number
    }
    expect(result).toMatchObject({ questionCount: 2, groupCount: 1, unverifiedGroupCount: 0 })
    const document = (await b.service.read({})).value
    expect(document.state.questionBatches).toMatchObject([{
      id: result.batchId,
      name: '自动切题',
      images: [
        { questionNo: 1, mediaType: 'image/png', width: 280 },
        { questionNo: 2, mediaType: 'image/png', width: 280 },
      ],
    }])
    expect(document.state.questionBatches[0]?.folderId).toBeUndefined()
    expect(document.state.questionLibraryFolders).toEqual([])
    const firstImage = document.state.questionBatches[0]?.images[0]
    const secondImage = document.state.questionBatches[0]?.images[1]
    if (firstImage === undefined || secondImage === undefined) throw new Error('segmented question image is missing')
    expect((await stat(join(root, 'segments', `${String(firstImage.id)}.png`))).isFile()).toBe(true)
    await expect(stat(join(root, 'segments', 'paper'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storedFirstImage = await b.service.readQuestionImage({ target: { kind: 'batch', id: firstImage.id } })
    if (!storedFirstImage.ok) throw new Error(storedFirstImage.error.message)
    const padded = await sharp(Buffer.from(storedFirstImage.value.contentBase64, 'base64'))
      .extract({ left: 250, top: 80, width: 25, height: 80 })
      .toBuffer()
    const paddedStats = await sharp(padded).stats()
    expect(paddedStats.channels.slice(0, 3).every(channel => channel.min === 255)).toBe(true)
    const storedImage = await b.service.readQuestionImage({ target: { kind: 'batch', id: secondImage.id } })
    if (!storedImage.ok) throw new Error(storedImage.error.message)
    const directCrop = await sharp(Buffer.from(storedImage.value.contentBase64, 'base64'))
      .extract({ left: 50, top: 100, width: 30, height: 60 })
      .toBuffer()
    const directCropStats = await sharp(directCrop).stats()
    expect(directCropStats.channels[1]?.min).toBeLessThan(80)
    expect(directCropStats.channels[2]?.min).toBeLessThan(80)
    const erasedCrop = await sharp(Buffer.from(storedImage.value.contentBase64, 'base64'))
      .extract({ left: 20, top: 100, width: 30, height: 60 })
      .toBuffer()
    const erasedCropStats = await sharp(erasedCrop).stats()
    expect(erasedCropStats.channels.slice(0, 3).every(channel => channel.min === 255)).toBe(true)
    reviewQuestionCrops.mockImplementation(request => Promise.resolve({
      ok: true,
      value: {
        decision: 'unresolved',
        affectedQuestionIds: request.reviewQuestionIds,
        questions: request.questions,
      },
    }))
    extractLayout.mockImplementationOnce(() => Promise.resolve({
      ok: false,
      error: { code: 'provider-failure', message: 'MinerU returned HTTP 409' },
    }) as never)
    const unverified = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'segment_pdf',
      data: {
        sourceId: staged.value.id,
        sourceName: 'paper.pdf',
        destinationKind: 'library-root',
        pageRange: '2',
        batchName: '不得落盘的未复核结果',
        padding: 8,
      },
    }, promptAgent('请重新切题并保存到试题图片库根目录'))
    expect(unverified.isError).toBe(false)
    expect(unverified.value).toMatchObject({ questionCount: 2, groupCount: 1, unverifiedGroupCount: 1 })
    expect(extractLayout).toHaveBeenCalledTimes(4)
    expect(reviewQuestionCrops).toHaveBeenCalledTimes(2)
    expect((await b.service.read({})).value.state.questionBatches).toHaveLength(2)
  })

  it('ships the reference headteacher templates and rejects cross-class seating occupants', () => {
    expect(INITIAL_TEACHER_WORKBENCH_STATE.noticeTemplates).toHaveLength(8)
    expect(INITIAL_TEACHER_WORKBENCH_STATE.templates.filter(item => item.kind === 'class')).toHaveLength(3)
    expect(INITIAL_TEACHER_WORKBENCH_STATE.templates.filter(item => item.kind === 'talk')).toHaveLength(3)
    expect(INITIAL_TEACHER_WORKBENCH_STATE.templates.filter(item => item.kind === 'summary')).toHaveLength(3)
    const firstClass = classItem('class-a', '一班')
    const secondClass = classItem('class-b', '二班')
    const parsed = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      classes: [firstClass, secondClass],
      students: [{
        id: 'student-b' as TeacherStudentId,
        classId: secondClass.id,
        name: '张同学',
        studentNumber: '',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
        extras: {},
      }],
      seatingLayouts: [{
        classId: firstClass.id,
        rows: 3,
        columns: 4,
        slots: ['student-b', ...Array<null>(11).fill(null)],
        updatedAt: 1,
      }],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.map(issue => issue.message)).toContain('student belongs to another class')
  })

  it('appends bounded save parts to one logical paper batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-question-append-'))
    temporaryRoots.push(root)
    const b = await harness(undefined, {
      geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
      geocodingCacheEntries: 16,
      segmentsRoot: join(root, 'segments'),
      studentsRoot: join(root, 'students'),
      sourcesRoot: join(root, 'sources'),
      generatedRoot: join(root, 'generated'),
      maxSourceDocumentBytes: 8 * 1024 * 1024,
      maxQuestionImageBytes: 1024 * 1024,
      maxQuestionBatchBytes: 4 * 1024 * 1024,
      maxTimetableSourceCharacters: 120_000,
      maxTimetableEntries: 1_000,
      timetableAgentTimeoutMs: 120_000,
      timetableVisionAgentTimeoutMs: 45_000,
      maxQuestionLayoutPages: 50,
      questionSegmentationBatchPages: 20,
      questionSegmentationBatchCandidates: 300,
      questionSegmentationConcurrency: 4,
      maxQuestionWidthOutlierExcessRatio: 0.5,
      maxQuestionLayoutElements: 5_000,
      maxQuestionSourceChunkCharacters: 18_000,
      maxQuestionCompactBoundaryCharacters: 12_000,
      questionSegmentationInlineEvidence: false,
      maxQuestionCompactBoundaryOutputTokens: 32_768,
      maxQuestionCompactReviewOutputTokens: 32_768,
      maxSegmentedQuestions: 300,
      maxQuestionBoundarySubmissions: 3,
      maxQuestionBoundaryAgentRuns: 2,
      maxQuestionRejectedToolCalls: 3,
      maxQuestionAutoOwnedGapRatio: 0.18,
      minQuestionRepeatedImagePages: 3,
      questionRepeatedImagePositionToleranceRatio: 0.015,
      maxQuestionRecutAttempts: 2,
      maxQuestionVisionImagesPerToolCall: 4,
      questionSegmentationAgentTimeoutMs: 90_000,
    })
    contexts.push(b.ctx)
    const image = async (questionNo: number, color: string) => ({
      questionNo,
      fileName: `第${String(questionNo)}题.png`,
      mediaType: 'image/png' as const,
      width: 12,
      height: 8,
      contentBase64: (await sharp({ create: { width: 12, height: 8, channels: 3, background: color } }).png().toBuffer()).toString('base64'),
    })

    const first = await b.service.saveQuestionBatch({
      destination: { kind: 'source-folder' },
      name: '合并试卷', sourceName: 'math.pdf', pageRange: '全部页', images: [await image(1, '#ff0000')],
    })
    expect(first.ok).toBe(true)
    if (!first.ok || first.value.batchId === undefined) throw new Error('missing batch id')
    const firstBatch = first.value.document.state.questionBatches.find(batch => batch.id === first.value.batchId)
    const automaticFolder = first.value.document.state.questionLibraryFolders.find(folder => folder.name === 'math')
    if (firstBatch === undefined || automaticFolder === undefined) throw new Error('missing automatic PDF directory')
    expect(firstBatch.folderId).toBe(automaticFolder.id)
    expect((await stat(join(root, 'segments', 'math', `${String(firstBatch.images[0]!.id)}.png`))).isFile()).toBe(true)
    const second = await b.service.saveQuestionBatch({
      appendToBatchId: first.value.batchId,
      destination: { kind: 'source-folder' },
      name: '合并试卷', sourceName: 'math.pdf', pageRange: '全部页', images: [await image(2, '#0000ff')],
    })

    expect(second).toMatchObject({
      ok: true,
      value: {
        batchId: first.value.batchId,
        document: {
          state: {
            questionBatches: [{ id: first.value.batchId, name: '合并试卷', images: [{ questionNo: 1 }, { questionNo: 2 }] }],
          },
        },
      },
    })
    const separate = await b.service.saveQuestionBatch({
      destination: { kind: 'source-folder' },
      name: '另一批次', sourceName: 'math.pdf', pageRange: '1', images: [await image(3, '#00ff00')],
    })
    expect(separate).toMatchObject({ ok: true })
    if (!separate.ok || separate.value.batchId === undefined) throw new Error('missing separate batch')
    expect(separate.value.document.state.questionLibraryFolders.filter(folder => folder.name === 'math')).toHaveLength(1)
    expect(separate.value.document.state.questionBatches.find(batch => batch.id === separate.value.batchId)?.folderId)
      .toBe(automaticFolder.id)
    expect(await b.service.saveQuestionBatch({
      appendToBatchId: 'missing' as TeacherQuestionBatchId,
      destination: { kind: 'source-folder' },
      name: '合并试卷', sourceName: 'math.pdf', pageRange: '全部页', images: [await image(4, '#00ff00')],
    })).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('creates durable Web hierarchies on disk and saves paper images directly in the selected folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-question-direct-folder-'))
    temporaryRoots.push(root)
    const segmentsRoot = join(root, 'segments')
    const studentsRoot = join(root, 'students')
    const b = await harness(undefined, testConfig(root))
    contexts.push(b.ctx)
    const classId = 'class-direct-folder' as TeacherClassId
    const studentId = 'student-direct-folder' as TeacherStudentId
    const studentFolderId = 'student-folder-direct' as TeacherQuestionFolderId
    const libraryFolderId = 'library-folder-direct' as TeacherQuestionLibraryFolderId
    const nestedLibraryFolderId = 'library-folder-direct-nested' as TeacherQuestionLibraryFolderId
    const written = await b.service.write({
      expectedRevision: 0,
      state: {
        ...INITIAL_TEACHER_WORKBENCH_STATE,
        classes: [{ id: classId, usage: 'roster', academicYear: '2026-2027', name: '高二（2）班', grade: '高二', subject: '数学' }],
        students: [{
          id: studentId,
          classId,
          name: '李同学',
          studentNumber: '2',
          gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
        }],
        questionFolders: [{
          id: studentFolderId,
          studentId,
          name: '错题订正',
          createdAt: 1,
          updatedAt: 1,
        }],
        questionLibraryFolders: [{
          id: libraryFolderId,
          name: '高二数学',
          createdAt: 1,
          updatedAt: 1,
        }, {
          id: nestedLibraryFolderId,
          parentId: libraryFolderId,
          name: '几何',
          createdAt: 2,
          updatedAt: 2,
        }],
      },
    })
    expect(written.ok).toBe(true)
    expect((await stat(join(studentsRoot, '2026-2027', '高二(2)班'))).isDirectory()).toBe(true)
    expect((await stat(join(studentsRoot, '2026-2027', '高二(2)班', '李同学'))).isDirectory()).toBe(true)
    expect((await stat(join(studentsRoot, '2026-2027', '高二(2)班', '李同学', '错题订正'))).isDirectory()).toBe(true)
    const selectedDirectory = join(segmentsRoot, '高二数学', '几何')
    expect((await stat(selectedDirectory)).isDirectory()).toBe(true)

    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()
    await expect(b.service.saveQuestionBatch({
      destination: { kind: 'library-folder', folderId: libraryFolderId },
      name: '父目录拒绝验证',
      sourceName: '父目录拒绝验证.pdf',
      pageRange: '1',
      images: [{
        questionNo: 1,
        fileName: '第1题.png',
        mediaType: 'image/png',
        width: 12,
        height: 8,
        contentBase64: bytes.toString('base64'),
      }],
    })).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request', message: '保存目录必须是末级目录' } })
    const saved = await b.service.saveQuestionBatch({
      destination: { kind: 'library-folder', folderId: nestedLibraryFolderId },
      name: '期中试卷',
      sourceName: '期中试卷.pdf',
      pageRange: '1',
      images: [{
        questionNo: 1,
        fileName: '第1题.png',
        mediaType: 'image/png',
        width: 12,
        height: 8,
        contentBase64: bytes.toString('base64'),
      }],
    })
    if (!saved.ok || saved.value.batchId === undefined) throw new Error('missing saved batch')
    const batch = saved.value.document.state.questionBatches.find(item => item.id === saved.value.batchId)!
    const storedPath = join(selectedDirectory, `${String(batch.images[0]!.id)}.png`)
    await expect(readFile(storedPath)).resolves.toEqual(bytes)
    await expect(stat(join(selectedDirectory, '期中试卷'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(selectedDirectory, String(batch.id)))).rejects.toMatchObject({ code: 'ENOENT' })

    const browsed = await b.service.browseQuestionMedia({})
    if (!browsed.ok) throw new Error(browsed.error.message)
    expect(browsed.value.questionLibraryFolders.filter(folder => folder.id === nestedLibraryFolderId)).toHaveLength(1)
    expect(browsed.value.questionBatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: batch.id, folderId: nestedLibraryFolderId, images: [expect.objectContaining({ questionNo: 1 })] }),
    ]))

    const renamed = await b.service.renameQuestionMediaDirectory({
      target: { kind: 'library-folder', id: nestedLibraryFolderId },
      name: '解析几何',
    })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) throw new Error(renamed.error.message)
    expect(renamed.value.document.state.questionLibraryFolders.find(item => item.id === nestedLibraryFolderId))
      .toMatchObject({ name: '解析几何' })
    const renamedDirectory = join(segmentsRoot, '高二数学', '解析几何')
    const renamedStoredPath = join(renamedDirectory, `${String(batch.images[0]!.id)}.png`)
    await expect(stat(selectedDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(renamedStoredPath)).resolves.toEqual(bytes)
    await expect(b.service.readQuestionImage({ target: { kind: 'batch', id: batch.images[0]!.id } }))
      .resolves.toMatchObject({ ok: true, value: { contentBase64: bytes.toString('base64') } })

    const unrelated = join(renamedDirectory, '手工图片.png')
    await writeFile(unrelated, bytes)
    await expect(b.service.deleteQuestionBatch({ batchId: batch.id })).resolves.toMatchObject({ ok: true })
    await expect(stat(renamedStoredPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(unrelated)).resolves.toEqual(bytes)
    expect((await stat(renamedDirectory)).isDirectory()).toBe(true)

    const retained = await b.service.saveQuestionBatch({
      destination: { kind: 'library-folder', folderId: nestedLibraryFolderId },
      name: '月考试卷',
      sourceName: '月考试卷.pdf',
      pageRange: '1',
      images: [{
        questionNo: 2,
        fileName: '第2题.png',
        mediaType: 'image/png',
        width: 12,
        height: 8,
        contentBase64: bytes.toString('base64'),
      }],
    })
    if (!retained.ok || retained.value.batchId === undefined) throw new Error('missing retained batch')
    const retainedBatch = retained.value.document.state.questionBatches.find(item => item.id === retained.value.batchId)!
    const retainedImage = retainedBatch.images[0]!
    const assigned = await b.service.assignQuestions({
      studentId,
      folderId: studentFolderId,
      imageIds: [retainedImage.id],
    })
    if (!assigned.ok) throw new Error(assigned.error.message)
    const retainedAssignment = assigned.value.document.state.questionAssignments[0]!
    const retainedAssignmentPath = join(studentsRoot, retainedAssignment.relativePath)
    await expect(readFile(retainedAssignmentPath)).resolves.toEqual(bytes)
    const retainedStoredPath = join(renamedDirectory, `${String(retainedImage.id)}.png`)
    await rm(retainedStoredPath)
    await expect(b.service.deleteQuestionMediaDirectory({
      target: { kind: 'library-folder', id: nestedLibraryFolderId },
    })).resolves.toMatchObject({
      ok: true,
      value: { document: { state: {
        questionLibraryFolders: [expect.objectContaining({ id: libraryFolderId })],
        questionBatches: [],
        questionAssignments: [],
      } } },
    })
    await expect(stat(renamedDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    const movedImagePath = join(segmentsRoot, '高二数学', `${String(retainedImage.id)}.png`)
    await expect(stat(movedImagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(retainedAssignmentPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(b.service.readQuestionImage({ target: { kind: 'batch', id: retainedImage.id } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
    await expect(b.service.readQuestionImage({ target: { kind: 'assignment', id: retainedAssignment.id } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('serves migrated defaults before the first durable write', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const result = await b.service.read({})
    expect(result.ok).toBe(true)
    expect(result.value.revision).toBe(0)
    expect(result.value.state.resources.map(item => item.name)).toContain('国家中小学智慧教育平台')
    expect(result.value.state.templates.filter(item => item.kind === 'teaching')).toHaveLength(4)
    expect(Object.isFrozen(result.value.state.resources)).toBe(true)
  })

  it('exposes Host-fetched weather through the same Remote service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])))
    const b = await harness()
    contexts.push(b.ctx)
    await expect(b.service.weather({ location: '不存在' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'location-not-found' },
    })
  })

  it('commits a valid compare-and-set write and rejects a stale writer', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const first = await b.service.write({ expectedRevision: 0, state: withClasses(classItem('class-a', '高一（1）班')) })
    expect(first).toMatchObject({ ok: true, value: { revision: 1 } })
    const conflict = await b.service.write({ expectedRevision: 0, state: withClasses(classItem('class-b', '高一（2）班')) })
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict', current: { revision: 1 } },
    })
    const read = await b.service.read({})
    expect(read.value.state.classes.map(item => item.name)).toEqual(['高一（1）班'])
  })

  it('serializes concurrent writes so only one observed revision commits', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const results = await Promise.all([
      b.service.write({ expectedRevision: 0, state: withClasses(classItem('class-a', 'A班')) }),
      b.service.write({ expectedRevision: 0, state: withClasses(classItem('class-b', 'B班')) }),
    ])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.error.code === 'revision-conflict')).toHaveLength(1)
  })

  it('rejects broken references without changing durable state', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const invalid: TeacherWorkbenchState = {
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      students: [{
        id: 'student-a' as TeacherStudentId,
        classId: 'missing' as TeacherClassId,
        name: '张同学',
        studentNumber: '1',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
        extras: {},
      }],
    }
    const result = await b.service.write({ expectedRevision: 0, state: invalid })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    expect((await b.service.read({})).value.revision).toBe(0)
  })

  it('reopens the committed document through the same storage medium', async () => {
    const first = await harness()
    contexts.push(first.ctx)
    await first.service.write({ expectedRevision: 0, state: withClasses(classItem('class-a', '持久班')) })
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const second = await harness(first.pool)
    contexts.push(second.ctx)
    const read = await second.service.read({})
    expect(read.value).toMatchObject({ revision: 1, state: { classes: [{ name: '持久班' }] } })
  })

  it('copies and freezes every nested collection before publishing it', async () => {
    const b = await harness()
    contexts.push(b.ctx)
    const classId = 'class-a' as TeacherClassId
    const timetableClassId = 'timetable-class-a' as TeacherClassId
    const studentId = 'student-a' as TeacherStudentId
    const templateId = 'template-a' as TeacherRecordTemplateId
    const state: TeacherWorkbenchState = {
      dailyTodos: [{
        id: 'todo-a' as TeacherDailyTodoId,
        title: '批改作业',
        dueAt: '2026-08-18T18:30',
        completed: false,
        category: 'important',
        color: 'amber',
        createdAt: 1,
        updatedAt: 1,
      }],
      quickNotes: [{
        id: 'note-a' as TeacherQuickNoteId,
        content: '课堂观察',
        createdAt: 1,
        updatedAt: 1,
      }],
      ledgerCategories: [{
        id: 'ledger-category-a' as TeacherLedgerCategoryId,
        name: '保险保费',
        createdAt: 1,
      }],
      ledgerEntries: [{
        id: 'ledger-entry-a' as TeacherLedgerEntryId,
        categoryId: 'ledger-category-a' as TeacherLedgerCategoryId,
        description: '家庭保险',
        amountCents: 120_000,
        occurredAt: '2026-08-20T10:30',
        createdAt: 1,
        updatedAt: 1,
      }],
      calendarItems: [{
        id: 'calendar-a' as TeacherCalendarItemId,
        date: '2026-08-20',
        time: '09:00',
        title: '教研会',
        details: '',
        createdAt: 1,
        updatedAt: 1,
      }],
      timetableEntries: [{
        id: 'timetable-a' as TeacherTimetableEntryId,
        classId: timetableClassId,
        kind: 'lesson',
        weekday: 1,
        period: 1,
        startTime: '08:00',
        endTime: '08:45',
        subject: '数学',
        teacherName: '张老师',
        location: '101',
        createdAt: 1,
        updatedAt: 1,
      }],
      classes: [
        classItem(classId, 'A班'),
        classItem(timetableClassId, 'A班', 'timetable'),
      ],
      students: [{
        id: studentId,
        classId,
        name: '张同学',
        studentNumber: '1',
        gender: '',
        guardian: '',
        relation: '',
        phone: '',
        address: '',
        extras: { '特长': '绘画' },
      }],
      resources: [{
        id: 'resource-a' as TeacherLessonResourceId,
        category: 'resource',
        name: '校本资源',
        url: 'https://example.com',
        description: '',
      }],
      templates: [{
        id: templateId,
        kind: 'teaching',
        name: '反思',
        scene: '',
        fields: ['问题'],
      }],
      records: [{
        id: 'record-a' as TeacherRecordId,
        templateId,
        title: '第一课',
        dueDate: '',
        status: 'active',
        values: { '问题': '节奏' },
        updatedAt: 1,
      }],
      noticeTemplates: [],
      notices: [],
      seatingLayouts: [],
      exams: [{
        id: 'exam-a' as TeacherExamId,
        classId,
        name: '期中',
        date: '',
        entries: [{ studentId, scores: { '数学': 90 } }],
      }],
      questionBatches: [],
      questionLibraryFolders: [],
      questionFolders: [],
      questionAssignments: [],
    }
    const result = await b.service.write({ expectedRevision: 0, state })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('valid nested workbench state was rejected')
    expect(Object.isFrozen(result.value.state.students[0]?.extras)).toBe(true)
    expect(Object.isFrozen(result.value.state.dailyTodos[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.quickNotes[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.ledgerCategories[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.ledgerEntries[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.calendarItems[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.timetableEntries[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.templates[0]?.fields)).toBe(true)
    expect(Object.isFrozen(result.value.state.records[0]?.values)).toBe(true)
    expect(Object.isFrozen(result.value.state.exams[0]?.entries[0]?.scores)).toBe(true)
    const mutableExtras = state.students[0]!.extras as Record<string, string>
    mutableExtras['特长'] = '音乐'
    expect(result.value.state.students[0]?.extras['特长']).toBe('绘画')
  })

  it('keeps queued writes usable after a storage failure and rejects disposal-time writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-teacher-workbench-rollback-'))
    temporaryRoots.push(root)
    const b = await harness(undefined, testConfig(root))
    contexts.push(b.ctx)
    const internal = b.service as unknown as { global: { set(value: unknown): Promise<void> } }
    vi.spyOn(internal.global, 'set').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(b.service.write({ expectedRevision: 0, state: withClasses(classItem('a', 'A班')) }))
      .rejects.toThrow('disk unavailable')
    await expect(stat(join(root, 'students', '未分学年', '高一A班'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(b.service.write({ expectedRevision: 0, state: withClasses(classItem('b', 'B班')) }))
      .resolves.toMatchObject({ ok: true, value: { revision: 1 } })
    expect((await stat(join(root, 'students', '未分学年', '高一B班'))).isDirectory()).toBe(true)

    await b.fiber.dispose()
    await expect(b.service.write({ expectedRevision: 1, state: withClasses() }))
      .rejects.toThrow('service is disposing')
  })

  it('persists, assigns, reads, exports, and deletes question images end to end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-question-workbench-'))
    temporaryRoots.push(root)
    const b = await harness(new MemoryMediaPool(), {
      geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
      geocodingCacheEntries: 16,
      segmentsRoot: join(root, 'segments'),
      studentsRoot: join(root, 'students'),
      sourcesRoot: join(root, 'sources'),
      generatedRoot: join(root, 'generated'),
      maxSourceDocumentBytes: 8 * 1024 * 1024,
      maxQuestionImageBytes: 1024 * 1024,
      maxQuestionBatchBytes: 4 * 1024 * 1024,
      maxTimetableSourceCharacters: 120_000,
      maxTimetableEntries: 1_000,
      timetableAgentTimeoutMs: 120_000,
      timetableVisionAgentTimeoutMs: 45_000,
      maxQuestionLayoutPages: 50,
      questionSegmentationBatchPages: 20,
      questionSegmentationBatchCandidates: 300,
      questionSegmentationConcurrency: 4,
      maxQuestionWidthOutlierExcessRatio: 0.5,
      maxQuestionLayoutElements: 5_000,
      maxQuestionSourceChunkCharacters: 18_000,
      maxQuestionCompactBoundaryCharacters: 12_000,
      questionSegmentationInlineEvidence: false,
      maxQuestionCompactBoundaryOutputTokens: 32_768,
      maxQuestionCompactReviewOutputTokens: 32_768,
      maxSegmentedQuestions: 300,
      maxQuestionBoundarySubmissions: 3,
      maxQuestionBoundaryAgentRuns: 2,
      maxQuestionRejectedToolCalls: 3,
      maxQuestionAutoOwnedGapRatio: 0.18,
      minQuestionRepeatedImagePages: 3,
      questionRepeatedImagePositionToleranceRatio: 0.015,
      maxQuestionRecutAttempts: 2,
      maxQuestionVisionImagesPerToolCall: 4,
      questionSegmentationAgentTimeoutMs: 90_000,
    })
    contexts.push(b.ctx)
    const owningClass = { ...classItem('class-a', '高一（1）班'), academicYear: '2026' }
    const studentId = 'student-a' as TeacherStudentId
    const sourceImages = await Promise.all([
      { questionNo: 10, color: '#0000ff' },
      { questionNo: 2, color: '#00ff00' },
      { questionNo: 1, color: '#ff0000' },
    ].map(async item => ({
      ...item,
      bytes: await sharp({ create: { width: 24, height: 16, channels: 3, background: item.color } }).png().toBuffer(),
    })))
    const bytes = sourceImages[0]!.bytes
    const desktopFolder = join(root, '桌面图片')
    await mkdir(join(desktopFolder, '子目录'), { recursive: true })
    await writeFile(join(desktopFolder, '第10题.png'), sourceImages[0]!.bytes)
    await writeFile(join(desktopFolder, '子目录', '第2题.png'), sourceImages[1]!.bytes)
    const generatedFolder = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'generate_folder_document',
      data: { kind: 'ppt', directoryPath: desktopFolder },
    })
    expect(generatedFolder.value).toMatchObject({ summary: 'Generated folder document' })
    const generatedFolderPath = (generatedFolder.value as { outputPath: string }).outputPath
    expect(generatedFolderPath).toContain('桌面图片.pptx')
    const generatedFolderParts = unzipSync(await readFile(generatedFolderPath))
    expect(Object.keys(generatedFolderParts).filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name))).toHaveLength(2)
    const generatedFolderColors = await Promise.all([1, 2].map(async (slideNo) => {
      const stats = await sharp(Buffer.from(generatedFolderParts[`ppt/media/image-${String(slideNo)}-1.png`]!)).stats()
      return stats.channels.slice(0, 3).map(channel => Math.round(channel.mean))
    }))
    expect(generatedFolderColors).toEqual([[0, 255, 0], [0, 0, 255]])

    const seeded = await b.service.write({
      expectedRevision: 0,
      state: {
        ...INITIAL_TEACHER_WORKBENCH_STATE,
        classes: [owningClass],
        students: [{
          id: studentId,
          classId: owningClass.id,
          name: '张同学',
          studentNumber: '1',
          gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
        }],
      },
    })
    expect(seeded.ok).toBe(true)
    const saved = await b.service.saveQuestionBatch({
      destination: { kind: 'source-folder' },
      name: '期中试卷',
      sourceName: 'math.pdf',
      pageRange: '1-2',
      images: sourceImages.map(item => ({
        questionNo: item.questionNo,
        fileName: `第${String(item.questionNo)}题.png`,
        mediaType: 'image/png' as const,
        width: 24,
        height: 16,
        contentBase64: item.bytes.toString('base64'),
      })),
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error(saved.error.message)
    const textMark = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#000000' } }).png().toBuffer()
    const editableBytes = await sharp({ create: { width: 20, height: 16, channels: 3, background: '#ffffff' } })
      .composite([{ input: textMark, left: 9, top: 7 }])
      .png()
      .toBuffer()
    const editable = await b.service.saveQuestionBatch({
      destination: { kind: 'source-folder' },
      name: '图片编辑测试',
      sourceName: 'edit.png',
      pageRange: '',
      images: [{
        questionNo: 1,
        fileName: '编辑题.png',
        mediaType: 'image/png',
        width: 20,
        height: 16,
        contentBase64: editableBytes.toString('base64'),
      }],
    })
    if (!editable.ok) throw new Error(editable.error.message)
    const editableBatchId = editable.value.batchId
    if (editableBatchId === undefined) throw new Error('editable question batch id was not returned')
    const editableBatch = editable.value.document.state.questionBatches.find(item => item.id === editableBatchId)!
    const editableImage = editableBatch.images[0]!
    const refusedInspection = await callTool(b.ctx, 'teacher_question_image_read', {
      kind: 'batch', id: editableImage.id,
    }, imageAgent('text-only'))
    expect(refusedInspection.isError).toBe(true)
    expect(refusedInspection.content.find(block => block.type === 'text')?.text)
      .toContain('does not declare image input')
    const inspected = await callTool(b.ctx, 'teacher_question_image_read', {
      kind: 'batch', id: editableImage.id,
    }, imageAgent())
    expect(inspected).toMatchObject({
      isError: false,
      value: { source: { fileName: '编辑题.png', width: 20, height: 16 } },
      content: [{ type: 'text' }, { type: 'image', attachment: { width: 20, height: 16 } }],
    })
    const invalidErase = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'erase_image_regions',
      data: { kind: 'batch', id: editableImage.id, regions: [{ left: 18, top: 12, width: 4, height: 4 }] },
    })
    expect(invalidErase.isError).toBe(true)
    await expect(b.service.readQuestionImage({ target: { kind: 'batch', id: editableImage.id } }))
      .resolves.toMatchObject({ ok: true, value: { contentBase64: editableBytes.toString('base64') } })
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'erase_image_regions',
      data: { kind: 'batch', id: editableImage.id, regions: [{ left: 7, top: 5, width: 6, height: 8 }] },
    })).resolves.toMatchObject({ isError: false })
    const erasedImage = await b.service.readQuestionImage({ target: { kind: 'batch', id: editableImage.id } })
    if (!erasedImage.ok) throw new Error(erasedImage.error.message)
    const erasedStats = await sharp(Buffer.from(erasedImage.value.contentBase64, 'base64'))
      .extract({ left: 7, top: 5, width: 6, height: 8 })
      .stats()
    expect(erasedStats.channels.slice(0, 3).every(channel => channel.mean > 250)).toBe(true)
    const batch = saved.value.document.state.questionBatches[0]!
    const image = batch.images[0]!
    await expect(b.service.readQuestionImage({ target: { kind: 'batch', id: image.id } }))
      .resolves.toMatchObject({ ok: true, value: { width: 24, height: 16 } })
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'rotate_image', data: { kind: 'batch', id: image.id, degrees: 90 },
    })).resolves.toMatchObject({ isError: false })
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'crop_image', data: { kind: 'batch', id: image.id, left: 0, top: 0, width: 12, height: 12 },
    })).resolves.toMatchObject({ isError: false })

    const folderId = 'folder-a' as TeacherQuestionFolderId
    const editedDocument = (await b.service.read({})).value
    const withFolder = await b.service.write({
      expectedRevision: editedDocument.revision,
      state: {
        ...editedDocument.state,
        questionLibraryFolders: [...editedDocument.state.questionLibraryFolders, {
          id: 'library-empty' as TeacherQuestionLibraryFolderId,
          name: '空试题库',
          createdAt: 2,
          updatedAt: 2,
        }],
        questionFolders: [{ id: folderId, studentId, name: '第一次作业', createdAt: 2, updatedAt: 2 }],
      },
    })
    expect(withFolder.ok).toBe(true)
    const nestedFolder = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'create_folder', data: { studentId, parentId: folderId, name: '错题' },
    })
    const nestedFolderId = (nestedFolder.value as { createdIds: string[] }).createdIds[0]!
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'delete_folder', data: { id: nestedFolderId },
    })).resolves.toMatchObject({ isError: false })
    const assigned = await b.service.assignQuestions({ studentId, folderId, imageIds: batch.images.map(item => item.id) })
    expect(assigned.ok).toBe(true)
    if (!assigned.ok) throw new Error(assigned.error.message)
    expect(assigned.value.document.state.questionAssignments).toHaveLength(3)
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'assign_questions', data: { studentId, folderId, imageIds: [image.id] },
    })).resolves.toMatchObject({ isError: false })
    const nestedAssignment = assigned.value.document.state.questionAssignments[0]!
    expect(nestedAssignment.folderId).toBe(folderId)
    expect(nestedAssignment.relativePath.split(/[\\/]/u).slice(0, 4)).toEqual(['2026', '高一(1)班', '张同学', '第一次作业'])

    const browsedAssignments = await b.service.browseQuestionMedia({})
    expect(browsedAssignments).toMatchObject({ ok: true })
    if (!browsedAssignments.ok) throw new Error(browsedAssignments.error.message)
    expect(browsedAssignments.value.questionAssignments).toHaveLength(4)
    for (const assignment of assigned.value.document.state.questionAssignments) {
      expect(browsedAssignments.value.questionAssignments).toContainEqual(expect.objectContaining({
        id: assignment.id,
        studentId,
      }))
    }
    expect(browsedAssignments.value.students.filter(item => item.id === studentId)).toHaveLength(1)
    expect(browsedAssignments.value.questionLibraryFolders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'library-empty', name: '空试题库' }),
    ]))
    expect(browsedAssignments.value.questionLibraryFolders.some(folder => folder.name === String(batch.id))).toBe(false)
    const renamedFolder = await b.service.renameQuestionMediaDirectory({
      target: { kind: 'student-folder', id: folderId },
      name: '第一次订正',
    })
    expect(renamedFolder).toMatchObject({ ok: true })
    if (!renamedFolder.ok) throw new Error(renamedFolder.error.message)
    expect(renamedFolder.value.document.state.questionFolders)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: folderId, name: '第一次订正' })]))
    expect(renamedFolder.value.document.state.questionAssignments
      .some(assignment => assignment.relativePath.includes('第一次订正'))).toBe(true)
    expect((await stat(join(root, 'students', '2026', '高一(1)班', '张同学', '第一次订正'))).isDirectory())
      .toBe(true)
    await expect(b.service.readQuestionImage({ target: { kind: 'assignment', id: nestedAssignment.id } }))
      .resolves.toMatchObject({ ok: true, value: { width: 12, height: 12 } })

    const staged = await b.service.saveTemporaryQuestionSelection({
      studentId,
      assignmentIds: [nestedAssignment.id],
    })
    expect(staged).toMatchObject({ ok: true, value: { studentId, imageCount: 1 } })
    if (!staged.ok) throw new Error(staged.error.message)
    const stagedAssignment = staged.value.document.state.questionAssignments.find(item => item.id === nestedAssignment.id)
    expect(stagedAssignment).toMatchObject({ temporarySaveCount: 1 })
    expect(stagedAssignment?.lastTemporarySavedAt).toEqual(expect.any(Number))
    await expect(b.service.listTemporaryQuestionSelections({ studentIds: [studentId] }))
      .resolves.toMatchObject({ ok: true, value: [{ studentId, imageCount: 1 }] })
    const temporaryPpt = await b.service.generateStudentDocuments({
      kind: 'ppt',
      students: [{ studentId, title: '', includeName: false, includeDate: false }],
    })
    expect(temporaryPpt).toMatchObject({ ok: true, value: { artifacts: [{ fileName: '张同学.pptx' }], skipped: [] } })
    if (!temporaryPpt.ok) throw new Error(temporaryPpt.error.message)
    const temporaryPptParts = unzipSync(Buffer.from(temporaryPpt.value.artifacts[0]!.contentBase64, 'base64'))
    expect(Object.keys(temporaryPptParts).filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name))).toHaveLength(1)
    await expect(b.service.listTemporaryQuestionSelections({ studentIds: [studentId] }))
      .resolves.toMatchObject({ ok: true, value: [] })

    const assignments = assigned.value.document.state.questionAssignments
    const shuffledIds = [assignments[0]!.id, assignments[2]!.id, assignments[1]!.id]
    await expect(b.service.saveTemporaryQuestionSelection({ studentId, assignmentIds: shuffledIds }))
      .resolves.toMatchObject({ ok: true, value: { studentId, imageCount: 3 } })
    const manifestPath = join(root, 'students', '.dsh-question-temp', studentId, 'manifest.json')
    const manifest = JSON.parse(await readFile(
      manifestPath,
      'utf8',
    )) as {
      version: 1
      studentId: TeacherStudentId
      images: Array<{
        storedName: string
        fileName: string
        questionNo?: number
        mediaType: 'image/png'
        width: number
        height: number
      }>
    }
    expect(manifest.images.map(item => item.fileName)).toEqual(['第1题.png', '第2题.png', '第10题.png'])
    expect(manifest.images.map(item => item.questionNo)).toEqual([1, 2, 10])
    const legacyImages = manifest.images.map(item => ({
      storedName: item.storedName,
      fileName: item.fileName,
      mediaType: item.mediaType,
      width: item.width,
      height: item.height,
    }))
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      images: [legacyImages[2]!, legacyImages[0]!, legacyImages[1]!],
    }))

    const orderedWord = await b.service.generateStudentDocuments({
      kind: 'word',
      source: 'temporary',
      students: [{ studentId, title: '', includeName: false, includeDate: false }],
    })
    expect(orderedWord).toMatchObject({ ok: true, value: { artifacts: [{ fileName: '张同学.docx' }], skipped: [] } })
    if (!orderedWord.ok) throw new Error(orderedWord.error.message)
    const orderedWordParts = unzipSync(Buffer.from(orderedWord.value.artifacts[0]!.contentBase64, 'base64'))
    const orderedWordXml = Buffer.from(orderedWordParts['word/document.xml']!).toString('utf8')
    const orderedWordRelationships = Buffer.from(orderedWordParts['word/_rels/document.xml.rels']!).toString('utf8')
    const imageTargets = new Map([...orderedWordRelationships.matchAll(
      /<Relationship Id="([^"]+)" Type="[^"]+\/image" Target="([^"]+)"\/>/gu,
    )].map(match => [match[1]!, match[2]!] as const))
    const imageRelationshipIds = [...orderedWordXml.matchAll(/r:embed="([^"]+)"/gu)].map(match => match[1]!)
    const orderedWordColors = await Promise.all(imageRelationshipIds.map(async (relationshipId) => {
      const target = imageTargets.get(relationshipId)
      if (target === undefined) throw new Error(`missing image relationship ${relationshipId}`)
      const stats = await sharp(Buffer.from(orderedWordParts[`word/${target}`]!)).stats()
      return stats.channels.slice(0, 3).map(channel => Math.round(channel.mean))
    }))
    expect(orderedWordColors).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]])

    await expect(b.service.saveTemporaryQuestionSelection({ studentId, assignmentIds: shuffledIds.toReversed() }))
      .resolves.toMatchObject({ ok: true, value: { studentId, imageCount: 3 } })
    const orderedPpt = await b.service.generateStudentDocuments({
      kind: 'ppt',
      source: 'temporary',
      students: [{ studentId, title: '', includeName: false, includeDate: false }],
    })
    expect(orderedPpt).toMatchObject({ ok: true, value: { artifacts: [{ fileName: '张同学.pptx' }], skipped: [] } })
    if (!orderedPpt.ok) throw new Error(orderedPpt.error.message)
    const orderedPptParts = unzipSync(Buffer.from(orderedPpt.value.artifacts[0]!.contentBase64, 'base64'))
    const orderedPptColors = await Promise.all([1, 2, 3].map(async (slideNo) => {
      const stats = await sharp(Buffer.from(orderedPptParts[`ppt/media/image-${String(slideNo)}-1.png`]!)).stats()
      return stats.channels.slice(0, 3).map(channel => Math.round(channel.mean))
    }))
    expect(orderedPptColors).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]])

    const word = await b.service.generateQuestionDocument({
      kind: 'word', title: '练习', studentName: '张同学', includeDate: true,
      targets: [{ kind: 'batch', id: image.id }],
    })
    expect(word.ok && Buffer.from(word.value.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK')
    if (!word.ok) throw new Error(word.error.message)
    const wordParts = unzipSync(Buffer.from(word.value.contentBase64, 'base64'))
    const wordXml = Buffer.from(wordParts['word/document.xml']!).toString('utf8')
    expect(wordXml).toContain('练习')
    expect(wordXml).toContain('张同学  ')
    expect(wordXml).not.toContain('姓名：')
    expect(wordXml).toMatch(/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/u)
    expect(wordXml).toMatch(/<w:pgMar[^>]*w:top="1134"[^>]*w:right="1134"[^>]*w:bottom="1134"[^>]*w:left="1134"/u)
    const ppt = await b.service.generateQuestionDocument({
      kind: 'ppt', title: '讲评', studentName: '', includeDate: false,
      targets: [{ kind: 'batch', id: image.id }],
    })
    expect(ppt.ok && Buffer.from(ppt.value.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK')
    if (!ppt.ok) throw new Error(ppt.error.message)
    const pptParts = unzipSync(Buffer.from(ppt.value.contentBase64, 'base64'))
    const slideXml = Buffer.from(pptParts['ppt/slides/slide1.xml']!).toString('utf8')
    const presentationXml = Buffer.from(pptParts['ppt/presentation.xml']!).toString('utf8')
    expect(slideXml).not.toContain('<a:t>')
    expect(slideXml).toContain('<a:off x="180000" y="360000"/>')
    expect(presentationXml).toMatch(/<p:sldSz cx="12191695" cy="6858000"/u)
    const uploaded = await b.service.generateUploadedQuestionDocument({
      kind: 'word',
      folderName: '本地题目',
      images: [{ fileName: '第2题.png', relativePath: '本地题目/第2题.png', contentBase64: bytes.toString('base64') }],
    })
    expect(uploaded).toMatchObject({ ok: true, value: { fileName: '本地题目.docx' } })
    const documents = await b.service.generateStudentDocuments({
      kind: 'word',
      source: 'assigned',
      students: [{ studentId, title: '课后练习', includeName: true, includeDate: true }],
    })
    expect(documents).toMatchObject({
      ok: true,
      value: { artifacts: [{ fileName: '张同学.docx' }], skipped: [] },
    })
    if (!documents.ok) throw new Error(documents.error.message)
    expect(Buffer.from(documents.value.artifacts[0]!.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK')

    const generated = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'generate_document',
      data: { kind: 'word', title: '工具生成', targets: [{ kind: 'batch', id: image.id }] },
    })
    expect(generated.value).toMatchObject({ summary: 'Generated question document' })
    expect((generated.value as { outputPath: string }).outputPath).toContain('generated')
    await expect(b.service.saveTemporaryQuestionSelection({ studentId, assignmentIds: [nestedAssignment.id] }))
      .resolves.toMatchObject({ ok: true, value: { studentId, imageCount: 1 } })
    const generatedTemporaryStudents = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'generate_student_documents',
      data: { kind: 'word', students: [{ studentId }] },
    })
    const generatedTemporaryPath = (generatedTemporaryStudents.value as { outputPaths: string[] }).outputPaths[0]!
    const generatedTemporaryParts = unzipSync(await readFile(generatedTemporaryPath))
    const generatedTemporaryXml = Buffer.from(generatedTemporaryParts['word/document.xml']!).toString('utf8')
    expect([...generatedTemporaryXml.matchAll(/r:embed=/gu)]).toHaveLength(1)
    expect(generatedTemporaryXml).not.toContain('张同学')
    await expect(b.service.listTemporaryQuestionSelections({ studentIds: [studentId] }))
      .resolves.toMatchObject({ ok: true, value: [] })
    const generatedStudents = await callTool(b.ctx, 'teacher_question_workbench', {
      action: 'generate_student_documents',
      data: { kind: 'ppt', source: 'assigned', students: [{ studentId }] },
    })
    expect((generatedStudents.value as { outputPaths: string[] }).outputPaths[0]).toContain('generated')
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'delete_image', data: { kind: 'assignment', id: nestedAssignment.id },
    })).resolves.toMatchObject({ isError: false })

    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'delete_batch', data: { batchId: batch.id },
    })).resolves.toMatchObject({ isError: false })
    await expect(callTool(b.ctx, 'teacher_question_workbench', {
      action: 'delete_batch', data: { batchId: editableBatch.id },
    })).resolves.toMatchObject({ isError: false })
    await expect(b.service.read({})).resolves.toMatchObject({
      value: { state: { questionBatches: [], questionAssignments: [] } },
    })
  })

  it('browses images from the newly configured batch and student roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-question-root-change-'))
    temporaryRoots.push(root)
    const originalSegments = join(root, 'original-segments')
    const originalStudents = join(root, 'original-students')
    const nextSegments = join(root, 'next-segments')
    const nextStudents = join(root, 'next-students')
    const b = await harness(new MemoryMediaPool(), {
      geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
      geocodingCacheEntries: 16,
      segmentsRoot: originalSegments,
      studentsRoot: originalStudents,
      sourcesRoot: join(root, 'sources'),
      generatedRoot: join(root, 'generated'),
      maxSourceDocumentBytes: 8 * 1024 * 1024,
      maxQuestionImageBytes: 1024 * 1024,
      maxQuestionBatchBytes: 4 * 1024 * 1024,
      maxTimetableSourceCharacters: 120_000,
      maxTimetableEntries: 1_000,
      timetableAgentTimeoutMs: 120_000,
      timetableVisionAgentTimeoutMs: 45_000,
      maxQuestionLayoutPages: 50,
      questionSegmentationBatchPages: 20,
      questionSegmentationBatchCandidates: 300,
      questionSegmentationConcurrency: 4,
      maxQuestionWidthOutlierExcessRatio: 0.5,
      maxQuestionLayoutElements: 5_000,
      maxQuestionSourceChunkCharacters: 18_000,
      maxQuestionCompactBoundaryCharacters: 12_000,
      questionSegmentationInlineEvidence: false,
      maxQuestionCompactBoundaryOutputTokens: 32_768,
      maxQuestionCompactReviewOutputTokens: 32_768,
      maxSegmentedQuestions: 300,
      maxQuestionBoundarySubmissions: 3,
      maxQuestionBoundaryAgentRuns: 2,
      maxQuestionRejectedToolCalls: 3,
      maxQuestionAutoOwnedGapRatio: 0.18,
      minQuestionRepeatedImagePages: 3,
      questionRepeatedImagePositionToleranceRatio: 0.015,
      maxQuestionRecutAttempts: 2,
      maxQuestionVisionImagesPerToolCall: 4,
      questionSegmentationAgentTimeoutMs: 90_000,
    }, true)
    contexts.push(b.ctx)
    const owningClass = { ...classItem('class-root-change', '高一（1）班'), academicYear: '2026' }
    const studentId = 'student-root-change' as TeacherStudentId
    const durableFolderId = 'folder-root-change' as TeacherQuestionFolderId
    const oldOnlyStudentId = 'student-old-root-only' as TeacherStudentId
    const oldLibraryFolderId = 'library-old-root-only' as TeacherQuestionLibraryFolderId
    const seeded = await b.service.write({
      expectedRevision: 0,
      state: {
        ...INITIAL_TEACHER_WORKBENCH_STATE,
        classes: [owningClass],
        students: [{
          id: studentId,
          classId: owningClass.id,
          name: '张同学',
          studentNumber: '1',
          gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
        }, {
          id: oldOnlyStudentId,
          classId: owningClass.id,
          name: '旧目录学生',
          studentNumber: '2',
          gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
        }],
        questionLibraryFolders: [{
          id: oldLibraryFolderId,
          name: '旧图片文件夹',
          createdAt: 1,
          updatedAt: 1,
        }],
        questionFolders: [{
          id: durableFolderId,
          studentId,
          name: '月考',
          createdAt: 1,
          updatedAt: 1,
        }],
      },
    })
    expect(seeded.ok).toBe(true)
    const oldBytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#993333' } }).png().toBuffer()
    const saved = await b.service.saveQuestionBatch({
      destination: { kind: 'source-folder' },
      name: '旧目录试卷',
      sourceName: 'math.pdf',
      pageRange: '1',
      images: [{
        questionNo: 1,
        fileName: '旧题.png',
        mediaType: 'image/png',
        width: 12,
        height: 8,
        contentBase64: oldBytes.toString('base64'),
      }],
    })
    if (!saved.ok || saved.value.batchId === undefined) throw new Error('missing old batch')
    const image = saved.value.document.state.questionBatches[0]!.images[0]!
    const assigned = await b.service.assignQuestions({ studentId, imageIds: [image.id] })
    if (!assigned.ok) throw new Error(assigned.error.message)

    const nextBytes = await sharp({ create: { width: 17, height: 9, channels: 3, background: '#336699' } }).png().toBuffer()
    const batchPath = join(nextSegments, '新路径试卷', '新路径试卷_7.png')
    const nestedBatchPath = join(nextSegments, '月考', '第一次', '套题甲', '月考_8.png')
    const studentPath = join(nextStudents, '2026', '高一', '（1）班', '张同学', '月考', '新路径学生题.png')
    const directoryStudentPath = join(
      nextStudents,
      '2026',
      '高一',
      '（1）班',
      '目录学生',
      '复习',
      '第一周',
      '四级目录题.png',
    )
    await Promise.all([
      mkdir(join(nextSegments, '新路径试卷'), { recursive: true }),
      mkdir(join(nextSegments, '月考', '第一次', '套题甲'), { recursive: true }),
      mkdir(join(nextSegments, '空目录', '下一层'), { recursive: true }),
      mkdir(join(nextStudents, '2026', '高一', '（1）班', '张同学', '月考'), { recursive: true }),
      mkdir(join(nextStudents, '2026', '高一', '（1）班', '目录学生', '复习', '第一周'), { recursive: true }),
      mkdir(join(nextStudents, '2026', '高二', '二班', '临时学生'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(batchPath, nextBytes),
      writeFile(nestedBatchPath, nextBytes),
      writeFile(studentPath, nextBytes),
      writeFile(directoryStudentPath, nextBytes),
    ])

    await b.ctx.settings.update(settingsNamespace('teacher-workbench'), {
      segmentsRoot: nextSegments,
      studentsRoot: nextStudents,
    })
    const beforeUnrelatedWrite = await b.service.read({})
    if (!beforeUnrelatedWrite.ok) throw new Error('missing current document')
    await expect(b.service.write({
      expectedRevision: beforeUnrelatedWrite.value.revision,
      state: beforeUnrelatedWrite.value.state,
    })).resolves.toMatchObject({ ok: true })
    await expect(stat(join(nextStudents, '2026', '高一(1)班', '旧目录学生')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(nextSegments, '旧图片文件夹'))).rejects.toMatchObject({ code: 'ENOENT' })
    const browsed = await b.service.browseQuestionMedia({})
    expect(browsed).toMatchObject({ ok: true })
    if (!browsed.ok) throw new Error(browsed.error.message)
    expect(browsed.value.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: owningClass.id, name: owningClass.name }),
    ]))
    expect(browsed.value.questionBatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '新路径试卷',
        images: [expect.objectContaining({ questionNo: 7, fileName: '新路径试卷_7.png' })],
      }),
      expect.objectContaining({
        name: '套题甲',
        images: [expect.objectContaining({ questionNo: 8, fileName: '月考_8.png' })],
      }),
    ]))
    expect(browsed.value.students).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: studentId, name: '张同学' }),
      expect.objectContaining({ name: '目录学生', classId: owningClass.id }),
    ]))
    expect(browsed.value.students.some(student => student.id === oldOnlyStudentId)).toBe(false)
    expect(browsed.value.questionAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ studentId, fileName: '新路径学生题.png' }),
      expect.objectContaining({ fileName: '四级目录题.png' }),
    ]))
    const libraryFolderByName = new Map(browsed.value.questionLibraryFolders.map(folder => [folder.name, folder] as const))
    expect(libraryFolderByName.has('旧图片文件夹')).toBe(false)
    expect(libraryFolderByName.get('第一次')?.parentId).toBe(libraryFolderByName.get('月考')?.id)
    expect(libraryFolderByName.get('下一层')?.parentId).toBe(libraryFolderByName.get('空目录')?.id)
    expect(browsed.value.questionBatches.find(batch => batch.name === '新路径试卷')?.folderId)
      .toBe(libraryFolderByName.get('新路径试卷')?.id)
    expect(browsed.value.questionBatches.find(batch => batch.name === '套题甲')?.folderId)
      .toBe(libraryFolderByName.get('套题甲')?.id)
    const studentFolderByName = new Map(browsed.value.questionFolders.map(folder => [folder.name, folder] as const))
    expect(studentFolderByName.get('第一周')?.parentId).toBe(studentFolderByName.get('复习')?.id)
    const nestedStudentAssignment = browsed.value.questionAssignments.find(item => item.fileName === '四级目录题.png')
    expect(nestedStudentAssignment?.folderId).toBe(studentFolderByName.get('第一周')?.id)
    expect(browsed.value.questionBatches.some(batch => batch.name === '旧目录试卷')).toBe(false)
    expect(browsed.value.questionAssignments.some(assignment => assignment.fileName === '旧题.png')).toBe(false)
    const discoveredBatchImage = browsed.value.questionBatches.find(batch => batch.name === '新路径试卷')!.images[0]!
    const studentAssignment = browsed.value.questionAssignments.find(item => item.fileName === '新路径学生题.png')!
    const directoryStudentAssignment = browsed.value.questionAssignments.find(item => item.fileName === '四级目录题.png')!
    const [batchRead, studentRead, directoryStudentRead] = await Promise.all([
      b.service.readQuestionImage({ target: { kind: 'batch', id: discoveredBatchImage.id } }),
      b.service.readQuestionImage({ target: { kind: 'assignment', id: studentAssignment.id } }),
      b.service.readQuestionImage({ target: { kind: 'assignment', id: directoryStudentAssignment.id } }),
    ])
    expect(batchRead).toMatchObject({ ok: true, value: { width: 17, height: 9 } })
    expect(studentRead).toMatchObject({ ok: true, value: { width: 17, height: 9 } })
    expect(directoryStudentRead).toMatchObject({ ok: true, value: { width: 17, height: 9 } })

    const beforeAddingCurrentStudent = await b.service.read({})
    if (!beforeAddingCurrentStudent.ok) throw new Error('missing current document')
    const addedCurrentStudentId = 'student-current-root-added' as TeacherStudentId
    await expect(b.service.write({
      expectedRevision: beforeAddingCurrentStudent.value.revision,
      state: {
        ...beforeAddingCurrentStudent.value.state,
        students: [...beforeAddingCurrentStudent.value.state.students, {
          id: addedCurrentStudentId,
          classId: owningClass.id,
          name: '新增持久学生',
          studentNumber: '3',
          gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
        }],
      },
    })).resolves.toMatchObject({ ok: true })
    expect((await stat(join(nextStudents, '2026', '高一', '（1）班', '新增持久学生'))).isDirectory()).toBe(true)
    await expect(stat(join(nextStudents, '2026', '高一(1)班', '新增持久学生')))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const externalStudent = browsed.value.students.find(student => student.name === '目录学生')
    if (externalStudent === undefined) throw new Error('missing directory student')
    const scannedClass = browsed.value.classes.find(item => item.grade === '高二' && item.name === '二班')
    if (scannedClass === undefined) throw new Error('missing scanned current-root class')
    await expect(b.service.createQuestionMediaDirectory({
      parent: { kind: 'class', id: scannedClass.id },
      name: '新增学生',
    })).resolves.toMatchObject({ ok: true })
    expect((await stat(join(nextStudents, '2026', '高二', '二班', '新增学生'))).isDirectory()).toBe(true)
    const afterStudentDirectoryCreate = await b.service.browseQuestionMedia({})
    if (!afterStudentDirectoryCreate.ok) throw new Error(afterStudentDirectoryCreate.error.message)
    const createdDirectoryStudent = afterStudentDirectoryCreate.value.students.find(student => student.name === '新增学生')
    if (createdDirectoryStudent === undefined) throw new Error('missing created current-root student')
    await expect(b.service.deleteQuestionMediaDirectory({
      target: { kind: 'student', id: createdDirectoryStudent.id },
    })).resolves.toMatchObject({ ok: true })
    await expect(stat(join(nextStudents, '2026', '高二', '二班', '新增学生')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const beforeScannedClassDelete = await b.service.browseQuestionMedia({})
    if (!beforeScannedClassDelete.ok) throw new Error(beforeScannedClassDelete.error.message)
    const currentScannedClass = beforeScannedClassDelete.value.classes.find(item => item.name === '二班')
    if (currentScannedClass === undefined) throw new Error('missing current-root class before deletion')
    await expect(b.service.deleteQuestionMediaDirectory({
      target: { kind: 'class', id: currentScannedClass.id },
    })).resolves.toMatchObject({ ok: true })
    await expect(stat(join(nextStudents, '2026', '高二', '二班'))).rejects.toMatchObject({ code: 'ENOENT' })
    const externalStudentFolder = studentFolderByName.get('第一周')
    if (externalStudentFolder === undefined) throw new Error('missing external student folder')
    const editedBytes = await sharp({ create: {
      width: 19,
      height: 11,
      channels: 3,
      background: '#663399',
    } }).png().toBuffer()
    await expect(b.service.replaceQuestionImage({
      target: { kind: 'batch', id: discoveredBatchImage.id },
      fileName: discoveredBatchImage.fileName,
      mediaType: 'image/png',
      width: 19,
      height: 11,
      contentBase64: editedBytes.toString('base64'),
    })).resolves.toMatchObject({ ok: true })
    expect(await readFile(batchPath)).toEqual(editedBytes)

    await expect(b.service.assignQuestions({
      studentId: externalStudent.id,
      folderId: externalStudentFolder.id,
      imageIds: [discoveredBatchImage.id],
    })).resolves.toMatchObject({ ok: true })
    const copiedPath = join(
      nextStudents,
      '2026',
      '高一',
      '（1）班',
      '目录学生',
      '复习',
      '第一周',
      discoveredBatchImage.fileName,
    )
    expect(await readFile(copiedPath)).toEqual(editedBytes)
    const afterAssignment = await b.service.browseQuestionMedia({})
    if (!afterAssignment.ok) throw new Error(afterAssignment.error.message)
    const copiedAssignment = afterAssignment.value.questionAssignments.find(
      assignment => assignment.studentId === externalStudent.id && assignment.fileName === discoveredBatchImage.fileName,
    )
    if (copiedAssignment === undefined) throw new Error('missing copied current-root assignment')
    await expect(b.service.deleteQuestionImage({
      target: { kind: 'assignment', id: copiedAssignment.id },
    })).resolves.toMatchObject({ ok: true })
    await expect(readFile(copiedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(nextStudents, '2026', '高一', '（1）班', '目录学生', '复习', '第一周')))
      .toContain('四级目录题.png')

    await expect(b.service.saveTemporaryQuestionSelection({
      studentId: externalStudent.id,
      assignmentIds: [directoryStudentAssignment.id],
    })).resolves.toMatchObject({
      ok: true,
      value: { studentId: externalStudent.id, imageCount: 1 },
    })
    await expect(b.service.listTemporaryQuestionSelections({ studentIds: [externalStudent.id] }))
      .resolves.toMatchObject({ ok: true, value: [{ studentId: externalStudent.id, imageCount: 1 }] })
    expect(await readFile(directoryStudentPath)).toEqual(nextBytes)
    const directoryStudentDocuments = await b.service.generateStudentDocuments({
      kind: 'word',
      source: 'temporary',
      students: [{ studentId: externalStudent.id, title: '', includeName: false, includeDate: false }],
    })
    expect(directoryStudentDocuments).toMatchObject({
      ok: true,
      value: { artifacts: [{ fileName: '目录学生.docx' }], skipped: [] },
    })
    await expect(b.service.listTemporaryQuestionSelections({ studentIds: [externalStudent.id] }))
      .resolves.toMatchObject({ ok: true, value: [] })

    await expect(b.service.deleteQuestionImage({
      target: { kind: 'batch', id: discoveredBatchImage.id },
    })).resolves.toMatchObject({ ok: true })
    await expect(readFile(batchPath)).rejects.toMatchObject({ code: 'ENOENT' })

    const deletedDurableFolder = await b.service.deleteQuestionMediaDirectory({
      target: { kind: 'student-folder', id: durableFolderId },
    })
    expect(deletedDurableFolder).toMatchObject({ ok: true })
    if (!deletedDurableFolder.ok) throw new Error(deletedDurableFolder.error.message)
    expect(deletedDurableFolder.value.document.state.questionFolders.some(folder => folder.id === durableFolderId))
      .toBe(false)
    await expect(stat(join(nextStudents, '2026', '高一', '（1）班', '张同学', '月考')))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const renamedStudent = await b.service.renameQuestionMediaDirectory({
      target: { kind: 'student', id: studentId },
      name: '张同学重命名',
    })
    expect(renamedStudent).toMatchObject({ ok: true })
    if (!renamedStudent.ok) throw new Error(renamedStudent.error.message)
    expect(renamedStudent.value.document.state.students.find(student => student.id === studentId))
      .toMatchObject({ name: '张同学重命名' })
    expect((await stat(join(nextStudents, '2026', '高一', '（1）班', '张同学重命名'))).isDirectory()).toBe(true)

    const afterDurableRename = await b.service.browseQuestionMedia({})
    if (!afterDurableRename.ok) throw new Error(afterDurableRename.error.message)
    expect(afterDurableRename.value.students.filter(student => student.id === studentId))
      .toEqual([expect.objectContaining({ name: '张同学重命名' })])
    const firstWeekFolder = afterDurableRename.value.questionFolders.find(folder => folder.name === '第一周')
    if (firstWeekFolder === undefined) throw new Error('missing discovered student folder')
    await expect(b.service.createQuestionMediaDirectory({
      parent: { kind: 'student-folder', id: firstWeekFolder.id },
      name: '第二周',
    })).resolves.toMatchObject({ ok: true })
    expect((await stat(join(
      nextStudents,
      '2026',
      '高一',
      '（1）班',
      '目录学生',
      '复习',
      '第一周',
      '第二周',
    ))).isDirectory()).toBe(true)

    const afterStudentCreate = await b.service.browseQuestionMedia({})
    if (!afterStudentCreate.ok) throw new Error(afterStudentCreate.error.message)
    const secondWeek = afterStudentCreate.value.questionFolders.find(folder => folder.name === '第二周')
    if (secondWeek === undefined) throw new Error('missing created student folder')
    await expect(b.service.renameQuestionMediaDirectory({
      target: { kind: 'student-folder', id: secondWeek.id },
      name: '第二周订正',
    })).resolves.toMatchObject({ ok: true })
    expect((await stat(join(
      nextStudents,
      '2026',
      '高一',
      '（1）班',
      '目录学生',
      '复习',
      '第一周',
      '第二周订正',
    ))).isDirectory()).toBe(true)

    const afterStudentRename = await b.service.browseQuestionMedia({})
    if (!afterStudentRename.ok) throw new Error(afterStudentRename.error.message)
    const firstExamFolder = afterStudentRename.value.questionLibraryFolders.find(folder => folder.name === '第一次')
    if (firstExamFolder === undefined) throw new Error('missing discovered library folder')
    await expect(b.service.createQuestionMediaDirectory({
      parent: { kind: 'library-folder', id: firstExamFolder.id },
      name: '第二次',
    })).resolves.toMatchObject({ ok: true })
    expect((await stat(join(nextSegments, '月考', '第一次', '第二次'))).isDirectory()).toBe(true)

    const afterLibraryCreate = await b.service.browseQuestionMedia({})
    if (!afterLibraryCreate.ok) throw new Error(afterLibraryCreate.error.message)
    const secondExamFolder = afterLibraryCreate.value.questionLibraryFolders.find(folder => folder.name === '第二次')
    if (secondExamFolder === undefined) throw new Error('missing created library folder')
    await expect(b.service.renameQuestionMediaDirectory({
      target: { kind: 'library-folder', id: secondExamFolder.id },
      name: '第二次月考',
    })).resolves.toMatchObject({ ok: true })
    expect((await stat(join(nextSegments, '月考', '第一次', '第二次月考'))).isDirectory()).toBe(true)

    const afterLibraryRename = await b.service.browseQuestionMedia({})
    if (!afterLibraryRename.ok) throw new Error(afterLibraryRename.error.message)
    const renamedExamFolder = afterLibraryRename.value.questionLibraryFolders.find(folder => folder.name === '第二次月考')
    if (renamedExamFolder === undefined) throw new Error('missing renamed library folder')
    await expect(b.service.createQuestionMediaDirectory({
      parent: { kind: 'library-folder', id: renamedExamFolder.id },
      name: '../越界',
    })).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    await expect(stat(join(nextSegments, '月考', '第一次', '越界'))).rejects.toMatchObject({ code: 'ENOENT' })

    const savedInScannedFolder = await b.service.saveQuestionBatch({
      destination: { kind: 'library-folder', folderId: renamedExamFolder.id },
      name: '当前目录试卷',
      sourceName: 'current.pdf',
      pageRange: '1',
      images: [{
        questionNo: 1,
        fileName: '当前目录题.png',
        mediaType: 'image/png',
        width: 17,
        height: 9,
        contentBase64: nextBytes.toString('base64'),
      }],
    })
    expect(savedInScannedFolder).toMatchObject({ ok: true })
    if (!savedInScannedFolder.ok) throw new Error(savedInScannedFolder.error.message)
    expect(savedInScannedFolder.value.document.state.questionLibraryFolders.some(
      folder => folder.id === renamedExamFolder.id && folder.name === '第二次月考',
    )).toBe(true)
    expect(savedInScannedFolder.value.document.state.questionBatches.some(
      batch => batch.folderId === renamedExamFolder.id && batch.name === '当前目录试卷',
    )).toBe(true)
    expect((await readdir(join(nextSegments, '月考', '第一次', '第二次月考')))
      .some(name => name.endsWith('.png'))).toBe(true)

    const currentRootBatch = savedInScannedFolder.value.document.state.questionBatches.find(
      batch => batch.id === savedInScannedFolder.value.batchId,
    )
    const currentRootImage = currentRootBatch?.images[0]
    if (currentRootImage === undefined) throw new Error('missing current-root durable image')
    const assignedCurrentRootImage = await b.service.assignQuestions({
      studentId,
      imageIds: [currentRootImage.id],
    })
    expect(assignedCurrentRootImage).toMatchObject({ ok: true })
    if (!assignedCurrentRootImage.ok) throw new Error(assignedCurrentRootImage.error.message)
    const currentRootAssignment = assignedCurrentRootImage.value.document.state.questionAssignments.find(
      assignment => assignment.sourceImageId === currentRootImage.id,
    )
    if (currentRootAssignment === undefined) throw new Error('missing current-root durable assignment')
    expect(await readFile(join(nextStudents, currentRootAssignment.relativePath))).toEqual(nextBytes)
    expect(currentRootAssignment.relativePath).toContain(join('2026', '高一', '（1）班', '张同学重命名'))
    await expect(stat(join(
      nextStudents,
      '2026',
      '高一(1)班',
      '张同学重命名',
      `${String(currentRootAssignment.id)}.png`,
    ))).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(b.service.deleteQuestionMediaDirectory({
      target: { kind: 'library-folder', id: renamedExamFolder.id },
    })).resolves.toMatchObject({ ok: true })
    await expect(stat(join(nextSegments, '月考', '第一次', '第二次月考')))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const afterLibraryDelete = await b.service.browseQuestionMedia({})
    if (!afterLibraryDelete.ok) throw new Error(afterLibraryDelete.error.message)
    const directoryStudent = afterLibraryDelete.value.students.find(student => student.name === '目录学生')
    if (directoryStudent === undefined) throw new Error('missing discovered directory student')
    await expect(b.service.deleteQuestionMediaDirectory({
      target: { kind: 'student', id: directoryStudent.id },
    })).resolves.toMatchObject({ ok: true })
    await expect(stat(join(nextStudents, '2026', '高一', '（1）班', '目录学生')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const deletedDurableStudent = await b.service.deleteQuestionMediaDirectory({
      target: { kind: 'student', id: studentId },
    })
    expect(deletedDurableStudent).toMatchObject({ ok: true })
    if (!deletedDurableStudent.ok) throw new Error(deletedDurableStudent.error.message)
    expect(deletedDurableStudent.value.document.state.students.some(student => student.id === studentId)).toBe(false)
    await expect(stat(join(nextStudents, '2026', '高一', '（1）班', '张同学重命名')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const renamedDurableClass = await b.service.renameQuestionMediaDirectory({
      target: { kind: 'class', id: owningClass.id },
      name: '（1）班重命名',
    })
    expect(renamedDurableClass).toMatchObject({ ok: true })
    if (!renamedDurableClass.ok) throw new Error(renamedDurableClass.error.message)
    expect(renamedDurableClass.value.document.state.classes.find(item => item.id === owningClass.id))
      .toMatchObject({ name: '（1）班重命名' })
    expect((await stat(join(nextStudents, '2026', '高一', '(1)班重命名'))).isDirectory()).toBe(true)
    const deletedDurableClass = await b.service.deleteQuestionMediaDirectory({
      target: { kind: 'class', id: owningClass.id },
    })
    expect(deletedDurableClass).toMatchObject({ ok: true })
    if (!deletedDurableClass.ok) throw new Error(deletedDurableClass.error.message)
    expect(deletedDurableClass.value.document.state.classes.some(item => item.id === owningClass.id)).toBe(false)
    await expect(stat(join(nextStudents, '2026', '高一', '(1)班重命名'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(nextSegments, String(saved.value.batchId), `${String(image.id)}.png`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails loud before its storage domain is initialized', () => {
    const service = new TeacherWorkbenchService(new Context())
    expect(() => service.read({})).toThrow('service is not initialized')
  })
})

describe('teacher workbench schema relationships', () => {
  it('rejects memo and ledger reminders without their own local deadline', () => {
    const reminder = {
      channel: 'weixin' as const,
      botId: 'bot-a' as never,
      botLabel: '机器人',
      dueAtUtc: '2099-08-22T10:00:00.000Z',
      rule: { kind: 'once' as const, minutesBefore: 0 },
      configuredAt: 1,
      lastOccurrenceAt: '',
    }
    const categoryId = 'ledger-category-a' as TeacherLedgerCategoryId
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      quickNotes: [{
        id: 'note-a', content: '联系家长', reminder, createdAt: 1, updatedAt: 1,
      }],
      ledgerCategories: [{ id: categoryId, name: '保险保费', createdAt: 1 }],
      ledgerEntries: [{
        id: 'ledger-a', categoryId, description: '续交车险', amountCents: 120_000,
        occurredAt: '2099-08-01T10:00', reminder, createdAt: 1, updatedAt: 1,
      }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'memo reminder requires a local deadline',
        'ledger reminder requires a local deadline',
      ]))
    }
  })

  it('rejects duplicate identities and cross-class exam entries', () => {
    const classA = classItem('class-a', 'A班')
    const classB = classItem('class-b', 'B班')
    const student = {
      id: 'student-a' as TeacherStudentId,
      classId: classA.id,
      name: '李同学',
      studentNumber: '1',
      gender: '',
      guardian: '',
      relation: '',
      phone: '',
      address: '',
      extras: {},
    }
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      classes: [classA, classA, classB],
      students: [student],
      exams: [{
        id: 'exam-a',
        classId: classB.id,
        name: '期中',
        date: '',
        entries: [
          { studentId: student.id, scores: { 数学: 90 } },
          { studentId: student.id, scores: { 数学: 91 } },
          { studentId: 'missing', scores: { 数学: 92 } },
        ],
      }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'duplicate id', 'student belongs to another class', 'duplicate student', 'unknown student',
      ]))
    }
  })

  it('rejects every duplicate collection and missing durable reference', () => {
    const classA = classItem('class-a', 'A班', 'timetable')
    const resource = {
      id: 'resource-a', category: 'resource', name: '资源', url: 'https://example.com', description: '',
    }
    const template = {
      id: 'template-a', kind: 'teaching', name: '反思', scene: '', fields: ['问题'],
    }
    const record = {
      id: 'record-a', templateId: 'missing-template', title: '记录', dueDate: '', status: 'active', values: {}, updatedAt: 0,
    }
    const exam = { id: 'exam-a', classId: 'missing-class', name: '期中', date: '', entries: [] }
    const todo = {
      id: 'todo-a', title: '待办', dueAt: '', completed: false,
      category: 'today', color: 'blue', createdAt: 0, updatedAt: 0,
    }
    const note = { id: 'note-a', content: '备忘录', createdAt: 0, updatedAt: 0 }
    const ledgerCategory = { id: 'ledger-category-a', name: '保险保费', createdAt: 0 }
    const ledgerEntry = {
      id: 'ledger-entry-a', categoryId: 'missing-category', description: '车险', amountCents: 100,
      occurredAt: '2026-08-18T10:00', createdAt: 0, updatedAt: 0,
    }
    const calendarItem = { id: 'calendar-a', date: '2026-08-18', time: '', title: '日程', details: '', createdAt: 0, updatedAt: 0 }
    const timetable = {
      id: 'timetable-a', classId: classA.id, kind: 'lesson', weekday: 1, period: 1,
      startTime: '', endTime: '', subject: '数学', teacherName: '张老师', location: '', createdAt: 0, updatedAt: 0,
    }
    const result = teacherWorkbenchStateSchema.safeParse({
      dailyTodos: [todo, todo],
      quickNotes: [note, note],
      ledgerCategories: [ledgerCategory, ledgerCategory],
      ledgerEntries: [ledgerEntry, ledgerEntry],
      calendarItems: [calendarItem, calendarItem],
      timetableEntries: [timetable, timetable, { ...timetable, id: 'timetable-b', classId: 'missing-class', period: 2 }],
      classes: [classA],
      students: [],
      resources: [resource, resource],
      templates: [template, template],
      records: [record, record],
      noticeTemplates: [],
      notices: [],
      seatingLayouts: [],
      exams: [exam, exam],
      questionBatches: [],
      questionLibraryFolders: [],
      questionFolders: [],
      questionAssignments: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'duplicate id', 'duplicate timetable slot', 'unknown ledger category', 'unknown template', 'unknown class',
      ]))
      expect(result.error.issues.filter(issue => issue.message === 'duplicate id').map(issue => issue.path[0]))
        .toEqual(expect.arrayContaining(['dailyTodos', 'quickNotes', 'ledgerCategories', 'ledgerEntries', 'calendarItems', 'timetableEntries']))
    }
  })

  it('rejects roster and timetable references that cross class usages', () => {
    const rosterClass = classItem('roster-class', '一班')
    const timetableClass = classItem('timetable-class', '一班', 'gradeTimetable')
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      classes: [rosterClass, timetableClass],
      students: [{
        id: 'student-a', classId: timetableClass.id, name: '学生', studentNumber: '', gender: '', guardian: '',
        relation: '', phone: '', address: '', extras: {},
      }],
      timetableEntries: [
        {
          id: 'entry-a', classId: rosterClass.id, kind: 'lesson', weekday: 1, period: 1,
          startTime: '', endTime: '', subject: '数学', teacherName: '', location: '', createdAt: 0, updatedAt: 0,
        },
      ],
      exams: [{ id: 'exam-a', classId: timetableClass.id, name: '期中', date: '', entries: [] }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'student class must belong to the roster',
        'timetable class must belong to a timetable catalog',
        'exam class must belong to the roster',
      ]))
    }
  })

  it('rejects invalid student-folder graphs and assignment targets', () => {
    const owningClass = classItem('class-a', 'A班')
    const student = (id: string) => ({
      id,
      classId: owningClass.id,
      name: id,
      studentNumber: '',
      gender: '',
      guardian: '',
      relation: '',
      phone: '',
      address: '',
      extras: {},
    })
    const folder = (id: string, studentId: string, name: string, parentId?: string) => ({
      id,
      studentId,
      ...(parentId === undefined ? {} : { parentId }),
      name,
      createdAt: 0,
      updatedAt: 0,
    })
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      classes: [owningClass],
      students: [student('student-a'), student('student-b')],
      questionBatches: [{
        id: 'batch-a',
        folderId: 'missing-library-folder',
        name: '试卷',
        sourceName: 'paper.pdf',
        pageRange: '',
        createdAt: 0,
        images: [{
          id: 'image-a', questionNo: 1, fileName: '1.png', mediaType: 'image/png',
          width: 1, height: 1, createdAt: 0, updatedAt: 0,
        }],
      }],
      questionLibraryFolders: [
        { id: 'library-orphan', parentId: 'missing-library-parent', name: '孤立', createdAt: 0, updatedAt: 0 },
        { id: 'library-duplicate-a', name: '模拟卷', createdAt: 0, updatedAt: 0 },
        { id: 'library-duplicate-b', name: '模拟卷', createdAt: 0, updatedAt: 0 },
        { id: 'library-cycle-a', parentId: 'library-cycle-b', name: '循环A', createdAt: 0, updatedAt: 0 },
        { id: 'library-cycle-b', parentId: 'library-cycle-a', name: '循环B', createdAt: 0, updatedAt: 0 },
      ],
      questionFolders: [
        folder('folder-unknown-student', 'missing-student', '未知学生'),
        folder('folder-orphan', 'student-a', '孤立', 'missing-parent'),
        folder('folder-a', 'student-a', '跨学生', 'folder-b'),
        folder('folder-b', 'student-b', 'B目录'),
        folder('folder-duplicate-a', 'student-a', '作业'),
        folder('folder-duplicate-b', 'student-a', '作业'),
        folder('folder-cycle-a', 'student-a', '循环A', 'folder-cycle-b'),
        folder('folder-cycle-b', 'student-a', '循环B', 'folder-cycle-a'),
      ],
      questionAssignments: [{
        id: 'assignment-a', studentId: 'student-a', sourceImageId: 'image-a', folderId: 'folder-b',
        fileName: '1.png', relativePath: 'student-a/1.png', mediaType: 'image/png',
        width: 1, height: 1, temporarySaveCount: 0, createdAt: 0, updatedAt: 0,
      }, {
        id: 'assignment-b', studentId: 'student-a', sourceImageId: 'image-a', folderId: 'missing-folder',
        fileName: '1.png', relativePath: 'student-a/2.png', mediaType: 'image/png',
        width: 1, height: 1, temporarySaveCount: 0, createdAt: 0, updatedAt: 0,
      }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'unknown student',
        'unknown parent folder',
        'parent folder belongs to another student',
        'duplicate sibling folder',
        'folder hierarchy contains a cycle',
        'question folder belongs to another student',
        'unknown question folder',
        'unknown parent library folder',
        'duplicate sibling library folder',
        'library folder hierarchy contains a cycle',
        'unknown question-library folder',
      ]))
    }
  })

  it('rejects impossible local dates and times in daily management', () => {
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      dailyTodos: [{
        id: 'todo-a', title: '待办', dueAt: '2026-02-30T12:00', completed: false,
        category: 'today', color: 'blue', createdAt: 0, updatedAt: 0,
      }],
      calendarItems: [{
        id: 'calendar-a', date: '2026-13-01', time: '24:00', title: '日程', details: '', createdAt: 0, updatedAt: 0,
      }, {
        id: 'calendar-b', date: 'bad', time: '', title: '错误日期', details: '', createdAt: 0, updatedAt: 0,
      }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'date must be a real calendar date',
        'time must use HH:mm',
      ]))
    }
  })

  it('rejects daily-task marker colors outside the durable palette', () => {
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      dailyTodos: [{
        id: 'todo-a', title: '待办', dueAt: '', completed: false,
        category: 'important', color: 'ultraviolet', createdAt: 0, updatedAt: 0,
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects daily tasks outside the three durable lists', () => {
    const result = teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      dailyTodos: [{
        id: 'todo-a', title: '待办', dueAt: '', completed: false,
        category: 'priority', color: 'blue', createdAt: 0, updatedAt: 0,
      }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts only non-negative scores and HTTP(S) resource links', () => {
    const resource = INITIAL_TEACHER_WORKBENCH_STATE.resources[0]!
    expect(teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      resources: [{ ...resource, url: 'javascript:alert(1)' }],
    }).success).toBe(false)
    expect(teacherWorkbenchStateSchema.safeParse({
      ...INITIAL_TEACHER_WORKBENCH_STATE,
      classes: [classItem('class-a', 'A班')],
      students: [{
        id: 'student-a', classId: 'class-a', name: '学生', studentNumber: '', gender: '', guardian: '',
        relation: '', phone: '', address: '', extras: {},
      }],
      exams: [{
        id: 'exam-a', classId: 'class-a', name: '期中', date: '',
        entries: [{ studentId: 'student-a', scores: { '数学': -1 } }],
      }],
    }).success).toBe(false)
  })
})
