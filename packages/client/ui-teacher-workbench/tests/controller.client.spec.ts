import { describe, expect, it, vi } from 'vitest'
import type {
  TeacherClassId,
  TeacherMobileBotId,
  TeacherQuestionBatchId,
  TeacherQuestionLibraryFolderId,
  TeacherStudentId,
  TeacherWorkbenchDocument,
  TeacherWorkbenchState,
  TeacherWorkbenchWriteResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  TeacherWorkbenchController,
  type TeacherWorkbenchRemote,
} from '../src/client/controller.ts'

const emptyState = (): TeacherWorkbenchState => ({
  dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
  classes: [], students: [], resources: [], templates: [], records: [], exams: [],
  questionBatches: [], questionLibraryFolders: [], questionFolders: [], questionAssignments: [],
  noticeTemplates: [], notices: [], seatingLayouts: [],
})

type FakeOptions = {
  read?: () => Promise<unknown>
  write?: (request: { expectedRevision: number; state: TeacherWorkbenchState }) => Promise<unknown>
}

function fakeRemote(options: FakeOptions = {}) {
  let document: TeacherWorkbenchDocument = { revision: 0, state: emptyState() }
  const read = vi.fn(async () => options.read === undefined
    ? { ok: true, value: { ok: true, value: document } }
    : await options.read())
  const write = vi.fn(async (request: { expectedRevision: number; state: TeacherWorkbenchState }) => {
    if (options.write !== undefined) return await options.write(request)
    if (request.expectedRevision !== document.revision) {
      const conflict: TeacherWorkbenchWriteResult = { ok: false, error: { code: 'revision-conflict', current: document } }
      return { ok: true, value: conflict }
    }
    document = { revision: document.revision + 1, state: request.state }
    return { ok: true, value: { ok: true, value: document } }
  })
  return {
    remote: { read, write } as unknown as TeacherWorkbenchRemote,
    read,
    write,
    getDocument: () => document,
    setDocument: (value: TeacherWorkbenchDocument) => { document = value },
  }
}

describe('TeacherWorkbenchController', () => {
  it('stores credential-free reminder rules against the current deadline', async () => {
    const fake = fakeRemote()
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => 'todo-reminder', now: () => 42 })
    const botId = 'bot-primary' as TeacherMobileBotId
    await controller.saveDailyTodo({
      title: '提交周报',
      dueAt: '2099-08-22T18:00',
      reminder: {
        channel: 'telegram',
        botId,
        botLabel: 'Primary Bot',
        rule: { kind: 'repeat', everyMinutes: 15 },
      },
    })

    const saved = controller.getSnapshot().document!.state.dailyTodos[0]!
    expect(saved.reminder).toEqual({
      channel: 'telegram',
      botId,
      botLabel: 'Primary Bot',
      dueAtUtc: new Date('2099-08-22T18:00').toISOString(),
      rule: { kind: 'repeat', everyMinutes: 15 },
      configuredAt: 42,
      lastOccurrenceAt: '',
    })

    await controller.saveDailyTodo({ id: saved.id, title: saved.title, dueAt: '2099-08-23T18:00' })
    expect(controller.getSnapshot().document!.state.dailyTodos[0]!.reminder).toBeUndefined()
  })

  it('stores reminders for memos and ledger entries against their reminder deadlines', async () => {
    const fake = fakeRemote()
    const ids = ['memo-reminder', 'ledger-category', 'ledger-reminder']
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => ids.shift() ?? 'extra', now: () => 42 })
    const reminder = {
      channel: 'telegram' as const,
      botId: 'bot-primary' as TeacherMobileBotId,
      botLabel: 'Primary Bot',
      rule: { kind: 'once' as const, minutesBefore: 10 },
    }

    await controller.saveQuickNote({ content: '联系家长', remindAt: '2099-08-22T18:00', reminder })
    await controller.saveLedgerCategory({ name: '保险保费' })
    const categoryId = controller.getSnapshot().document!.state.ledgerCategories[0]!.id
    await controller.saveLedgerEntry({
      categoryId,
      description: '续交车险',
      amountCents: 120_000,
      occurredAt: '2099-08-01T10:00',
      remindAt: '2099-08-23T18:00',
      reminder,
    })

    const state = controller.getSnapshot().document!.state
    expect(state.quickNotes[0]).toMatchObject({
      remindAt: '2099-08-22T18:00',
      reminder: { dueAtUtc: new Date('2099-08-22T18:00').toISOString() },
    })
    expect(state.ledgerEntries[0]).toMatchObject({
      remindAt: '2099-08-23T18:00',
      reminder: { dueAtUtc: new Date('2099-08-23T18:00').toISOString() },
    })
  })

  it('persists family notices, headteacher templates, and one seating layout per class', async () => {
    const fake = fakeRemote()
    const ids = ['class-a', 'student-a', 'notice-template-a', 'notice-a']
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => ids.shift() ?? 'extra', now: () => 42 })
    await controller.saveClass({ usage: 'roster', name: '一班', grade: '高一', subject: '语文' })
    const classId = controller.getSnapshot().document!.state.classes[0]!.id
    await controller.saveStudent({ classId, name: '张同学', studentNumber: '1', gender: '', guardian: '', relation: '', phone: '', address: '' })
    const studentId = controller.getSnapshot().document!.state.students[0]!.id
    await controller.saveNoticeTemplate({ name: '考试提醒', icon: 'custom', hint: '考试前使用', starter: '考试时间：【填写】', custom: true })
    await controller.saveNotice({ title: '考试提醒', content: '请准备考试用品。' })
    await controller.saveSeatingLayout({ classId, rows: 3, columns: 4, slots: [studentId, ...Array<null>(11).fill(null)] })
    expect(controller.getSnapshot().document!.state).toMatchObject({
      noticeTemplates: [{ name: '考试提醒', custom: true }],
      notices: [{ title: '考试提醒', createdAt: 42 }],
      seatingLayouts: [{ classId, rows: 3, columns: 4, updatedAt: 42 }],
    })
  })

  it('returns the Host batch id so later save parts append to the same paper', async () => {
    const fake = fakeRemote()
    const batchId = 'batch-a' as TeacherQuestionBatchId
    const saveQuestionBatch = vi.fn(async () => ({
      ok: true as const,
      value: {
        ok: true as const,
        value: { document: fake.getDocument(), batchId },
      },
    }))
    Object.assign(fake.remote, { saveQuestionBatch })
    const controller = new TeacherWorkbenchController(fake.remote)

    await expect(controller.saveQuestionBatch({
      name: '试卷', sourceName: '试卷.pdf', pageRange: '全部页', images: [{
        questionNo: 1, fileName: '第1题.png', mediaType: 'image/png', width: 1, height: 1, contentBase64: 'AA==',
      }],
    })).resolves.toEqual({ ok: true, batchId })
  })

  it('collapses initial reads and publishes through subscribe/unsubscribe', async () => {
    const fake = fakeRemote()
    const controller = new TeacherWorkbenchController(fake.remote)
    const listener = vi.fn()
    const off = controller.subscribe(listener)
    await Promise.all([controller.ensure(), controller.ensure(), controller.refresh()])
    expect(fake.read).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', document: { revision: 0 } })
    expect(listener).toHaveBeenCalled()
    off()
    listener.mockClear()
    await controller.resync()
    expect(listener).not.toHaveBeenCalled()
  })

  it('runs every module mutation through one revisioned document', async () => {
    const fake = fakeRemote()
    const ids = [
      'todo-a', 'note-a', 'ledger-category-a', 'ledger-entry-a', 'ledger-entry-b', 'calendar-a',
      'class-a', 'timetable-class-a', 'timetable-a', 'timetable-b', 'student-a', 'student-b', 'resource-a', 'template-a', 'record-a', 'exam-a',
    ]
    const controller = new TeacherWorkbenchController(fake.remote, {
      id: () => ids.shift() ?? 'extra-id',
      now: () => 1234,
    })

    await controller.saveDailyTodo({ title: '  批改作业  ', dueAt: '2026-08-18T18:30' })
    const todoId = controller.getSnapshot().document!.state.dailyTodos[0]!.id
    expect(controller.getSnapshot().document!.state.dailyTodos[0]).toMatchObject({
      title: '批改作业', completed: false, category: 'today', color: 'blue',
      createdAt: 1234, updatedAt: 1234,
    })
    await controller.saveDailyTodo({
      id: todoId, title: '批改试卷', dueAt: '', completed: true,
      category: 'urgent', color: 'red',
    })
    await controller.toggleDailyTodo(todoId)
    expect(controller.getSnapshot().document!.state.dailyTodos[0]).toMatchObject({
      title: '批改试卷', completed: false, category: 'urgent', color: 'red',
    })
    await controller.deleteDailyTodo(todoId)

    await controller.saveQuickNote({ content: '  课堂观察  ' })
    const noteId = controller.getSnapshot().document!.state.quickNotes[0]!.id
    await controller.saveQuickNote({ id: noteId, content: '课堂观察更新' })
    expect(controller.getSnapshot().document!.state.quickNotes[0]).toMatchObject({ content: '课堂观察更新', createdAt: 1234 })
    await controller.deleteQuickNote(noteId)

    await controller.saveLedgerCategory({ name: '  保险保费  ' })
    const ledgerCategoryId = controller.getSnapshot().document!.state.ledgerCategories[0]!.id
    await controller.saveLedgerEntry({
      categoryId: ledgerCategoryId,
      description: '  家庭保险  ',
      amountCents: 120_000,
      occurredAt: '2026-08-20T10:30',
    })
    const ledgerEntryId = controller.getSnapshot().document!.state.ledgerEntries[0]!.id
    await controller.saveLedgerEntry({
      id: ledgerEntryId,
      categoryId: ledgerCategoryId,
      description: '家庭保险续费',
      amountCents: 125_000,
      occurredAt: '2026-08-21T09:00',
    })
    expect(controller.getSnapshot().document!.state.ledgerEntries[0]).toMatchObject({
      description: '家庭保险续费', amountCents: 125_000, createdAt: 1234,
    })
    await controller.deleteLedgerEntry(ledgerEntryId)
    await controller.saveLedgerEntry({
      categoryId: ledgerCategoryId,
      description: '车险',
      amountCents: 80_000,
      occurredAt: '2026-08-22T09:00',
    })
    await controller.deleteLedgerCategory(ledgerCategoryId)
    expect(controller.getSnapshot().document!.state).toMatchObject({ ledgerCategories: [], ledgerEntries: [] })

    await controller.saveCalendarItem({ date: '2026-08-20', time: '09:00', title: '  教研会  ', details: '一楼' })
    const calendarId = controller.getSnapshot().document!.state.calendarItems[0]!.id
    await controller.saveCalendarItem({ id: calendarId, date: '2026-08-21', time: '', title: '教研会改期', details: '' })
    expect(controller.getSnapshot().document!.state.calendarItems[0]).toMatchObject({ date: '2026-08-21', title: '教研会改期' })
    await controller.deleteCalendarItem(calendarId)

    await controller.saveClass({ usage: 'roster', academicYear: '2026-2027', name: '一班', grade: '高一', subject: '数学' })
    expect(controller.getSnapshot().document!.state.classes[0]).toMatchObject({ academicYear: '2026-2027' })
    const classId = controller.getSnapshot().document!.state.classes[0]!.id
    await controller.saveTimetableEntry({
      usage: 'timetable', className: '一班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
      startTime: '08:00', endTime: '08:45', subject: '数学', teacherName: '张老师', location: '101',
    })
    const timetableClassId = controller.getSnapshot().document!.state.classes[1]!.id
    const timetableId = controller.getSnapshot().document!.state.timetableEntries[0]!.id
    await controller.saveTimetableEntry({
      id: timetableId, classId: timetableClassId, usage: 'timetable', className: '一班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
      startTime: '08:00', endTime: '08:45', subject: '语文', teacherName: '张老师', location: '101',
    })
    await controller.importTimetableEntries([{
      classId: timetableClassId, usage: 'timetable', className: '一班', grade: '高一', kind: 'lesson', weekday: 2, period: 1,
      startTime: '', endTime: '', subject: '英语', teacherName: '李老师', location: '',
    }])
    expect(controller.getSnapshot().document!.state.timetableEntries).toMatchObject([
      { id: timetableId, weekday: 1, period: 1, subject: '语文' },
      { weekday: 2, period: 1, subject: '英语' },
    ])
    await controller.saveStudent({
      classId, name: '张同学', studentNumber: '001', gender: '女', guardian: '', relation: '', phone: '', address: '',
    })
    await controller.importStudents(classId, [
      { name: '张同学（更新）', studentNumber: '001', gender: '女', guardian: '张女士', relation: '母亲', phone: '1', address: '', extras: {} },
      { name: '李同学', studentNumber: '002', gender: '', guardian: '', relation: '', phone: '', address: '', extras: { 特长: '足球' } },
    ])
    const students = controller.getSnapshot().document!.state.students
    expect(students.map(item => item.name)).toEqual(['张同学（更新）', '李同学'])

    await controller.saveResource({ category: 'resource', name: '平台', url: 'https://example.com', description: '' })
    await controller.saveTemplate({ kind: 'teaching', name: '反思', scene: '', fields: ['问题', '', '行动'] })
    const templateId = controller.getSnapshot().document!.state.templates[0]!.id
    await controller.saveRecord({ templateId, title: '第一课', dueDate: '2026-08-17', status: 'active', values: { 问题: '节奏' } })
    const recordId = controller.getSnapshot().document!.state.records[0]!.id
    await controller.toggleRecord(recordId)
    expect(controller.getSnapshot().document!.state.records[0]).toMatchObject({ status: 'done', updatedAt: 1234 })

    await controller.saveExam({
      classId, name: '期中', date: '2026-08-17',
      entries: students.map((item, index) => ({ studentId: item.id, scores: { 数学: 90 - index } })),
    })
    const examId = controller.getSnapshot().document!.state.exams[0]!.id
    await controller.deleteExam(examId)
    await controller.deleteRecord(recordId)
    await controller.deleteTemplate(templateId)
    await controller.deleteResource(controller.getSnapshot().document!.state.resources[0]!.id)
    await controller.deleteStudent(students[1]!.id)
    await controller.deleteClass(classId)
    await controller.deleteClass(timetableClassId)

    expect(controller.getSnapshot().document!.state).toEqual(emptyState())
    expect(fake.write).toHaveBeenCalledTimes(34)
  })

  it('keeps identical class names independent across timetable areas and the roster', async () => {
    const fake = fakeRemote()
    const ids = ['roster-class', 'week-class', 'week-entry', 'grade-class', 'grade-entry', 'study-entry']
    const controller = new TeacherWorkbenchController(fake.remote, {
      id: () => ids.shift() ?? 'extra-id',
      now: () => 1,
    })
    await controller.saveClass({ usage: 'roster', name: '高一三班', grade: '高一', subject: '数学' })
    await controller.importTimetableEntries([{
      usage: 'timetable', className: '高一三班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
      startTime: '', endTime: '', subject: '数学', teacherName: '', location: '',
    }])
    await controller.importTimetableEntries([{
      usage: 'gradeTimetable', className: '高一三班', grade: '高一', kind: 'lesson', weekday: 1, period: 1,
      startTime: '', endTime: '', subject: '数学', teacherName: '', location: '',
    }])
    await controller.importTimetableEntries([{
      usage: 'timetable', className: '高一三班', grade: '高一', kind: 'morningStudy', weekday: 1, period: 1,
      startTime: '', endTime: '', subject: '早读', teacherName: '', location: '',
    }])

    const state = controller.getSnapshot().document!.state
    expect(state.classes.map(item => [item.id, item.usage])).toEqual([
      ['roster-class', 'roster'],
      ['week-class', 'timetable'],
      ['grade-class', 'gradeTimetable'],
    ])
    expect(state.timetableEntries.map(item => item.classId)).toEqual(['week-class', 'grade-class', 'week-class'])
    await expect(controller.importTimetableEntries([{
      usage: 'gradeTimetable', className: '第一节', grade: '高一', kind: 'lesson', weekday: 2, period: 1,
      startTime: '', endTime: '', subject: '语文', teacherName: '', location: '',
    }])).resolves.toEqual({ ok: false, error: { code: 'invalid-state', message: '课表班级名称必须以“班”结尾' } })
    expect(fake.write).toHaveBeenCalledTimes(4)
  })

  it('cascades student and class deletion through surviving exams', async () => {
    const fake = fakeRemote()
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => 'generated', now: () => 1 })
    fake.setDocument({
      revision: 3,
      state: {
        ...emptyState(),
        classes: [
          { id: 'a' as TeacherClassId, usage: 'roster', name: 'A', grade: '', subject: '' },
          { id: 'b' as TeacherClassId, usage: 'roster', name: 'B', grade: '', subject: '' },
        ],
        students: [
          { id: 's-a' as TeacherStudentId, classId: 'a' as TeacherClassId, name: 'A', studentNumber: '', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {} },
          { id: 's-b' as TeacherStudentId, classId: 'b' as TeacherClassId, name: 'B', studentNumber: '', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {} },
        ],
        exams: [
          { id: 'e-a' as never, classId: 'a' as TeacherClassId, name: 'A考', date: '', entries: [{ studentId: 's-a' as TeacherStudentId, scores: { 数学: 1 } }] },
          { id: 'e-b' as never, classId: 'b' as TeacherClassId, name: 'B考', date: '', entries: [
            { studentId: 's-a' as TeacherStudentId, scores: { 数学: 1 } },
            { studentId: 's-b' as TeacherStudentId, scores: { 数学: 2 } },
          ] },
        ],
      },
    })
    await controller.ensure()
    await controller.deleteStudent('s-b' as TeacherStudentId)
    expect(controller.getSnapshot().document!.state.exams[1]!.entries).toEqual([
      { studentId: 's-a', scores: { 数学: 1 } },
    ])
    await controller.deleteClass('a' as TeacherClassId)
    expect(controller.getSnapshot().document!.state).toMatchObject({ classes: [{ id: 'b' }], exams: [{ id: 'e-b', entries: [] }] })
  })

  it('persists nested question folders and deletes a complete folder subtree', async () => {
    const fake = fakeRemote()
    const ids = ['folder-root', 'folder-child']
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => ids.shift() ?? 'extra', now: () => 42 })
    const classId = 'class-a' as TeacherClassId
    const studentId = 'student-a' as TeacherStudentId
    fake.setDocument({
      revision: 2,
      state: {
        ...emptyState(),
        classes: [{ id: classId, usage: 'roster', name: '一班', grade: '高一', subject: '数学' }],
        students: [{
          id: studentId, classId, name: '张三', studentNumber: '', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
        }],
      },
    })
    await controller.ensure()
    await controller.createQuestionFolder({ studentId, name: '作业' })
    const rootId = controller.getSnapshot().document!.state.questionFolders[0]!.id
    await controller.createQuestionFolder({ studentId, parentId: rootId, name: '第一次' })
    expect(controller.getSnapshot().document!.state.questionFolders).toMatchObject([
      { id: 'folder-root', studentId, name: '作业', createdAt: 42, updatedAt: 42 },
      { id: 'folder-child', studentId, parentId: 'folder-root', name: '第一次' },
    ])
    await controller.deleteQuestionFolder(rootId)
    expect(controller.getSnapshot().document!.state.questionFolders).toEqual([])
  })

  it('persists nested question-library folders', async () => {
    const fake = fakeRemote()
    const ids = ['library-root', 'library-child']
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => ids.shift() ?? 'extra', now: () => 42 })
    await controller.ensure()
    await controller.createQuestionLibraryFolder({ name: '模拟卷' })
    const rootId = controller.getSnapshot().document!.state.questionLibraryFolders[0]!.id
    await controller.createQuestionLibraryFolder({ parentId: rootId, name: '五月' })
    expect(controller.getSnapshot().document!.state.questionLibraryFolders).toMatchObject([
      { id: 'library-root', name: '模拟卷', createdAt: 42, updatedAt: 42 },
      { id: 'library-child', parentId: 'library-root', name: '五月' },
    ])
    await controller.renameQuestionLibraryFolder(rootId, '联考试卷')
    expect(controller.getSnapshot().document!.state.questionLibraryFolders[0]).toMatchObject({
      id: 'library-root', name: '联考试卷', updatedAt: 42,
    })
    await controller.deleteQuestionLibraryFolder(rootId)
    expect(controller.getSnapshot().document!.state.questionLibraryFolders).toEqual([])
  })

  it('moves batches to the parent when deleting a question-library hierarchy', async () => {
    const fake = fakeRemote()
    fake.setDocument({
      revision: 1,
      state: {
        ...emptyState(),
        questionLibraryFolders: [
          { id: 'library-parent' as TeacherQuestionLibraryFolderId, name: '模拟卷', createdAt: 1, updatedAt: 1 },
          {
            id: 'library-root' as TeacherQuestionLibraryFolderId,
            parentId: 'library-parent' as TeacherQuestionLibraryFolderId,
            name: '五月',
            createdAt: 2,
            updatedAt: 2,
          },
          {
            id: 'library-child' as TeacherQuestionLibraryFolderId,
            parentId: 'library-root' as TeacherQuestionLibraryFolderId,
            name: '第一周',
            createdAt: 3,
            updatedAt: 3,
          },
        ],
        questionBatches: [{
          id: 'batch-a' as TeacherQuestionBatchId,
          folderId: 'library-child' as TeacherQuestionLibraryFolderId,
          name: '试卷',
          sourceName: '试卷.pdf',
          pageRange: '全部页',
          createdAt: 1,
          images: [],
        }],
      },
    })
    const controller = new TeacherWorkbenchController(fake.remote)
    await controller.ensure()
    await controller.deleteQuestionLibraryFolder('library-root' as TeacherQuestionLibraryFolderId)
    expect(controller.getSnapshot().document!.state.questionLibraryFolders.map(folder => folder.id)).toEqual(['library-parent'])
    expect(controller.getSnapshot().document!.state.questionBatches[0]).toMatchObject({
      id: 'batch-a', folderId: 'library-parent',
    })
  })

  it('updates existing identities and name-only roster imports', async () => {
    const fake = fakeRemote()
    fake.setDocument({
      revision: 1,
      state: {
        ...emptyState(),
        classes: [{ id: 'class-a' as TeacherClassId, usage: 'roster', name: 'A', grade: '', subject: '' }],
        students: [{
          id: 'student-a' as TeacherStudentId,
          classId: 'class-a' as TeacherClassId,
          name: '张同学',
          studentNumber: '',
          gender: '',
          guardian: '',
          relation: '',
          phone: '',
          address: '',
          extras: {},
        }],
        templates: [{ id: 'template-a' as never, kind: 'teaching', name: '反思', scene: '', fields: ['问题'] }],
        records: [{
          id: 'record-a' as never,
          templateId: 'template-a' as never,
          title: '记录',
          dueDate: '',
          status: 'done',
          values: {},
          updatedAt: 1,
        }],
      },
    })
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => 'new-id', now: () => 2 })
    await controller.ensure()
    await controller.saveClass({ id: 'class-a' as TeacherClassId, usage: 'roster', name: 'A更新', grade: '', subject: '' })
    await controller.importStudents('class-a' as TeacherClassId, [{
      name: '张同学', studentNumber: '', gender: '', guardian: '家长', relation: '', phone: '', address: '', extras: {},
    }])
    await controller.toggleRecord('record-a' as never)
    await controller.deleteTemplate('template-a' as never)
    expect(controller.getSnapshot().document!.state).toMatchObject({
      classes: [{ name: 'A更新' }],
      students: [{ id: 'student-a', guardian: '家长' }],
      templates: [],
      records: [],
    })
  })

  it('reapplies a mutation to the current document after one conflict', async () => {
    let calls = 0
    const current: TeacherWorkbenchDocument = { revision: 4, state: emptyState() }
    const fake = fakeRemote({
      write: async (request) => {
        calls += 1
        if (calls === 1) return { ok: true, value: { ok: false, error: { code: 'revision-conflict', current } } }
        return { ok: true, value: { ok: true, value: { revision: 5, state: request.state } } }
      },
    })
    const controller = new TeacherWorkbenchController(fake.remote, { id: () => 'class-a' })
    const result = await controller.saveClass({ usage: 'roster', name: '重试班', grade: '', subject: '' })
    expect(result).toEqual({ ok: true })
    expect(fake.write).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().document).toMatchObject({ revision: 5, state: { classes: [{ name: '重试班' }] } })
  })

  it('publishes carrier, business, thrown, and repeated-conflict failures', async () => {
    const carrier = fakeRemote({ read: async () => ({ ok: false, error: { code: 'offline', message: 'down', details: null } }) })
    const first = new TeacherWorkbenchController(carrier.remote)
    expect(await first.ensure()).toEqual({ ok: false, error: { code: 'offline', message: 'down' } })

    const thrown = fakeRemote({ read: async () => { throw 'down' } })
    expect(await new TeacherWorkbenchController(thrown.remote).ensure()).toMatchObject({ ok: false, error: { code: 'transport' } })

    const invalid = fakeRemote({ write: async () => ({ ok: true, value: { ok: false, error: { code: 'invalid-state', message: 'bad' } } }) })
    const invalidController = new TeacherWorkbenchController(invalid.remote, { id: () => 'c' })
    expect(await invalidController.saveClass({ usage: 'roster', name: '班', grade: '', subject: '' })).toEqual({ ok: false, error: { code: 'invalid-state', message: 'bad' } })

    const writeThrow = fakeRemote({ write: async () => { throw new Error('write down') } })
    const writeController = new TeacherWorkbenchController(writeThrow.remote, { id: () => 'c' })
    expect(await writeController.saveClass({ usage: 'roster', name: '班', grade: '', subject: '' })).toMatchObject({ ok: false, error: { code: 'transport' } })

    const stale = { revision: 1, state: emptyState() }
    const conflicts = fakeRemote({ write: async () => ({ ok: true, value: { ok: false, error: { code: 'revision-conflict', current: stale } } }) })
    const conflictController = new TeacherWorkbenchController(conflicts.remote, { id: () => 'c' })
    expect(await conflictController.saveClass({ usage: 'roster', name: '班', grade: '', subject: '' })).toMatchObject({ ok: false, error: { code: 'revision-conflict' } })

    const mutationReadFailure = new TeacherWorkbenchController(carrier.remote)
    expect(await mutationReadFailure.saveClass({ usage: 'roster', name: '班', grade: '', subject: '' }))
      .toEqual({ ok: false, error: { code: 'offline', message: 'down' } })

    const missingDocument = fakeRemote({
      read: async () => ({ ok: true, value: { ok: true, value: null } }),
    })
    expect(await new TeacherWorkbenchController(missingDocument.remote).saveClass({ usage: 'roster', name: '班', grade: '', subject: '' }))
      .toMatchObject({ ok: false, error: { code: 'unavailable' } })

    const writeCarrier = fakeRemote({
      write: async () => ({ ok: false, error: { code: 'offline', message: 'write down', details: null } }),
    })
    expect(await new TeacherWorkbenchController(writeCarrier.remote, { id: () => 'c' })
      .saveClass({ usage: 'roster', name: '班', grade: '', subject: '' }))
      .toEqual({ ok: false, error: { code: 'offline', message: 'write down' } })

    const writeString = fakeRemote({ write: async () => { throw 'write down' } })
    expect(await new TeacherWorkbenchController(writeString.remote, { id: () => 'c' })
      .saveClass({ usage: 'roster', name: '班', grade: '', subject: '' }))
      .toEqual({ ok: false, error: { code: 'transport', message: 'teacher workbench write failed' } })

    const readError = fakeRemote({ read: async () => { throw new Error('read down') } })
    expect(await new TeacherWorkbenchController(readError.remote).ensure())
      .toEqual({ ok: false, error: { code: 'transport', message: 'read down' } })
  })

  it('settles a read that rejects after disposal and drains rejected operations', async () => {
    let rejectRead: ((error: unknown) => void) | undefined
    const pendingRead = fakeRemote({
      read: async () => await new Promise((_resolve, reject) => { rejectRead = reject }),
    })
    const controller = new TeacherWorkbenchController(pendingRead.remote)
    const loading = controller.ensure()
    await vi.waitFor(() => { expect(rejectRead).toBeTypeOf('function') })
    controller.dispose()
    rejectRead!(new Error('late read failure'))
    await expect(loading).resolves.toEqual({ ok: true })

    const throwingId = new TeacherWorkbenchController(fakeRemote().remote, {
      id: () => { throw new Error('id source failed') },
    })
    await expect(throwingId.saveClass({ usage: 'roster', name: '班', grade: '', subject: '' }))
      .rejects.toThrow('id source failed')
  })

  it('stops work and notifications after disposal', async () => {
    const fake = fakeRemote()
    const controller = new TeacherWorkbenchController(fake.remote)
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.dispose()
    expect(await controller.ensure()).toEqual({ ok: true })
    expect(await controller.saveClass({ usage: 'roster', name: '班', grade: '', subject: '' })).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(listener).not.toHaveBeenCalled()
  })
})
