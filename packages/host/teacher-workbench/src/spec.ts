/**
 * Durable storage declaration for the teacher workbench.
 * @module @deepseek-ai/dsh-host-teacher-workbench/spec
 */

import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type {
  TeacherCalendarItemId,
  TeacherClassUsage,
  TeacherClassId,
  TeacherDailyTodoCategory,
  TeacherDailyTodoColor,
  TeacherDailyTodoId,
  TeacherExamId,
  TeacherLessonResourceId,
  TeacherLedgerCategoryId,
  TeacherLedgerEntryId,
  TeacherQuickNoteId,
  TeacherQuestionAssignmentId,
  TeacherQuestionBatchId,
  TeacherQuestionFolderId,
  TeacherQuestionImageId,
  TeacherRecordId,
  TeacherRecordTemplateId,
  TeacherStudentId,
  TeacherTimetableEntryId,
  TeacherTimetableEntryKind,
  TeacherWeekday,
  TeacherWorkbenchDocument,
  TeacherWorkbenchState,
} from './types.ts'

const text = z.string()
const identity = <T extends string>() => z.string().min(1).transform(value => value as T)
const stringRecord = z.record(z.string(), z.string())
const scoreRecord = z.record(z.string(), z.number().nonnegative())
const localDate = text
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must use YYYY-MM-DD')
  .refine(isCalendarDate, 'date must be a real calendar date')
const optionalLocalTime = text.regex(/^(?:|[01]\d:[0-5]\d|2[0-3]:[0-5]\d)$/, 'time must use HH:mm')
const optionalLocalDateTime = text.regex(
  /^(?:|\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d)$/,
  'date and time must use YYYY-MM-DDTHH:mm',
).refine(value => value === '' || isCalendarDate(value.slice(0, 10)), 'date must be a real calendar date')
const epochMilliseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const safeFileName = text.trim().min(1).max(255).refine(value => !/[\\/\u0000-\u001f]/u.test(value), 'file name must not contain a path')
const safeRelativePath = text.trim().min(1).max(1_024)
  .refine(value => !value.startsWith('/') && !value.startsWith('\\') && !/(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(value), 'relative path must stay below its root')
const questionMediaType = z.union([z.literal('image/png'), z.literal('image/jpeg'), z.literal('image/webp')])
const dailyTodoColor = z.union([
  z.literal('red'),
  z.literal('orange'),
  z.literal('amber'),
  z.literal('yellow'),
  z.literal('green'),
  z.literal('teal'),
  z.literal('cyan'),
  z.literal('blue'),
  z.literal('violet'),
  z.literal('pink'),
]) satisfies z.ZodType<TeacherDailyTodoColor>
const dailyTodoCategory = z.union([
  z.literal('today'),
  z.literal('important'),
  z.literal('urgent'),
]) satisfies z.ZodType<TeacherDailyTodoCategory>
const teacherWeekday = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]) satisfies z.ZodType<TeacherWeekday>
const timetableEntryKind = z.union([
  z.literal('lesson'),
  z.literal('morningStudy'),
  z.literal('eveningStudy'),
]) satisfies z.ZodType<TeacherTimetableEntryKind>
const teacherClassUsage = z.union([
  z.literal('roster'),
  z.literal('timetable'),
  z.literal('gradeTimetable'),
]) satisfies z.ZodType<TeacherClassUsage>

/** Runtime schema for a class. */
export const teacherClassSchema = z.object({
  id: identity<TeacherClassId>(),
  usage: teacherClassUsage,
  academicYear: text.optional(),
  name: text.trim().min(1),
  grade: text,
  subject: text,
})

/** Runtime schema for a roster student. */
export const teacherStudentSchema = z.object({
  id: identity<TeacherStudentId>(),
  classId: identity<TeacherClassId>(),
  name: text.trim().min(1),
  studentNumber: text,
  gender: text,
  guardian: text,
  relation: text,
  phone: text,
  address: text,
  extras: stringRecord,
})

/** Runtime schema for a lesson-preparation resource. */
export const teacherLessonResourceSchema = z.object({
  id: identity<TeacherLessonResourceId>(),
  category: z.union([z.literal('resource'), z.literal('observation'), z.literal('publicLesson')]),
  name: text.trim().min(1),
  url: z.url().regex(/^https?:\/\//i, 'resource URL must use http or https'),
  description: text,
})

/** Runtime schema for a workbench record template. */
export const teacherRecordTemplateSchema = z.object({
  id: identity<TeacherRecordTemplateId>(),
  kind: z.union([z.literal('observation'), z.literal('teaching')]),
  name: text.trim().min(1),
  scene: text,
  fields: z.array(text.trim().min(1)).min(1),
})

/** Runtime schema for one populated workbench record. */
export const teacherRecordSchema = z.object({
  id: identity<TeacherRecordId>(),
  templateId: identity<TeacherRecordTemplateId>(),
  title: text.trim().min(1),
  dueDate: text,
  status: z.union([z.literal('active'), z.literal('done')]),
  values: stringRecord,
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

/** Runtime schema for one exam. */
export const teacherExamSchema = z.object({
  id: identity<TeacherExamId>(),
  classId: identity<TeacherClassId>(),
  name: text.trim().min(1),
  date: text,
  entries: z.array(z.object({
    studentId: identity<TeacherStudentId>(),
    scores: scoreRecord,
  })),
})

/** Runtime schema for one daily task. */
export const teacherDailyTodoSchema = z.object({
  id: identity<TeacherDailyTodoId>(),
  title: text.trim().min(1),
  dueAt: optionalLocalDateTime,
  completed: z.boolean(),
  category: dailyTodoCategory,
  color: dailyTodoColor,
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one quick note. */
export const teacherQuickNoteSchema = z.object({
  id: identity<TeacherQuickNoteId>(),
  content: text.trim().min(1),
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one ledger category. */
export const teacherLedgerCategorySchema = z.object({
  id: identity<TeacherLedgerCategoryId>(),
  name: text.trim().min(1).max(40),
  createdAt: epochMilliseconds,
})

/** Runtime schema for one ledger entry. */
export const teacherLedgerEntrySchema = z.object({
  id: identity<TeacherLedgerEntryId>(),
  categoryId: identity<TeacherLedgerCategoryId>(),
  description: text.trim().min(1).max(500),
  amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  occurredAt: optionalLocalDateTime.refine(value => value !== '', 'ledger time is required'),
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one calendar item. */
export const teacherCalendarItemSchema = z.object({
  id: identity<TeacherCalendarItemId>(),
  date: localDate,
  time: optionalLocalTime,
  title: text.trim().min(1),
  details: text,
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one normalized weekly timetable entry. */
export const teacherTimetableEntrySchema = z.object({
  id: identity<TeacherTimetableEntryId>(),
  classId: identity<TeacherClassId>(),
  kind: timetableEntryKind,
  weekday: teacherWeekday,
  period: z.number().int().min(1).max(20),
  startTime: optionalLocalTime,
  endTime: optionalLocalTime,
  subject: text.trim().min(1),
  teacherName: text,
  location: text,
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one cropped question image. */
export const teacherQuestionImageSchema = z.object({
  id: identity<TeacherQuestionImageId>(),
  questionNo: z.number().int().min(1).max(10_000),
  fileName: safeFileName,
  mediaType: questionMediaType,
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one paper batch. */
export const teacherQuestionBatchSchema = z.object({
  id: identity<TeacherQuestionBatchId>(),
  name: text.trim().min(1).max(200),
  sourceName: safeFileName,
  pageRange: text.max(200),
  createdAt: epochMilliseconds,
  images: z.array(teacherQuestionImageSchema),
})

/** Runtime schema for one nested directory below a roster student. */
export const teacherQuestionFolderSchema = z.object({
  id: identity<TeacherQuestionFolderId>(),
  studentId: identity<TeacherStudentId>(),
  parentId: identity<TeacherQuestionFolderId>().optional(),
  name: text.trim().min(1).max(80).refine(value => !/[\\/\u0000-\u001f:*?"<>|]/u.test(value), 'folder name contains invalid characters'),
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for one student-owned question copy. */
export const teacherQuestionAssignmentSchema = z.object({
  id: identity<TeacherQuestionAssignmentId>(),
  studentId: identity<TeacherStudentId>(),
  sourceImageId: identity<TeacherQuestionImageId>(),
  folderId: identity<TeacherQuestionFolderId>().optional(),
  fileName: safeFileName,
  relativePath: safeRelativePath,
  mediaType: questionMediaType,
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
  createdAt: epochMilliseconds,
  updatedAt: epochMilliseconds,
})

/** Runtime schema for the complete workbench state, including owned references. */
export const teacherWorkbenchStateSchema = z.object({
  dailyTodos: z.array(teacherDailyTodoSchema),
  quickNotes: z.array(teacherQuickNoteSchema),
  ledgerCategories: z.array(teacherLedgerCategorySchema),
  ledgerEntries: z.array(teacherLedgerEntrySchema),
  calendarItems: z.array(teacherCalendarItemSchema),
  timetableEntries: z.array(teacherTimetableEntrySchema),
  classes: z.array(teacherClassSchema),
  students: z.array(teacherStudentSchema),
  resources: z.array(teacherLessonResourceSchema),
  templates: z.array(teacherRecordTemplateSchema),
  records: z.array(teacherRecordSchema),
  exams: z.array(teacherExamSchema),
  questionBatches: z.array(teacherQuestionBatchSchema),
  questionFolders: z.array(teacherQuestionFolderSchema).default([]),
  questionAssignments: z.array(teacherQuestionAssignmentSchema),
}).superRefine((state, ctx) => {
  uniqueIds(state.dailyTodos, 'dailyTodos', ctx)
  uniqueIds(state.quickNotes, 'quickNotes', ctx)
  const ledgerCategoryIds = uniqueIds(state.ledgerCategories, 'ledgerCategories', ctx)
  uniqueIds(state.ledgerEntries, 'ledgerEntries', ctx)
  uniqueIds(state.calendarItems, 'calendarItems', ctx)
  uniqueIds(state.timetableEntries, 'timetableEntries', ctx)
  uniqueIds(state.classes, 'classes', ctx)
  const classesById = new Map(state.classes.map(item => [item.id, item] as const))
  const studentIds = uniqueIds(state.students, 'students', ctx)
  uniqueIds(state.resources, 'resources', ctx)
  const templateIds = uniqueIds(state.templates, 'templates', ctx)
  uniqueIds(state.records, 'records', ctx)
  uniqueIds(state.exams, 'exams', ctx)
  uniqueIds(state.questionBatches, 'questionBatches', ctx)
  uniqueIds(state.questionFolders, 'questionFolders', ctx)
  const questionImageIds = new Set<string>()
  state.questionBatches.forEach((batch, batchIndex) => {
    batch.images.forEach((image, imageIndex) => {
      if (questionImageIds.has(image.id)) issue(ctx, ['questionBatches', batchIndex, 'images', imageIndex, 'id'], 'duplicate question image')
      questionImageIds.add(image.id)
    })
  })
  uniqueIds(state.questionAssignments, 'questionAssignments', ctx)

  const ledgerCategoryNames = new Set<string>()
  state.ledgerCategories.forEach((category, index) => {
    const key = category.name.normalize('NFKC').toLocaleLowerCase()
    if (ledgerCategoryNames.has(key)) issue(ctx, ['ledgerCategories', index, 'name'], 'duplicate ledger category')
    ledgerCategoryNames.add(key)
  })
  state.ledgerEntries.forEach((entry, index) => {
    if (!ledgerCategoryIds.has(entry.categoryId)) issue(ctx, ['ledgerEntries', index, 'categoryId'], 'unknown ledger category')
  })

  state.students.forEach((student, index) => {
    const owner = classesById.get(student.classId)
    if (owner === undefined) issue(ctx, ['students', index, 'classId'], 'unknown class')
    else if (owner.usage !== 'roster') issue(ctx, ['students', index, 'classId'], 'student class must belong to the roster')
  })
  const occupiedTimetableSlots = new Set<string>()
  state.timetableEntries.forEach((entry, index) => {
    const owner = classesById.get(entry.classId)
    if (owner === undefined) issue(ctx, ['timetableEntries', index, 'classId'], 'unknown class')
    else if (owner.usage === 'roster') issue(ctx, ['timetableEntries', index, 'classId'], 'timetable class must belong to a timetable catalog')
    const slot = `${entry.classId}\u0000${entry.kind}\u0000${String(entry.weekday)}\u0000${String(entry.period)}`
    if (occupiedTimetableSlots.has(slot)) {
      issue(ctx, ['timetableEntries', index, 'period'], 'duplicate timetable slot')
    }
    occupiedTimetableSlots.add(slot)
  })
  state.records.forEach((record, index) => {
    if (!templateIds.has(record.templateId)) issue(ctx, ['records', index, 'templateId'], 'unknown template')
  })
  state.exams.forEach((exam, examIndex) => {
    const owner = classesById.get(exam.classId)
    if (owner === undefined) issue(ctx, ['exams', examIndex, 'classId'], 'unknown class')
    else if (owner.usage !== 'roster') issue(ctx, ['exams', examIndex, 'classId'], 'exam class must belong to the roster')
    const seen = new Set<string>()
    exam.entries.forEach((entry, entryIndex) => {
      const student = state.students.find(candidate => candidate.id === entry.studentId)
      if (student === undefined || !studentIds.has(entry.studentId)) {
        issue(ctx, ['exams', examIndex, 'entries', entryIndex, 'studentId'], 'unknown student')
      } else if (student.classId !== exam.classId) {
        issue(ctx, ['exams', examIndex, 'entries', entryIndex, 'studentId'], 'student belongs to another class')
      }
      if (seen.has(entry.studentId)) {
        issue(ctx, ['exams', examIndex, 'entries', entryIndex, 'studentId'], 'duplicate student')
      }
      seen.add(entry.studentId)
    })
  })
  const folderById = new Map(state.questionFolders.map(folder => [folder.id, folder] as const))
  const siblingNames = new Set<string>()
  state.questionFolders.forEach((folder, index) => {
    if (!studentIds.has(folder.studentId)) issue(ctx, ['questionFolders', index, 'studentId'], 'unknown student')
    const parent = folder.parentId === undefined ? undefined : folderById.get(folder.parentId)
    if (folder.parentId !== undefined && parent === undefined) {
      issue(ctx, ['questionFolders', index, 'parentId'], 'unknown parent folder')
    } else if (parent !== undefined && parent.studentId !== folder.studentId) {
      issue(ctx, ['questionFolders', index, 'parentId'], 'parent folder belongs to another student')
    }
    const siblingKey = `${folder.studentId}\u0000${folder.parentId ?? ''}\u0000${folder.name.normalize('NFKC').toLocaleLowerCase()}`
    if (siblingNames.has(siblingKey)) issue(ctx, ['questionFolders', index, 'name'], 'duplicate sibling folder')
    siblingNames.add(siblingKey)
    const ancestors = new Set<string>([folder.id])
    let cursor = parent
    while (cursor !== undefined) {
      if (ancestors.has(cursor.id)) {
        issue(ctx, ['questionFolders', index, 'parentId'], 'folder hierarchy contains a cycle')
        break
      }
      ancestors.add(cursor.id)
      cursor = cursor.parentId === undefined ? undefined : folderById.get(cursor.parentId)
    }
  })
  state.questionAssignments.forEach((assignment, index) => {
    if (!studentIds.has(assignment.studentId)) issue(ctx, ['questionAssignments', index, 'studentId'], 'unknown student')
    if (!questionImageIds.has(assignment.sourceImageId)) issue(ctx, ['questionAssignments', index, 'sourceImageId'], 'unknown source image')
    if (assignment.folderId !== undefined) {
      const folder = folderById.get(assignment.folderId)
      if (folder === undefined) issue(ctx, ['questionAssignments', index, 'folderId'], 'unknown question folder')
      else if (folder.studentId !== assignment.studentId) issue(ctx, ['questionAssignments', index, 'folderId'], 'question folder belongs to another student')
    }
  })
}) as unknown as z.ZodType<TeacherWorkbenchState>

/** Runtime schema for the revisioned durable document. */
export const teacherWorkbenchDocumentSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: teacherWorkbenchStateSchema,
}) as z.ZodType<TeacherWorkbenchDocument>

/** Initial links and record templates migrated from the reference workbench. */
export const INITIAL_TEACHER_WORKBENCH_STATE: TeacherWorkbenchState = Object.freeze({
  dailyTodos: Object.freeze([]),
  quickNotes: Object.freeze([]),
  ledgerCategories: Object.freeze([
    ledgerCategory('builtin-ledger-insurance', '保险保费'),
    ledgerCategory('builtin-ledger-utilities', '水电燃气'),
    ledgerCategory('builtin-ledger-other', '其他账目'),
  ]),
  ledgerEntries: Object.freeze([]),
  calendarItems: Object.freeze([]),
  timetableEntries: Object.freeze([]),
  classes: Object.freeze([]),
  students: Object.freeze([]),
  resources: Object.freeze([
    resource('builtin-smartedu', 'resource', '国家中小学智慧教育平台', 'https://basic.smartedu.cn/', '国家课程与专题教育资源'),
    resource('builtin-seewo', 'resource', '希沃白板', 'https://easinote.seewo.com/', '课件制作与课堂互动'),
    resource('builtin-feixiang', 'resource', '飞象老师', 'https://www.feixianglaoshi.com/', '教师备课资源'),
    resource('builtin-zxxk', 'resource', '学科网', 'https://www.zxxk.com/', '学科资料与试题'),
  ]),
  templates: Object.freeze([
    template('builtin-observation', 'observation', '听课记录', '课堂观察与评课', ['授课教师', '课题', '班级与日期', '教学环节', '课堂亮点', '改进建议']),
    template('builtin-reflection', 'teaching', '课后反思记录', '完成一节课后的快速复盘', ['课题', '班级与日期', '目标达成', '学生真实反应', '问题', '下一课改进行动']),
    template('builtin-adjustment', 'teaching', '课堂观察与即时调整', '记录课堂中的观察与调整', ['观察时点', '学生表现', '即时判断', '调整动作', '调整结果']),
    template('builtin-homework', 'teaching', '作业批改与讲评记录', '整理作业问题与讲评计划', ['作业主题', '共性问题', '典型错例', '讲评重点', '后续练习']),
    template('builtin-unit-review', 'teaching', '单元教学复盘', '完成单元后的整体复盘', ['单元主题', '目标达成', '学情变化', '有效策略', '遗留问题', '下轮改进']),
  ]),
  records: Object.freeze([]),
  exams: Object.freeze([]),
  questionBatches: Object.freeze([]),
  questionFolders: Object.freeze([]),
  questionAssignments: Object.freeze([]),
})

/** Initial revisioned document served before the first durable write. */
export const INITIAL_TEACHER_WORKBENCH_DOCUMENT: TeacherWorkbenchDocument = Object.freeze({
  revision: 0,
  state: INITIAL_TEACHER_WORKBENCH_STATE,
})

/** Durable singleton owned by the workbench service. */
export const teacherWorkbenchDomainSpec = defineDomain({
  name: 'teacher_workbench',
  version: 7,
  global: {
    schema: teacherWorkbenchDocumentSchema,
    initial: INITIAL_TEACHER_WORKBENCH_DOCUMENT,
  },
  tables: {},
})

function ledgerCategory(id: string, name: string) {
  return Object.freeze({ id: id as TeacherLedgerCategoryId, name, createdAt: 0 })
}

function resource(
  id: string,
  category: 'resource' | 'observation' | 'publicLesson',
  name: string,
  url: string,
  description: string,
) {
  return Object.freeze({ id: id as TeacherLessonResourceId, category, name, url, description })
}

function template(
  id: string,
  kind: 'observation' | 'teaching',
  name: string,
  scene: string,
  fields: readonly string[],
) {
  return Object.freeze({
    id: id as TeacherRecordTemplateId,
    kind,
    name,
    scene,
    fields: Object.freeze([...fields]),
  })
}

function uniqueIds(
  rows: readonly { id: string }[],
  path: string,
  ctx: z.RefinementCtx,
): Set<string> {
  const ids = new Set<string>()
  rows.forEach((row, index) => {
    if (ids.has(row.id)) issue(ctx, [path, index, 'id'], 'duplicate id')
    ids.add(row.id)
  })
  return ids
}

function issue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: 'custom', path, message })
}

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
