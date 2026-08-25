/** Model-facing read and mutation tools for the teacher workbench. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import sharp from 'sharp'
import { saveGeneratedArtifact } from './source-documents.ts'
import { readFolderDocumentRequest } from './folder-document.ts'
import { segmentStagedQuestionPdf } from './question-source-pipeline.ts'
import type { TeacherWorkbenchService } from './index.ts'
import type {
  TeacherCalendarItem,
  TeacherCalendarItemId,
  TeacherClass,
  TeacherClassId,
  TeacherDailyTodo,
  TeacherDailyTodoId,
  TeacherExam,
  TeacherExamEntry,
  TeacherExamId,
  TeacherLedgerCategory,
  TeacherLedgerCategoryId,
  TeacherLedgerEntry,
  TeacherLedgerEntryId,
  TeacherMobileBotId,
  TeacherNotificationTarget,
  TeacherQuickNote,
  TeacherQuickNoteId,
  TeacherQuestionFolder,
  TeacherQuestionFolderId,
  TeacherQuestionBatchDestination,
  TeacherQuestionLibraryFolderId,
  TeacherStudent,
  TeacherStudentId,
  TeacherReminder,
  TeacherReminderRule,
  TeacherTimetableEntry,
  TeacherTimetableEntryId,
  TeacherWorkbenchState,
} from './types.ts'

const DAILY_ACTIONS = [
  'save_todo', 'delete_todo', 'save_note', 'delete_note', 'save_ledger_category',
  'delete_ledger_category', 'save_ledger_entry', 'delete_ledger_entry',
  'save_calendar_item', 'delete_calendar_item', 'import_calendar_items',
] as const
const TIMETABLE_ACTIONS = ['save_class', 'delete_class', 'save_entry', 'delete_entry', 'import_entries'] as const
const ROSTER_ACTIONS = ['save_class', 'delete_class', 'save_student', 'delete_student', 'import_students'] as const
const SCORE_ACTIONS = ['save_exam', 'delete_exam'] as const
const QUESTION_ACTIONS = [
  'segment_pdf', 'create_folder', 'delete_folder', 'delete_batch', 'delete_image', 'rotate_image', 'crop_image',
  'erase_image_regions', 'assign_questions', 'generate_folder_document', 'generate_document', 'generate_student_documents',
] as const

const MAX_QUESTION_IMAGE_EDIT_REGIONS = 32

const mutationOutput = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

type MutationResult = {
  revision: number
  summary: string
  createdIds: string[]
  confirmation?: TimetableMutationConfirmation
}

type StateChange = {
  readonly state: TeacherWorkbenchState
  readonly summary: string
  readonly createdIds?: readonly string[]
  readonly timetableConfirmation?: TimetableStateConfirmation
}

type DailyCreationRoute = {
  readonly kind: 'note' | 'today' | 'urgent' | 'important' | 'ledger' | 'calendar'
  readonly keyword: string
}

type TimetableToolView = 'week' | 'grade'

type TimetableStateConfirmation = {
  readonly view: TimetableToolView
  readonly classIds: readonly TeacherClassId[]
  readonly entryIds: readonly TeacherTimetableEntryId[]
  readonly deleted: boolean
}

type TimetableMutationConfirmation = {
  readonly section: 'timetable'
  readonly view: TimetableToolView
  readonly verifiedRevision: number
  readonly classIds: string[]
  readonly entryIds: string[]
}

/**
 * Register ordinary-conversation tools for all five teacher-workbench modules.
 * @param ctx - context providing the model-facing tool registry.
 * @param service - authoritative workbench read, write, media, and generation operations.
 * @param fs - filesystem provider used to read local image directories.
 */
export function registerTeacherWorkbenchTools(ctx: Context, service: TeacherWorkbenchService, fs: FileSystem): void {
  ctx.inject(['attachments'], (imageCtx) => {
    registerTeacherQuestionImageReadTool(imageCtx, service)
  })

  ctx.tools.register(defineTool({
    name: 'teacher_workbench_read',
    description: 'Read the authoritative teacher workbench before editing it. Returns stable ids needed by mutation tools.',
    parameters: {
      section: {
        type: 'string',
        required: true,
        enum: ['daily', 'timetable', 'roster', 'scores', 'questions'],
        description: 'daily | timetable | roster | scores | questions',
      },
      class_id: { type: 'string', description: 'Optional roster or timetable class id used to filter rows.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const document = (await service.read({})).value
      const notificationTargets = args.section === 'daily'
        ? await service.listNotificationTargets({})
        : []
      return jsonValue(readSection(document.state, args.section, args.class_id, notificationTargets))
    },
    presentCall: args => ({ card: 'generic', title: `Read teacher workbench: ${args.section}`, kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'teacher_daily_management',
    description: `Create, edit, delete, complete, reschedule, or import daily-management data. Call teacher_workbench_read first. Actions: ${DAILY_ACTIONS.join(', ')}. Payloads: save_todo {id?,title,dueAt?,completed?,color?,reminder?}; save_note {id?,content,remindAt?,reminder?}; save_ledger_category {id?,name}; save_ledger_entry {id?,categoryId,description,amountCents,occurredAt,remindAt?,reminder?}; save_calendar_item {id?,date,time?,title,details?,reminder?}; import_calendar_items {items:[calendar fields]}; delete actions use {id}. Route only from literal words in the current user request: 备忘, 备忘录, or memo means save_note; 今日, 待办, today, or todo means save_todo; 紧急 or urgent means save_todo in Urgent; 重要 or important means save_todo in Important; 账单, 账本, 保险, 保费, 水费, 电费, 燃气费, bill, insurance, or premium means the matching ledger category or entry action; 日历 or calendar means a calendar action. The host validates every new item's action and destination against the original user message, so never substitute another action or invent a routing keyword. If a new item has no routing word, ask the user where it belongs and do not mutate the workbench. Never infer a destination from the content, deadline, tone, or consequences. Existing item edits retain their destination. For a requested mobile reminder, use reminder {channel,botId,rule:{kind:'once',minutesBefore}|{kind:'repeat',everyMinutes}} with the exact channel and botId from notificationTargets returned by teacher_workbench_read daily; never invent a bot id. Memos and ledger entries use remindAt as their reminder deadline. Set reminder to null to remove it. Omission preserves an existing reminder only while its deadline is unchanged. Amounts use integer CNY cents; local date-times use YYYY-MM-DDTHH:mm.`,
    parameters: {
      action: { type: 'string', required: true, enum: [...DAILY_ACTIONS] },
      data: { type: 'object', required: true, additionalProperties: true, description: 'Action fields described by the selected action.' },
    },
    output: mutationOutput,
    execute: async (args, exec) => {
      const route = dailyCreationRoute(args.action, args.data, exec.agent)
      const targets = reminderObject(args.data.reminder)
        ? await service.listNotificationTargets({})
        : []
      return mutate(service, state => dailyChange(state, args.action, args.data, targets, route))
    },
    presentCall: args => ({ card: 'generic', title: `Daily management: ${args.action}`, kind: 'other', rawInput: args.data }),
  }))

  ctx.tools.register(defineTool({
    name: 'teacher_timetable',
    description: `Create, edit, delete, or bulk-import classes and timetable entries. Call teacher_workbench_read first. Actions: ${TIMETABLE_ACTIONS.join(', ')}. Every save/import payload requires view: week|grade. Use view=week for 本周课表, 今日课程, one class's weekly schedule, morning study, or evening study; use view=grade only when the user explicitly asks for 年级课表 covering multiple classes. A grade name such as 高三 never implies view=grade. Never reuse a class id whose usage belongs to the other view; omit classId and provide className to create the parallel class catalog entry. save_class {view,id?,name,grade?,subject?}; save_entry uses {view,id?,classId?,className,grade?,kind,weekday,period,startTime?,endTime?,subject,teacherName?,location?}; import_entries uses {view,entries:[...]}; deletes use {id}. Weekday is 1=Monday through 7=Sunday; kind is lesson, morningStudy, or eveningStudy. Period is the unique daily ordinal: if afternoon labels restart at 1, continue them after the morning periods instead of submitting duplicate slots. A success result includes a read-back confirmation naming the exact week or grade view.`,
    parameters: {
      action: { type: 'string', required: true, enum: [...TIMETABLE_ACTIONS] },
      data: { type: 'object', required: true, additionalProperties: true },
    },
    output: mutationOutput,
    execute: async args => mutate(service, state => timetableChange(state, args.action, args.data)),
    presentCall: args => ({ card: 'generic', title: `Timetable: ${args.action}`, kind: 'other', rawInput: args.data }),
  }))

  ctx.tools.register(defineTool({
    name: 'teacher_student_roster',
    description: `Create, edit, delete, or bulk-import roster classes and students from uploaded OCR content. Call teacher_workbench_read first. Actions: ${ROSTER_ACTIONS.join(', ')}. save_class {id?,name,grade?,subject?,academicYear?}; save_student {id?,classId,name,studentNumber?,gender?,guardian?,relation?,phone?,address?,extras?}; import_students {classId,students:[student fields]}; deletes use {id}. import_students merges by studentNumber, then by name when the number is blank.`,
    parameters: {
      action: { type: 'string', required: true, enum: [...ROSTER_ACTIONS] },
      data: { type: 'object', required: true, additionalProperties: true },
    },
    output: mutationOutput,
    execute: async args => mutate(service, state => rosterChange(state, args.action, args.data)),
    presentCall: args => ({ card: 'generic', title: `Student roster: ${args.action}`, kind: 'other', rawInput: args.data }),
  }))

  ctx.tools.register(defineTool({
    name: 'teacher_score_analysis',
    description: `Create, replace, or delete an exam and its subject scores from uploaded OCR content. Call teacher_workbench_read first. Actions: ${SCORE_ACTIONS.join(', ')}. save_exam {id?,classId,name,date?,entries:[{studentId?|studentNumber?|studentName?,scores:{subject:number}}]}; delete_exam {id}. Each entry must identify exactly one student within the class.`,
    parameters: {
      action: { type: 'string', required: true, enum: [...SCORE_ACTIONS] },
      data: { type: 'object', required: true, additionalProperties: true },
    },
    output: mutationOutput,
    execute: async args => mutate(service, state => scoreChange(state, args.action, args.data)),
    presentCall: args => ({ card: 'generic', title: `Score analysis: ${args.action}`, kind: 'other', rawInput: args.data }),
  }))

  ctx.tools.register(defineTool({
    name: 'teacher_question_workbench',
    description: `Split an uploaded PDF, edit/delete question images, manage student folders and assignments, and generate Word or PowerPoint files. Call teacher_workbench_read before actions that use stored workbench state. Actions: ${QUESTION_ACTIONS.join(', ')}. segment_pdf has no default save destination and uses {sourceId,sourceName,destinationKind:library-root|library-folder,folderId?,pageRange?,batchName?,padding?} from uploaded-document context. Use library-root only when the current user explicitly names the question-library root. Use library-folder with the folderId from teacher_workbench_read only when the current user explicitly names that folder's complete path. Otherwise ask which destination to use and do not call segment_pdf. It keeps each accepted region's MinerU left, top, and bottom coordinates and gives every output the PDF-wide maximum normalized safe-lane width from its fixed left edge. Source pixels stop at the inset horizontal lane limit; any remaining width is white padding instead of gutter or neighboring-column pixels. Image actions use {kind:batch|assignment,id}; inspect the stored raster with teacher_question_image_read before choosing source-pixel coordinates. rotate_image adds degrees 90|180|270; crop_image adds left,top,width,height; erase_image_regions adds regions:[{left,top,width,height}] and replaces each rectangle with its sampled surrounding background. Both crop and erase overwrite the stored image. assign_questions {studentId,folderId?,imageIds}. generate_folder_document accepts {kind:word|ppt,directoryPath} for an ordinary local image directory, requires no student assignment, and does not require teacher_workbench_read. generate_document accepts kind word|ppt and ordered stored targets [{kind:batch|assignment,id}]. To reproduce Question Cutting class Word or PowerPoint output, use generate_student_documents {kind,source?,students:[{studentId,title?,includeName?,includeDate?}]}; omitted fields match the browser defaults: source temporary, empty title, and no printed name or date. Set source assigned only when the user requests all assigned images.`,
    parameters: {
      action: { type: 'string', required: true, enum: [...QUESTION_ACTIONS] },
      data: { type: 'object', required: true, additionalProperties: true },
    },
    output: mutationOutput,
    execute: async (args, exec) => {
      if (args.action === 'segment_pdf') {
        if (exec.agent === undefined) throw new Error('question segmentation requires an owning agent session')
        const sourceName = textField(args.data, 'sourceName')
        const state = (await service.read({})).value.state
        const result = await segmentStagedQuestionPdf(ctx, service, {
          sourceId: textField(args.data, 'sourceId') as never,
          sourceName,
          destination: questionSegmentationDestination(state, args.data, exec.agent),
          pageRange: optionalText(args.data, 'pageRange') ?? '',
          batchName: optionalText(args.data, 'batchName')?.trim() || sourceName.replace(/\.pdf$/iu, ''),
          padding: optionalNumber(args.data, 'padding') ?? 8,
        }, exec.agent.id, exec.signal)
        return {
          revision: result.revision,
          summary: `Segmented ${String(result.questionCount)} questions`,
          createdIds: [result.batchId],
          batchId: result.batchId,
          questionCount: result.questionCount,
          groupCount: result.groupCount,
        }
      }
      if (args.action === 'delete_batch') {
        const batchId = textField(args.data, 'batchId') as never
        const result = await service.deleteQuestionBatch({ batchId })
        if (!result.ok) throw new Error(result.error.message)
        return { revision: result.value.document.revision, summary: 'Deleted question batch', createdIds: [] }
      }
      if (args.action === 'delete_image') {
        const target = questionTarget(args.data)
        const result = await service.deleteQuestionImage({ target })
        if (!result.ok) throw new Error(result.error.message)
        return { revision: result.value.document.revision, summary: 'Deleted question image', createdIds: [] }
      }
      if (args.action === 'rotate_image' || args.action === 'crop_image' || args.action === 'erase_image_regions') {
        const target = questionTarget(args.data)
        const source = await service.readQuestionImage({ target })
        if (!source.ok) throw new Error(source.error.message)
        const input = Buffer.from(source.value.contentBase64, 'base64')
        let output: Buffer
        if (args.action === 'rotate_image') {
          output = await sharp(input)
            .rotate(enumNumberField(args.data, 'degrees', [90, 180, 270] as const))
            .png()
            .toBuffer()
        } else if (args.action === 'crop_image') {
          output = await sharp(input).extract({
            left: integerField(args.data, 'left'),
            top: integerField(args.data, 'top'),
            width: integerField(args.data, 'width'),
            height: integerField(args.data, 'height'),
          }).png().toBuffer()
        } else {
          output = await eraseQuestionImageRegions(input, questionImageEditRegions(args.data))
        }
        const metadata = await sharp(output).metadata()
        const replaced = await service.replaceQuestionImage({
          target,
          fileName: source.value.fileName.replace(/\.[^.]+$/u, '.png'),
          mediaType: 'image/png',
          width: metadata.width,
          height: metadata.height,
          contentBase64: output.toString('base64'),
        })
        if (!replaced.ok) throw new Error(replaced.error.message)
        return { revision: replaced.value.document.revision, summary: 'Edited question image', createdIds: [] }
      }
      if (args.action === 'assign_questions') {
        const result = await service.assignQuestions({
          studentId: textField(args.data, 'studentId') as never,
          imageIds: textArray(args.data, 'imageIds') as never,
          ...optionalText(args.data, 'folderId') === undefined ? {} : { folderId: optionalText(args.data, 'folderId') as never },
        })
        if (!result.ok) throw new Error(result.error.message)
        return { revision: result.value.document.revision, summary: 'Assigned questions to student', createdIds: [] }
      }
      if (args.action === 'generate_folder_document') {
        const request = await readFolderDocumentRequest(
          fs,
          exec,
          enumField(args.data, 'kind', ['word', 'ppt'] as const),
          textField(args.data, 'directoryPath'),
          service.questionDocumentLimits(),
        )
        const result = await service.generateUploadedQuestionDocument(request)
        if (!result.ok) throw new Error(result.error.message)
        const outputPath = await saveGeneratedArtifact(service.sourceConfig(), result.value)
        return {
          revision: (await service.read({})).value.revision,
          summary: 'Generated folder document',
          createdIds: [],
          outputPath,
        }
      }
      if (args.action === 'generate_document') {
        const kind = enumField(args.data, 'kind', ['word', 'ppt'] as const)
        const targets = objectArray(args.data, 'targets').map(target => ({
          kind: enumField(target, 'kind', ['batch', 'assignment'] as const),
          id: textField(target, 'id') as never,
        }))
        const result = await service.generateQuestionDocument({
          kind,
          title: optionalText(args.data, 'title') ?? '',
          studentName: optionalText(args.data, 'studentName') ?? '',
          includeDate: optionalBoolean(args.data, 'includeDate') ?? false,
          targets,
        })
        if (!result.ok) throw new Error(result.error.message)
        const outputPath = await saveGeneratedArtifact(service.sourceConfig(), result.value)
        return { revision: (await service.read({})).value.revision, summary: 'Generated question document', createdIds: [], outputPath }
      }
      if (args.action === 'generate_student_documents') {
        const source = optionalEnum(args.data, 'source', ['assigned', 'temporary'] as const) ?? 'temporary'
        const result = await service.generateStudentDocuments({
          kind: enumField(args.data, 'kind', ['word', 'ppt'] as const),
          source,
          students: objectArray(args.data, 'students').map(student => ({
            studentId: textField(student, 'studentId') as never,
            title: optionalText(student, 'title') ?? '',
            includeName: optionalBoolean(student, 'includeName') ?? false,
            includeDate: optionalBoolean(student, 'includeDate') ?? false,
          })),
        })
        if (!result.ok) throw new Error(result.error.message)
        const outputPaths: string[] = []
        for (const artifact of result.value.artifacts) {
          outputPaths.push(await saveGeneratedArtifact(service.sourceConfig(), artifact))
        }
        return {
          revision: (await service.read({})).value.revision,
          summary: `Generated ${String(outputPaths.length)} student documents`,
          createdIds: [],
          outputPaths,
          skipped: result.value.skipped.map(item => ({ ...item })),
        }
      }
      return mutate(service, state => questionStateChange(state, questionFolderAction(args.action), args.data))
    },
    presentCall: args => ({ card: 'generic', title: `Question workbench: ${args.action}`, kind: 'other', rawInput: args.data }),
  }))
}

interface QuestionImageReadValue {
  readonly target: { readonly kind: 'batch' | 'assignment'; readonly id: string }
  readonly source: { readonly fileName: string; readonly width: number; readonly height: number }
  readonly image: {
    readonly attachmentId: string
    readonly mediaType: ImageMediaType
    readonly bytes: number
    readonly width: number
    readonly height: number
    readonly name?: string
    readonly originalDimensions?: { readonly width: number; readonly height: number }
  }
}

interface QuestionImageEditRegion {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function registerTeacherQuestionImageReadTool(ctx: Context, service: TeacherWorkbenchService): void {
  ctx.tools.register(defineTool({
    name: 'teacher_question_image_read',
    description: 'Read one stored Question Cutting image and return the raster itself. Call teacher_workbench_read with section questions first to obtain a batch or assignment image id. The result states the source dimensions used by crop_image and erase_image_regions. Requires the current model route to accept image input.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['batch', 'assignment'] },
      id: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'object', required: true, additionalProperties: true },
          source: { type: 'object', required: true, additionalProperties: true },
          image: { type: 'object', required: true, additionalProperties: true },
        },
      },
      render: (_args, value) => questionImageReadContent(value as unknown as QuestionImageReadValue),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = questionTarget(args)
      await assertQuestionImageCapableRoute(ctx, exec, `${target.kind}:${String(target.id)}`)
      const source = await service.readQuestionImage({ target })
      if (!source.ok) throw new Error(source.error.message)
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('cannot read a question image: no attachment service is mounted')
      const mediaType = source.value.mediaType as ImageMediaType
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`cannot read question image ${String(target.id)}: ${mediaType} images are not accepted by this deployment`)
      }
      const bytes = Buffer.from(source.value.contentBase64, 'base64')
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      if (bytes.byteLength > byteCap) {
        throw new Error(`cannot read question image ${String(target.id)}: encoded image exceeds the ${String(byteCap)}-byte model-result limit`)
      }
      const ref = await attachments.saveImage({ data: bytes, mediaType, name: source.value.fileName })
      return {
        target,
        source: { fileName: source.value.fileName, width: source.value.width, height: source.value.height },
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
          ...ref.originalDimensions === undefined ? {} : {
            originalDimensions: { ...ref.originalDimensions },
          },
        },
      }
    },
    presentCall: args => ({ card: 'generic', title: `Read question image ${args.id}`, kind: 'read' }),
  }))
}

function questionImageReadContent(value: QuestionImageReadValue): ContentBlock[] {
  const xScale = value.source.width / value.image.width
  const yScale = value.source.height / value.image.height
  const scaling = xScale === 1 && yScale === 1
    ? ''
    : ` The attached preview is ${String(value.image.width)}x${String(value.image.height)} px; multiply preview x coordinates by ${xScale.toFixed(4)} and y coordinates by ${yScale.toFixed(4)}.`
  return [
    {
      type: 'text',
      text: `Question image ${value.target.kind}:${value.target.id} is ${String(value.source.width)}x${String(value.source.height)} source pixels. Use source-pixel coordinates for crop_image and erase_image_regions.${scaling}`,
    },
    { type: 'image', attachment: questionImageAttachmentRef(value.image) },
  ]
}

function questionImageAttachmentRef(image: QuestionImageReadValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
    ...image.originalDimensions === undefined ? {} : {
      originalDimensions: { ...image.originalDimensions },
    },
  }
}

async function assertQuestionImageCapableRoute(
  ctx: Context,
  exec: ToolExecution,
  target: string,
): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read question image ${target}: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`cannot read question image ${target}: model "${model}" does not declare image input; switch to an image-capable model`)
  }
}

function questionImageEditRegions(data: Record<string, unknown>): QuestionImageEditRegion[] {
  const regions = objectArray(data, 'regions').map(region => ({
    left: integerField(region, 'left'),
    top: integerField(region, 'top'),
    width: integerField(region, 'width'),
    height: integerField(region, 'height'),
  }))
  if (regions.length === 0 || regions.length > MAX_QUESTION_IMAGE_EDIT_REGIONS) {
    throw new Error(`regions must contain between 1 and ${String(MAX_QUESTION_IMAGE_EDIT_REGIONS)} rectangles`)
  }
  for (const [index, region] of regions.entries()) {
    if (region.left < 0 || region.top < 0 || region.width < 1 || region.height < 1) {
      throw new Error(`regions[${String(index)}] must use non-negative left/top and positive width/height`)
    }
  }
  return regions
}

async function eraseQuestionImageRegions(
  input: Buffer,
  regions: readonly QuestionImageEditRegion[],
): Promise<Buffer> {
  const decoded = await sharp(input)
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = decoded.info
  for (const [index, region] of regions.entries()) {
    if (region.left + region.width > width || region.top + region.height > height) {
      throw new Error(`regions[${String(index)}] exceeds the ${String(width)}x${String(height)} image bounds`)
    }
  }
  for (const region of regions) {
    const color = sampledQuestionBackground(decoded.data, width, height, channels, region)
    for (let y = region.top; y < region.top + region.height; y += 1) {
      for (let x = region.left; x < region.left + region.width; x += 1) {
        const offset = (y * width + x) * channels
        decoded.data[offset] = color.red
        decoded.data[offset + 1] = color.green
        decoded.data[offset + 2] = color.blue
      }
    }
  }
  return await sharp(decoded.data, {
    raw: { width, height, channels },
  }).png().toBuffer()
}

function sampledQuestionBackground(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
  region: QuestionImageEditRegion,
): { readonly red: number; readonly green: number; readonly blue: number } {
  const padding = 8
  const left = Math.max(0, region.left - padding)
  const top = Math.max(0, region.top - padding)
  const right = Math.min(width, region.left + region.width + padding)
  const bottom = Math.min(height, region.top + region.height + padding)
  const red: number[] = []
  const green: number[] = []
  const blue: number[] = []
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const insideRegion = x >= region.left
        && x < region.left + region.width
        && y >= region.top
        && y < region.top + region.height
      if (insideRegion) continue
      const offset = (y * width + x) * channels
      red.push(pixels[offset] ?? 255)
      green.push(pixels[offset + 1] ?? 255)
      blue.push(pixels[offset + 2] ?? 255)
    }
  }
  if (red.length === 0) return { red: 255, green: 255, blue: 255 }
  return {
    red: medianQuestionChannel(red),
    green: medianQuestionChannel(green),
    blue: medianQuestionChannel(blue),
  }
}

function medianQuestionChannel(values: number[]): number {
  values.sort((left, right) => left - right)
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) return values[middle] ?? 255
  return Math.round(((values[middle - 1] ?? 255) + (values[middle] ?? 255)) / 2)
}

function readSection(
  state: TeacherWorkbenchState,
  section: string,
  classId?: string,
  notificationTargets: readonly TeacherNotificationTarget[] = [],
): unknown {
  switch (section) {
    case 'daily': return {
      dailyTodos: state.dailyTodos,
      quickNotes: state.quickNotes,
      ledgerCategories: state.ledgerCategories,
      ledgerEntries: state.ledgerEntries,
      calendarItems: state.calendarItems,
      notificationTargets,
    }
    case 'timetable': {
      const classes = state.classes.filter(item => item.usage !== 'roster' && (classId === undefined || item.id === classId))
      const ids = new Set(classes.map(item => item.id))
      return { classes, timetableEntries: state.timetableEntries.filter(item => ids.has(item.classId)) }
    }
    case 'roster': {
      const classes = state.classes.filter(item => item.usage === 'roster' && (classId === undefined || item.id === classId))
      const ids = new Set(classes.map(item => item.id))
      return { classes, students: state.students.filter(item => ids.has(item.classId)) }
    }
    case 'scores': {
      const classes = state.classes.filter(item => item.usage === 'roster' && (classId === undefined || item.id === classId))
      const ids = new Set(classes.map(item => item.id))
      return {
        classes,
        students: state.students.filter(item => ids.has(item.classId)),
        exams: state.exams.filter(item => ids.has(item.classId)),
      }
    }
    case 'questions': return {
      questionBatches: state.questionBatches,
      questionLibraryFolders: state.questionLibraryFolders,
      questionFolders: state.questionFolders,
      questionAssignments: state.questionAssignments,
      classes: state.classes.filter(item => item.usage === 'roster'),
      students: state.students,
    }
    default: throw new Error(`unknown teacher workbench section: ${section}`)
  }
}

async function mutate(
  service: TeacherWorkbenchService,
  transform: (state: TeacherWorkbenchState) => StateChange,
): Promise<MutationResult> {
  let document = (await service.read({})).value
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const change = transform(document.state)
    const result = await service.write({ expectedRevision: document.revision, state: change.state })
    if (result.ok) {
      const confirmation = change.timetableConfirmation === undefined
        ? undefined
        : await confirmTimetableMutation(service, change.timetableConfirmation)
      return {
        revision: result.value.revision,
        summary: change.summary,
        createdIds: [...(change.createdIds ?? [])],
        ...(confirmation === undefined ? {} : { confirmation }),
      }
    }
    if (result.error.code === 'invalid-state') throw new Error(result.error.message)
    document = result.error.current
  }
  throw new Error('teacher workbench changed concurrently; read it and retry')
}

async function confirmTimetableMutation(
  service: TeacherWorkbenchService,
  expected: TimetableStateConfirmation,
): Promise<TimetableMutationConfirmation> {
  const document = (await service.read({})).value
  const classIds = new Set(document.state.classes.map(item => item.id))
  const entryIds = new Set(document.state.timetableEntries.map(item => item.id))
  const classMatches = expected.classIds.every(id => classIds.has(id) !== expected.deleted)
  const entryMatches = expected.entryIds.every(id => entryIds.has(id) !== expected.deleted)
  if (!classMatches || !entryMatches) {
    throw new Error('timetable write was not present during read-back verification; read the workbench and retry')
  }
  return {
    section: 'timetable',
    view: expected.view,
    verifiedRevision: document.revision,
    classIds: [...expected.classIds],
    entryIds: [...expected.entryIds],
  }
}

function reminderObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveAgentReminder(
  data: Record<string, unknown>,
  existing: TeacherReminder | undefined,
  localDeadline: string,
  now: number,
  notificationTargets: readonly TeacherNotificationTarget[],
): { reminder?: TeacherReminder } {
  const deadline = localDeadline === '' ? undefined : new Date(localDeadline)
  const dueAtUtc = deadline === undefined || Number.isNaN(deadline.getTime()) ? undefined : deadline.toISOString()
  if (!Object.hasOwn(data, 'reminder')) {
    return existing !== undefined && existing.dueAtUtc === dueAtUtc ? { reminder: existing } : {}
  }
  const requested = data.reminder
  if (requested === null) return {}
  if (!reminderObject(requested)) throw new Error('reminder must be an object or null')
  if (dueAtUtc === undefined) throw new Error('a mobile reminder requires a valid local deadline')
  if (Date.parse(dueAtUtc) <= now) throw new Error('a mobile reminder deadline must be in the future')
  const channel = enumField(requested, 'channel', [
    'weixin', 'feishu', 'dingtalk', 'wecom', 'qq', 'slack', 'telegram', 'discord', 'whatsapp',
  ] as const)
  const botId = textField(requested, 'botId') as TeacherMobileBotId
  const target = notificationTargets.find(candidate => candidate.channel === channel && candidate.botId === botId)
  if (target === undefined) {
    throw new Error('reminder channel and botId must match notificationTargets from teacher_workbench_read daily')
  }
  const ruleValue = requested.rule
  if (!reminderObject(ruleValue)) throw new Error('reminder.rule must be an object')
  const rule = reminderRule(ruleValue)
  if (rule.kind === 'once' && Date.parse(dueAtUtc) - rule.minutesBefore * 60_000 <= now) {
    throw new Error('a one-time reminder must occur in the future')
  }
  if (existing !== undefined
    && existing.channel === channel
    && existing.botId === botId
    && existing.botLabel === target.label
    && existing.dueAtUtc === dueAtUtc
    && sameReminderRule(existing.rule, rule)) {
    return { reminder: existing }
  }
  return {
    reminder: {
      channel,
      botId,
      botLabel: target.label,
      dueAtUtc,
      rule,
      configuredAt: now,
      lastOccurrenceAt: '',
    },
  }
}

function reminderRule(value: Record<string, unknown>): TeacherReminderRule {
  const kind = enumField(value, 'kind', ['once', 'repeat'] as const)
  if (kind === 'once') {
    const minutesBefore = integerField(value, 'minutesBefore')
    if (minutesBefore < 0 || minutesBefore > 525_600) {
      throw new Error('reminder.rule.minutesBefore must be between 0 and 525600')
    }
    return { kind, minutesBefore }
  }
  const everyMinutes = integerField(value, 'everyMinutes')
  if (everyMinutes < 5 || everyMinutes > 525_600) {
    throw new Error('reminder.rule.everyMinutes must be between 5 and 525600')
  }
  return { kind, everyMinutes }
}

function sameReminderRule(left: TeacherReminderRule, right: TeacherReminderRule): boolean {
  if (left.kind !== right.kind) return false
  return left.kind === 'once'
    ? left.minutesBefore === (right as Extract<TeacherReminderRule, { kind: 'once' }>).minutesBefore
    : left.everyMinutes === (right as Extract<TeacherReminderRule, { kind: 'repeat' }>).everyMinutes
}

function dailyCreationRoute(
  action: typeof DAILY_ACTIONS[number],
  data: Record<string, unknown>,
  agent: Agent | undefined,
): DailyCreationRoute | undefined {
  const createsItem = action === 'import_calendar_items'
    || (action === 'save_todo' || action === 'save_note' || action === 'save_ledger_category'
      || action === 'save_ledger_entry' || action === 'save_calendar_item')
      && optionalText(data, 'id') === undefined
  if (!createsItem) return undefined
  if (agent === undefined) throw new Error('creating daily-management data requires the owning agent user request')

  const text = currentTurnUserText(agent)
  const route = routeFromLiteralKeyword(text)
  if (route === undefined) {
    throw new Error('the current user request has no daily-management routing keyword; ask where the item belongs and do not create it')
  }
  const allowed = route.kind === 'note'
    ? action === 'save_note'
    : route.kind === 'ledger'
      ? action === 'save_ledger_category' || action === 'save_ledger_entry'
      : route.kind === 'calendar'
        ? action === 'save_calendar_item' || action === 'import_calendar_items'
        : action === 'save_todo'
  if (!allowed) {
    throw new Error(`the current user request contains ${JSON.stringify(route.keyword)}; use ${expectedDailyAction(route.kind)} instead of ${action}`)
  }
  return route
}

function currentTurnUserText(agent: Agent): string {
  const events = agent.session.events
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const text = events.slice(turnStart + 1).flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  }).join('\n').trim()
  if (text === '') throw new Error('the current agent turn has no direct user text')
  return text
}

function questionSegmentationDestination(
  state: TeacherWorkbenchState,
  data: Record<string, unknown>,
  agent: Agent,
): Exclude<TeacherQuestionBatchDestination, { readonly kind: 'source-folder' }> {
  const kind = optionalEnum(data, 'destinationKind', ['library-root', 'library-folder'] as const)
  if (kind === undefined) {
    throw new Error('segment_pdf has no default save destination; ask the user to choose the question-library root or provide one complete folder path before cutting')
  }
  const requestText = normalizedQuestionDestination(currentTurnUserText(agent))
  if (kind === 'library-root') {
    if (optionalText(data, 'folderId') !== undefined) throw new Error('folderId is not allowed for the question-library root')
    const rootNames = ['试题图片库根目录', '试题图片根目录', '图片根目录', 'question library root']
    if (!rootNames.some(name => requestText.includes(normalizedQuestionDestination(name)))) {
      throw new Error('the current user request does not explicitly name the question-library root; ask which save destination to use before cutting')
    }
    return { kind: 'library-root' }
  }

  const folderId = textField(data, 'folderId') as TeacherQuestionLibraryFolderId
  const path = questionLibraryFolderPath(state, folderId)
  if (state.questionLibraryFolders.some(folder => folder.parentId === folderId)) {
    throw new Error(`question-library destination must be a leaf path: ${path}`)
  }
  if (!requestText.includes(normalizedQuestionDestination(path))) {
    throw new Error(`the current user request does not explicitly name question-library path ${JSON.stringify(path)}; ask for the complete save path before cutting`)
  }
  return { kind: 'library-folder', folderId }
}

function questionLibraryFolderPath(state: TeacherWorkbenchState, folderId: TeacherQuestionLibraryFolderId): string {
  const folders = new Map(state.questionLibraryFolders.map(folder => [folder.id, folder] as const))
  const visited = new Set<TeacherQuestionLibraryFolderId>()
  const names: string[] = []
  let currentId: TeacherQuestionLibraryFolderId | undefined = folderId
  while (currentId !== undefined) {
    if (visited.has(currentId)) throw new Error('question-library destination contains a directory cycle')
    visited.add(currentId)
    const folder = folders.get(currentId)
    if (folder === undefined) throw new Error(`question-library folder not found: ${String(currentId)}`)
    names.push(folder.name)
    currentId = folder.parentId
  }
  return names.reverse().join('/')
}

function normalizedQuestionDestination(value: string): string {
  return normalized(value).replaceAll('\\', '/').replace(/\s*\/\s*/gu, '/')
}

function routeFromLiteralKeyword(text: string): DailyCreationRoute | undefined {
  const rules: ReadonlyArray<{
    kind: DailyCreationRoute['kind']
    chinese: readonly string[]
    english: readonly string[]
  }> = [
    { kind: 'note', chinese: ['备忘录', '备忘'], english: ['memo'] },
    { kind: 'ledger', chinese: ['账单', '账本', '保险', '保费', '水费', '电费', '燃气费'], english: ['bill', 'insurance', 'premium'] },
    { kind: 'calendar', chinese: ['日历'], english: ['calendar'] },
    { kind: 'urgent', chinese: ['紧急'], english: ['urgent'] },
    { kind: 'important', chinese: ['重要'], english: ['important'] },
    { kind: 'today', chinese: ['今日', '待办'], english: ['today', 'todo'] },
  ]
  for (const rule of rules) {
    const chinese = rule.chinese.find(keyword => text.includes(keyword))
    if (chinese !== undefined) return { kind: rule.kind, keyword: chinese }
    const english = rule.english.find(keyword => containsEnglishKeyword(text, keyword))
    if (english !== undefined) return { kind: rule.kind, keyword: english }
  }
  return undefined
}

function containsEnglishKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')
  return new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`, 'iu').test(text)
}

function expectedDailyAction(kind: DailyCreationRoute['kind']): string {
  switch (kind) {
    case 'note': return 'save_note'
    case 'ledger': return 'save_ledger_category or save_ledger_entry'
    case 'calendar': return 'save_calendar_item or import_calendar_items'
    case 'today':
    case 'urgent':
    case 'important': return 'save_todo'
  }
}

function dailyChange(
  state: TeacherWorkbenchState,
  action: typeof DAILY_ACTIONS[number],
  data: Record<string, unknown>,
  notificationTargets: readonly TeacherNotificationTarget[],
  route: DailyCreationRoute | undefined,
): StateChange {
  const now = Date.now()
  switch (action) {
    case 'save_todo': {
      const id = optionalText(data, 'id') as TeacherDailyTodoId | undefined
      const existing = id === undefined ? undefined : requireById(state.dailyTodos, id, 'daily todo')
      const createdId = id ?? randomUUID() as TeacherDailyTodoId
      const dueAt = optionalText(data, 'dueAt') ?? existing?.dueAt ?? ''
      const item: TeacherDailyTodo = {
        id: createdId,
        title: textField(data, 'title').trim(),
        dueAt,
        completed: optionalBoolean(data, 'completed') ?? existing?.completed ?? false,
        category: existing?.category ?? todoCategoryFromRoute(route),
        color: optionalEnum(data, 'color', ['red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'violet', 'pink'] as const) ?? existing?.color ?? 'blue',
        ...resolveAgentReminder(data, existing?.reminder, dueAt, now, notificationTargets),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return changed({ ...state, dailyTodos: upsert(state.dailyTodos, item) }, 'Saved daily todo', id === undefined ? [createdId] : [])
    }
    case 'delete_todo': {
      const id = textField(data, 'id') as TeacherDailyTodoId
      requireById(state.dailyTodos, id, 'daily todo')
      return changed({ ...state, dailyTodos: state.dailyTodos.filter(item => item.id !== id) }, 'Deleted daily todo')
    }
    case 'save_note': {
      const id = optionalText(data, 'id') as TeacherQuickNoteId | undefined
      const existing = id === undefined ? undefined : requireById(state.quickNotes, id, 'memo')
      const createdId = id ?? randomUUID() as TeacherQuickNoteId
      const remindAt = optionalText(data, 'remindAt') ?? existing?.remindAt ?? ''
      const item: TeacherQuickNote = {
        id: createdId,
        content: textField(data, 'content').trim(),
        ...(remindAt === '' ? {} : { remindAt }),
        ...resolveAgentReminder(data, existing?.reminder, remindAt, now, notificationTargets),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return changed({ ...state, quickNotes: upsert(state.quickNotes, item) }, 'Saved memo', id === undefined ? [createdId] : [])
    }
    case 'delete_note': {
      const id = textField(data, 'id') as TeacherQuickNoteId
      requireById(state.quickNotes, id, 'memo')
      return changed({ ...state, quickNotes: state.quickNotes.filter(item => item.id !== id) }, 'Deleted memo')
    }
    case 'save_ledger_category': {
      const id = optionalText(data, 'id') as TeacherLedgerCategoryId | undefined
      const existing = id === undefined ? undefined : requireById(state.ledgerCategories, id, 'ledger category')
      const createdId = id ?? randomUUID() as TeacherLedgerCategoryId
      const item: TeacherLedgerCategory = { id: createdId, name: textField(data, 'name').trim(), createdAt: existing?.createdAt ?? now }
      return changed({ ...state, ledgerCategories: upsert(state.ledgerCategories, item) }, 'Saved ledger category', id === undefined ? [createdId] : [])
    }
    case 'delete_ledger_category': {
      const id = textField(data, 'id') as TeacherLedgerCategoryId
      requireById(state.ledgerCategories, id, 'ledger category')
      return changed({
        ...state,
        ledgerCategories: state.ledgerCategories.filter(item => item.id !== id),
        ledgerEntries: state.ledgerEntries.filter(item => item.categoryId !== id),
      }, 'Deleted ledger category and its entries')
    }
    case 'save_ledger_entry': {
      const id = optionalText(data, 'id') as TeacherLedgerEntryId | undefined
      const existing = id === undefined ? undefined : requireById(state.ledgerEntries, id, 'ledger entry')
      const createdId = id ?? randomUUID() as TeacherLedgerEntryId
      const remindAt = optionalText(data, 'remindAt') ?? existing?.remindAt ?? ''
      const item: TeacherLedgerEntry = {
        id: createdId,
        categoryId: textField(data, 'categoryId') as TeacherLedgerCategoryId,
        description: textField(data, 'description').trim(),
        amountCents: integerField(data, 'amountCents'),
        occurredAt: textField(data, 'occurredAt'),
        ...(remindAt === '' ? {} : { remindAt }),
        ...resolveAgentReminder(data, existing?.reminder, remindAt, now, notificationTargets),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return changed({ ...state, ledgerEntries: upsert(state.ledgerEntries, item) }, 'Saved ledger entry', id === undefined ? [createdId] : [])
    }
    case 'delete_ledger_entry': {
      const id = textField(data, 'id') as TeacherLedgerEntryId
      requireById(state.ledgerEntries, id, 'ledger entry')
      return changed({ ...state, ledgerEntries: state.ledgerEntries.filter(item => item.id !== id) }, 'Deleted ledger entry')
    }
    case 'save_calendar_item': {
      const id = optionalText(data, 'id') as TeacherCalendarItemId | undefined
      const existing = id === undefined ? undefined : requireById(state.calendarItems, id, 'calendar item')
      const createdId = id ?? randomUUID() as TeacherCalendarItemId
      const date = textField(data, 'date')
      const time = optionalText(data, 'time') ?? ''
      const item: TeacherCalendarItem = {
        id: createdId,
        date,
        time,
        title: textField(data, 'title').trim(),
        details: optionalText(data, 'details')?.trim() ?? '',
        ...resolveAgentReminder(data, existing?.reminder, time === '' ? '' : `${date}T${time}`, now, notificationTargets),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return changed({ ...state, calendarItems: upsert(state.calendarItems, item) }, 'Saved calendar item', id === undefined ? [createdId] : [])
    }
    case 'delete_calendar_item': {
      const id = textField(data, 'id') as TeacherCalendarItemId
      requireById(state.calendarItems, id, 'calendar item')
      return changed({ ...state, calendarItems: state.calendarItems.filter(item => item.id !== id) }, 'Deleted calendar item')
    }
    case 'import_calendar_items': {
      const items = objectArray(data, 'items').map((input): TeacherCalendarItem => ({
        id: randomUUID() as TeacherCalendarItemId,
        date: textField(input, 'date'),
        time: optionalText(input, 'time') ?? '',
        title: textField(input, 'title').trim(),
        details: optionalText(input, 'details')?.trim() ?? '',
        createdAt: now,
        updatedAt: now,
      }))
      return changed(
        { ...state, calendarItems: [...state.calendarItems, ...items] },
        `Imported ${String(items.length)} calendar items`,
        items.map(item => item.id),
      )
    }
  }
}

function todoCategoryFromRoute(route: DailyCreationRoute | undefined): TeacherDailyTodo['category'] {
  if (route === undefined) throw new Error('a new daily todo requires a routing keyword in the current user request')
  if (route.kind === 'today' || route.kind === 'urgent' || route.kind === 'important') return route.kind
  throw new Error(`the current user request contains ${JSON.stringify(route.keyword)}; use ${expectedDailyAction(route.kind)} instead of save_todo`)
}

function timetableChange(
  state: TeacherWorkbenchState,
  action: typeof TIMETABLE_ACTIONS[number],
  data: Record<string, unknown>,
): StateChange {
  if (action === 'save_class') {
    const view = timetableView(data)
    const usage = timetableUsage(view)
    const id = optionalText(data, 'id') as TeacherClassId | undefined
    const createdId = id ?? randomUUID() as TeacherClassId
    const existing = id === undefined ? undefined : requireById(state.classes, id, 'class')
    if (existing !== undefined && existing.usage !== usage) throw timetableCatalogError(view)
    const item: TeacherClass = {
      id: createdId,
      usage,
      name: textField(data, 'name').trim(),
      grade: optionalText(data, 'grade')?.trim() ?? '',
      subject: optionalText(data, 'subject')?.trim() ?? '',
    }
    return {
      ...changed({ ...state, classes: upsert(state.classes, item) }, `Saved ${view} timetable class`, id === undefined ? [createdId] : []),
      timetableConfirmation: { view, classIds: [createdId], entryIds: [], deleted: false },
    }
  }
  if (action === 'delete_class') {
    const id = textField(data, 'id') as TeacherClassId
    const owner = requireById(state.classes, id, 'class')
    const view = timetableViewForClass(owner)
    const entryIds = state.timetableEntries.filter(item => item.classId === id).map(item => item.id)
    return {
      ...deleteClassChange(state, id),
      timetableConfirmation: { view, classIds: [id], entryIds, deleted: true },
    }
  }
  if (action === 'delete_entry') {
    const id = textField(data, 'id') as TeacherTimetableEntryId
    const entry = requireById(state.timetableEntries, id, 'timetable entry')
    const owner = requireById(state.classes, entry.classId, 'class')
    const view = timetableViewForClass(owner)
    return {
      ...changed({ ...state, timetableEntries: state.timetableEntries.filter(item => item.id !== id) }, `Deleted ${view} timetable entry`),
      timetableConfirmation: { view, classIds: [], entryIds: [id], deleted: true },
    }
  }
  const view = timetableView(data)
  const usage = timetableUsage(view)
  const rows = action === 'save_entry' ? [data] : objectArray(data, 'entries')
  const classes = [...state.classes]
  let entries = [...state.timetableEntries]
  const createdIds: string[] = []
  const affectedClassIds = new Set<TeacherClassId>()
  const affectedEntryIds: TeacherTimetableEntryId[] = []
  const importedSlots = new Set<string>()
  const now = Date.now()
  for (const row of rows) {
    const classId = optionalText(row, 'classId') as TeacherClassId | undefined
    let owner = classId === undefined ? undefined : requireById(classes, classId, 'class')
    if (owner !== undefined && owner.usage !== usage) throw timetableCatalogError(view)
    if (owner === undefined) {
      const name = textField(row, 'className').trim()
      owner = classes.find(item => item.usage === usage && normalized(item.name) === normalized(name))
      if (owner === undefined) {
        owner = { id: randomUUID() as TeacherClassId, usage, name, grade: optionalText(row, 'grade')?.trim() ?? '', subject: '' }
        classes.push(owner)
        createdIds.push(owner.id)
      }
    }
    affectedClassIds.add(owner.id)
    const kind = enumField(row, 'kind', ['lesson', 'morningStudy', 'eveningStudy'] as const)
    const weekday = integerField(row, 'weekday') as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const period = integerField(row, 'period')
    const slot = `${owner.id}\u0000${kind}\u0000${String(weekday)}\u0000${String(period)}`
    if (action === 'import_entries' && importedSlots.has(slot)) {
      throw new Error('timetable import contains a duplicate class, kind, weekday, and period slot; use one unique daily period ordinal for morning and afternoon rows')
    }
    importedSlots.add(slot)
    const requestedId = optionalText(row, 'id') as TeacherTimetableEntryId | undefined
    const existing = requestedId === undefined
      ? entries.find(item => item.classId === owner.id
        && item.kind === kind && item.weekday === weekday && item.period === period)
      : requireById(entries, requestedId, 'timetable entry')
    if (existing !== undefined && existing.classId !== owner.id) throw new Error('timetable entry belongs to another class')
    const entry: TeacherTimetableEntry = {
      id: existing?.id ?? randomUUID() as TeacherTimetableEntryId,
      classId: owner.id,
      kind,
      weekday,
      period,
      startTime: optionalText(row, 'startTime') ?? '',
      endTime: optionalText(row, 'endTime') ?? '',
      subject: textField(row, 'subject').trim(),
      teacherName: optionalText(row, 'teacherName')?.trim() ?? '',
      location: optionalText(row, 'location')?.trim() ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (existing === undefined) createdIds.push(entry.id)
    affectedEntryIds.push(entry.id)
    entries = entries.filter(item => !(item.classId === entry.classId && item.kind === entry.kind
      && item.weekday === entry.weekday && item.period === entry.period) || item.id === entry.id)
    entries = upsert(entries, entry)
  }
  return {
    ...changed(
      { ...state, classes, timetableEntries: entries },
      `${action === 'save_entry' ? 'Saved' : 'Imported'} ${String(affectedEntryIds.length)} ${view} timetable entries`,
      createdIds,
    ),
    timetableConfirmation: {
      view,
      classIds: [...affectedClassIds],
      entryIds: affectedEntryIds,
      deleted: false,
    },
  }
}

function timetableView(data: Record<string, unknown>): TimetableToolView {
  return enumField(data, 'view', ['week', 'grade'] as const)
}

function timetableUsage(view: TimetableToolView): 'timetable' | 'gradeTimetable' {
  return view === 'week' ? 'timetable' : 'gradeTimetable'
}

function timetableViewForClass(owner: TeacherClass): TimetableToolView {
  if (owner.usage === 'roster') throw new Error('class belongs to the student roster, not a timetable view')
  return owner.usage === 'timetable' ? 'week' : 'grade'
}

function timetableCatalogError(view: TimetableToolView): Error {
  return new Error(`class id belongs to the other timetable view; for ${view} omit classId and provide className to use its independent catalog`)
}

function rosterChange(state: TeacherWorkbenchState, action: typeof ROSTER_ACTIONS[number], data: Record<string, unknown>): StateChange {
  if (action === 'save_class') {
    const id = optionalText(data, 'id') as TeacherClassId | undefined
    const createdId = id ?? randomUUID() as TeacherClassId
    if (id !== undefined) requireById(state.classes, id, 'class')
    const year = optionalText(data, 'academicYear')?.trim()
    const item: TeacherClass = {
      id: createdId,
      usage: 'roster',
      ...(year === undefined || year === '' ? {} : { academicYear: year }),
      name: textField(data, 'name').trim(),
      grade: optionalText(data, 'grade')?.trim() ?? '',
      subject: optionalText(data, 'subject')?.trim() ?? '',
    }
    return changed({ ...state, classes: upsert(state.classes, item) }, 'Saved roster class', id === undefined ? [createdId] : [])
  }
  if (action === 'delete_class') return deleteClassChange(state, textField(data, 'id') as TeacherClassId)
  if (action === 'delete_student') {
    const id = textField(data, 'id') as TeacherStudentId
    requireById(state.students, id, 'student')
    return changed({
      ...state,
      students: state.students.filter(item => item.id !== id),
      exams: state.exams.map(exam => ({ ...exam, entries: exam.entries.filter(entry => entry.studentId !== id) })),
      questionFolders: state.questionFolders.filter(item => item.studentId !== id),
      questionAssignments: state.questionAssignments.filter(item => item.studentId !== id),
      seatingLayouts: state.seatingLayouts.map(layout => ({ ...layout, slots: layout.slots.map(value => value === id ? null : value) })),
    }, 'Deleted student')
  }
  const classId = textField(data, 'classId') as TeacherClassId
  const owner = requireById(state.classes, classId, 'class')
  if (owner.usage !== 'roster') throw new Error('student class must belong to the roster')
  const rows = action === 'save_student' ? [data] : objectArray(data, 'students')
  const students = [...state.students]
  const createdIds: string[] = []
  for (const row of rows) {
    const requestedId = optionalText(row, 'id') as TeacherStudentId | undefined
    const studentNumber = optionalText(row, 'studentNumber')?.trim() ?? ''
    const name = textField(row, 'name').trim()
    const existingIndex = requestedId === undefined
      ? students.findIndex(item => item.classId === classId && (studentNumber !== '' ? item.studentNumber === studentNumber : item.name === name))
      : students.findIndex(item => item.id === requestedId)
    if (requestedId !== undefined && existingIndex < 0) throw new Error('student not found')
    const existing = existingIndex < 0 ? undefined : students[existingIndex]
    const id = existing?.id ?? randomUUID() as TeacherStudentId
    const student: TeacherStudent = {
      id,
      classId,
      name,
      studentNumber,
      gender: optionalText(row, 'gender')?.trim() ?? '',
      guardian: optionalText(row, 'guardian')?.trim() ?? '',
      relation: optionalText(row, 'relation')?.trim() ?? '',
      phone: optionalText(row, 'phone')?.trim() ?? '',
      address: optionalText(row, 'address')?.trim() ?? '',
      extras: stringRecord(row.extras),
    }
    if (existingIndex < 0) {
      students.push(student)
      createdIds.push(id)
    } else students[existingIndex] = student
  }
  return changed({ ...state, students }, `${action === 'save_student' ? 'Saved' : 'Imported'} ${String(rows.length)} students`, createdIds)
}

function scoreChange(state: TeacherWorkbenchState, action: typeof SCORE_ACTIONS[number], data: Record<string, unknown>): StateChange {
  if (action === 'delete_exam') {
    const id = textField(data, 'id') as TeacherExamId
    requireById(state.exams, id, 'exam')
    return changed({ ...state, exams: state.exams.filter(item => item.id !== id) }, 'Deleted exam')
  }
  const classId = textField(data, 'classId') as TeacherClassId
  const owner = requireById(state.classes, classId, 'class')
  if (owner.usage !== 'roster') throw new Error('exam class must belong to the roster')
  const entries: TeacherExamEntry[] = objectArray(data, 'entries').map((row) => {
    const studentId = resolveStudent(state.students, classId, row)
    const scores = numberRecord(row.scores)
    return { studentId, scores }
  })
  const requestedId = optionalText(data, 'id') as TeacherExamId | undefined
  if (requestedId !== undefined) requireById(state.exams, requestedId, 'exam')
  const id = requestedId ?? randomUUID() as TeacherExamId
  const exam: TeacherExam = {
    id,
    classId,
    name: textField(data, 'name').trim(),
    date: optionalText(data, 'date') ?? '',
    entries,
  }
  return changed({ ...state, exams: upsert(state.exams, exam) }, 'Saved exam scores', requestedId === undefined ? [id] : [])
}

function questionStateChange(state: TeacherWorkbenchState, action: 'create_folder' | 'delete_folder', data: Record<string, unknown>): StateChange {
  if (action === 'create_folder') {
    const id = randomUUID() as TeacherQuestionFolderId
    const folder: TeacherQuestionFolder = {
      id,
      studentId: textField(data, 'studentId') as TeacherStudentId,
      ...optionalText(data, 'parentId') === undefined ? {} : { parentId: optionalText(data, 'parentId') as TeacherQuestionFolderId },
      name: textField(data, 'name').trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return changed({ ...state, questionFolders: [...state.questionFolders, folder] }, 'Created question folder', [id])
  }
  const id = textField(data, 'id') as TeacherQuestionFolderId
  requireById(state.questionFolders, id, 'question folder')
  const removed = new Set<TeacherQuestionFolderId>([id])
  let changedSet = true
  while (changedSet) {
    changedSet = false
    for (const folder of state.questionFolders) {
      if (folder.parentId !== undefined && removed.has(folder.parentId) && !removed.has(folder.id)) {
        removed.add(folder.id)
        changedSet = true
      }
    }
  }
  return changed({
    ...state,
    questionFolders: state.questionFolders.filter(item => !removed.has(item.id)),
    questionAssignments: state.questionAssignments.filter(item => item.folderId === undefined || !removed.has(item.folderId)),
  }, 'Deleted question folder tree')
}

function questionFolderAction(action: typeof QUESTION_ACTIONS[number]): 'create_folder' | 'delete_folder' {
  if (action === 'create_folder' || action === 'delete_folder') return action
  throw new Error(`unsupported question action: ${action}`)
}

function deleteClassChange(state: TeacherWorkbenchState, id: TeacherClassId): StateChange {
  requireById(state.classes, id, 'class')
  const removedStudents = new Set(state.students.filter(item => item.classId === id).map(item => item.id))
  return changed({
    ...state,
    classes: state.classes.filter(item => item.id !== id),
    students: state.students.filter(item => item.classId !== id),
    timetableEntries: state.timetableEntries.filter(item => item.classId !== id),
    exams: state.exams.filter(item => item.classId !== id).map(item => ({
      ...item,
      entries: item.entries.filter(entry => !removedStudents.has(entry.studentId)),
    })),
    questionFolders: state.questionFolders.filter(item => !removedStudents.has(item.studentId)),
    questionAssignments: state.questionAssignments.filter(item => !removedStudents.has(item.studentId)),
    seatingLayouts: state.seatingLayouts.filter(item => item.classId !== id),
  }, 'Deleted class and dependent records')
}

function resolveStudent(
  students: readonly TeacherStudent[],
  classId: TeacherClassId,
  data: Record<string, unknown>,
): TeacherStudentId {
  const id = optionalText(data, 'studentId')
  const number = optionalText(data, 'studentNumber')
  const name = optionalText(data, 'studentName')
  const matches = students.filter(student => student.classId === classId && (
    id !== undefined
      ? student.id === id
      : number !== undefined
        ? student.studentNumber === number
        : name !== undefined && student.name === name
  ))
  if (matches.length !== 1) throw new Error('score entry must resolve to exactly one student in the class')
  const student = matches[0]
  if (student === undefined) throw new Error('score entry must resolve to exactly one student in the class')
  return student.id
}

function changed(state: TeacherWorkbenchState, summary: string, createdIds: readonly string[] = []): StateChange {
  return { state, summary, createdIds }
}

function upsert<T extends { readonly id: string }>(rows: readonly T[], item: T): T[] {
  const index = rows.findIndex(row => row.id === item.id)
  if (index < 0) return [...rows, item]
  const next = [...rows]
  next[index] = item
  return next
}

function requireById<T extends { readonly id: string }>(rows: readonly T[], id: string, label: string): T {
  const found = rows.find(row => row.id === id)
  if (found === undefined) throw new Error(`${label} not found: ${id}`)
  return found
}

function textField(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} must be a non-empty string`)
  return value
}

function optionalText(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function optionalBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function integerField(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  if (!Number.isSafeInteger(value)) throw new Error(`${key} must be an integer`)
  return value as number
}

function optionalNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return value
}

function enumNumberField<const T extends readonly number[]>(data: Record<string, unknown>, key: string, values: T): T[number] {
  const value = integerField(data, key)
  if (!values.includes(value)) throw new Error(`${key} must be one of ${values.join(', ')}`)
  return value
}

function enumField<const T extends readonly string[]>(data: Record<string, unknown>, key: string, values: T): T[number] {
  const value = textField(data, key)
  if (!values.includes(value)) throw new Error(`${key} must be one of ${values.join(', ')}`)
  return value
}

function optionalEnum<const T extends readonly string[]>(data: Record<string, unknown>, key: string, values: T): T[number] | undefined {
  return optionalText(data, key) === undefined ? undefined : enumField(data, key, values)
}

function objectArray(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = data[key]
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`)
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`${key}[${String(index)}] must be an object`)
    return item as Record<string, unknown>
  })
}

function textArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${key} must be an array of non-empty strings`)
  }
  return value as string[]
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('extras must be an object of strings')
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'string')) throw new Error('extras must be an object of strings')
  return Object.fromEntries(entries)
}

function numberRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('scores must be an object of non-negative numbers')
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.some(([key, item]) => key.trim() === '' || typeof item !== 'number' || !Number.isFinite(item) || item < 0)) {
    throw new Error('scores must be a non-empty object of non-negative numbers')
  }
  return Object.fromEntries(entries)
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function questionTarget(data: Record<string, unknown>) {
  return {
    kind: enumField(data, 'kind', ['batch', 'assignment'] as const),
    id: textField(data, 'id') as never,
  }
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
