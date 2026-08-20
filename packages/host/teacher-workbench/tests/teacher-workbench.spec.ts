import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import TeacherWorkbenchService, {
  INITIAL_TEACHER_WORKBENCH_STATE,
  teacherWorkbenchStateSchema,
} from '../src/index.ts'
import type {
  TeacherCalendarItemId,
  TeacherClass,
  TeacherClassId,
  TeacherClassUsage,
  TeacherDailyTodoId,
  TeacherExamId,
  TeacherLessonResourceId,
  TeacherRecordId,
  TeacherRecordTemplateId,
  TeacherQuickNoteId,
  TeacherQuestionFolderId,
  TeacherStudentId,
  TeacherTimetableEntryId,
  TeacherWorkbenchState,
} from '../src/types.ts'

async function harness(pool = new MemoryMediaPool(), config?: ConstructorParameters<typeof TeacherWorkbenchService>[1]) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = config === undefined
    ? await ctx.plugin(TeacherWorkbenchService)
    : await ctx.plugin(TeacherWorkbenchService, config)
  return { ctx, fiber, pool, service: ctx.teacherWorkbench }
}

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
      exams: [{
        id: 'exam-a' as TeacherExamId,
        classId,
        name: '期中',
        date: '',
        entries: [{ studentId, scores: { '数学': 90 } }],
      }],
      questionBatches: [],
      questionFolders: [],
      questionAssignments: [],
    }
    const result = await b.service.write({ expectedRevision: 0, state })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('valid nested workbench state was rejected')
    expect(Object.isFrozen(result.value.state.students[0]?.extras)).toBe(true)
    expect(Object.isFrozen(result.value.state.dailyTodos[0])).toBe(true)
    expect(Object.isFrozen(result.value.state.quickNotes[0])).toBe(true)
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
    const b = await harness()
    contexts.push(b.ctx)
    const internal = b.service as unknown as { global: { set(value: unknown): Promise<void> } }
    vi.spyOn(internal.global, 'set').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(b.service.write({ expectedRevision: 0, state: withClasses(classItem('a', 'A班')) }))
      .rejects.toThrow('disk unavailable')
    await expect(b.service.write({ expectedRevision: 0, state: withClasses(classItem('b', 'B班')) }))
      .resolves.toMatchObject({ ok: true, value: { revision: 1 } })

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
      maxQuestionImageBytes: 1024 * 1024,
      maxQuestionBatchBytes: 4 * 1024 * 1024,
    })
    contexts.push(b.ctx)
    const owningClass = { ...classItem('class-a', '高一（1）班'), academicYear: '2026' }
    const studentId = 'student-a' as TeacherStudentId
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
    const sourceImages = await Promise.all([
      { questionNo: 10, color: '#0000ff' },
      { questionNo: 2, color: '#00ff00' },
      { questionNo: 1, color: '#ff0000' },
    ].map(async item => ({
      ...item,
      bytes: await sharp({ create: { width: 24, height: 16, channels: 3, background: item.color } }).png().toBuffer(),
    })))
    const bytes = sourceImages[0]!.bytes
    const saved = await b.service.saveQuestionBatch({
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
    const batch = saved.value.document.state.questionBatches[0]!
    const image = batch.images[0]!
    await expect(b.service.readQuestionImage({ target: { kind: 'batch', id: image.id } }))
      .resolves.toMatchObject({ ok: true, value: { width: 24, height: 16 } })

    const folderId = 'folder-a' as TeacherQuestionFolderId
    const withFolder = await b.service.write({
      expectedRevision: saved.value.document.revision,
      state: {
        ...saved.value.document.state,
        questionFolders: [{ id: folderId, studentId, name: '第一次作业', createdAt: 2, updatedAt: 2 }],
      },
    })
    expect(withFolder.ok).toBe(true)
    const assigned = await b.service.assignQuestions({ studentId, folderId, imageIds: batch.images.map(item => item.id) })
    expect(assigned.ok).toBe(true)
    if (!assigned.ok) throw new Error(assigned.error.message)
    expect(assigned.value.document.state.questionAssignments).toHaveLength(3)
    const nestedAssignment = assigned.value.document.state.questionAssignments[0]!
    expect(nestedAssignment.folderId).toBe(folderId)
    expect(nestedAssignment.relativePath.split(/[\\/]/u).slice(0, 4)).toEqual(['2026', '高一(1)班', '张同学', '第一次作业'])

    const staged = await b.service.saveTemporaryQuestionSelection({
      studentId,
      assignmentIds: [nestedAssignment.id],
    })
    expect(staged).toMatchObject({ ok: true, value: { studentId, imageCount: 1 } })
    await expect(b.service.listTemporaryQuestionSelections({ studentIds: [studentId] }))
      .resolves.toMatchObject({ ok: true, value: [{ studentId, imageCount: 1 }] })
    const temporaryPpt = await b.service.generateStudentDocuments({
      kind: 'ppt',
      source: 'temporary',
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
      students: [{ studentId, title: '课后练习', includeName: true, includeDate: true }],
    })
    expect(documents).toMatchObject({
      ok: true,
      value: { artifacts: [{ fileName: '张同学.docx' }], skipped: [] },
    })
    if (!documents.ok) throw new Error(documents.error.message)
    expect(Buffer.from(documents.value.artifacts[0]!.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK')

    const deleted = await b.service.deleteQuestionBatch({ batchId: batch.id })
    expect(deleted).toMatchObject({
      ok: true,
      value: { document: { state: { questionBatches: [], questionAssignments: [] } } },
    })
  })

  it('fails loud before its storage domain is initialized', () => {
    const service = new TeacherWorkbenchService(new Context())
    expect(() => service.read({})).toThrow('service is not initialized')
  })
})

describe('teacher workbench schema relationships', () => {
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
    const note = { id: 'note-a', content: '随记', createdAt: 0, updatedAt: 0 }
    const calendarItem = { id: 'calendar-a', date: '2026-08-18', time: '', title: '日程', details: '', createdAt: 0, updatedAt: 0 }
    const timetable = {
      id: 'timetable-a', classId: classA.id, kind: 'lesson', weekday: 1, period: 1,
      startTime: '', endTime: '', subject: '数学', teacherName: '张老师', location: '', createdAt: 0, updatedAt: 0,
    }
    const result = teacherWorkbenchStateSchema.safeParse({
      dailyTodos: [todo, todo],
      quickNotes: [note, note],
      calendarItems: [calendarItem, calendarItem],
      timetableEntries: [timetable, timetable, { ...timetable, id: 'timetable-b', classId: 'missing-class', period: 2 }],
      classes: [classA],
      students: [],
      resources: [resource, resource],
      templates: [template, template],
      records: [record, record],
      exams: [exam, exam],
      questionBatches: [],
      questionFolders: [],
      questionAssignments: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
        'duplicate id', 'duplicate timetable slot', 'unknown template', 'unknown class',
      ]))
      expect(result.error.issues.filter(issue => issue.message === 'duplicate id').map(issue => issue.path[0]))
        .toEqual(expect.arrayContaining(['dailyTodos', 'quickNotes', 'calendarItems', 'timetableEntries']))
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
        name: '试卷',
        sourceName: 'paper.pdf',
        pageRange: '',
        createdAt: 0,
        images: [{
          id: 'image-a', questionNo: 1, fileName: '1.png', mediaType: 'image/png',
          width: 1, height: 1, createdAt: 0, updatedAt: 0,
        }],
      }],
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
        width: 1, height: 1, createdAt: 0, updatedAt: 0,
      }, {
        id: 'assignment-b', studentId: 'student-a', sourceImageId: 'image-a', folderId: 'missing-folder',
        fileName: '1.png', relativePath: 'student-a/2.png', mediaType: 'image/png',
        width: 1, height: 1, createdAt: 0, updatedAt: 0,
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
