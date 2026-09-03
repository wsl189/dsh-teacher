/** Agent-loop question-boundary detection over provider-neutral OCR geometry. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import {
  COMPACT_QUESTION_CROP_REPAIR_PERSONA,
  COMPACT_QUESTION_CROP_REVIEW_PERSONA,
  COMPACT_QUESTION_SEGMENTATION_PERSONA,
  QUESTION_CROP_REVIEW_SKILL,
  QUESTION_SEGMENTATION_SKILL,
} from './question-segmentation-skill.ts'
import {
  QuestionSegmentationReasoningError,
  questionSegmentationToolSelection,
} from './tool-agent-model.ts'
import type {
  TeacherQuestionLayoutElement,
  TeacherQuestionLayoutElementId,
  TeacherQuestionLayoutPage,
  TeacherQuestionCropReviewRequest,
  TeacherQuestionCropReviewResult,
  TeacherQuestionImageUpload,
  TeacherQuestionPageRegion,
  TeacherQuestionPagePreview,
  TeacherQuestionSegmentErrorCode,
  TeacherQuestionSegmentRejected,
  TeacherQuestionSegmentRequest,
  TeacherSegmentedQuestion,
} from './types.ts'

/** Deployment tunables for one semantic question-segmentation run. */
export interface TeacherQuestionSegmentationAgentConfig {
  /** Maximum selected pages admitted to one run. */
  maxQuestionLayoutPages: number
  /** Maximum OCR elements admitted to one run. */
  maxQuestionLayoutElements: number
  /** Maximum serialized OCR characters returned by one source-tool call. */
  maxQuestionSourceChunkCharacters: number
  /** Maximum complete OCR characters placed directly in one compact boundary request. */
  maxQuestionCompactBoundaryCharacters: number
  /** Whether eligible OCR source and visual-review sheets travel directly in their respective child requests. */
  questionSegmentationInlineEvidence: boolean
  /** Maximum model output tokens for one compact OCR boundary child. */
  maxQuestionCompactBoundaryOutputTokens: number
  /** Maximum model output tokens for one compact visual review or repair child. */
  maxQuestionCompactReviewOutputTokens: number
  /** Maximum questions accepted from one run. */
  maxSegmentedQuestions: number
  /** Maximum complete boundary drafts admitted to one run. */
  maxQuestionBoundarySubmissions: number
  /** Maximum fresh child runs used to obtain one accepted result in each boundary or crop-review stage. */
  maxQuestionBoundaryAgentRuns: number
  /** Maximum identical rejected tool results admitted before the current child is stopped and safe output is retained. */
  maxQuestionRejectedToolCalls: number
  /** Maximum page-height gap between automatically owned elements before explicit attachment is required. */
  maxQuestionAutoOwnedGapRatio: number
  /** Minimum distinct pages that establish a repeated-position image as page furniture. */
  minQuestionRepeatedImagePages: number
  /** Maximum normalized coordinate drift when matching repeated-position image furniture. */
  questionRepeatedImagePositionToleranceRatio: number
  /** Maximum page or crop images returned by one image-tool call. */
  maxQuestionVisionImagesPerToolCall: number
  /** Whether boundary, visual-review, and repair children use an enabled reasoning effort. */
  questionSegmentationReasoningEnabled: boolean
  /** Wall-clock deadline for one segmentation child, or zero for no child deadline. */
  questionSegmentationAgentTimeoutMs: number
}

/** Result of one bounded semantic child before page-group metadata is attached. */
export type TeacherQuestionSegmentationAgentResult = TeacherQuestionSegmentRejected | {
  /** Success discriminant. */
  readonly ok: true
  /** Questions validated within this bounded source window. */
  readonly value: { readonly questions: readonly TeacherSegmentedQuestion[] }
}

interface IndexedElement {
  readonly id: TeacherQuestionLayoutElementId
  readonly ordinal: number
  readonly page: TeacherQuestionLayoutPage
  readonly element: TeacherQuestionLayoutElement
}

function runToolSuffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12)
}

interface BoundaryDraft {
  readonly headConvention: string
  readonly questions: readonly {
    readonly headElementId: string
    readonly stopBeforeElementId?: string
    readonly additionalElementIds?: readonly string[]
    readonly verticalRegionEdits?: readonly VerticalRegionEdit[]
    readonly sourceRightLimitEdits?: readonly SourceRightLimitEdit[]
  }[]
  readonly nonQuestionHeadElementIds?: readonly string[]
  readonly outsideBoundaryElementIds?: readonly string[]
  readonly retainedImageElementIds?: readonly string[]
  readonly excludedElementIds?: readonly string[]
  readonly stopBeforeElementId?: string
}

interface VerticalRegionEdit {
  readonly pageIndex: number
  readonly top?: number
  readonly bottom?: number
}

interface SourceRightLimitEdit {
  readonly pageIndex: number
  readonly rightLimit: number
}

interface AcceptedBoundaryDraft {
  readonly token: string
  readonly questions: readonly TeacherSegmentedQuestion[]
}

interface AcceptedCropReview {
  readonly token: string
  readonly decision: 'accepted' | 'revised' | 'unresolved'
  readonly affectedQuestionIds: readonly TeacherQuestionLayoutElementId[]
  readonly questions: readonly TeacherSegmentedQuestion[]
}

const cropRepairIntents = [
  'expand-top',
  'trim-top',
  'expand-bottom',
  'trim-bottom',
  'trim-right',
  'reassign-content',
  'remove-crop',
] as const

type CropRepairIntent = typeof cropRepairIntents[number]

interface CropReviewFinding {
  readonly cropId?: string
  readonly pageId?: string
  readonly missingQuestionHead?: string
  readonly repairIntents?: readonly CropRepairIntent[]
  readonly issue: string
  readonly evidence: string
  readonly outsideCropEvidence?: string
  readonly insideCropEvidence?: string
}

interface CropReviewVerification {
  readonly answerDemand: string
  readonly evidence: string
  readonly topmostVisibleContent: string
  readonly bottommostVisibleContent: string
  readonly leftmostVisibleContent: string
  readonly rightmostVisibleContent: string
  readonly requiredVisuals: string
  readonly attentionEvidence?: string
}

interface CompactCropReviewVerification {
  readonly cropId: string
  readonly answerDemand: string
  readonly evidence: string
}

interface CropReviewAttention {
  readonly cropId: string
  readonly flags: readonly string[]
}

interface CropReviewState {
  findings?: readonly CropReviewFinding[]
  findingSubmissions: number
  revisionSubmissions: number
  readonly draftFindings: Map<string, CropReviewFinding>
  readonly draftVerifications: Map<string, CropReviewVerification>
  readonly seenRevisionDrafts: Set<string>
}

function recordedCropReviewFindings(state: CropReviewState): readonly CropReviewFinding[] {
  return state.findings ?? []
}

function cropReviewFindingKey(finding: CropReviewFinding): string {
  return finding.cropId === undefined
    ? `missing:${finding.pageId ?? ''}:${finding.missingQuestionHead ?? ''}`
    : `crop:${finding.cropId}`
}

function cropReviewRepairTargetIds(state: CropReviewState): readonly string[] {
  return [...new Set(recordedCropReviewFindings(state).flatMap(finding => (
    finding.cropId === undefined
      ? finding.pageId === undefined ? [] : [finding.pageId]
      : [finding.cropId]
  )))]
}

interface BoundarySubmissionState {
  submissions: number
  readonly seenDrafts: Set<string>
}

interface RejectedToolCallBudget {
  readonly callsByResult: Map<string, number>
  readonly maxCalls: number
  exhausted: boolean
}

function withRejectedToolCallBudget(
  tool: ToolDefinition,
  budget: RejectedToolCallBudget,
): ToolDefinition {
  return {
    ...tool,
    async execute(args, exec) {
      const value = await tool.execute(args, exec)
      if (typeof value !== 'string' || !value.startsWith('REJECTED')) return value
      const calls = (budget.callsByResult.get(value) ?? 0) + 1
      budget.callsByResult.set(value, calls)
      if (calls < budget.maxCalls) return value
      budget.exhausted = true
      exec.concludeTurn()
      return `${value}\nREJECTION_BUDGET_EXHAUSTED\nThe Host stopped this child after ${String(calls)} identical rejected tool results.`
    },
  }
}

interface BoundaryValidation {
  readonly errors: readonly string[]
  readonly referenceErrors: readonly string[]
  readonly questions?: readonly TeacherSegmentedQuestion[]
}

interface SelectedQuestion {
  readonly head: IndexedElement
  readonly end?: IndexedElement
  readonly additional: readonly IndexedElement[]
  readonly verticalRegionEdits: readonly VerticalRegionEdit[]
  readonly sourceRightLimitEdits: readonly SourceRightLimitEdit[]
}

interface VisionImageSource {
  readonly id: string
  readonly label: string
  readonly mediaType: ImageMediaType
  readonly contentBase64: string
}

interface VisionImageValue {
  readonly images: readonly {
    readonly id: string
    readonly label: string
    readonly attachmentId: string
    readonly mediaType: ImageMediaType
    readonly bytes: number
    readonly width: number
    readonly height: number
    readonly name?: string
    readonly originalDimensions?: { readonly width: number; readonly height: number }
  }[]
}

class QuestionSegmentationVisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuestionSegmentationVisionError'
  }
}

interface QuestionChildDeadline {
  readonly signal: AbortSignal
  readonly expired: boolean
  renew(): void
  dispose(): void
}

function createQuestionChildDeadline(timeoutMs: number, timeoutMessage: string): QuestionChildDeadline {
  if (timeoutMs === 0) {
    let controller = new AbortController()
    return {
      get signal() {
        return controller.signal
      },
      get expired() {
        return false
      },
      renew() {
        controller = new AbortController()
      },
      dispose() {
        return undefined
      },
    }
  }
  const arm = (controller: AbortController): ReturnType<typeof setTimeout> => setTimeout(() => {
    controller.abort(new Error(timeoutMessage))
  }, timeoutMs)
  let controller = new AbortController()
  let timeout = arm(controller)
  return {
    get signal() {
      return controller.signal
    },
    get expired() {
      return controller.signal.aborted
    },
    renew() {
      clearTimeout(timeout)
      controller = new AbortController()
      timeout = arm(controller)
    },
    dispose() {
      clearTimeout(timeout)
    },
  }
}

const answerHeadingPattern = /^\s*(?:.{0,80}(?:试卷|作业|练习)\s*)?(?:参考)?答案(?:与解析|及解析|及评分标准|与评分标准)?\s*[:：]?\s*$/u
const answerOrExplanationBlockPattern = new RegExp([
  '^\\s*(?:',
  '[\\[【(（]\\s*(?:参考)?(?:答案|解析|解答|点评|解|分析|思路|评注)(?:与解析|及解析)?\\s*[\\]】)）]',
  '|(?:参考)?(?:答案|解析|解答|点评|解|分析|思路|评注)\\s*[:：])\\s*(?:\\S|$)',
].join(''), 'u')
const sectionHeadingPattern = new RegExp([
  '^\\s*(?:',
  '[一二三四五六七八九十]+\\s*[、.．]\\s*(?:(?:单项|多项)?选择|填空|解答|计算|证明|判断|作图|应用)',
  '|[0-9０-９]+(?:\\s*[.．]\\s*[0-9０-９]+){2,}\\s*\\S',
  '|(?:题型|微?专题|考点|题组)\\s*(?:[0-9０-９一二三四五六七八九十百]+(?:\\s|[:：、.．]|$)|[^\\s:：、.．].{0,40}$)',
  '|第\\s*[0-9０-９一二三四五六七八九十百]+\\s*(?:章|节|单元)(?:\\s|[:：、.．]|$)',
  '|(?:方向|类型|策略)\\s*[0-9０-９一二三四五六七八九十百]+\\s*(?:[:：、.．]|$)',
  '|(?:基本原理|典例分析|知识梳理|方法总结)\\s*$',
  '|(?:习题演练|巩固练习|课后练习|随堂练习|课堂练习|同步练习|针对训练|基础训练|综合训练|专项训练|即时训练|拓展训练|能力提升|实战演练|达标训练)\\s*$',
  '|(?:part|section)\\s+[A-Z0-9]+',
  ')',
].join(''), 'iu')
const numberedTheoryHeadingPattern = new RegExp([
  '^\\s*(?:[0-9０-９]\\s*)+[.．、]\\s*.{0,100}?',
  '(?:定义|求法|方法|定理|性质|公式|原理|概念|步骤|技巧|事实|结论|规律|应用)',
  '(?:\\s*(?:与|及|和|、)\\s*(?:定义|求法|方法|定理|性质|公式|原理|概念|步骤|技巧|事实|结论|规律|应用))*\\s*[:：]?',
  '(?:\\s*(?:[0-9０-９]\\s*)+[.．、].{0,100}',
  '(?:定义|求法|方法|定理|性质|公式|原理|概念|步骤|技巧|事实|结论|规律|应用)',
  '(?:\\s*(?:与|及|和|、)\\s*(?:定义|求法|方法|定理|性质|公式|原理|概念|步骤|技巧|事实|结论|规律|应用))*\\s*[:：]?)?\\s*$',
].join(''), 'u')
const definitionStatementPattern = /(?:是指|称为|称之为|称其为|叫[做作]|定义为|就说)/u
const documentTitlePattern = /(?:试卷|作业|练习|测验|考试|供题|年级|学校|届|模拟)|\b(?:exam|test|worksheet|paper)\b/iu
const documentAnswerSectionHeadingPattern = /(?:参考\s*答案|答案\s*(?:与解析|及解析|及评分标准|与评分标准))/u
const learnerDocumentInstructionPattern = /(?:注意事项|答题前|本卷共|全卷满分|考试时间|请将答案|请在答题)/u
const questionNumberPattern = '[0-9０-９一二三四五六七八九十百]+'
const exampleQuestionLabelPattern = '(?:(?:例题?|示例|引例)(?:\\s*变式)?|变式)'
const taggedQuestionLabelPattern = [
  `题\\s*${questionNumberPattern}(?:\\s*变式(?:\\s*${questionNumberPattern})?)?`,
  `${exampleQuestionLabelPattern}\\s*(?:${questionNumberPattern})?`,
].join('|')
const taggedQuestionHeadPattern = new RegExp(
  `^\\s*(?:[\\[［【「『(（]\\s*(?:${taggedQuestionLabelPattern})|(?:${taggedQuestionLabelPattern})(?=\\s*(?:[\\]］】」』)）]|[（(:：]|$))|${exampleQuestionLabelPattern}\\s*${questionNumberPattern}|第\\s*${questionNumberPattern}\\s*题(?=\\s*(?:[（(:：、.．]|$)))`,
  'u',
)
const numberedQuestionHeadPattern = /^\s*(?:[0-9０-９]\s*)+[.．、](?!\s*[0-9０-９]\s*[.．])(?:\s*\S|\s*$)/u
const explicitAnswerDemandPattern = new RegExp([
  '(?:[?？]|[（(]\\s*[）)]|_{2,})',
  '|(?:求证|证明|求|计算|判断|解答|作图)\\s*[:：]',
  '|(?:分别|各自|依次)求(?:出|得)?',
  '|(?:^|[\\s，,。；;：:）)])(?:求(?!法)|求证|证明(?!方法|思路|步骤)|判断(?:下列|命题|结论|说法|正误|是否)|选择(?:正确|错误|合适|适当)|填空|作图|解答|计算(?!方法|公式|步骤)|写出|指出|回答|完成|比较(?!方法)|化简(?!方法)|解(?:方程|不等式))',
  '|(?:下列|以上).{0,40}(?:正确|错误).{0,12}(?:是|有)',
  '|(?:满足|符合)[\\s\\S]{0,120}(?:图形|选项|结论|说法)(?:有|为|是)\\s*$',
  '|(?:值为|结果为|答案为|等于|和为|序号是)\\s*(?:[,，;；]|$)',
  '|共(?:出现|有)\\s*[,，;；]?\\s*次',
  '|(?:最大值|最小值|取值范围|解析式|定义域|值域|单调区间|递增区间|递减区间|解集|概率|面积|体积|长度|长|大小|角度|余弦值|正弦值|坐标|方程|表达式|结果|比值|条数|个数|数量).{0,16}(?:为|是)\\s*(?:[（(]\\s*[）)]|[?？]|[=＝]|[。.]?\\s*$)',
  '|(?:有|共有|恰有|有且仅有)[^0-9０-９一二三四五六七八九十百]{0,8}(?:个|条|种|组|项)\\s*[。.]?\\s*$',
  '|则[\\s\\S]{0,300}[=＝]\\s*[。.]?\\s*$',
  '|(?:^|\\s)[A-DＡ-Ｄ][.．、]\\s*\\S',
].join(''), 'u')
const bracketedReferenceLabelPattern = /^\s*[\[［【「『]\s*(?:题|例题|引例|变式)[^\]］】」』]{0,40}[\]］】」』]\s*(.*)$/u
const parenthesizedReferencePattern = /^(?:[（(][^()（）]*[）)]\s*)+$/u
const bibliographicReferencePattern = /(?:[12][0-9]{3}|[１２][０-９]{3}|人教|课标|高考|联考|模拟|教材|教辅|版本|版|页|习题|练习|例题|题变式|P\s*[0-9０-９]+)/iu
const uncertainVisualFindingPattern = /(?:\b(?:may|might|could|possibly|potential|potentially|uncertain|suspected)\b|可能|疑似|或许)/iu
const insideAnnotatedRegionPattern = new RegExp([
  '(?:\\b(?:inside|within)\\b.{0,80}\\b(?:magenta|annotated|source)\\b.{0,40}',
  '\\b(?:box|rectangle|region)\\b',
  '|\\b(?:magenta|annotated|source)\\b.{0,40}\\b(?:box|rectangle|region)\\b.{0,80}',
  '\\b(?:contains?|includes?|inside|within)\\b',
  '|(?:紫红|洋红|标注|源页).{0,24}(?:框|矩形|区域).{0,40}(?:内|包含|已有))',
].join(''), 'iu')
const explicitNonDefectFindingPattern = new RegExp([
  '(?:\\bno (?:defect|defective|unwanted|extraneous|missing)\\b.{0,40}\\b(?:pixel|content|visible)',
  '|\\balready correctly (?:excludes?|contains?|displays?|shows?)\\b',
  '|(?:没有|未见|无)(?:缺陷|多余|异常|遗漏)|已正确(?:排除|包含|显示))',
].join(''), 'iu')
const learnerFacingTrimEvidencePattern = new RegExp([
  '(?:\\bsubpart\\b|[（(]\\s*[1-9一二三四五六七八九十]\\s*[)）]',
  '|(?:附|提示)\\s*[:：_]|\\b(?:question|problem)\\s+(?:condition|stem)\\b|题干|已知条件|小问)',
].join(''), 'iu')
const missingRequiredContentFindingPattern = new RegExp([
  '(?:\\b(?:missing|omits?|omitted|absent|cut[- ]?off|not (?:inside|included|present))\\b',
  '|(?:缺少|缺失|遗漏|未包含|未进入|被切断|被截断))',
].join(''), 'iu')
const crossPageContinuationStartPattern = new RegExp([
  '^\\s*(?:',
  '[C-HＣ-Ｈ]\\s*[.．、:：)]',
  '|[（(]\\s*[2-9２-９]\\s*[)）]',
  '|[②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]',
  '|(?:接|续)(?:上|前)页',
  ')',
].join(''), 'u')
const localQuestionContinuationStartPattern = new RegExp([
  '^\\s*(?:',
  '[A-HＡ-Ｈ]\\s*[.．、:：)]',
  '|[（(]\\s*[1-9１-９]\\s*[)）]',
  '|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]',
  ')',
].join(''), 'u')
const subordinateQuestionFragmentPattern = /^\s*(?:[A-HＡ-Ｈ]\s*[.．、:：)]|[（(]\s*[1-9１-９一二三四五六七八九十]\s*[)）]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/u
const answerDemandedAsMissingPattern = new RegExp([
  '(?:missing|omits?|omitted|without|not (?:include|contain)|cut[- ]?off).{0,64}(?:answer(?!\\s+(?:line|blank|space|box|area))|solution|explanation)',
  '|(?:answer(?!\\s+(?:line|blank|space|box|area))|solution|explanation).{0,64}(?:missing|omitted|not (?:included|present)|cut[- ]?off)',
  '|(?:未包含|缺少|缺失|遗漏|未进入).{0,64}(?:答案|解析|解答)',
  '|(?:答案|解析|解答).{0,64}(?:未包含|缺少|缺失|遗漏|未进入|被切|截断)',
].join(''), 'iu')

function isSemanticTextElement(element: TeacherQuestionLayoutElement): boolean {
  return element.type === 'text'
    || element.type === 'equation'
    || (element.type === 'other' && element.text.trim() !== '')
}

function isNumberedTheoryHeading(text: string): boolean {
  return (numberedTheoryHeadingPattern.test(text)
      || (numberedQuestionHeadPattern.test(text)
        && definitionStatementPattern.test(text)
        && !explicitAnswerDemandPattern.test(text)))
    && !/(?:证明|计算|选择|填空|作图|解答|写出|指出|回答|完成)/u.test(text)
    && (!/求/u.test(text) || /(?:求法|方法)\s*[:：]?\s*$/u.test(text))
}

function isAnswerBoundaryElement(element: IndexedElement): boolean {
  return isSemanticTextElement(element.element)
    && (answerHeadingPattern.test(element.element.text)
      || answerOrExplanationBlockPattern.test(element.element.text))
}

function isSemanticBoundaryElement(element: IndexedElement): boolean {
  return isSemanticTextElement(element.element)
    && (sectionHeadingPattern.test(element.element.text)
      || isNumberedTheoryHeading(element.element.text)
      || isAnswerBoundaryElement(element))
}

function isAnswerCoverHeading(
  element: IndexedElement,
  elements: readonly IndexedElement[],
): boolean {
  if (!isSemanticTextElement(element.element)
    || !documentTitlePattern.test(element.element.text)
    || explicitAnswerDemandPattern.test(element.element.text)) return false
  const next = elements.find(candidate => (
    candidate.page === element.page
      && candidate.ordinal > element.ordinal
      && isSemanticTextElement(candidate.element)
      && candidate.element.text.trim() !== ''
  ))
  if (next === undefined || !isAnswerBoundaryElement(next)) return false
  const elementHeight = element.element.bbox[3] - element.element.bbox[1]
  const nextHeight = next.element.bbox[3] - next.element.bbox[1]
  return next.element.bbox[1] - element.element.bbox[3] <= 2 * Math.max(elementHeight, nextHeight)
}

function answerSectionElementIds(elements: readonly IndexedElement[]): ReadonlySet<string> {
  const elementIds = new Set<string>()
  let answerSectionStarted = false
  let previousPageIndex: number | undefined
  for (const element of elements) {
    if (element.page.pageIndex !== previousPageIndex) {
      if (previousPageIndex !== undefined && element.page.pageIndex !== previousPageIndex + 1) {
        answerSectionStarted = false
      } else if (answerSectionStarted) {
        const pageElements = elements.filter(candidate => candidate.page.pageIndex === element.page.pageIndex)
        const startsLearnerDocument = pageElements.some(candidate => (
          isSemanticTextElement(candidate.element)
            && documentTitlePattern.test(candidate.element.text)
            && !isAnswerCoverHeading(candidate, elements)
        )) && pageElements.some(candidate => (
          isSemanticTextElement(candidate.element)
            && learnerDocumentInstructionPattern.test(candidate.element.text)
        ))
        if (startsLearnerDocument) answerSectionStarted = false
      }
      previousPageIndex = element.page.pageIndex
    }
    if (isSemanticTextElement(element.element)
      && (documentAnswerSectionHeadingPattern.test(element.element.text)
        || isAnswerCoverHeading(element, elements))) {
      answerSectionStarted = true
    }
    if (answerSectionStarted) elementIds.add(element.id)
  }
  return elementIds
}

function answerSectionPageIndexes(elements: readonly IndexedElement[]): ReadonlySet<number> {
  const answerElementIds = answerSectionElementIds(elements)
  const pages = new Set<number>()
  for (const page of new Set(elements.map(element => element.page))) {
    const firstElement = elements.find(element => element.page === page)
    if (firstElement !== undefined && answerElementIds.has(firstElement.id)) {
      pages.add(page.pageIndex)
    }
  }
  return pages
}

function isContextualNumberedTheoryHeading(
  head: IndexedElement,
  elements: readonly IndexedElement[],
): boolean {
  if (!isSemanticTextElement(head.element)) return false
  if (isNumberedTheoryHeading(head.element.text)) return true
  if (!numberedQuestionHeadPattern.test(head.element.text)) return false
  const text = [head.element.text]
  for (const element of elements) {
    if (element.ordinal <= head.ordinal) continue
    if (isSemanticBoundaryElement(element) || isPossibleQuestionHead(element)) break
    if (!isSemanticTextElement(element.element)) continue
    text.push(element.element.text)
    if (text.join('\n').length >= 1_200) break
  }
  return isNumberedTheoryHeading(text.join('\n'))
}

function isContextualSemanticBoundaryElement(
  element: IndexedElement,
  elements: readonly IndexedElement[],
): boolean {
  return isSemanticBoundaryElement(element)
    || isAnswerCoverHeading(element, elements)
    || isContextualNumberedTheoryHeading(element, elements)
}

function isCitationOnlyQuestionHead(element: IndexedElement): boolean {
  if (!isSemanticTextElement(element.element)) return false
  const match = bracketedReferenceLabelPattern.exec(element.element.text)
  if (match === null) return false
  const suffix = match[1]?.trim() ?? ''
  return suffix === ''
    || (parenthesizedReferencePattern.test(suffix) && bibliographicReferencePattern.test(suffix))
}

function stopBeginsCrossPageContinuation(
  head: IndexedElement,
  stop: IndexedElement,
  elements: readonly IndexedElement[],
): boolean {
  return stop.page.pageIndex > head.page.pageIndex
    && !isContextualSemanticBoundaryElement(stop, elements)
    && (crossPageContinuationStartPattern.test(stop.element.text)
      || hasVisibleAnswerDemand(stop, elements))
}

function isPossibleQuestionHead(element: IndexedElement): boolean {
  return isSemanticTextElement(element.element)
    && (numberedQuestionHeadPattern.test(element.element.text)
      || taggedQuestionHeadPattern.test(element.element.text))
}

function possibleQuestionHeadIds(
  elements: readonly IndexedElement[],
  corePageIndexes?: ReadonlySet<number>,
): readonly TeacherQuestionLayoutElementId[] {
  const eligible = corePageIndexes === undefined
    ? elements
    : elements.filter(element => corePageIndexes.has(element.page.pageIndex))
  const ids: TeacherQuestionLayoutElementId[] = []
  let insideExplanation = false
  for (const element of eligible) {
    if (!isSemanticTextElement(element.element)) continue
    const text = element.element.text
    if (sectionHeadingPattern.test(text) || isContextualNumberedTheoryHeading(element, elements)) {
      insideExplanation = false
      continue
    }
    if (answerHeadingPattern.test(text) || answerOrExplanationBlockPattern.test(text)) {
      insideExplanation = true
      continue
    }
    if (taggedQuestionHeadPattern.test(text)) {
      insideExplanation = false
      ids.push(element.id)
      continue
    }
    if (!insideExplanation && numberedQuestionHeadPattern.test(text)) ids.push(element.id)
  }
  return ids
}

function hasVisibleAnswerDemand(head: IndexedElement, elements: readonly IndexedElement[]): boolean {
  const text: string[] = []
  for (const element of elements) {
    if (element.ordinal < head.ordinal) continue
    if (element.ordinal > head.ordinal
      && (isContextualSemanticBoundaryElement(element, elements) || isPossibleQuestionHead(element))) break
    if (!isSemanticTextElement(element.element)) continue
    text.push(element.element.text)
    if (text.join('\n').length >= 4_000) break
  }
  const joined = text.join('\n')
  const joinedCjkLines = joined.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
  return explicitAnswerDemandPattern.test(joined) || explicitAnswerDemandPattern.test(joinedCjkLines)
}

function protectedQuestionHeadIds(
  elements: readonly IndexedElement[],
  candidateIds: readonly TeacherQuestionLayoutElementId[],
): ReadonlySet<string> {
  const candidates = new Set(candidateIds as readonly string[])
  return new Set(elements.flatMap(element => (
    candidates.has(element.id as string) && hasVisibleAnswerDemand(element, elements)
      ? [element.id as string]
      : []
  )))
}

function splitLayoutElement(element: TeacherQuestionLayoutElement): readonly TeacherQuestionLayoutElement[] {
  if (!isSemanticTextElement(element)) return [element]
  const lines = element.text.split(/\r?\n/u)
  if (lines.length < 2) return [element]
  const starts = lines.flatMap((line, index) => (
    index > 0
      && (numberedQuestionHeadPattern.test(line)
        || taggedQuestionHeadPattern.test(line)
        || sectionHeadingPattern.test(line)
        || isNumberedTheoryHeading(line)
        || answerHeadingPattern.test(line)
        || answerOrExplanationBlockPattern.test(line))
      ? [index]
      : []
  ))
  if (starts.length === 0) return [element]
  const boundaries = [0, ...starts, lines.length]
  const [left, top, right, bottom] = element.bbox
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1] ?? lines.length
    return {
      ...element,
      text: lines.slice(start, end).join('\n'),
      bbox: [
        left,
        top + ((bottom - top) * start) / lines.length,
        right,
        top + ((bottom - top) * end) / lines.length,
      ],
    }
  })
}

/**
 * Count fallible question-head candidates for semantic page-group sizing.
 * @param page - One OCR page whose candidate density contributes to a batch limit.
 * @returns candidate count before any semantic classification by the child agent.
 */
export function countQuestionHeadCandidates(page: TeacherQuestionLayoutPage): number {
  return page.elements.flatMap(splitLayoutElement).filter(element => (
    isSemanticTextElement(element)
      && (numberedQuestionHeadPattern.test(element.text) || taggedQuestionHeadPattern.test(element.text))
  )).length
}

function imageElementIds(elements: readonly IndexedElement[], corePageIndexes?: ReadonlySet<number>): readonly string[] {
  return elements.flatMap(element => (
    element.element.type === 'image'
      && (corePageIndexes === undefined || corePageIndexes.has(element.page.pageIndex))
      ? [element.id as string]
      : []
  ))
}

function repeatedPositionImageIds(
  elements: readonly IndexedElement[],
  corePageIndexes: ReadonlySet<number> | undefined,
  minimumPages: number,
  positionToleranceRatio: number,
): ReadonlySet<string> {
  const images = elements.filter(element => (
    element.element.type === 'image'
      && (corePageIndexes === undefined || corePageIndexes.has(element.page.pageIndex))
  ))
  const normalized = new Map(images.map((image) => {
    const [left, top, right, bottom] = image.element.bbox
    return [image, [
      left / image.page.width,
      top / image.page.height,
      right / image.page.width,
      bottom / image.page.height,
    ] as const] as const
  }))
  return new Set(images.flatMap((image) => {
    const box = normalized.get(image)
    if (box === undefined) return []
    const matchingPages = new Set(images.flatMap((candidate) => {
      const candidateBox = normalized.get(candidate)
      return candidateBox !== undefined && candidateBox.every((coordinate, index) => (
        Math.abs(coordinate - (box[index] ?? coordinate)) <= positionToleranceRatio
      ))
        ? [candidate.page.pageIndex]
        : []
    }))
    return matchingPages.size >= minimumPages ? [image.id] : []
  }))
}

function rejected(code: TeacherQuestionSegmentErrorCode, message: string): TeacherQuestionSegmentRejected {
  return { ok: false, error: { code, message } }
}

function unresolvedCropReview(request: TeacherQuestionCropReviewRequest): TeacherQuestionCropReviewResult {
  return {
    ok: true,
    value: {
      decision: 'unresolved',
      affectedQuestionIds: request.reviewQuestionIds,
      questions: request.questions,
    },
  }
}

function validBox(
  bbox: readonly number[],
  page: Pick<TeacherQuestionLayoutPage, 'width' | 'height'>,
): bbox is readonly [number, number, number, number] {
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return false
  const [left, top, right, bottom] = bbox as readonly [number, number, number, number]
  return left >= 0
    && top >= 0
    && right > left
    && bottom > top
    && right <= page.width
    && bottom <= page.height
}

function validateRequest(
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): string | undefined {
  if (request.fileName.trim() === '') return 'fileName must not be empty'
  if (!Number.isFinite(request.padding) || request.padding < 0) return 'padding must be a non-negative finite number'
  if (!Number.isFinite(config.maxQuestionAutoOwnedGapRatio)
    || config.maxQuestionAutoOwnedGapRatio <= 0
    || config.maxQuestionAutoOwnedGapRatio > 1) {
    return 'maxQuestionAutoOwnedGapRatio must be greater than zero and at most one'
  }
  if (!Number.isSafeInteger(config.minQuestionRepeatedImagePages)
    || config.minQuestionRepeatedImagePages < 2) {
    return 'minQuestionRepeatedImagePages must be an integer of at least two'
  }
  if (!Number.isFinite(config.questionRepeatedImagePositionToleranceRatio)
    || config.questionRepeatedImagePositionToleranceRatio < 0
    || config.questionRepeatedImagePositionToleranceRatio > 0.25) {
    return 'questionRepeatedImagePositionToleranceRatio must be between zero and 0.25'
  }
  if (request.pages.length === 0) return 'at least one selected page is required'
  if (request.pages.length > config.maxQuestionLayoutPages) {
    return `selected layout exceeds ${String(config.maxQuestionLayoutPages)} pages`
  }
  let previousPage = -1
  let elements = 0
  for (const page of request.pages) {
    if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex <= previousPage) {
      return 'page indexes must be unique non-negative integers in source order'
    }
    if (!Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0) {
      return `page ${String(page.pageIndex + 1)} has invalid dimensions`
    }
    for (const element of page.elements) {
      if (!['text', 'equation', 'image', 'table', 'other'].includes(element.type)) {
        return `page ${String(page.pageIndex + 1)} contains an unsupported element type`
      }
      if (!validBox(element.bbox, page)) {
        return `page ${String(page.pageIndex + 1)} contains an invalid element box`
      }
    }
    elements += page.elements.flatMap(splitLayoutElement).length
    previousPage = page.pageIndex
  }
  if (elements === 0) return 'selected pages contain no OCR elements'
  if (elements > config.maxQuestionLayoutElements) {
    return `selected layout exceeds ${String(config.maxQuestionLayoutElements)} OCR elements`
  }
  if (request.corePageIndexes !== undefined) {
    const selectedPageIndexes = new Set(request.pages.map(page => page.pageIndex))
    if (request.corePageIndexes.length === 0
      || new Set(request.corePageIndexes).size !== request.corePageIndexes.length
      || request.corePageIndexes.some(pageIndex => !selectedPageIndexes.has(pageIndex))) {
      return 'corePageIndexes must be unique selected page indexes and must not be empty'
    }
  }
  if (request.answerSectionPageIndexes !== undefined) {
    const ownedPageIndexes = new Set(request.corePageIndexes ?? request.pages.map(page => page.pageIndex))
    if (new Set(request.answerSectionPageIndexes).size !== request.answerSectionPageIndexes.length
      || request.answerSectionPageIndexes.some(pageIndex => !ownedPageIndexes.has(pageIndex))) {
      return 'answerSectionPageIndexes must contain unique owned page indexes'
    }
  }
  const previews = request.pagePreviews
  if (previews === undefined) return undefined
  const expectedPages = new Set(request.pages.map(page => page.pageIndex))
  const previewPages = new Set<number>()
  for (const preview of previews) {
    if (!expectedPages.has(preview.pageIndex) || previewPages.has(preview.pageIndex)) {
      return 'page previews contain an unknown or duplicate page index'
    }
    if (!Number.isSafeInteger(preview.width) || preview.width < 1
      || !Number.isSafeInteger(preview.height) || preview.height < 1) {
      return `page ${String(preview.pageIndex + 1)} preview has invalid dimensions`
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(preview.mediaType)) {
      return `page ${String(preview.pageIndex + 1)} preview has an unsupported media type`
    }
    if (decodeCanonicalBase64(preview.contentBase64) === undefined) {
      return `page ${String(preview.pageIndex + 1)} preview is not canonical base64`
    }
    previewPages.add(preview.pageIndex)
  }
  return previewPages.size === expectedPages.size
    ? undefined
    : 'page previews must include every selected layout page exactly once'
}

function indexElements(pages: readonly TeacherQuestionLayoutPage[]): IndexedElement[] {
  let ordinal = 0
  return pages.flatMap((page, pageOffset) => page.elements.flatMap((element, elementOffset) => (
    splitLayoutElement(element).map((segment, segmentOffset) => ({
      id: `p${String(pageOffset)}e${String(elementOffset)}${segmentOffset === 0 ? '' : `-s${String(segmentOffset)}`}` as TeacherQuestionLayoutElementId,
      ordinal: ordinal++,
      page,
      element: segment,
    }))
  )))
}

/**
 * Identify selected source pages that belong to a document-level answer section.
 * @param pages - Ordered OCR pages, including any available adjacent context pages.
 * @returns Original PDF page indexes after an explicit answer-section transition.
 */
export function detectDocumentAnswerSectionPageIndexes(
  pages: readonly TeacherQuestionLayoutPage[],
): readonly number[] {
  return [...answerSectionPageIndexes(indexElements(pages))]
}

function sourceRecord(item: IndexedElement) {
  return {
    elementId: item.id,
    pageIndex: item.page.pageIndex,
    pageWidth: item.page.width,
    pageHeight: item.page.height,
    type: item.element.type,
    bbox: item.element.bbox,
    text: item.element.text,
  }
}

function compactSourceRecord(elements: readonly IndexedElement[]) {
  const pages = [...new Set(elements.map(element => element.page))]
  return {
    format: 'pages[].elements[] = [elementId,type,[left,top,right,bottom],text]',
    pages: pages.map(page => ({
      pageIndex: page.pageIndex,
      width: page.width,
      height: page.height,
      elements: elements.filter(element => element.page === page).map(element => [
        element.id,
        element.element.type,
        element.element.bbox,
        element.element.text,
      ]),
    })),
  }
}

function sourceChunks(elements: readonly IndexedElement[], maxCharacters: number): readonly (readonly IndexedElement[])[] {
  const chunks: IndexedElement[][] = []
  let current: IndexedElement[] = []
  let characters = 2
  for (const element of elements) {
    const length = JSON.stringify(sourceRecord(element)).length + (current.length === 0 ? 0 : 1)
    if (current.length > 0 && characters + length > maxCharacters) {
      chunks.push(current)
      current = []
      characters = 2
    }
    current.push(element)
    characters += length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function sourceTool(
  name: string,
  chunks: readonly (readonly IndexedElement[])[],
  inspected: Set<number>,
  unavailable?: () => string | undefined,
) {
  return defineTool({
    name,
    description: 'Inspect one bounded chunk of the selected OCR elements. Call every numbered chunk exactly once and copy opaque element IDs exactly.',
    parameters: { chunk: { type: 'integer', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      const unavailableReason = unavailable?.()
      if (unavailableReason !== undefined) return Promise.resolve(`REJECTED\n${unavailableReason}`)
      const elements = chunks[args.chunk]
      if (elements === undefined) return Promise.resolve(`REJECTED\nchunk must be from 0 through ${String(chunks.length - 1)}`)
      if (inspected.has(args.chunk)) return Promise.resolve('REJECTED\nthis source chunk was already inspected')
      inspected.add(args.chunk)
      return Promise.resolve(JSON.stringify({
        chunk: args.chunk,
        totalChunks: chunks.length,
        elements: elements.map(sourceRecord),
      }))
    },
  })
}

function cropReviewRepairElements(
  targetId: string,
  finding: CropReviewFinding,
  request: TeacherQuestionCropReviewRequest,
  elements: readonly IndexedElement[],
  cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId>,
): readonly IndexedElement[] {
  if (finding.cropId === undefined) return elements
  const questionId = cropQuestionIdByPreviewId.get(targetId)
  const question = request.questions.find(candidate => candidate.sourceHeadId === questionId)
  const head = elements.find(element => element.id === questionId)
  if (question === undefined || head === undefined) return []
  const intents = new Set(finding.repairIntents ?? [])
  const relevantPageIndexes = new Set(question.regions.map(region => region.pageIndex))
  const broadContentEvidence = intents.has('reassign-content')
  const selected = elements.filter((element) => {
    if (element === head) return true
    const boundaryLandmark = isPossibleQuestionHead(element)
      || isContextualSemanticBoundaryElement(element, elements)
    if (boundaryLandmark) return relevantPageIndexes.has(element.page.pageIndex)
    if (Math.abs(element.ordinal - head.ordinal) <= 4) return true
    const region = question.regions.find(candidate => candidate.pageIndex === element.page.pageIndex)
    if (region === undefined) {
      if (!broadContentEvidence || element.element.type !== 'image') return false
      return Math.abs(element.page.pageIndex - question.headPageIndex) <= 1
    }
    const horizontalOverlap = element.element.bbox[2] > region.left
      && element.element.bbox[0] < region.rightLimit
    if (!horizontalOverlap) return false
    const edgeDepth = Math.max(request.padding * 4, region.pageHeight * 0.08)
    const nearTop = element.element.bbox[3] > region.top - edgeDepth
      && element.element.bbox[1] < region.top + edgeDepth
    const nearBottom = element.element.bbox[3] > region.bottom - edgeDepth
      && element.element.bbox[1] < region.bottom + edgeDepth
    const nearRight = element.element.bbox[2] > region.rightLimit - edgeDepth
    const sampledImage = element.element.type === 'image'
      && boxesOverlap([region.left, region.top, region.rightLimit, region.bottom], element.element.bbox)
    return sampledImage
      || (broadContentEvidence
        && boxesOverlap([region.left, region.top, region.rightLimit, region.bottom], element.element.bbox))
      || ((intents.has('expand-top') || intents.has('trim-top')) && nearTop)
      || ((intents.has('expand-bottom') || intents.has('trim-bottom')) && nearBottom)
      || (intents.has('trim-right') && nearRight)
  })
  return selected.toSorted((left, right) => left.ordinal - right.ordinal)
}

function cropReviewRepairChunks(
  targetId: string,
  state: CropReviewState,
  request: TeacherQuestionCropReviewRequest,
  elements: readonly IndexedElement[],
  cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId>,
  maxCharacters: number,
): readonly (readonly IndexedElement[])[] {
  const finding = recordedCropReviewFindings(state).find(candidate => (
    candidate.cropId === targetId || (candidate.cropId === undefined && candidate.pageId === targetId)
  ))
  if (finding === undefined) return []
  return sourceChunks(
    cropReviewRepairElements(targetId, finding, request, elements, cropQuestionIdByPreviewId),
    Math.min(maxCharacters, 12_000),
  )
}

function cropReviewRepairContextTool(
  name: string,
  request: TeacherQuestionCropReviewRequest,
  elements: readonly IndexedElement[],
  cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId>,
  state: CropReviewState,
  inspected: Set<string>,
  maxCharacters: number,
) {
  return defineTool({
    name,
    description: 'Inspect bounded OCR geometry only for one recorded visual-defect target. Start with chunk 0, then call every remaining chunk reported by the result. Copy opaque element ids exactly.',
    parameters: {
      targetId: {
        type: 'string',
        description: 'Recorded crop or page repair target. It may be omitted only when the findings contain exactly one target.',
      },
      chunk: { type: 'integer', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      const validTargets = cropReviewRepairTargetIds(state)
      const targetId = args.targetId ?? (validTargets.length === 1 ? validTargets[0] : undefined)
      if (targetId === undefined || !validTargets.includes(targetId)) {
        return Promise.resolve(`REJECTED\ntargetId must be one of the recorded repair targets: ${validTargets.join(', ')}`)
      }
      const chunks = cropReviewRepairChunks(
        targetId,
        state,
        request,
        elements,
        cropQuestionIdByPreviewId,
        maxCharacters,
      )
      const chunk = chunks[args.chunk]
      if (chunk === undefined) {
        return Promise.resolve(`REJECTED\nchunk must be from 0 through ${String(chunks.length - 1)} for ${targetId}`)
      }
      const inspectionKey = `${targetId}:${String(args.chunk)}`
      if (inspected.has(inspectionKey)) return Promise.resolve('REJECTED\nthis repair-context chunk was already inspected')
      inspected.add(inspectionKey)
      const finding = recordedCropReviewFindings(state).find(candidate => (
        candidate.cropId === targetId || (candidate.cropId === undefined && candidate.pageId === targetId)
      ))
      const questionId = cropQuestionIdByPreviewId.get(targetId)
      const question = request.questions.find(candidate => candidate.sourceHeadId === questionId)
      return Promise.resolve(JSON.stringify({
        targetId,
        chunk: args.chunk,
        totalChunks: chunks.length,
        finding,
        ...(question === undefined ? {} : { currentQuestion: question }),
        elements: chunk.map(sourceRecord),
      }))
    },
  })
}

function cropReviewRepairEvidenceComplete(
  state: CropReviewState,
  request: TeacherQuestionCropReviewRequest,
  elements: readonly IndexedElement[],
  cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId>,
  inspected: ReadonlySet<string>,
  maxCharacters: number,
): boolean {
  const targetIds = cropReviewRepairTargetIds(state)
  return targetIds.length > 0 && targetIds.every(targetId => (
    cropReviewRepairChunks(
      targetId,
      state,
      request,
      elements,
      cropQuestionIdByPreviewId,
      maxCharacters,
    ).every((_chunk, index) => inspected.has(`${targetId}:${String(index)}`))
  ))
}

function decodeCanonicalBase64(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 4 !== 0) return undefined
  const bytes = Buffer.from(value, 'base64')
  return bytes.byteLength > 0 && bytes.toString('base64') === value ? bytes : undefined
}

function pagePreviewSources(previews: readonly TeacherQuestionPagePreview[]): readonly VisionImageSource[] {
  return previews.map(preview => ({
    id: `page-${String(preview.pageIndex + 1)}`,
    label: `source PDF page ${String(preview.pageIndex + 1)}`,
    mediaType: preview.mediaType,
    contentBase64: preview.contentBase64,
  }))
}

function cropPreviewSources(
  crops: readonly TeacherQuestionImageUpload[],
  questions: readonly TeacherSegmentedQuestion[],
  elements: readonly IndexedElement[],
): readonly VisionImageSource[] {
  const questionByNumber = new Map(questions.map(question => [question.questionNo, question] as const))
  const headById = new Map(elements.map(element => [element.id as string, element] as const))
  return crops.map((crop) => {
    const question = questionByNumber.get(crop.questionNo)
    if (question === undefined) throw new Error(`crop ${String(crop.questionNo)} has no question boundary`)
    const headText = headById.get(question.sourceHeadId)?.element.text.trim().slice(0, 160) ?? ''
    return {
      id: `crop-${String(question.sourceHeadId)}`,
      label: `crop for head ${String(question.sourceHeadId)} (${String(crop.width)}x${String(crop.height)} pixels); blank white right padding is intentional; OCR head text: ${JSON.stringify(headText)}`,
      mediaType: crop.mediaType,
      contentBase64: crop.contentBase64,
    }
  })
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function annotatedReviewPageSources(
  previews: readonly TeacherQuestionPagePreview[],
  pages: readonly TeacherQuestionLayoutPage[],
  questions: readonly TeacherSegmentedQuestion[],
  maskOutsideReviewedLanes: boolean,
): Promise<readonly VisionImageSource[]> {
  const pageByIndex = new Map(pages.map(page => [page.pageIndex, page] as const))
  return await Promise.all(previews.map(async (preview) => {
    const page = pageByIndex.get(preview.pageIndex)
    if (page === undefined) throw new Error(`page ${String(preview.pageIndex + 1)} has no OCR geometry`)
    const input = decodeCanonicalBase64(preview.contentBase64)
    if (input === undefined) throw new Error(`preview is not canonical base64: page-${String(preview.pageIndex + 1)}`)
    const metadata = await sharp(input, { failOn: 'error' }).metadata()
    const width = metadata.width
    const height = metadata.height
    const scaleX = width / page.width
    const scaleY = height / page.height
    const strokeWidth = Math.max(2, Math.round(Math.min(width, height) / 500))
    const fontSize = Math.max(12, Math.round(Math.min(width, height) / 60))
    const reviewedLanes = questions.flatMap(question => question.regions.flatMap((region) => {
      if (region.pageIndex !== page.pageIndex) return []
      const left = Math.max(0, Math.min(width - 1, Math.round(region.left * scaleX)))
      const right = Math.max(left + 1, Math.min(width, Math.round(region.rightLimit * scaleX)))
      return [{ left, right }]
    })).sort((left, right) => left.left - right.left)
    const mergedReviewedLanes: Array<{ left: number; right: number }> = []
    for (const lane of reviewedLanes) {
      const previous = mergedReviewedLanes.at(-1)
      if (previous === undefined || lane.left > previous.right) {
        mergedReviewedLanes.push({ ...lane })
      } else {
        previous.right = Math.max(previous.right, lane.right)
      }
    }
    const laneMasks: string[] = []
    if (maskOutsideReviewedLanes && mergedReviewedLanes.length > 0) {
      let cursor = 0
      for (const lane of mergedReviewedLanes) {
        if (lane.left > cursor) {
          laneMasks.push(`<rect x="${String(cursor)}" y="0" width="${String(lane.left - cursor)}" height="${String(height)}" fill="#cbd5e1"/>`)
        }
        cursor = Math.max(cursor, lane.right)
      }
      if (cursor < width) {
        laneMasks.push(`<rect x="${String(cursor)}" y="0" width="${String(width - cursor)}" height="${String(height)}" fill="#cbd5e1"/>`)
      }
    }
    const cropOverlays = questions.flatMap(question => question.regions.flatMap((region) => {
      if (region.pageIndex !== page.pageIndex) return []
      const left = Math.max(0, Math.min(width - 1, Math.round(region.left * scaleX)))
      const top = Math.max(0, Math.min(height - 1, Math.round(region.top * scaleY)))
      const right = Math.max(left + 1, Math.min(width, Math.round(region.rightLimit * scaleX)))
      const contentRight = Math.max(left, Math.min(right, Math.round(region.right * scaleX)))
      const bottom = Math.max(top + 1, Math.min(height, Math.round(region.bottom * scaleY)))
      const label = `Q${String(question.questionNo)}`
      const labelWidth = Math.max(fontSize * 2, Math.round(label.length * fontSize * 0.75))
      const excluded = region.excludedAreas.map(([areaLeft, areaTop, areaRight, areaBottom]) => {
        const x = Math.round(areaLeft * scaleX)
        const y = Math.round(areaTop * scaleY)
        const areaWidth = Math.max(1, Math.round((areaRight - areaLeft) * scaleX))
        const areaHeight = Math.max(1, Math.round((areaBottom - areaTop) * scaleY))
        return `<rect x="${String(x)}" y="${String(y)}" width="${String(areaWidth)}" height="${String(areaHeight)}" fill="rgba(220,38,38,0.18)" stroke="#dc2626" stroke-width="${String(strokeWidth)}"/><path d="M${String(x)} ${String(y)} L${String(x + areaWidth)} ${String(y + areaHeight)} M${String(x + areaWidth)} ${String(y)} L${String(x)} ${String(y + areaHeight)}" stroke="#dc2626" stroke-width="${String(strokeWidth)}"/>`
      }).join('')
      return [`<g><rect x="${String(left)}" y="${String(top)}" width="${String(right - left)}" height="${String(bottom - top)}" fill="none" stroke="#db2777" stroke-width="${String(strokeWidth)}"/><line x1="${String(contentRight)}" y1="${String(top)}" x2="${String(contentRight)}" y2="${String(bottom)}" stroke="#0284c7" stroke-width="${String(strokeWidth)}" stroke-dasharray="${String(strokeWidth * 3)} ${String(strokeWidth * 2)}"/><rect x="${String(left)}" y="${String(top)}" width="${String(labelWidth)}" height="${String(fontSize + 6)}" fill="rgba(17,24,39,0.88)"/><text x="${String(left + 3)}" y="${String(top + fontSize + 1)}" font-family="sans-serif" font-size="${String(fontSize)}" font-weight="700" fill="#ffffff">${escapeSvgText(label)}</text>${excluded}</g>`]
    }))
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">${laneMasks.join('')}${cropOverlays.join('')}</svg>`)
    const output = await sharp(input, { failOn: 'error' })
      .composite([{ input: svg, left: 0, top: 0 }])
      .png()
      .toBuffer()
    return {
      id: `page-${String(preview.pageIndex + 1)}`,
      label: `annotated source PDF page ${String(preview.pageIndex + 1)}; magenta rectangles are sampled crop regions, blue dashed lines mark final owned OCR content before allowed white right padding, red crossed areas are erased, repeated Q labels are one stitched question${maskOutsideReviewedLanes && mergedReviewedLanes.length > 0 ? ', and opaque gray vertical bands hide unrelated page lanes' : ''}`,
      mediaType: 'image/png' as const,
      contentBase64: output.toString('base64'),
    }
  }))
}

async function reviewSheetSources(
  sources: readonly VisionImageSource[],
  kind: 'page' | 'crop',
): Promise<readonly VisionImageSource[]> {
  const sourcesPerSheet = kind === 'page' ? 5 : 9
  const cellWidth = 800
  const imageWidth = 780
  const imageHeight = 850
  const labelHeight = 36
  const imageTopPadding = 8
  const imageBottomPadding = 8
  const sheets: VisionImageSource[] = []
  for (let offset = 0; offset < sources.length; offset += sourcesPerSheet) {
    const group = sources.slice(offset, offset + sourcesPerSheet)
    const columns = Math.min(2, group.length)
    const rows = Math.ceil(group.length / columns)
    const prepared = await Promise.all(group.map(async (source) => {
      const input = decodeCanonicalBase64(source.contentBase64)
      if (input === undefined) throw new Error(`review image is not canonical base64: ${source.id}`)
      const resized = await sharp(input, { failOn: 'error' })
        .resize({ width: imageWidth, height: imageHeight, fit: 'inside' })
        .png()
        .toBuffer()
      const displayed = kind === 'crop'
        ? await sharp(resized)
          .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#0891b2' })
          .png()
          .toBuffer()
        : resized
      const metadata = await sharp(displayed).metadata()
      return {
        source,
        displayed,
        width: metadata.width,
        height: metadata.height,
      }
    }))
    const rowHeights = Array.from({ length: rows }, (_, row) => (
      labelHeight
      + imageTopPadding
      + Math.max(...prepared
        .filter((_item, index) => Math.floor(index / columns) === row)
        .map(item => item.height))
      + imageBottomPadding
    ))
    const rowTops = rowHeights.map((_height, row) => (
      rowHeights.slice(0, row).reduce((total, height) => total + height, 0)
    ))
    const composites: Array<{ input: Buffer; left: number; top: number }> = []
    for (const [index, item] of prepared.entries()) {
      const column = index % columns
      const row = Math.floor(index / columns)
      const cellLeft = column * cellWidth
      const cellTop = rowTops[row] ?? 0
      composites.push({
        input: item.displayed,
        left: cellLeft + Math.floor((cellWidth - item.width) / 2),
        top: cellTop + labelHeight + imageTopPadding,
      })
      composites.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${String(cellWidth)}" height="${String(labelHeight)}"><rect width="100%" height="100%" fill="#111827"/><text x="12" y="25" font-family="sans-serif" font-size="22" font-weight="700" fill="#ffffff">${escapeSvgText(item.source.id)}</text></svg>`),
        left: cellLeft,
        top: cellTop,
      })
    }
    const output = await sharp({
      create: {
        width: columns * cellWidth,
        height: rowHeights.reduce((total, height) => total + height, 0),
        channels: 3,
        background: kind === 'crop' ? '#cbd5e1' : '#ffffff',
      },
    }).composite(composites).png().toBuffer()
    sheets.push({
      id: `review-${kind}-sheet-${String(sheets.length + 1)}`,
      label: `${kind === 'page' ? 'annotated source-page' : 'rendered output-crop'} review sheet containing ${group.map(source => source.id).join(', ')}`,
      mediaType: 'image/png',
      contentBase64: output.toString('base64'),
    })
  }
  return sheets
}

function cropReviewAttentionRecords(
  questions: readonly TeacherSegmentedQuestion[],
  elements: readonly IndexedElement[],
  padding: number,
  maxAutoOwnedGapRatio: number,
): readonly CropReviewAttention[] {
  const imageElements = elements.filter(element => element.element.type === 'image')
  return questions.flatMap((question): readonly CropReviewAttention[] => {
    const flags: string[] = []
    const head = elements.find(element => element.id === question.sourceHeadId)
    if (head !== undefined && !isPossibleQuestionHead(head)) {
      flags.push(
        `The crop head ${String(head.id)} was promoted outside the source's recognized top-level numbering. `
        + 'Verify that its first visible line begins a complete independent answer demand and is not an option, subpart, response line, or continuation of the preceding crop.',
      )
    }
    const regions = question.regions
    for (let index = 1; index < regions.length; index += 1) {
      const previous = regions[index - 1]
      const current = regions[index]
      if (previous === undefined || current === undefined || previous.pageIndex !== current.pageIndex) continue
      const gap = current.top - previous.bottom
      if (gap > current.pageHeight * maxAutoOwnedGapRatio) {
        flags.push(
          `The rendered crop concatenates source regions on PDF page ${String(current.pageIndex + 1)} `
          + `with a ${String(gap)}-unit vertical gap (${String(previous.bottom)} to ${String(current.top)}). `
          + 'Identify the lower region in the crop and prove it is required question content; otherwise report it for local removal.',
        )
      }
    }
    for (const region of regions) {
      const regionBox = [region.left, region.top, region.right, region.bottom] as const
      const excludedImages = imageElements.filter(element => (
        element.page.pageIndex === region.pageIndex
          && region.excludedAreas.some(area => boxesOverlap(area, element.element.bbox))
      ))
      if (excludedImages.length > 0) {
        const excludedImageIds = excludedImages.map(element => element.id)
        const connectedCaptions = excludedImages.flatMap(image => imageCompanionElements(elements, image, padding))
        const visibleCaptionIds = [...new Set(connectedCaptions
          .filter(element => boxesOverlap(regionBox, element.element.bbox)
            && !region.excludedAreas.some(area => boxesOverlap(area, element.element.bbox)))
          .map(element => element.id))]
        flags.push(
          `Source image element(s) ${excludedImageIds.join(', ')} on PDF page ${String(region.pageIndex + 1)} `
          + 'are erased from this crop. Compare them with the printed task and report any required diagram, table, or other visual as missing.'
          + (visibleCaptionIds.length === 0
            ? ''
            : ` Connected caption element(s) ${visibleCaptionIds.join(', ')} remain visible; report the orphaned residue unless the task independently requires it.`),
        )
      }
      const edgeImageIds = imageElements.filter(element => (
        element.page.pageIndex === region.pageIndex
          && boxesOverlap(regionBox, element.element.bbox)
          && !region.excludedAreas.some(area => boxesOverlap(area, element.element.bbox))
          && (element.element.bbox[0] < region.left
            || element.element.bbox[1] < region.top
            || element.element.bbox[2] > region.right
            || element.element.bbox[3] > region.bottom)
      )).map(element => element.id)
      if (edgeImageIds.length > 0) {
        flags.push(
          `Source image element(s) ${edgeImageIds.join(', ')} on PDF page ${String(region.pageIndex + 1)} `
          + 'extend beyond the sampled crop bounds. Compare the source and crop at every outer line, label, and vertex and report the clipped visual.',
        )
      }
    }
    return flags.length === 0
      ? []
      : [{ cropId: `crop-${String(question.sourceHeadId)}`, flags }]
  })
}

function visionImageContent(value: VisionImageValue): Array<
  { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
> {
  return value.images.flatMap(image => [
    { type: 'text' as const, text: `${image.id}: ${image.label}` },
    {
      type: 'image' as const,
      attachment: {
        attachmentId: AttachmentId(image.attachmentId),
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.originalDimensions === undefined ? {} : {
          originalDimensions: { ...image.originalDimensions },
        }),
      },
    },
  ])
}

function visionImageTool(
  name: string,
  sources: readonly VisionImageSource[],
  inspected: Set<string>,
  maxImages: number,
  saveImage: (source: { data: Uint8Array; mediaType: ImageMediaType; name: string }) => Promise<ImageAttachmentRef>,
  requireAllSources = false,
) {
  const byId = new Map(sources.map(source => [source.id, source] as const))
  return defineTool({
    name,
    description: requireAllSources
      ? `Read all ${String(sources.length)} listed review sheets in one request. Partial or repeated sheet requests are rejected.`
      : `Read one through ${String(maxImages)} source previews by opaque id. Every returned image is authoritative visual evidence and must be inspected before the final submission.`,
    parameters: {
      ids: {
        type: 'array',
        required: true,
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          images: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => visionImageContent(value as unknown as VisionImageValue),
    },
    async execute(args) {
      const ids = args.ids
      if (requireAllSources && (
        ids.length !== sources.length || ids.some(id => !byId.has(id))
      )) {
        throw new Error(`review sheet request must contain all ${String(sources.length)} ids in one call`)
      }
      if (ids.length < 1 || ids.length > maxImages) {
        throw new Error(`preview request must contain one through ${String(maxImages)} ids`)
      }
      if (new Set(ids).size !== ids.length) throw new Error('preview request contains duplicate ids')
      const requested: VisionImageSource[] = []
      for (const id of ids) {
        const source = byId.get(id)
        if (source === undefined) throw new Error(`unknown preview id: ${id}`)
        if (inspected.has(id)) throw new Error(`preview was already inspected: ${id}`)
        requested.push(source)
      }
      const images = await Promise.all(requested.map(async (source) => {
        const data = decodeCanonicalBase64(source.contentBase64)
        if (data === undefined) throw new Error(`preview is not canonical base64: ${source.id}`)
        const attachment = await saveImage({ data, mediaType: source.mediaType, name: `${source.id}.png` })
        return {
          id: source.id,
          label: source.label,
          attachmentId: attachment.attachmentId,
          mediaType: attachment.mediaType,
          bytes: attachment.bytes,
          width: attachment.width,
          height: attachment.height,
          ...(attachment.name === undefined ? {} : { name: attachment.name }),
          ...(attachment.originalDimensions === undefined ? {} : {
            originalDimensions: { ...attachment.originalDimensions },
          }),
        }
      }))
      for (const source of requested) inspected.add(source.id)
      return { images }
    },
  })
}

function pageSizeKey(page: TeacherQuestionLayoutPage): string {
  return `${String(page.width)}x${String(page.height)}`
}

function questionHeadLanes(heads: readonly IndexedElement[]): readonly {
  readonly left: number
  readonly heads: readonly IndexedElement[]
}[] {
  const lanes: Array<{
    left: number
    maxHeadHeight: number
    heads: IndexedElement[]
  }> = []
  for (const head of heads.toSorted((left, right) => (
    left.element.bbox[0] - right.element.bbox[0]
      || left.ordinal - right.ordinal
  ))) {
    const [left, top, , bottom] = head.element.bbox
    const height = bottom - top
    const lane = lanes.at(-1)
    if (lane !== undefined && left - lane.left <= 2 * Math.max(height, lane.maxHeadHeight)) {
      lane.maxHeadHeight = Math.max(lane.maxHeadHeight, height)
      lane.heads.push(head)
    } else {
      lanes.push({ left, maxHeadHeight: height, heads: [head] })
    }
  }
  return lanes
}

function questionLaneStartsByPageSize(
  heads: readonly IndexedElement[],
): ReadonlyMap<string, readonly number[]> {
  const headsByPageSize = new Map<string, IndexedElement[]>()
  for (const head of heads) {
    const key = pageSizeKey(head.page)
    const matching = headsByPageSize.get(key)
    if (matching === undefined) headsByPageSize.set(key, [head])
    else matching.push(head)
  }
  return new Map([...headsByPageSize].map(([key, matching]) => [
    key,
    questionHeadLanes(matching).map(lane => lane.left),
  ]))
}

function cropRegions(
  elements: readonly IndexedElement[],
  selectedPages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  head: IndexedElement,
  cropStops: readonly IndexedElement[],
  selectedHeadIds: ReadonlySet<string>,
  laneStartsByPageSize: ReadonlyMap<string, readonly number[]>,
  excluded: ReadonlySet<string>,
  explicitAdditionalIds: ReadonlySet<string>,
  maxAutoOwnedGapRatio: number,
) {
  const effectiveGroups = selectedPages.flatMap((page) => {
    const ordered = elements
      .filter(item => item.page === page)
      .toSorted((left, right) => (
        left.element.bbox[1] - right.element.bbox[1]
          || left.element.bbox[0] - right.element.bbox[0]
          || left.ordinal - right.ordinal
      ))
    let effectiveCount = ordered.length
    let occupiedBottom = ordered[0]?.element.bbox[3] ?? 0
    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index]
      if (current === undefined) continue
      const trailing = ordered.slice(index)
      const disconnectedGap = current.element.bbox[1] - occupiedBottom
      const minimumGap = page.height * maxAutoOwnedGapRatio
      if (disconnectedGap >= minimumGap
        && !trailing.some(item => explicitAdditionalIds.has(item.id) || item.id === head.id)) {
        effectiveCount = index
        break
      }
      occupiedBottom = Math.max(occupiedBottom, current.element.bbox[3])
    }
    const effective = ordered.slice(0, effectiveCount)
    if (effective.length === 0) return []
    const minimumGap = page.height * maxAutoOwnedGapRatio
    const verticalClusters: IndexedElement[][] = []
    let clusterBottom = 0
    for (const item of effective) {
      const previous = verticalClusters.at(-1)
      if (previous === undefined || item.element.bbox[1] - clusterBottom >= minimumGap) {
        verticalClusters.push([item])
        clusterBottom = item.element.bbox[3]
      } else {
        previous.push(item)
        clusterBottom = Math.max(clusterBottom, item.element.bbox[3])
      }
    }
    const slices: Array<{
      elements: IndexedElement[]
      left: number
      right: number
    }> = []
    for (const cluster of verticalClusters) {
      const clusterLeft = Math.min(...cluster.map(item => item.element.bbox[0]))
      const clusterRight = Math.max(...cluster.map(item => item.element.bbox[2]))
      const matching = slices.find(slice => (
        clusterRight + padding >= slice.left
          && slice.right + padding >= clusterLeft
          && !(page === head.page
            && (cluster.some(item => item.id === head.id) || slice.elements.some(item => item.id === head.id))
            && Math.min(clusterLeft, slice.left) < head.element.bbox[0] - padding)
      ))
      if (matching === undefined) {
        slices.push({ elements: [...cluster], left: clusterLeft, right: clusterRight })
      } else {
        matching.elements.push(...cluster)
        matching.left = Math.min(matching.left, clusterLeft)
        matching.right = Math.max(matching.right, clusterRight)
      }
    }
    return slices
      .toSorted((left, right) => (
        Math.min(...left.elements.map(item => item.ordinal))
          - Math.min(...right.elements.map(item => item.ordinal))
      ))
      .map(slice => ({ page, elements: slice.elements }))
  })
  const effectiveElements = effectiveGroups.flatMap(group => group.elements)
  const ownedIds = new Set(effectiveElements.map(item => item.id))
  const allElements = indexElements(selectedPages)
  return selectedPages.flatMap((page) => {
    const others = allElements.filter(item => item.page === page && !ownedIds.has(item.id))
    return effectiveGroups.filter(group => group.page === page).flatMap(({ elements: owned }) => {
      const ownedLeft = Math.min(...owned.map(item => item.element.bbox[0]))
      const ownedTop = Math.min(...owned.map(item => item.element.bbox[1]))
      const ownedRight = Math.max(...owned.map(item => item.element.bbox[2]))
      const ownedBottom = Math.max(...owned.map(item => item.element.bbox[3]))
      const horizontalBlockers = others.filter(item => (
        item.element.bbox[2] > ownedLeft && item.element.bbox[0] < ownedRight
      ))
      const verticalBlockers = others.filter(item => (
        item.element.bbox[3] > ownedTop && item.element.bbox[1] < ownedBottom
      ))
      const previousBottom = Math.max(0, ...horizontalBlockers
        .filter(item => item.element.bbox[3] <= ownedTop)
        .map(item => item.element.bbox[3]))
      const nextTop = Math.min(page.height, ...horizontalBlockers
        .filter(item => item.element.bbox[1] >= ownedBottom)
        .map(item => item.element.bbox[1]))
      const previousRight = Math.max(0, ...verticalBlockers
        .filter(item => item.element.bbox[2] <= ownedLeft)
        .map(item => item.element.bbox[2]))
      const nextLeft = Math.min(page.width, ...verticalBlockers
        .filter(item => item.element.bbox[0] >= ownedRight)
        .map(item => item.element.bbox[0]))
      const siblingLaneLeft = Math.min(
        page.width,
        ...(laneStartsByPageSize.get(pageSizeKey(page)) ?? []).filter(left => left >= ownedRight),
      )
      const localHorizontalLimit = nextLeft === page.width
        ? page.width
        : Math.max(ownedRight, nextLeft - padding)
      // Repeated lane starts keep a half-empty spread in its printed column; owned content crossing a start remains intact.
      const horizontalLimit = Math.min(localHorizontalLimit, siblingLaneLeft)
      // A same-page ownership claim may reach another lane, but it cannot move the head-bearing slice's origin.
      const leftAnchor = owned.some(item => item.id === head.id) ? head.element.bbox[0] : ownedLeft
      const left = Math.max(0, leftAnchor - padding, previousRight)
      const bufferedPreviousBottom = previousBottom === 0
        ? 0
        : Math.ceil((previousBottom + ownedTop) / 2)
      const right = Math.min(page.width, ownedRight + padding, horizontalLimit)
      const questionTop = owned.some(item => item.id === head.id) ? head.element.bbox[1] : ownedTop
      const hardPreviousBottom = Math.max(0, ...cropStops
        .filter(item => item.page === page
          && item.id !== head.id
          && item.element.bbox[1] < questionTop
          && item.element.bbox[2] > left
          && item.element.bbox[0] < right)
        .map(item => item.element.bbox[3]))
      const bufferedHardPreviousBottom = hardPreviousBottom === 0
        ? 0
        : hardPreviousBottom <= ownedTop
          ? Math.ceil((hardPreviousBottom + ownedTop) / 2)
          : hardPreviousBottom - ownedTop <= padding
            ? ownedTop
            : 0
      const pageEdgeThreshold = Math.max(1, padding * 3, page.height * 0.04)
      const paddedOwnedTop = ownedTop - padding <= pageEdgeThreshold
        ? ownedTop
        : ownedTop - padding
      const top = Math.max(0, paddedOwnedTop, bufferedPreviousBottom, bufferedHardPreviousBottom)
      const hardNextCandidates = cropStops
        .filter(item => item.page === page
          && item.id !== head.id
          && item.element.bbox[1] > questionTop
          && item.element.bbox[2] > left
          && item.element.bbox[0] < right)
      const hardNextTop = Math.min(page.height, ...hardNextCandidates.map(item => item.element.bbox[1]))
      const hardNextIsQuestionHead = hardNextCandidates.some(item => (
        item.element.bbox[1] === hardNextTop && selectedHeadIds.has(item.id)
      ))
      const hardNextOverlapsOwned = hardNextCandidates.some(item => (
        item.element.bbox[1] === hardNextTop
          && owned.some(owner => boxesOverlap(owner.element.bbox, item.element.bbox))
      ))
      // A blocker in another horizontal lane may overlap vertically; outside content never truncates owned pixels.
      const bufferedNextTop = nextTop === page.height
        ? page.height
        : nextTop <= ownedBottom
          ? page.height
          : Math.floor((ownedBottom + nextTop) / 2)
      const bufferedHardNextTop = hardNextTop === page.height
        ? page.height
        : hardNextTop <= ownedBottom
          ? hardNextIsQuestionHead
            ? hardNextTop
            : hardNextOverlapsOwned && ownedBottom - hardNextTop <= padding
              ? hardNextTop
              : page.height
          : Math.floor((ownedBottom + hardNextTop) / 2)
      const paddedOwnedBottom = page.height - (ownedBottom + padding) <= pageEdgeThreshold
        ? ownedBottom
        : ownedBottom + padding
      const bottom = Math.min(page.height, paddedOwnedBottom, bufferedNextTop, bufferedHardNextTop)
      const excludedAreas = allElements
        .filter(item => item.page === page
          && excluded.has(item.id as string)
          && item.element.bbox[2] > left
          && item.element.bbox[0] < right
          && item.element.bbox[3] > top
          && item.element.bbox[1] < bottom
          && !owned.some(owner => boxesOverlap(owner.element.bbox, item.element.bbox)))
        .map(item => item.element.bbox)
      return right > left && bottom > top
        ? [{
          pageIndex: page.pageIndex,
          left,
          top,
          right,
          rightLimit: horizontalLimit,
          bottom,
          excludedAreas,
          pageWidth: page.width,
          pageHeight: page.height,
        }]
        : []
    })
  })
}

function applyVerticalRegionEdits(
  regions: readonly TeacherQuestionPageRegion[],
  edits: readonly VerticalRegionEdit[],
  question: SelectedQuestion,
  selected: readonly SelectedQuestion[],
  pages: readonly TeacherQuestionLayoutPage[],
): { readonly regions: readonly TeacherQuestionPageRegion[]; readonly errors: readonly string[] } {
  if (edits.length === 0) return { regions, errors: [] }
  const errors: string[] = []
  const edited = regions.map(region => ({ ...region }))
  for (const [index, edit] of edits.entries()) {
    const label = `verticalRegionEdits[${String(index)}]`
    const regionIndex = edited.findIndex(region => region.pageIndex === edit.pageIndex)
    const region = edited[regionIndex]
    const page = pages.find(candidate => candidate.pageIndex === edit.pageIndex)
    if (region === undefined || page === undefined) {
      errors.push(`${label}.pageIndex has no existing source slice for this question`)
      continue
    }
    const top = edit.top ?? region.top
    const bottom = edit.bottom ?? region.bottom
    if (top < 0 || bottom > page.height || bottom <= top) {
      errors.push(`${label} must satisfy 0 <= top < bottom <= page height`)
      continue
    }
    if (question.head.page === page
      && (top > question.head.element.bbox[1] || bottom < question.head.element.bbox[3])) {
      errors.push(`${label} must retain the complete question head`)
      continue
    }
    const editedBox = [region.left, top, region.right, bottom] as const
    const crossedHead = selected.find(candidate => (
      candidate !== question
        && candidate.head.page === page
        && boxesOverlap(editedBox, candidate.head.element.bbox)
    ))
    if (crossedHead !== undefined) {
      errors.push(`${label} crosses question head ${String(crossedHead.head.id)}`)
      continue
    }
    edited[regionIndex] = { ...region, top, bottom }
  }
  return { regions: edited, errors }
}

function applySourceRightLimitEdits(
  regions: readonly TeacherQuestionPageRegion[],
  edits: readonly SourceRightLimitEdit[],
): { readonly regions: readonly TeacherQuestionPageRegion[]; readonly errors: readonly string[] } {
  if (edits.length === 0) return { regions, errors: [] }
  const errors: string[] = []
  const edited = regions.map(region => ({ ...region }))
  for (const [index, edit] of edits.entries()) {
    const label = `sourceRightLimitEdits[${String(index)}]`
    const regionIndex = edited.findIndex(region => region.pageIndex === edit.pageIndex)
    const region = edited[regionIndex]
    if (region === undefined) {
      errors.push(`${label}.pageIndex has no existing source slice for this question`)
      continue
    }
    if (edit.rightLimit < region.right || edit.rightLimit > region.rightLimit) {
      errors.push(`${label}.rightLimit must retain all owned pixels and may only reduce the current source-pixel limit`)
      continue
    }
    edited[regionIndex] = { ...region, rightLimit: edit.rightLimit }
  }
  return { regions: edited, errors }
}

function semanticStopAppliesToQuestion(question: SelectedQuestion, stop: IndexedElement): boolean {
  return stop.ordinal > question.head.ordinal
    && (isAnswerBoundaryElement(stop)
      || stop.page !== question.head.page
      || horizontalBoxDistance(stop.element.bbox, question.head.element.bbox) === 0)
}

function assignQuestionOwners(
  elements: readonly IndexedElement[],
  selected: readonly SelectedQuestion[],
  end: IndexedElement | undefined,
  semanticStops: readonly IndexedElement[],
  globalStops: readonly IndexedElement[],
  excluded: ReadonlySet<string>,
  claimed: ReadonlyMap<string, number>,
  retainedImages: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const owners = new Map<string, number>()
  const nearestStop = (
    question: SelectedQuestion,
    candidates: readonly (IndexedElement | undefined)[],
  ): IndexedElement | undefined => candidates
    .filter((candidate): candidate is IndexedElement => (
      candidate !== undefined && candidate.ordinal > question.head.ordinal
    ))
    .toSorted((left, right) => left.ordinal - right.ordinal)[0]
  const applicableSemanticStops = (question: SelectedQuestion): readonly IndexedElement[] => semanticStops.filter(stop => (
    semanticStopAppliesToQuestion(question, stop)
  ))
  const ordinalStops = selected.map((question, questionIndex) => nearestStop(question, [
    question.end,
    selected[questionIndex + 1]?.head,
    end,
    ...globalStops,
    ...applicableSemanticStops(question),
  ]))
  const hardStops = selected.map(question => nearestStop(question, [
    question.end,
    end,
    ...globalStops,
    ...applicableSemanticStops(question),
  ]))
  for (const [questionIndex, question] of selected.entries()) {
    const next = ordinalStops[questionIndex]
    for (const element of elements) {
      const id = element.id as string
      if (element.ordinal < question.head.ordinal
        || (next !== undefined && element.ordinal >= next.ordinal)
        || excluded.has(id)) continue
      const claimedOwner = claimed.get(id)
      if (claimedOwner === undefined || claimedOwner === questionIndex) owners.set(id, questionIndex)
    }
  }
  for (const [id, questionIndex] of claimed) owners.set(id, questionIndex)
  const ordinalOwners = new Map(owners)

  const selectedById = new Map(selected.map((question, index) => [question.head.id as string, index] as const))
  for (const page of new Set(elements.map(element => element.page))) {
    const pageQuestions = selected.map((question, index) => ({ question, index })).filter(item => item.question.head.page === page)
    if (pageQuestions.length < 2) continue
    const questionByHeadId = new Map(pageQuestions.map(item => [item.question.head.id, item] as const))
    const lanes = questionHeadLanes(pageQuestions.map(item => item.question.head)).map(lane => ({
      left: lane.left,
      questions: lane.heads.flatMap((head) => {
        const item = questionByHeadId.get(head.id)
        return item === undefined ? [] : [item]
      }),
    }))
    const laneIndexFor = (element: IndexedElement): number => Math.max(
      0,
      lanes.findLastIndex(lane => lane.left <= element.element.bbox[0]),
    )
    const precedesHardStop = (
      element: IndexedElement,
      stop: IndexedElement | undefined,
      laneIndex: number,
    ): boolean => {
      if (stop === undefined) return true
      if (stop.page === page && laneIndexFor(stop) === laneIndex) {
        return element.id !== stop.id && element.element.bbox[1] < stop.element.bbox[1]
      }
      return element.ordinal < stop.ordinal
    }
    const claimedLaneSeeds = [...claimed].flatMap(([id, index]) => {
      const element = elements.find(candidate => candidate.id === id && candidate.page === page)
      return element === undefined ? [] : [{ element, index, laneIndex: laneIndexFor(element) }]
    })
    const retainedLaneSeeds: Array<{
      element: IndexedElement
      index: number
      laneIndex: number
    }> = []
    for (const element of elements.filter(item => item.page === page)) {
      const id = element.id as string
      if (excluded.has(id)) {
        owners.delete(id)
        continue
      }
      const explicitOwner = claimed.get(id) ?? selectedById.get(id)
      if (explicitOwner !== undefined) {
        owners.set(id, explicitOwner)
        continue
      }
      const laneIndex = laneIndexFor(element)
      const lane = lanes[laneIndex]
      const nextLane = lanes[laneIndex + 1]
      if (lane === undefined) continue
      if (nextLane !== undefined && element.element.bbox[2] > nextLane.left) continue
      const claimedContinuation = claimedLaneSeeds
        .filter((seed) => {
          const stop = ordinalStops[seed.index]
          return seed.laneIndex === laneIndex
            && seed.element.ordinal < element.ordinal
            && (stop === undefined || element.ordinal < stop.ordinal)
        })
        .toSorted((left, right) => right.element.ordinal - left.element.ordinal)[0]
      if (claimedContinuation !== undefined) {
        owners.set(id, claimedContinuation.index)
        continue
      }
      const owner = lane.questions.filter((item) => {
        const hardStop = hardStops[item.index]
        return item.question.head.element.bbox[1] <= element.element.bbox[1]
          && precedesHardStop(element, hardStop, laneIndex)
      }).sort((left, right) => right.question.head.element.bbox[1] - left.question.head.element.bbox[1])[0]
      const retainedContinuation = retainedLaneSeeds
        .filter((seed) => {
          const stop = ordinalStops[seed.index]
          return seed.laneIndex === laneIndex
            && seed.element.ordinal < element.ordinal
            && (stop === undefined || element.ordinal < stop.ordinal)
        })
        .toSorted((left, right) => right.element.ordinal - left.element.ordinal)[0]
      const ordinalOwner = ordinalOwners.get(id)
      const ordinalQuestion = ordinalOwner === undefined ? undefined : selected[ordinalOwner]
      let crossPageContinuationOwner: number | undefined
      if (ordinalOwner !== undefined
        && ordinalQuestion !== undefined
        && stopBeginsCrossPageContinuation(ordinalQuestion.head, element, elements)) {
        crossPageContinuationOwner = ordinalOwner
      }
      const retainedOwner = retainedImages.has(id) ? ordinalOwners.get(id) : undefined
      const resolvedOwner = owner?.index
        ?? retainedContinuation?.index
        ?? crossPageContinuationOwner
        ?? retainedOwner
      if (resolvedOwner === undefined) owners.delete(id)
      else owners.set(id, resolvedOwner)
      if (retainedImages.has(id) && resolvedOwner !== undefined) {
        retainedLaneSeeds.push({ element, index: resolvedOwner, laneIndex })
      }
    }
  }
  return owners
}

function boxesOverlap(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  return left[2] > right[0] && left[0] < right[2] && verticalBoxesOverlap(left, right)
}

function horizontalBoxDistance(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  if (left[2] >= right[0] && right[2] >= left[0]) return 0
  return left[2] < right[0] ? right[0] - left[2] : left[0] - right[2]
}

function imageCompanionElements(
  elements: readonly IndexedElement[],
  image: IndexedElement,
  padding: number,
): readonly IndexedElement[] {
  const [left, , right, bottom] = image.element.bbox
  return elements.filter(candidate => (
    candidate !== image
      && candidate.page === image.page
      && candidate.element.text.trim() !== ''
      && candidate.element.bbox[1] >= bottom
      && candidate.element.bbox[1] - bottom <= padding
      && candidate.element.bbox[0] >= left - padding
      && candidate.element.bbox[2] <= right + padding
  ))
}

function validateBoundaryDraft(
  draft: BoundaryDraft,
  elements: readonly IndexedElement[],
  pages: readonly TeacherQuestionLayoutPage[],
  padding: number,
  maxQuestions: number,
  requiredHeadCandidateIds: ReadonlySet<string>,
  requiredImageElementIds: ReadonlySet<string>,
  maxAutoOwnedGapRatio: number,
  corePageIndexes?: ReadonlySet<number>,
  protectedHeadIds: ReadonlySet<string> = new Set(),
  allowSamePageReassignment = false,
): BoundaryValidation {
  const errors: string[] = []
  const referenceErrors: string[] = []
  if (draft.headConvention.trim() === '') errors.push('headConvention must describe the inferred question-head convention')
  if (draft.headConvention.length > 1_000) errors.push('headConvention exceeds 1000 characters')
  if (draft.questions.length > maxQuestions) errors.push(`questions exceeds the ${String(maxQuestions)} item limit`)
  const byId = new Map(elements.map(element => [element.id as string, element] as const))
  const selected: SelectedQuestion[] = []
  const seenIds = new Set<string>()
  for (const [index, question] of draft.questions.entries()) {
    const label = `questions[${String(index)}]`
    const head = byId.get(question.headElementId)
    if (head === undefined) {
      const error = `${label}.headElementId is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
      continue
    }
    if (corePageIndexes !== undefined && !corePageIndexes.has(head.page.pageIndex)) {
      errors.push(`${label}.headElementId belongs to an adjacent context page, not a core page owned by this run`)
    }
    if (isContextualSemanticBoundaryElement(head, elements)) {
      errors.push(`${label}.headElementId references a section or answer heading, not an independent question`)
    }
    if (!requiredHeadCandidateIds.has(head.id) && !isCitationOnlyQuestionHead(head)) {
      const enclosingProtectedHead = elements.findLast(candidate => (
        candidate.ordinal < head.ordinal
          && candidate.page === head.page
          && protectedHeadIds.has(candidate.id as string)
          && horizontalBoxDistance(candidate.element.bbox, head.element.bbox) === 0
          && !elements.some(boundary => (
            boundary.ordinal > candidate.ordinal
              && boundary.ordinal < head.ordinal
              && (requiredHeadCandidateIds.has(boundary.id)
                || isContextualSemanticBoundaryElement(boundary, elements))
          ))
      ))
      if (enclosingProtectedHead !== undefined
        && subordinateQuestionFragmentPattern.test(head.element.text)) {
        errors.push(
          `${label}.headElementId is inside protected question ${String(enclosingProtectedHead.id)}; `
          + 'an option, subpart, response line, or continuation cannot become another top-level question',
        )
      }
    }
    if (seenIds.has(question.headElementId)) {
      const error = `${label}.headElementId duplicates an earlier question`
      errors.push(error)
      referenceErrors.push(error)
    }
    seenIds.add(question.headElementId)
    const questionStop = question.stopBeforeElementId === undefined ? undefined : byId.get(question.stopBeforeElementId)
    if (question.stopBeforeElementId !== undefined && questionStop === undefined) {
      const error = `${label}.stopBeforeElementId is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    }
    const additional: IndexedElement[] = []
    const localIds = new Set<string>()
    for (const [additionalIndex, id] of (question.additionalElementIds ?? []).entries()) {
      const additionalLabel = `${label}.additionalElementIds[${String(additionalIndex)}]`
      const element = byId.get(id)
      if (element === undefined) {
        const error = `${additionalLabel} is not present in the inspected source`
        errors.push(error)
        referenceErrors.push(error)
      }
      else {
        additional.push(element)
        if (element.page.pageIndex < head.page.pageIndex) {
          errors.push(`${additionalLabel} precedes its question head; a question cannot own content from an earlier page`)
        } else if (element.page === head.page
          && element.ordinal < head.ordinal
          && elements.some(candidate => (
            candidate.page === head.page
              && candidate.ordinal < element.ordinal
              && isAnswerBoundaryElement(candidate)
              && !elements.some(intervening => (
                intervening.ordinal > candidate.ordinal
                  && intervening.ordinal < element.ordinal
                  && isPossibleQuestionHead(intervening)
              ))
          ))) {
          errors.push(
            `${additionalLabel} belongs to an answer or explanation block before the question head; `
            + 'do not attach answer visuals or residue to the next question',
          )
        } else if (element.page === head.page
          && element.ordinal < head.ordinal
          && element.element.bbox[3] <= head.element.bbox[1]
          && horizontalBoxDistance(element.element.bbox, head.element.bbox) === 0
          && isSemanticTextElement(element.element)) {
          errors.push(
            `${additionalLabel} is preceding text in the question head's lane; `
            + 'use the first condition as the head instead of attaching a previous question continuation',
          )
        }
      }
      if (id === question.headElementId) {
        const error = `${additionalLabel} repeats its question head`
        errors.push(error)
        referenceErrors.push(error)
      }
      if (id === question.stopBeforeElementId) {
        errors.push(`${additionalLabel} cannot claim stopBeforeElementId; that element is the first item outside the question`)
      }
      if (localIds.has(id)) {
        const error = `${additionalLabel} duplicates an earlier additional element`
        errors.push(error)
        referenceErrors.push(error)
      }
      localIds.add(id)
    }
    const verticalRegionEdits: VerticalRegionEdit[] = []
    const editedPages = new Set<number>()
    for (const [editIndex, edit] of (question.verticalRegionEdits ?? []).entries()) {
      const editLabel = `${label}.verticalRegionEdits[${String(editIndex)}]`
      if (!Number.isSafeInteger(edit.pageIndex) || !pages.some(page => page.pageIndex === edit.pageIndex)) {
        errors.push(`${editLabel}.pageIndex is not an inspected source page`)
      }
      if (editedPages.has(edit.pageIndex)) errors.push(`${editLabel}.pageIndex duplicates an earlier vertical edit`)
      if (edit.top === undefined && edit.bottom === undefined) {
        errors.push(`${editLabel} must set top or bottom`)
      }
      if (edit.top !== undefined && !Number.isFinite(edit.top)) errors.push(`${editLabel}.top must be finite`)
      if (edit.bottom !== undefined && !Number.isFinite(edit.bottom)) errors.push(`${editLabel}.bottom must be finite`)
      editedPages.add(edit.pageIndex)
      verticalRegionEdits.push(edit)
    }
    const sourceRightLimitEdits: SourceRightLimitEdit[] = []
    const rightLimitEditedPages = new Set<number>()
    for (const [editIndex, edit] of (question.sourceRightLimitEdits ?? []).entries()) {
      const editLabel = `${label}.sourceRightLimitEdits[${String(editIndex)}]`
      if (!Number.isSafeInteger(edit.pageIndex) || !pages.some(page => page.pageIndex === edit.pageIndex)) {
        errors.push(`${editLabel}.pageIndex is not an inspected source page`)
      }
      if (rightLimitEditedPages.has(edit.pageIndex)) {
        errors.push(`${editLabel}.pageIndex duplicates an earlier source-right edit`)
      }
      if (!Number.isFinite(edit.rightLimit)) errors.push(`${editLabel}.rightLimit must be finite`)
      rightLimitEditedPages.add(edit.pageIndex)
      sourceRightLimitEdits.push(edit)
    }
    selected.push({
      head,
      ...(questionStop === undefined ? {} : { end: questionStop }),
      additional,
      verticalRegionEdits,
      sourceRightLimitEdits,
    })
  }
  selected.sort((left, right) => left.head.ordinal - right.head.ordinal)
  for (const [index, question] of selected.entries()) {
    const nextHead = selected[index + 1]?.head
    if (question.end !== undefined && question.end.ordinal <= question.head.ordinal) {
      errors.push(`questions[${String(index)}].stopBeforeElementId must follow its question head`)
    }
    if (question.end !== undefined && nextHead !== undefined && question.end.ordinal > nextHead.ordinal) {
      errors.push(`questions[${String(index)}].stopBeforeElementId must not follow the next question head`)
    }
  }
  const end = draft.stopBeforeElementId === undefined ? undefined : byId.get(draft.stopBeforeElementId)
  if (draft.stopBeforeElementId !== undefined && end === undefined) {
    const error = 'stopBeforeElementId is not present in the inspected source'
    errors.push(error)
    referenceErrors.push(error)
  }
  const lastHead = selected.at(-1)?.head
  if (end !== undefined && lastHead !== undefined && end.ordinal <= lastHead.ordinal) {
    errors.push('stopBeforeElementId must follow the final question head')
  }
  const declaredExcluded = new Set<string>()
  for (const [index, id] of (draft.excludedElementIds ?? []).entries()) {
    const label = `excludedElementIds[${String(index)}]`
    if (!byId.has(id)) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (seenIds.has(id)) {
      const error = `${label} must not exclude a question head`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) {
      const error = `${label} duplicates an earlier excluded element`
      errors.push(error)
      referenceErrors.push(error)
    }
    declaredExcluded.add(id)
  }
  const declaredOutsideBoundaries = new Set<string>()
  for (const [index, id] of (draft.outsideBoundaryElementIds ?? []).entries()) {
    const label = `outsideBoundaryElementIds[${String(index)}]`
    const element = byId.get(id)
    if (element === undefined) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    } else if (!isSemanticTextElement(element.element)) {
      errors.push(`${label} must reference a semantic OCR element`)
    }
    if (seenIds.has(id)) errors.push(`${label} must not also be a question head`)
    if (declaredOutsideBoundaries.has(id)) {
      const error = `${label} duplicates an earlier outside boundary`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) errors.push(`${label} must not also exclude the same element`)
    declaredOutsideBoundaries.add(id)
  }
  const declaredNonQuestionHeads = new Set<string>()
  for (const [index, id] of (draft.nonQuestionHeadElementIds ?? []).entries()) {
    const label = `nonQuestionHeadElementIds[${String(index)}]`
    if (!byId.has(id)) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (seenIds.has(id)) {
      const error = `${label} must not also be a question head`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredNonQuestionHeads.has(id)) {
      const error = `${label} duplicates an earlier non-question decision`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) errors.push(`${label} must not also exclude the same element`)
    if (declaredOutsideBoundaries.has(id)) {
      errors.push(`${label} must not also classify the same element as an outside boundary`)
    }
    if (protectedHeadIds.has(id) && !declaredOutsideBoundaries.has(id)) {
      errors.push(
        `${id} in ${label} has visible learner answer-demand evidence; `
        + 'submit it as a question or mark the same id as an outside boundary after inspecting the complete source',
      )
    }
    declaredNonQuestionHeads.add(id)
  }
  const explicitlyClaimedIds = new Set(selected.flatMap(question => (
    question.additional.map(element => element.id as string)
  )))
  const declaredRetainedImages = new Set<string>()
  for (const [index, id] of (draft.retainedImageElementIds ?? []).entries()) {
    const label = `retainedImageElementIds[${String(index)}]`
    const element = byId.get(id)
    if (element === undefined) {
      const error = `${label} is not present in the inspected source`
      errors.push(error)
      referenceErrors.push(error)
    } else if (element.element.type !== 'image') {
      errors.push(`${label} must reference an image element`)
    }
    if (seenIds.has(id)) errors.push(`${label} must not also be a question head`)
    if (declaredRetainedImages.has(id)) {
      const error = `${label} duplicates an earlier retained image decision`
      errors.push(error)
      referenceErrors.push(error)
    }
    if (declaredExcluded.has(id)) errors.push(`${label} must not also exclude the same image`)
    if (explicitlyClaimedIds.has(id)) errors.push(`${label} must not also assign the same image through additionalElementIds`)
    declaredRetainedImages.add(id)
  }
  for (const id of declaredExcluded) {
    const image = byId.get(id)
    if (image?.element.type !== 'image') continue
    const connectedCaptionIds = imageCompanionElements(elements, image, padding)
      .map(element => element.id as string)
      .filter(companionId => !declaredExcluded.has(companionId))
    if (connectedCaptionIds.length > 0) {
      errors.push(
        `excluded image ${id} has connected caption element(s) ${connectedCaptionIds.join(', ')}; `
        + 'exclude the complete visual block or retain/assign the image',
      )
    }
  }
  const unclassifiedCandidates = [...requiredHeadCandidateIds].filter(id => (
    !seenIds.has(id)
      && !declaredNonQuestionHeads.has(id)
      && !declaredOutsideBoundaries.has(id)
      && !declaredExcluded.has(id)
  ))
  if (unclassifiedCandidates.length > 0) {
    errors.push(`possible question-head candidates require an explicit decision: ${unclassifiedCandidates.join(', ')}`)
  }
  const unclassifiedImages = [...requiredImageElementIds].filter(id => (
    !seenIds.has(id)
      && !declaredRetainedImages.has(id)
      && !declaredExcluded.has(id)
      && !explicitlyClaimedIds.has(id)
  ))
  if (unclassifiedImages.length > 0) {
    errors.push(`image elements require an explicit retained, excluded, or additional ownership decision: ${unclassifiedImages.join(', ')}`)
  }
  const semanticStops = elements.filter(element => isContextualSemanticBoundaryElement(element, elements))
  const contextHeadStops = corePageIndexes === undefined
    ? []
    : elements.filter(element => !corePageIndexes.has(element.page.pageIndex) && isPossibleQuestionHead(element))
  const outsideBoundaries = elements.filter(element => declaredOutsideBoundaries.has(element.id as string))
  const ownershipStops = [...semanticStops, ...contextHeadStops]
  const excluded = new Set([
    ...declaredExcluded,
    ...declaredOutsideBoundaries,
    ...semanticStops.map(element => element.id as string),
  ])
  const selectedHeadIds = new Set(selected.map(question => question.head.id as string))
  const baselineOwners = allowSamePageReassignment
    ? undefined
    : assignQuestionOwners(
      elements,
      selected,
      end,
      ownershipStops,
      outsideBoundaries,
      excluded,
      new Map(),
      declaredRetainedImages,
    )
  const claimed = new Map<string, number>()
  for (const [questionIndex, question] of selected.entries()) {
    for (const element of question.additional) {
      const id = element.id as string
      const owner = claimed.get(id)
      if (owner !== undefined && owner !== questionIndex) {
        errors.push(`questions[${String(questionIndex)}].additionalElementIds claims an element already claimed by questions[${String(owner)}]`)
      }
      if (excluded.has(id)) {
        errors.push(`questions[${String(questionIndex)}].additionalElementIds claims excluded element ${id}`)
      }
      const crossedSemanticStop = [...outsideBoundaries, ...semanticStops].find(stop => (
        stop.ordinal < element.ordinal
          && (declaredOutsideBoundaries.has(stop.id as string) || semanticStopAppliesToQuestion(question, stop))
      ))
      if (crossedSemanticStop !== undefined) {
        errors.push(
          `questions[${String(questionIndex)}].additionalElementIds claims ${id} across semantic boundary ${String(crossedSemanticStop.id)}`,
        )
      }
      if (question.head.page === element.page) {
        const claimantOverlaps = verticalBoxesOverlap(element.element.bbox, question.head.element.bbox)
        const claimantDistance = horizontalBoxDistance(element.element.bbox, question.head.element.bbox)
        const baselineOwner = baselineOwners?.get(id)
        if (baselineOwner !== undefined && baselineOwner !== questionIndex) {
          errors.push(
            `questions[${String(questionIndex)}].additionalElementIds assigns ${id} away from its automatic same-page owner ${String(selected[baselineOwner]?.head.id)}`,
          )
        }
        const overlappingHead = selected.find((candidate, candidateIndex) => (
          candidateIndex !== questionIndex
            && candidate.head.page === element.page
            && verticalBoxesOverlap(element.element.bbox, candidate.head.element.bbox)
            && horizontalBoxDistance(element.element.bbox, candidate.head.element.bbox) < claimantDistance
        ))
        if (!claimantOverlaps && overlappingHead !== undefined) {
          errors.push(`questions[${String(questionIndex)}].additionalElementIds assigns ${id} across the vertical band of ${String(overlappingHead.head.id)}`)
        }
      }
      claimed.set(id, questionIndex)
    }
  }
  if (errors.length > 0) return { errors, referenceErrors }
  const owners = assignQuestionOwners(
    elements,
    selected,
    end,
    ownershipStops,
    outsideBoundaries,
    excluded,
    claimed,
    declaredRetainedImages,
  )
  for (const [questionIndex, question] of selected.entries()) {
    if (!isCitationOnlyQuestionHead(question.head)) continue
    const ownedContent = elements.some(element => (
      element.id !== question.head.id && owners.get(element.id) === questionIndex
    ))
    if (!ownedContent) {
      errors.push(`questions[${String(questionIndex)}].headElementId is only a citation label without question content; classify it in nonQuestionHeadElementIds`)
    }
  }
  if (errors.length > 0) return { errors, referenceErrors }
  const cropStops = elements.filter(element => (
    selectedHeadIds.has(element.id as string)
      || element === end
      || selected.some(question => question.end === element)
      || ownershipStops.includes(element)
      || outsideBoundaries.includes(element)
  ))
  const laneLandmarks = elements.filter(element => (
    isPossibleQuestionHead(element) || isContextualNumberedTheoryHeading(element, elements)
  ))
  const laneStartsByPageSize = questionLaneStartsByPageSize(laneLandmarks)
  const questions = selected.map((item, index): TeacherSegmentedQuestion => {
    const owned = elements.filter(element => owners.get(element.id as string) === index)
    for (const element of item.additional) {
      if (!owned.includes(element)) owned.push(element)
    }
    const verticalEdit = applyVerticalRegionEdits(
      cropRegions(
        owned,
        pages,
        padding,
        item.head,
        cropStops,
        selectedHeadIds,
        laneStartsByPageSize,
        excluded,
        new Set(item.additional.map(element => element.id as string)),
        maxAutoOwnedGapRatio,
      ),
      item.verticalRegionEdits,
      item,
      selected,
      pages,
    )
    errors.push(...verticalEdit.errors.map(error => `questions[${String(index)}].${error}`))
    const rightEdit = applySourceRightLimitEdits(verticalEdit.regions, item.sourceRightLimitEdits)
    errors.push(...rightEdit.errors.map(error => `questions[${String(index)}].${error}`))
    return {
      sourceHeadId: item.head.id,
      questionNo: index + 1,
      headPageIndex: item.head.page.pageIndex,
      groupIndex: 0,
      regions: rightEdit.regions,
    }
  })
  if (errors.length > 0) return { errors, referenceErrors }
  if (questions.some(question => question.regions.length === 0)) {
    return { errors: ['one or more accepted boundaries produce an empty crop'], referenceErrors }
  }
  return { errors: [], referenceErrors, questions }
}

function verticalBoxesOverlap(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  return left[3] > right[1] && left[1] < right[3]
}

function stopContinuesNearbyText(
  head: IndexedElement,
  stop: IndexedElement,
  elements: readonly IndexedElement[],
): boolean {
  if (stop.page !== head.page || !isSemanticTextElement(stop.element)) return false
  const previous = elements.filter(element => (
    element.page === head.page
      && element.ordinal >= head.ordinal
      && element.ordinal < stop.ordinal
      && isSemanticTextElement(element.element)
      && element.element.bbox[3] <= stop.element.bbox[1]
  )).toSorted((left, right) => right.element.bbox[3] - left.element.bbox[3])[0]
  if (previous === undefined) return false
  const previousHeight = previous.element.bbox[3] - previous.element.bbox[1]
  const stopHeight = stop.element.bbox[3] - stop.element.bbox[1]
  const lineHeight = Math.max(previousHeight, stopHeight)
  const verticalGap = stop.element.bbox[1] - previous.element.bbox[3]
  const alignedLeft = Math.abs(stop.element.bbox[0] - previous.element.bbox[0]) <= 2 * lineHeight
  const previousText = previous.element.text.trim()
  return verticalGap <= 1.5 * lineHeight
    && alignedLeft
    && !/[。.!！?？；;：:)）]$/u.test(previousText)
}

function removeUnsafeQuestionStops(
  draft: BoundaryDraft,
  elements: readonly IndexedElement[],
): BoundaryDraft {
  const elementById = new Map(elements.map(element => [element.id as string, element] as const))
  const selectedHeadOrdinals = draft.questions.flatMap((question) => {
    const element = elementById.get(question.headElementId)
    return element === undefined ? [] : [element.ordinal]
  })
  const selectedHeadIds = new Set(draft.questions.map(question => question.headElementId))
  return {
    ...draft,
    questions: draft.questions.map((question) => {
      if (question.stopBeforeElementId === undefined) return question
      const head = elementById.get(question.headElementId)
      const stop = elementById.get(question.stopBeforeElementId)
      if (head === undefined || stop === undefined) return question
      const crossesAnotherHead = selectedHeadOrdinals.some(ordinal => (
        ordinal > head.ordinal && ordinal < stop.ordinal
      ))
      const cannotBoundQuestion = stop.ordinal <= head.ordinal
        || crossesAnotherHead
        || stopBeginsCrossPageContinuation(head, stop, elements)
        || (stop.page === head.page
          && !selectedHeadIds.has(stop.id)
          && !isContextualSemanticBoundaryElement(stop, elements)
          && (localQuestionContinuationStartPattern.test(stop.element.text)
            || hasVisibleAnswerDemand(stop, elements)
            || stopContinuesNearbyText(head, stop, elements)))
      if (!cannotBoundQuestion) return question
      const { stopBeforeElementId: _ignoredUnsafeStop, ...withoutUnsafeStop } = question
      return withoutUnsafeStop
    }),
  }
}

function expandDefaultBoundaryDraft(
  draft: BoundaryDraft,
  elements: readonly IndexedElement[],
  corePageIndexes: ReadonlySet<number> | undefined,
  padding: number,
  minimumRepeatedImagePages: number,
  repeatedImagePositionToleranceRatio: number,
  forbiddenQuestionHeadIds: ReadonlySet<string>,
  includeDefaultQuestionHeads = true,
): BoundaryDraft {
  const elementById = new Map(elements.map(element => [element.id as string, element] as const))
  const candidateIds = possibleQuestionHeadIds(elements, corePageIndexes)
    .filter(id => !forbiddenQuestionHeadIds.has(id as string))
  const protectedCandidateIds = protectedQuestionHeadIds(elements, candidateIds)
  const submittedQuestions = draft.questions.filter((question) => {
    const element = elementById.get(question.headElementId)
    return !forbiddenQuestionHeadIds.has(question.headElementId)
      && (element === undefined || !isContextualSemanticBoundaryElement(element, elements))
  })
  const submittedHeadIds = new Set(submittedQuestions.map(question => question.headElementId))
  const excludedIds = new Set(draft.excludedElementIds ?? [])
  const nonQuestionHeadElementIds = [...new Set([
    ...(draft.nonQuestionHeadElementIds ?? []).filter(id => !submittedHeadIds.has(id)),
    ...(includeDefaultQuestionHeads
      ? candidateIds.flatMap(candidateId => (
        protectedCandidateIds.has(candidateId as string)
          || submittedHeadIds.has(candidateId as string)
          || excludedIds.has(candidateId as string)
          ? []
          : [candidateId as string]
      ))
      : []),
    ...draft.questions.flatMap((question) => {
      const element = elementById.get(question.headElementId)
      return element !== undefined
        && isContextualSemanticBoundaryElement(element, elements)
        && !excludedIds.has(question.headElementId)
        ? [question.headElementId]
        : []
    }),
  ])]
  const nonQuestionHeadIds = new Set(nonQuestionHeadElementIds)
  const explicitlyClaimedIds = new Set(submittedQuestions.flatMap(question => question.additionalElementIds ?? []))
  const questions: BoundaryDraft['questions'] = [
    ...(includeDefaultQuestionHeads
      ? candidateIds.flatMap(candidateId => (
        !protectedCandidateIds.has(candidateId as string)
          || submittedHeadIds.has(candidateId as string)
          || nonQuestionHeadIds.has(candidateId as string)
          || excludedIds.has(candidateId as string)
          ? []
          : [{ headElementId: candidateId }]
      ))
      : []),
    ...submittedQuestions,
  ]
  const selectedHeads = questions.flatMap((question) => {
    const head = elementById.get(question.headElementId)
    return head === undefined ? [] : [head]
  })
  const selectedHeadIds = new Set(selectedHeads.map(head => head.id as string))
  const repeatedImageIds = repeatedPositionImageIds(
    elements,
    corePageIndexes,
    minimumRepeatedImagePages,
    repeatedImagePositionToleranceRatio,
  )
  const retainedImageElementIds = [...(draft.retainedImageElementIds ?? [])]
  const retainedImageIds = new Set(retainedImageElementIds)
  for (const imageId of imageElementIds(elements, corePageIndexes)) {
    if (retainedImageIds.has(imageId) || excludedIds.has(imageId) || explicitlyClaimedIds.has(imageId)) continue
    const image = elementById.get(imageId)
    const companions = image === undefined ? [] : imageCompanionElements(elements, image, padding)
    const repeatedFurniture = repeatedImageIds.has(imageId)
      && companions.every(companion => (
        !selectedHeadIds.has(companion.id as string)
          && !explicitlyClaimedIds.has(companion.id as string)
          && !nonQuestionHeadIds.has(companion.id as string)
      ))
    if (repeatedFurniture) {
      excludedIds.add(imageId)
      for (const companion of companions) excludedIds.add(companion.id)
      continue
    }
    if (image !== undefined && selectedHeads.filter(head => (
      head.page === image.page && boxesOverlap(head.element.bbox, image.element.bbox)
    )).length > 1) {
      excludedIds.add(imageId)
      continue
    }
    retainedImageElementIds.push(imageId)
    retainedImageIds.add(imageId)
  }
  return {
    ...draft,
    questions,
    nonQuestionHeadElementIds,
    retainedImageElementIds,
    excludedElementIds: [...excludedIds],
  }
}

function fallbackQuestionBoundaries(
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
  elements: readonly IndexedElement[],
  learnerCorePageIndexes: ReadonlySet<number>,
  forbiddenQuestionHeadIds: ReadonlySet<string>,
): readonly TeacherSegmentedQuestion[] | undefined {
  const candidateIds = possibleQuestionHeadIds(elements, learnerCorePageIndexes)
    .filter(id => !forbiddenQuestionHeadIds.has(id as string))
  const expanded = expandDefaultBoundaryDraft({
    headConvention: 'Visible learner answer demands delimit independent questions.',
    questions: [],
  }, elements, learnerCorePageIndexes, request.padding, config.minQuestionRepeatedImagePages,
  config.questionRepeatedImagePositionToleranceRatio, forbiddenQuestionHeadIds)
  const validated = validateBoundaryDraft(
    removeUnsafeQuestionStops(expanded, elements),
    elements,
    request.pages,
    request.padding,
    config.maxSegmentedQuestions,
    new Set(candidateIds),
    new Set(imageElementIds(elements, learnerCorePageIndexes)),
    config.maxQuestionAutoOwnedGapRatio,
    learnerCorePageIndexes,
    protectedQuestionHeadIds(elements, candidateIds),
  )
  return validated.questions
}

function submissionTool(
  name: string,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
  elements: readonly IndexedElement[],
  accepted: Map<string, AcceptedBoundaryDraft>,
  state: BoundarySubmissionState,
  sourceComplete: () => boolean,
  automaticImageDecisions: boolean,
) {
  const corePageIndexes = request.corePageIndexes === undefined
    ? undefined
    : new Set(request.corePageIndexes)
  const answerSectionPages = new Set([
    ...answerSectionPageIndexes(elements),
    ...(request.answerSectionPageIndexes ?? []),
  ])
  const learnerCorePageIndexes = new Set(
    [...(corePageIndexes ?? new Set(request.pages.map(page => page.pageIndex)))]
      .filter(pageIndex => !answerSectionPages.has(pageIndex)),
  )
  const answerSectionElementIdSet = new Set([
    ...answerSectionElementIds(elements),
    ...elements.filter(element => (request.answerSectionPageIndexes ?? []).includes(element.page.pageIndex))
      .map(element => element.id as string),
  ])
  const candidateIds = possibleQuestionHeadIds(elements, learnerCorePageIndexes)
    .filter(id => !answerSectionElementIdSet.has(id as string))
  const protectedCandidateIds = protectedQuestionHeadIds(elements, candidateIds)
  const questionSchema = {
    type: 'array' as const,
    required: true,
    items: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        headElementId: { type: 'string' as const, required: true },
        stopBeforeElementId: {
          type: 'string' as const,
          description: 'First OCR element outside this question. The crop stops before it; omit it to use the next question head.',
        },
        additionalElementIds: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
      },
    },
  } as const
  return defineTool({
    name,
    description: 'Submit one complete semantic boundary draft containing every independent learner question in source order, including heads absent from semanticHints. The Host validates element references, ordering, ownership, and crop geometry without imposing one numbering or document format.',
    parameters: {
      headConvention: { type: 'string', required: true },
      questions: {
        ...questionSchema,
        description: 'Complete ordered list of every independent learner question. A genuine head may be submitted even when semanticHints omitted it.',
      },
      excludedElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: automaticImageDecisions
          ? 'Unavailable in the compact boundary pass. Any submitted id is rejected; later annotated visual review owns pixel removal.'
          : 'OCR elements whose pixels must be removed from every resulting crop.',
      },
      nonQuestionHeadElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: automaticImageDecisions
          ? 'Every semanticHints possibleQuestionHeadId that does not begin an independent question. These elements remain eligible question content.'
          : 'Possible question-head candidates explicitly classified as content that does not begin an independent question. These elements remain eligible question content.',
      },
      outsideBoundaryElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'First semantic OCR element of each title, preamble, summary, answer, or other block that belongs to no question. Each id stops preceding automatic ownership until the next submitted question head and is omitted from crops.',
      },
      retainedImageElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: automaticImageDecisions
          ? 'Only explicit image-retention overrides. Unlisted images default to automatic geometric ownership; do not echo them.'
          : 'Image elements inspected in the page preview and retained for automatic geometric ownership. Do not list images assigned through additionalElementIds.',
      },
      stopBeforeElementId: {
        type: 'string',
        description: 'First OCR element outside the final question. The inspected range stops before it.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args, exec: ToolRunContext) {
      const submittedArgs = args as BoundaryDraft
      if (!sourceComplete()) return Promise.resolve('REJECTED\ninspect every source chunk before submitting boundaries')
      if (automaticImageDecisions && (submittedArgs.excludedElementIds?.length ?? 0) > 0) {
        return Promise.resolve('REJECTED\nexcludedElementIds is unavailable in the compact boundary pass; classify false-positive heads in nonQuestionHeadElementIds and leave pixel removal to Host defaults or annotated visual review')
      }
      const answerSectionHeadIds = submittedArgs.questions.flatMap((question) => {
        return answerSectionElementIdSet.has(question.headElementId)
          ? [question.headElementId]
          : []
      })
      if (answerSectionHeadIds.length > 0) {
        return Promise.resolve(`REJECTED\nquestion heads inside a document answer section are solutions or explanations, not learner questions: ${answerSectionHeadIds.join(', ')}`)
      }
      if (automaticImageDecisions) {
        const submittedQuestionIds = new Set(submittedArgs.questions.map(question => question.headElementId))
        const explicitNonQuestionIds = new Set(submittedArgs.nonQuestionHeadElementIds ?? [])
        const outsideBoundaryIds = new Set(submittedArgs.outsideBoundaryElementIds ?? [])
        const unclassifiedCandidateIds = candidateIds.filter(id => (
          !submittedQuestionIds.has(id as string)
            && !explicitNonQuestionIds.has(id as string)
            && !outsideBoundaryIds.has(id as string)
        ))
        if (unclassifiedCandidateIds.length > 0) {
          return Promise.resolve(`REJECTED\nevery possible question head requires an explicit question or non-question decision: ${unclassifiedCandidateIds.join(', ')}`)
        }
      }
      const fingerprint = JSON.stringify(submittedArgs)
      if (state.seenDrafts.has(fingerprint)) return Promise.resolve('REJECTED\nthis identical rejected draft was already checked; change the reported decisions')
      state.seenDrafts.add(fingerprint)
      const submittedDraft = automaticImageDecisions
        ? expandDefaultBoundaryDraft(
          submittedArgs,
          elements,
          learnerCorePageIndexes,
          request.padding,
          config.minQuestionRepeatedImagePages,
          config.questionRepeatedImagePositionToleranceRatio,
          answerSectionElementIdSet,
          false,
        )
        : submittedArgs
      const draft = removeUnsafeQuestionStops(submittedDraft, elements)
      const validated = validateBoundaryDraft(
        draft,
        elements,
        request.pages,
        request.padding,
        config.maxSegmentedQuestions,
        new Set(candidateIds),
        new Set(imageElementIds(elements, learnerCorePageIndexes)),
        config.maxQuestionAutoOwnedGapRatio,
        corePageIndexes,
        protectedCandidateIds,
        true,
      )
      if (validated.referenceErrors.length === 0) {
        state.submissions += 1
        if (state.submissions > config.maxQuestionBoundarySubmissions) {
          return Promise.resolve('REJECTED\nboundary submission limit reached')
        }
      }
      if (validated.questions === undefined) {
        return Promise.resolve([
          'REJECTED',
          ...(validated.referenceErrors.length === 0
            ? []
            : ['invalid or duplicate element references do not consume the complete-draft submission limit']),
          ...validated.errors,
        ].join('\n'))
      }
      const token = randomUUID()
      accepted.set(token, { token, questions: validated.questions })
      exec.concludeTurn()
      return Promise.resolve(`ACCEPTED\nvalidationToken=${token}`)
    },
  })
}

function validateCropReviewRequest(
  request: TeacherQuestionCropReviewRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): string | undefined {
  const requestError = validateRequest({
    parentSessionId: request.parentSessionId,
    fileName: request.fileName,
    pages: request.pages,
    padding: request.padding,
  }, config)
  if (requestError !== undefined) return requestError
  if (!Number.isSafeInteger(request.groupIndex) || request.groupIndex < 0) return 'groupIndex must be a non-negative integer'
  if (!Number.isSafeInteger(request.recutAttempt) || request.recutAttempt < 0) {
    return 'recutAttempt must be a non-negative integer'
  }
  if (request.corePageIndexes.length === 0) return 'corePageIndexes must not be empty'
  const pageIndexes = new Set(request.pages.map(page => page.pageIndex))
  if (new Set(request.corePageIndexes).size !== request.corePageIndexes.length
    || request.corePageIndexes.some(pageIndex => !pageIndexes.has(pageIndex))) {
    return 'corePageIndexes must be unique inspection-page indexes'
  }
  if (request.answerSectionPageIndexes !== undefined
    && (new Set(request.answerSectionPageIndexes).size !== request.answerSectionPageIndexes.length
      || request.answerSectionPageIndexes.some(pageIndex => !request.corePageIndexes.includes(pageIndex)))) {
    return 'answerSectionPageIndexes must contain unique core page indexes'
  }
  if (request.questions.some(question => question.groupIndex !== request.groupIndex)) {
    return 'every preliminary question must belong to groupIndex'
  }
  const sourceHeadIds = new Set(request.questions.map(question => question.sourceHeadId))
  if (sourceHeadIds.size !== request.questions.length) return 'preliminary sourceHeadId values must be unique'
  const questionNumbers = new Set(request.questions.map(question => question.questionNo))
  if (questionNumbers.size !== request.questions.length) return 'preliminary question numbers must be unique'
  const reviewQuestionIds = new Set(request.reviewQuestionIds)
  if (request.questions.length > 0 && reviewQuestionIds.size === 0) {
    return 'reviewQuestionIds must not be empty when preliminary crops exist'
  }
  if (reviewQuestionIds.size !== request.reviewQuestionIds.length
    || request.reviewQuestionIds.some(id => !sourceHeadIds.has(id))) {
    return 'reviewQuestionIds must be unique preliminary sourceHeadId values'
  }
  const reviewedQuestions = request.questions.filter(question => reviewQuestionIds.has(question.sourceHeadId))
  const reviewedNumbers = new Set(reviewedQuestions.map(question => question.questionNo))
  const cropNumbers = new Set<number>()
  for (const crop of request.crops) {
    if (!reviewedNumbers.has(crop.questionNo) || cropNumbers.has(crop.questionNo)) {
      return 'crop images contain an unknown or duplicate question number'
    }
    if (!Number.isSafeInteger(crop.width) || crop.width < 1
      || !Number.isSafeInteger(crop.height) || crop.height < 1) {
      return `question ${String(crop.questionNo)} crop has invalid dimensions`
    }
    if (decodeCanonicalBase64(crop.contentBase64) === undefined) {
      return `question ${String(crop.questionNo)} crop is not canonical base64`
    }
    cropNumbers.add(crop.questionNo)
  }
  if (cropNumbers.size !== reviewedNumbers.size) {
    return 'crop images must include every reviewed question exactly once'
  }
  const previewPages = new Set<number>()
  for (const preview of request.pagePreviews) {
    if (!pageIndexes.has(preview.pageIndex) || previewPages.has(preview.pageIndex)) {
      return 'page previews contain an unknown or duplicate page index'
    }
    if (!Number.isSafeInteger(preview.width) || preview.width < 1
      || !Number.isSafeInteger(preview.height) || preview.height < 1) {
      return `page ${String(preview.pageIndex + 1)} preview has invalid dimensions`
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(preview.mediaType)) {
      return `page ${String(preview.pageIndex + 1)} preview has an unsupported media type`
    }
    if (decodeCanonicalBase64(preview.contentBase64) === undefined) {
      return `page ${String(preview.pageIndex + 1)} preview is not canonical base64`
    }
    previewPages.add(preview.pageIndex)
  }
  const reviewsCompleteGroup = reviewQuestionIds.size === sourceHeadIds.size
  const requiredPreviewPages = new Set(reviewedQuestions.length === 0 || reviewsCompleteGroup
    ? request.corePageIndexes
    : reviewedQuestions.flatMap(question => question.regions.map(region => region.pageIndex)))
  return [...requiredPreviewPages].every(pageIndex => previewPages.has(pageIndex))
    ? undefined
    : reviewsCompleteGroup
      ? 'a complete-group review must preview every core page'
      : 'page previews must cover every reviewed question region'
}

function cropReviewFindingsTool(
  name: string,
  request: TeacherQuestionCropReviewRequest,
  inspectedImageIds: ReadonlySet<string>,
  expectedImageIds: ReadonlySet<string>,
  validCropIds: ReadonlySet<string>,
  validPageIds: ReadonlySet<string>,
  validMissingQuestionPageIds: ReadonlySet<string>,
  answerSectionPageIds: ReadonlySet<string>,
  elements: readonly IndexedElement[],
  state: CropReviewState,
  accepted: Map<string, AcceptedCropReview>,
  maxSubmissions: number,
  allowMissingQuestionFindings: boolean,
  attentionByCropId: ReadonlyMap<string, CropReviewAttention>,
  compactVerification: boolean,
) {
  const finalize = (exec: ToolRunContext): string => {
    state.findingSubmissions += 1
    if (state.findingSubmissions > maxSubmissions) return 'REJECTED\nvisual finding submission limit reached'
    const unclassifiedCropIds = [...validCropIds].filter(id => (
      !state.draftVerifications.has(id) && !state.draftFindings.has(`crop:${id}`)
    ))
    if (unclassifiedCropIds.length > 0) {
      return `REJECTED\nevery requested crop requires a verified or defective classification: ${unclassifiedCropIds.join(', ')}`
    }
    const findings = [...state.draftFindings.values()]
    state.findings = findings
    state.seenRevisionDrafts.clear()
    if (findings.length > 0) {
      if (compactVerification) exec.concludeTurn()
      return `DEFECTS_RECORDED\nrepairTargetIds=${JSON.stringify(cropReviewRepairTargetIds(state))}\ninspect chunk 0 for every repair target through the named OCR repair-context tool, then inspect any remaining numbered chunks it reports and submit corrections; recorded visual defects cannot be withdrawn in this run`
    }
    const token = randomUUID()
    accepted.set(token, {
      token,
      decision: 'accepted',
      affectedQuestionIds: [],
      questions: request.questions,
    })
    exec.concludeTurn()
    return `ACCEPTED\nvalidationToken=${token}`
  }
  return defineTool({
    name,
    description: compactVerification
      ? 'Submit one complete annotated-page classification. verifiedCrops lists every visibly complete crop exactly once with its learner answer demand and visible task evidence, attentionChecks resolves every geometry warning on a verified crop, and findings contains every defective crop or independent source question with no crop.'
      : 'Submit exactly one complete classification after inspecting every requested source page and crop. verifiedCrops identifies each complete crop\'s answer demand, actual content at all four edges, required visuals, and any visualAttention resolution. findings contains every crop defect and any independent source question with no crop. Every requested crop must appear in exactly one array.',
    parameters: {
      ...(compactVerification
        ? {
          verifiedCrops: {
            type: 'array' as const,
            required: true,
            items: {
              type: 'object' as const,
              additionalProperties: false,
              properties: {
                cropId: { type: 'string' as const, required: true },
                answerDemand: {
                  type: 'string' as const,
                  required: true,
                  description: 'Exact visible response the learner must produce. A topic, formula, method, theory summary, answer, solution, or crop label is not an answer demand.',
                },
                evidence: {
                  type: 'string' as const,
                  required: true,
                  description: 'Visible stem words, options, subparts, proof request, calculation request, or response mark that establishes this answer demand. A magenta box or Q label is not task evidence.',
                },
              },
            },
            description: 'Every complete crop, each exactly once, with its visible learner task stated explicitly.',
          },
          attentionChecks: {
            type: 'array' as const,
            description: 'Visible resolution for every visualAttention warning attached to a verified crop.',
            items: {
              type: 'object' as const,
              additionalProperties: false,
              properties: {
                cropId: { type: 'string' as const, required: true },
                evidence: { type: 'string' as const, required: true },
              },
            },
          },
        }
        : {
          verifiedCrops: {
            type: 'array' as const,
            required: true,
            items: {
              type: 'object' as const,
              additionalProperties: false,
              properties: {
                cropId: { type: 'string' as const, required: true },
                answerDemand: {
                  type: 'string' as const,
                  required: true,
                  description: 'Visible task, choice, blank, proof, calculation, or other response the learner must produce. Numbering or a topic title is not an answer demand.',
                },
                evidence: { type: 'string' as const, required: true },
                topmostVisibleContent: {
                  type: 'string' as const,
                  required: true,
                  description: 'Actual topmost non-white pixels visible in the crop, including unrelated or clipped content.',
                },
                bottommostVisibleContent: {
                  type: 'string' as const,
                  required: true,
                  description: 'Actual bottommost non-white pixels visible in the crop, including detached marks after whitespace.',
                },
                leftmostVisibleContent: {
                  type: 'string' as const,
                  required: true,
                  description: 'Actual leftmost non-white pixels visible in the crop, including clipped or unrelated content.',
                },
                rightmostVisibleContent: {
                  type: 'string' as const,
                  required: true,
                  description: 'Actual rightmost non-white pixels visible before intentional blank padding, including neighboring content or page furniture.',
                },
                requiredVisuals: {
                  type: 'string' as const,
                  required: true,
                  description: 'Every source diagram, table, or other visual required by the task and where it is visibly present in the crop; write "none" only when the source task requires none.',
                },
                attentionEvidence: {
                  type: 'string' as const,
                  description: 'Required when task metadata lists visualAttention for this crop. Resolve every listed geometry warning against visible source and crop pixels.',
                },
              },
            },
          },
        }),
      findings: {
        type: 'array',
        description: 'Every defective crop or independent source question with no crop. Omit only when the verified list classifies every requested crop.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cropId: { type: 'string' },
            pageId: { type: 'string' },
            missingQuestionHead: {
              type: 'string',
              description: 'Visible printed head of an independent source question that has no listed crop. Valid only with pageId and without cropId.',
            },
            repairIntents: {
              type: 'array',
              required: true,
              items: { type: 'string', enum: [...cropRepairIntents] },
              description: 'Declare every boundary direction or content/removal operation for a crop defect. Use [] only for a page-only missing-question finding.',
            },
            issue: {
              type: 'string',
              required: true,
              description: 'Concise defect statement that names the visible pixels proving the defect.',
            },
            evidence: {
              type: 'string',
              description: 'Optional additional visible detail beyond issue. When omitted, issue is the finding evidence.',
            },
            outsideCropEvidence: {
              type: 'string',
              description: 'Required for expand-top or expand-bottom. Name the first required source pixels visibly outside the crop\'s magenta rectangle and their direction from that rectangle.',
            },
            insideCropEvidence: {
              type: 'string',
              description: 'Required for trim-top, trim-bottom, trim-right, or remove-crop. Name the unwanted pixels visibly present inside the actual rendered crop.',
            },
          },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args, exec: ToolRunContext) {
      const submission = args as typeof args & {
        readonly verifiedCrops?: readonly (CompactCropReviewVerification
          | (CropReviewVerification & { readonly cropId: string }))[]
        readonly attentionChecks?: readonly { readonly cropId: string; readonly evidence: string }[]
      }
      if (accepted.size > 0) return Promise.resolve('REJECTED\nthis review already has an accepted result')
      if (state.findings !== undefined) {
        return Promise.resolve('REJECTED\nrecorded visual defects cannot be replaced or withdrawn; inspect their repair contexts and submit a correction')
      }
      if (![...expectedImageIds].every(id => inspectedImageIds.has(id))) {
        return Promise.resolve('REJECTED\ninspect every requested source-page preview and question crop before submitting findings')
      }
      const batchFindings = args.findings ?? []
      const findings: CropReviewFinding[] = []
      const defectiveCropIds = new Set<string>()
      for (const [index, finding] of batchFindings.entries()) {
        const label = `findings[${String(index)}]`
        const repairIntents = finding.repairIntents
        const issue = finding.issue.trim()
        const rawEvidence: unknown = Reflect.get(finding, 'evidence')
        const evidence = typeof rawEvidence === 'string' ? rawEvidence.trim() || issue : issue
        if (finding.cropId === undefined && finding.pageId === undefined) {
          return Promise.resolve(`REJECTED\n${label} must cite cropId or pageId`)
        }
        if (finding.cropId !== undefined && !validCropIds.has(finding.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId is not a requested crop`)
        }
        if (finding.pageId !== undefined && !validPageIds.has(finding.pageId)) {
          return Promise.resolve(`REJECTED\n${label}.pageId is not a supplied source page`)
        }
        if (finding.cropId === undefined) {
          if (finding.pageId === undefined) {
            return Promise.resolve(`REJECTED\n${label} missing-question finding requires pageId`)
          }
          if (!validMissingQuestionPageIds.has(finding.pageId)) {
            return Promise.resolve(`REJECTED\n${label} missing-question finding must cite a core page; adjacent pages are read-only continuation context`)
          }
          if (answerSectionPageIds.has(finding.pageId)) {
            return Promise.resolve(`REJECTED\n${label} cites a document answer-section page; numbered solutions and explanations are not missing learner questions`)
          }
          if (finding.missingQuestionHead === undefined || finding.missingQuestionHead.trim() === '') {
            return Promise.resolve(`REJECTED\n${label} pageId-only finding requires missingQuestionHead for the source question with no listed crop`)
          }
          if (!allowMissingQuestionFindings) {
            return Promise.resolve(`REJECTED\n${label} pageId-only missing-question finding is forbidden during a crop-local recut; unlisted questions remain unchanged`)
          }
          if (repairIntents.length > 0) {
            return Promise.resolve(`REJECTED\n${label} pageId-only missing-question finding must not contain crop repairIntents`)
          }
        } else if (finding.missingQuestionHead !== undefined) {
          return Promise.resolve(`REJECTED\n${label}.missingQuestionHead is only valid without cropId`)
        } else if (repairIntents.length === 0) {
          return Promise.resolve(`REJECTED\n${label} crop defect requires at least one repairIntent`)
        } else if (new Set(repairIntents).size !== repairIntents.length) {
          return Promise.resolve(`REJECTED\n${label}.repairIntents must not contain duplicates`)
        } else if ((repairIntents.includes('expand-top') && repairIntents.includes('trim-top'))
          || (repairIntents.includes('expand-bottom') && repairIntents.includes('trim-bottom'))) {
          return Promise.resolve(`REJECTED\n${label}.repairIntents must not expand and trim the same crop edge`)
        } else if (repairIntents.includes('remove-crop') && repairIntents.length !== 1) {
          return Promise.resolve(`REJECTED\n${label} remove-crop must be the only repairIntent for a spurious crop`)
        }
        if (issue === '') {
          return Promise.resolve(`REJECTED\n${label} must contain a concise issue naming visible evidence`)
        }
        const expandsCrop = repairIntents.includes('expand-top') || repairIntents.includes('expand-bottom')
        const trimsCrop = repairIntents.includes('trim-top')
          || repairIntents.includes('trim-bottom')
          || repairIntents.includes('trim-right')
          || repairIntents.includes('remove-crop')
        if (compactVerification && finding.cropId !== undefined && expandsCrop) {
          if (finding.outsideCropEvidence === undefined || finding.outsideCropEvidence.trim() === '') {
            return Promise.resolve(`REJECTED\n${label} expansion requires outsideCropEvidence naming required pixels visibly outside the magenta crop rectangle`)
          }
          if (insideAnnotatedRegionPattern.test(finding.outsideCropEvidence)) {
            return Promise.resolve(`REJECTED\n${label}.outsideCropEvidence describes pixels inside the annotated crop region; those pixels are already present in the rendered crop`)
          }
        }
        if (compactVerification && finding.cropId !== undefined && trimsCrop
          && (finding.insideCropEvidence === undefined || finding.insideCropEvidence.trim() === '')) {
          return Promise.resolve(`REJECTED\n${label} trimming requires insideCropEvidence naming unwanted pixels visibly present inside the actual rendered crop`)
        }
        if (compactVerification && finding.cropId !== undefined
          && repairIntents.includes('reassign-content')
          && missingRequiredContentFindingPattern.test(`${issue}\n${evidence}`)) {
          const question = request.questions.find(candidate => `crop-${String(candidate.sourceHeadId)}` === finding.cropId)
          if (question !== undefined && unownedRequiredQuestionElementIds(question, elements).size === 0) {
            return Promise.resolve(`REJECTED\n${label} claims missing content although the crop owns every OCR element before the next question or section; page-binding lines and blank width are not evidence of a cut-off continuation`)
          }
        }
        if (compactVerification && finding.cropId !== undefined
          && (repairIntents.includes('trim-top') || repairIntents.includes('trim-bottom'))
          && learnerFacingTrimEvidencePattern.test(`${issue}\n${evidence}\n${finding.insideCropEvidence ?? ''}`)) {
          const question = request.questions.find(candidate => `crop-${String(candidate.sourceHeadId)}` === finding.cropId)
          const requiredIds = question === undefined ? new Set<string>() : requiredQuestionTextIds(question, elements)
          const hasSampledTextOutsideQuestion = question !== undefined && elements.some(element => (
            isSemanticTextElement(element.element)
              && questionFullyOwnsElement(question, element)
              && !requiredIds.has(element.id as string)
          ))
          if (!hasSampledTextOutsideQuestion) {
            return Promise.resolve(`REJECTED\n${label}.insideCropEvidence identifies learner-facing stem, subpart, condition, or supplied hint before the next semantic boundary; classify the crop as complete unless different unwanted pixels are visibly present`)
          }
        }
        if ((repairIntents.includes('expand-top') || repairIntents.includes('expand-bottom'))
          && answerDemandedAsMissingPattern.test(`${issue}\n${evidence}`)) {
          return Promise.resolve(`REJECTED\n${label} must not expand a learner crop to include an answer, solution, or explanation; classify visible answer residue with a trim repairIntent`)
        }
        if (uncertainVisualFindingPattern.test(`${issue}\n${evidence}`)) {
          return Promise.resolve(`REJECTED\n${label} must report a visibly confirmed defect, not a possible or suspected one`)
        }
        if (compactVerification
          && explicitNonDefectFindingPattern.test(`${issue}\n${evidence}\n${finding.insideCropEvidence ?? ''}`)) {
          return Promise.resolve(`REJECTED\n${label} describes an already-correct crop or states that no defect is visible; classify it as verified instead`)
        }
        findings.push({
          ...(finding.cropId === undefined ? {} : { cropId: finding.cropId }),
          ...(finding.pageId === undefined ? {} : { pageId: finding.pageId }),
          ...(finding.missingQuestionHead === undefined
            ? {}
            : { missingQuestionHead: finding.missingQuestionHead.trim() }),
          repairIntents: finding.repairIntents,
          issue,
          evidence,
          ...(finding.outsideCropEvidence === undefined
            ? {}
            : { outsideCropEvidence: finding.outsideCropEvidence.trim() }),
          ...(finding.insideCropEvidence === undefined
            ? {}
            : { insideCropEvidence: finding.insideCropEvidence.trim() }),
        })
        if (finding.cropId !== undefined) defectiveCropIds.add(finding.cropId)
      }
      if (compactVerification) {
        const verifiedCropIds = new Set<string>()
        const compactVerifications = new Map<string, CompactCropReviewVerification>()
        for (const [index, verification] of submission.verifiedCrops.entries()) {
          const label = `verifiedCrops[${String(index)}]`
          if (!validCropIds.has(verification.cropId)) {
            return Promise.resolve(`REJECTED\n${label}.cropId is not a requested crop`)
          }
          if (verifiedCropIds.has(verification.cropId)) {
            return Promise.resolve(`REJECTED\n${label}.cropId duplicates an earlier verified crop`)
          }
          if (defectiveCropIds.has(verification.cropId)) {
            return Promise.resolve(`REJECTED\n${label}.cropId is also classified as defective`)
          }
          const answerDemand = verification.answerDemand.trim()
          if (answerDemand === '') {
            return Promise.resolve(`REJECTED\n${label}.answerDemand must identify the visible response required from the learner`)
          }
          const evidence = verification.evidence.trim()
          if (evidence === '') {
            return Promise.resolve(`REJECTED\n${label}.evidence must name visible task pixels that establish the answer demand`)
          }
          verifiedCropIds.add(verification.cropId)
          compactVerifications.set(verification.cropId, {
            cropId: verification.cropId,
            answerDemand,
            evidence,
          })
        }
        const attentionEvidence = new Map<string, string>()
        for (const [index, check] of (submission.attentionChecks ?? []).entries()) {
          const label = `attentionChecks[${String(index)}]`
          if (!verifiedCropIds.has(check.cropId)) {
            return Promise.resolve(`REJECTED\n${label}.cropId must identify a verified crop`)
          }
          if (!attentionByCropId.has(check.cropId)) {
            return Promise.resolve(`REJECTED\n${label}.cropId has no visualAttention warning`)
          }
          if (attentionEvidence.has(check.cropId)) {
            return Promise.resolve(`REJECTED\n${label}.cropId duplicates an earlier attention check`)
          }
          if (check.evidence.trim() === '') {
            return Promise.resolve(`REJECTED\n${label}.evidence must resolve every listed geometry warning against visible pixels`)
          }
          attentionEvidence.set(check.cropId, check.evidence)
        }
        const unresolvedAttention = [...attentionByCropId.keys()].filter(cropId => (
          verifiedCropIds.has(cropId) && !attentionEvidence.has(cropId)
        ))
        if (unresolvedAttention.length > 0) {
          return Promise.resolve(`REJECTED\nverified crops with visualAttention require attentionChecks: ${unresolvedAttention.join(', ')}`)
        }
        state.draftFindings.clear()
        state.draftVerifications.clear()
        for (const finding of findings) state.draftFindings.set(cropReviewFindingKey(finding), finding)
        for (const cropId of verifiedCropIds) {
          const verification = compactVerifications.get(cropId)
          if (verification === undefined) throw new Error('compact crop verification is missing')
          const geometryEvidence = attentionEvidence.get(cropId) ?? verification.evidence
          state.draftVerifications.set(cropId, {
            answerDemand: verification.answerDemand,
            evidence: verification.evidence,
            topmostVisibleContent: geometryEvidence,
            bottommostVisibleContent: geometryEvidence,
            leftmostVisibleContent: geometryEvidence,
            rightmostVisibleContent: geometryEvidence,
            requiredVisuals: geometryEvidence,
            ...(attentionEvidence.has(cropId) ? { attentionEvidence: geometryEvidence } : {}),
          })
        }
        return Promise.resolve(finalize(exec))
      }
      const batchVerifications = submission.verifiedCrops as readonly (
        CropReviewVerification & { readonly cropId: string }
      )[]
      const verifiedCropIds = new Set<string>()
      for (const [index, verification] of batchVerifications.entries()) {
        const label = `verifiedCrops[${String(index)}]`
        if (!validCropIds.has(verification.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId is not a requested crop`)
        }
        if (verifiedCropIds.has(verification.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId duplicates an earlier verified crop`)
        }
        if (defectiveCropIds.has(verification.cropId)) {
          return Promise.resolve(`REJECTED\n${label}.cropId is also classified as defective`)
        }
        if (verification.answerDemand.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.answerDemand must identify the visible response required from the learner`)
        }
        if (verification.evidence.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.evidence must summarize visible first and last owned content`)
        }
        if (verification.topmostVisibleContent.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.topmostVisibleContent must name the actual topmost visible non-white content`)
        }
        if (verification.bottommostVisibleContent.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.bottommostVisibleContent must name the actual bottommost visible non-white content`)
        }
        if (verification.leftmostVisibleContent.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.leftmostVisibleContent must name the actual leftmost visible non-white content`)
        }
        if (verification.rightmostVisibleContent.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.rightmostVisibleContent must name the actual rightmost visible non-white content before blank padding`)
        }
        if (verification.requiredVisuals.trim() === '') {
          return Promise.resolve(`REJECTED\n${label}.requiredVisuals must compare every required source visual with the crop`)
        }
        if (attentionByCropId.has(verification.cropId)
          && (verification.attentionEvidence === undefined || verification.attentionEvidence.trim() === '')) {
          return Promise.resolve(`REJECTED\n${label} has visualAttention flags; resolve every flag in attentionEvidence or report a defect`)
        }
        verifiedCropIds.add(verification.cropId)
      }
      state.draftFindings.clear()
      state.draftVerifications.clear()
      for (const finding of findings) state.draftFindings.set(cropReviewFindingKey(finding), finding)
      for (const verification of batchVerifications) {
        state.draftVerifications.set(verification.cropId, {
          answerDemand: verification.answerDemand,
          evidence: verification.evidence,
          topmostVisibleContent: verification.topmostVisibleContent,
          bottommostVisibleContent: verification.bottommostVisibleContent,
          leftmostVisibleContent: verification.leftmostVisibleContent,
          rightmostVisibleContent: verification.rightmostVisibleContent,
          requiredVisuals: verification.requiredVisuals,
          ...(verification.attentionEvidence === undefined
            ? {}
            : { attentionEvidence: verification.attentionEvidence }),
        })
      }
      return Promise.resolve(finalize(exec))
    },
  })
}

function questionGeometryFingerprint(question: TeacherSegmentedQuestion): string {
  return JSON.stringify({
    sourceHeadId: question.sourceHeadId,
    headPageIndex: question.headPageIndex,
    regions: question.regions,
  })
}

function sampledQuestionImageIds(
  question: TeacherSegmentedQuestion,
  elements: readonly IndexedElement[],
): ReadonlySet<string> {
  return new Set(elements.flatMap((element) => {
    if (element.element.type !== 'image') return []
    const sampled = question.regions.some(region => (
      region.pageIndex === element.page.pageIndex
        && boxesOverlap([region.left, region.top, region.rightLimit, region.bottom], element.element.bbox)
        && !region.excludedAreas.some(area => (
          area[0] <= element.element.bbox[0]
            && area[1] <= element.element.bbox[1]
            && area[2] >= element.element.bbox[2]
            && area[3] >= element.element.bbox[3]
        ))
    ))
    return sampled ? [element.id] : []
  }))
}

function questionFullyOwnsElement(
  question: TeacherSegmentedQuestion,
  element: IndexedElement,
): boolean {
  const [left, top, right, bottom] = element.element.bbox
  return question.regions.some(region => (
    region.pageIndex === element.page.pageIndex
      && region.left <= left
      && region.top <= top
      && region.right >= right
      && region.bottom >= bottom
      && !region.excludedAreas.some(area => boxesOverlap(area, element.element.bbox))
  ))
}

function requiredQuestionTextIds(
  question: TeacherSegmentedQuestion,
  elements: readonly IndexedElement[],
): ReadonlySet<string> {
  const head = elements.find(element => element.id === question.sourceHeadId)
  if (head === undefined) return new Set()
  const stop = elements.find(element => (
    element.ordinal > head.ordinal
      && (isContextualSemanticBoundaryElement(element, elements) || isPossibleQuestionHead(element))
  ))
  return new Set(elements.flatMap(element => (
    element.ordinal >= head.ordinal
      && (stop === undefined || element.ordinal < stop.ordinal)
      && isSemanticTextElement(element.element)
      && questionFullyOwnsElement(question, element)
      ? [element.id as string]
      : []
  )))
}

function unownedRequiredQuestionElementIds(
  question: TeacherSegmentedQuestion,
  elements: readonly IndexedElement[],
): ReadonlySet<string> {
  const head = elements.find(element => element.id === question.sourceHeadId)
  if (head === undefined) return new Set()
  const stop = elements.find(element => (
    element.ordinal > head.ordinal
      && (isContextualSemanticBoundaryElement(element, elements) || isPossibleQuestionHead(element))
  ))
  return new Set(elements.flatMap(element => (
    element.ordinal >= head.ordinal
      && (stop === undefined || element.ordinal < stop.ordinal)
      && (isSemanticTextElement(element.element)
        || element.element.type === 'image'
        || element.element.type === 'table')
      && !questionFullyOwnsElement(question, element)
      ? [element.id as string]
      : []
  )))
}

function extendQuestionWithAdditionalElements(
  question: TeacherSegmentedQuestion,
  additionalIds: readonly string[],
  elements: readonly IndexedElement[],
  padding: number,
): TeacherSegmentedQuestion {
  const byId = new Map(elements.map(element => [element.id as string, element] as const))
  const regions = question.regions.map(region => ({ ...region }))
  for (const id of additionalIds) {
    const additional = byId.get(id)
    if (additional === undefined) continue
    const [boxLeft, boxTop, boxRight, boxBottom] = additional.element.bbox
    const left = Math.max(0, boxLeft - padding)
    const top = Math.max(0, boxTop - padding)
    const right = Math.min(additional.page.width, boxRight + padding)
    const bottom = Math.min(additional.page.height, boxBottom + padding)
    const index = regions.findIndex(region => region.pageIndex === additional.page.pageIndex)
    const current = regions[index]
    if (current === undefined) {
      regions.push({
        pageIndex: additional.page.pageIndex,
        left,
        top,
        right,
        rightLimit: additional.page.width,
        bottom,
        excludedAreas: [],
        pageWidth: additional.page.width,
        pageHeight: additional.page.height,
      })
      continue
    }
    regions[index] = {
      ...current,
      top: Math.min(current.top, top),
      right: Math.min(current.rightLimit, Math.max(current.right, right)),
      bottom: Math.max(current.bottom, bottom),
      excludedAreas: current.excludedAreas.filter(area => !boxesOverlap(area, additional.element.bbox)),
    }
  }
  regions.sort((left, right) => left.pageIndex - right.pageIndex)
  return { ...question, regions }
}

function cropReviewRevisionTool(
  name: string,
  request: TeacherQuestionCropReviewRequest,
  config: TeacherQuestionSegmentationAgentConfig,
  elements: readonly IndexedElement[],
  cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId>,
  state: CropReviewState,
  accepted: Map<string, AcceptedCropReview>,
  evidenceComplete: () => boolean,
) {
  return defineTool({
    name,
    description: 'Correct visually defective boundaries after every bounded repair-context chunk is inspected. Crop-cited findings are merged by stable question head and cannot modify uncited questions. removedCropIds locally deletes confirmed spurious crops whose finding declares remove-crop. A page-only finding with missingQuestionHead identifies a wholly missing question and requires replacement of the complete group. A previously sampled image can disappear only through an explicit reassign-content decision that either preserves it in another crop or lists it in excludedElementIds.',
    parameters: {
      headConvention: { type: 'string', required: true },
      questions: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            headElementId: { type: 'string', required: true },
            stopBeforeElementId: {
              type: 'string',
              description: 'First OCR element outside this question. The crop stops before it; never use the question\'s final owned element.',
            },
            additionalElementIds: { type: 'array', items: { type: 'string' } },
            verticalRegionEdits: {
              type: 'array',
              description: 'Optional visual correction of top or bottom only, in OCR page units. Horizontal crop coordinates remain Host-owned.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  pageIndex: { type: 'integer', required: true },
                  top: { type: 'number' },
                  bottom: { type: 'number' },
                },
              },
            },
            sourceRightLimitEdits: {
              type: 'array',
              description: 'Optional crop-local reduction of source pixels sampled on the right. It preserves the fixed left edge and document-wide output width.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  pageIndex: { type: 'integer', required: true },
                  rightLimit: { type: 'number', required: true },
                },
              },
            },
          },
        },
      },
      removedCropIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Spurious crop ids to remove locally. Every id requires a finding for that crop with repairIntents=["remove-crop"].',
      },
      excludedElementIds: { type: 'array', items: { type: 'string' } },
      nonQuestionHeadElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Possible question-head candidates classified as non-head content during a complete-group replacement.',
      },
      outsideBoundaryElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'First semantic OCR element of each non-question block. It stops preceding automatic ownership until the next submitted question head.',
      },
      retainedImageElementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Image elements retained after preview inspection during a complete-group replacement.',
      },
      stopBeforeElementId: {
        type: 'string',
        description: 'First OCR element outside the final question. The inspected range stops before it.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args, exec: ToolRunContext) {
      if ((state.findings?.length ?? 0) === 0) {
        return Promise.resolve('REJECTED\nrecord at least one visual defect before revising boundaries')
      }
      if (!evidenceComplete()) {
        return Promise.resolve('REJECTED\ninspect every listed OCR source chunk before replacing boundaries')
      }
      const fingerprint = JSON.stringify(args)
      if (state.seenRevisionDrafts.has(fingerprint)) {
        return Promise.resolve('REJECTED\nthis identical rejected draft was already checked; change the reported decisions')
      }
      state.seenRevisionDrafts.add(fingerprint)
      const citedIds = new Set<TeacherQuestionLayoutElementId>()
      const findingByQuestionId = new Map<TeacherQuestionLayoutElementId, CropReviewFinding>()
      const currentById = new Map(request.questions.map(question => [question.sourceHeadId, question] as const))
      const pageOnlyFindings = (state.findings ?? []).filter(finding => (
        finding.pageId !== undefined && finding.cropId === undefined
      ))
      for (const finding of state.findings ?? []) {
        if (finding.cropId === undefined) continue
        const id = cropQuestionIdByPreviewId.get(finding.cropId)
        if (id !== undefined) {
          citedIds.add(id)
          findingByQuestionId.set(id, finding)
        }
      }
      const requestedRemovalCropIds = args.removedCropIds ?? []
      if (new Set(requestedRemovalCropIds).size !== requestedRemovalCropIds.length) {
        return Promise.resolve('REJECTED\nremovedCropIds must not contain duplicates')
      }
      const removedQuestionIds = new Set<TeacherQuestionLayoutElementId>()
      for (const cropId of requestedRemovalCropIds) {
        const questionId = cropQuestionIdByPreviewId.get(cropId)
        if (questionId === undefined || !currentById.has(questionId)) {
          return Promise.resolve(`REJECTED\nremovedCropIds contains an unknown requested crop: ${cropId}`)
        }
        const removalFinding = (state.findings ?? []).find(finding => (
          finding.cropId === cropId
            && (finding.repairIntents ?? []).includes('remove-crop')
        ))
        if (removalFinding === undefined) {
          return Promise.resolve(`REJECTED\nremoved crop ${cropId} requires a crop finding with repairIntents=["remove-crop"]`)
        }
        removedQuestionIds.add(questionId)
        citedIds.add(questionId)
      }
      const hasGroupFinding = pageOnlyFindings.length > 0
      const submittedHeadIds = new Set(args.questions.map(question => question.headElementId))
      const removedAndSubmittedIds = [...removedQuestionIds].filter(id => submittedHeadIds.has(id as string))
      if (removedAndSubmittedIds.length > 0) {
        return Promise.resolve(`REJECTED\nremoved crops must not also be submitted as questions: ${removedAndSubmittedIds.join(', ')}`)
      }
      const boundaryDraftArgs: BoundaryDraft = {
        headConvention: args.headConvention,
        questions: args.questions,
        ...(args.excludedElementIds === undefined ? {} : { excludedElementIds: args.excludedElementIds }),
        ...(args.nonQuestionHeadElementIds === undefined
          ? {}
          : { nonQuestionHeadElementIds: args.nonQuestionHeadElementIds }),
        ...(args.outsideBoundaryElementIds === undefined
          ? {}
          : { outsideBoundaryElementIds: args.outsideBoundaryElementIds }),
        ...(args.retainedImageElementIds === undefined
          ? {}
          : { retainedImageElementIds: args.retainedImageElementIds }),
        ...(args.stopBeforeElementId === undefined ? {} : { stopBeforeElementId: args.stopBeforeElementId }),
      }
      const validationDraft: BoundaryDraft = hasGroupFinding
        ? boundaryDraftArgs
        : {
          ...boundaryDraftArgs,
          questions: [
            ...args.questions,
            ...request.questions
              .filter(question => !submittedHeadIds.has(question.sourceHeadId as string)
                && !removedQuestionIds.has(question.sourceHeadId))
              .map(question => ({ headElementId: question.sourceHeadId as string })),
          ],
        }
      const candidateIds = hasGroupFinding
        ? possibleQuestionHeadIds(elements, new Set(request.corePageIndexes))
        : []
      const validated = validateBoundaryDraft(
        validationDraft,
        elements,
        request.pages,
        request.padding,
        config.maxSegmentedQuestions,
        new Set(candidateIds),
        hasGroupFinding ? new Set(imageElementIds(elements, new Set(request.corePageIndexes))) : new Set(),
        config.maxQuestionAutoOwnedGapRatio,
        new Set(request.corePageIndexes),
        protectedQuestionHeadIds(elements, candidateIds),
        true,
      )
      if (validated.referenceErrors.length === 0) {
        state.revisionSubmissions += 1
        if (state.revisionSubmissions > config.maxQuestionBoundarySubmissions) {
          return Promise.resolve('REJECTED\nboundary submission limit reached')
        }
      }
      if (validated.questions === undefined) {
        return Promise.resolve([
          'REJECTED',
          ...(validated.referenceErrors.length === 0
            ? []
            : ['invalid or duplicate element references do not consume the complete-draft submission limit']),
          ...validated.errors,
        ].join('\n'))
      }
      const corePages = new Set(request.corePageIndexes)
      const submittedQuestions = validated.questions
        .filter(question => corePages.has(question.headPageIndex))
        .map((question, index) => ({ ...question, questionNo: index + 1, groupIndex: request.groupIndex }))
      if (submittedQuestions.length === 0 && !hasGroupFinding && removedQuestionIds.size === 0) {
        return Promise.resolve('REJECTED\ncrop-only corrections contain no question head on a core page')
      }
      const validatedById = new Map(submittedQuestions.map(question => [question.sourceHeadId, question] as const))
      const patchById = new Map(args.questions.map(question => [question.headElementId, question] as const))
      const elementById = new Map(elements.map(element => [element.id as string, element] as const))
      const currentSelected = request.questions.flatMap((question): SelectedQuestion[] => {
        const head = elementById.get(question.sourceHeadId)
        return head === undefined
          ? []
          : [{ head, additional: [], verticalRegionEdits: [], sourceRightLimitEdits: [] }]
      })
      const submittedById = new Map<TeacherQuestionLayoutElementId, TeacherSegmentedQuestion>()
      for (const [id, patch] of patchById) {
        const current = currentById.get(id as TeacherQuestionLayoutElementId)
        const validatedQuestion = validatedById.get(id as TeacherQuestionLayoutElementId)
        if (validatedQuestion === undefined) continue
        const finding = findingByQuestionId.get(id as TeacherQuestionLayoutElementId)
        if (current !== undefined && (patch.verticalRegionEdits?.length ?? 0) > 0) {
          const repairIntents = new Set(finding?.repairIntents ?? [])
          for (const edit of patch.verticalRegionEdits ?? []) {
            const region = current.regions.find(candidate => candidate.pageIndex === edit.pageIndex)
            if (region === undefined) continue
            const requiredIntents: CropRepairIntent[] = []
            if (edit.top !== undefined && edit.top < region.top) requiredIntents.push('expand-top')
            if (edit.top !== undefined && edit.top > region.top) requiredIntents.push('trim-top')
            if (edit.bottom !== undefined && edit.bottom > region.bottom) requiredIntents.push('expand-bottom')
            if (edit.bottom !== undefined && edit.bottom < region.bottom) requiredIntents.push('trim-bottom')
            for (const requiredIntent of requiredIntents) {
              if (!repairIntents.has(requiredIntent)) {
                return Promise.resolve(`REJECTED\nverticalRegionEdits for ${id} move in the ${requiredIntent} direction, but its finding does not authorize that repairIntent`)
              }
            }
          }
        }
        if (current !== undefined && (patch.sourceRightLimitEdits?.length ?? 0) > 0) {
          const repairIntents = new Set(finding?.repairIntents ?? [])
          if (!repairIntents.has('trim-right')) {
            return Promise.resolve(`REJECTED\nsourceRightLimitEdits for ${id} require the trim-right repairIntent`)
          }
        }
        let correction = validatedQuestion
        const preservesExistingBoundary = current !== undefined
          && patch.stopBeforeElementId === undefined
          && validationDraft.stopBeforeElementId === undefined
          && (validationDraft.excludedElementIds?.length ?? 0) === 0
          && (validationDraft.nonQuestionHeadElementIds?.length ?? 0) === 0
          && (validationDraft.retainedImageElementIds?.length ?? 0) === 0
          && ((patch.additionalElementIds?.length ?? 0) > 0
            || (patch.verticalRegionEdits?.length ?? 0) > 0
            || (patch.sourceRightLimitEdits?.length ?? 0) > 0)
        if (preservesExistingBoundary) {
          correction = (patch.additionalElementIds?.length ?? 0) > 0
            ? extendQuestionWithAdditionalElements(current, patch.additionalElementIds ?? [], elements, request.padding)
            : current
          if ((patch.verticalRegionEdits?.length ?? 0) > 0) {
            const selectedQuestion = currentSelected.find(item => item.head.id === current.sourceHeadId)
            if (selectedQuestion === undefined) {
              return Promise.resolve(`REJECTED\ncrop-only correction references missing current head ${String(current.sourceHeadId)}`)
            }
            const edited = applyVerticalRegionEdits(
              correction.regions,
              patch.verticalRegionEdits ?? [],
              selectedQuestion,
              currentSelected,
              request.pages,
            )
            if (edited.errors.length > 0) {
              return Promise.resolve(['REJECTED', ...edited.errors].join('\n'))
            }
            correction = { ...correction, regions: edited.regions }
          }
          if ((patch.sourceRightLimitEdits?.length ?? 0) > 0) {
            const edited = applySourceRightLimitEdits(
              correction.regions,
              patch.sourceRightLimitEdits ?? [],
            )
            if (edited.errors.length > 0) {
              return Promise.resolve(['REJECTED', ...edited.errors].join('\n'))
            }
            correction = { ...correction, regions: edited.regions }
          }
        }
        submittedById.set(correction.sourceHeadId, correction)
      }
      let questions: readonly TeacherSegmentedQuestion[]
      if (hasGroupFinding) {
        const retainedRemovedIds = [...removedQuestionIds].filter(id => validatedById.has(id))
        if (retainedRemovedIds.length > 0) {
          return Promise.resolve(`REJECTED\ncomplete-group draft retains removed crop heads: ${retainedRemovedIds.join(', ')}`)
        }
        questions = submittedQuestions
      } else {
        const unknownIds = [...submittedById.keys()].filter(id => !currentById.has(id))
        if (unknownIds.length > 0) {
          return Promise.resolve(`REJECTED\ncrop-only corrections contain unknown question heads: ${unknownIds.join(', ')}`)
        }
        const missingCitedIds = [...citedIds].filter(id => (
          !removedQuestionIds.has(id) && !submittedById.has(id)
        ))
        if (missingCitedIds.length > 0) {
          return Promise.resolve(`REJECTED\ncrop-only corrections omit cited question heads: ${missingCitedIds.join(', ')}`)
        }
        questions = request.questions.filter(question => !removedQuestionIds.has(question.sourceHeadId)).map((question, index) => {
          const correction = submittedById.get(question.sourceHeadId)
          return correction === undefined
            ? { ...question, questionNo: index + 1 }
            : { ...correction, questionNo: index + 1, groupIndex: request.groupIndex }
        })
      }
      const correctedById = new Map(questions.map(question => [question.sourceHeadId, question] as const))
      const explicitlyExcludedIds = new Set(validationDraft.excludedElementIds ?? [])
      const sampledAfter = new Set(questions.flatMap(question => [...sampledQuestionImageIds(question, elements)]))
      for (const [id, finding] of findingByQuestionId) {
        const current = currentById.get(id)
        const corrected = correctedById.get(id)
        if (current === undefined || corrected === undefined || removedQuestionIds.has(id)) continue
        const lostRequiredTextIds = hasGroupFinding
          ? []
          : [...requiredQuestionTextIds(current, elements)].filter((elementId) => {
            const element = elementById.get(elementId)
            return element !== undefined && !questionFullyOwnsElement(corrected, element)
          })
        if (lostRequiredTextIds.length > 0) {
          return Promise.resolve(
            `REJECTED\ncorrection for ${String(id)} clips learner-facing OCR before the next question or semantic boundary: ${lostRequiredTextIds.join(', ')}`,
          )
        }
        const lostImageIds = [...sampledQuestionImageIds(current, elements)].filter(imageId => (
          !sampledQuestionImageIds(corrected, elements).has(imageId)
        ))
        if (lostImageIds.length === 0) continue
        const authorizesImageRemoval = (finding.repairIntents ?? []).includes('reassign-content')
          && lostImageIds.every(imageId => sampledAfter.has(imageId) || explicitlyExcludedIds.has(imageId))
        if (!authorizesImageRemoval) {
          return Promise.resolve(
            `REJECTED\ncorrection for ${String(id)} silently drops previously sampled image element(s) ${lostImageIds.join(', ')}; retain them, or use reassign-content and either preserve them in another crop or list them in excludedElementIds`,
          )
        }
      }
      const changedIds = new Set<TeacherQuestionLayoutElementId>()
      for (const id of new Set([...currentById.keys(), ...correctedById.keys()])) {
        const current = currentById.get(id)
        const corrected = correctedById.get(id)
        if (current === undefined || corrected === undefined
          || questionGeometryFingerprint(current) !== questionGeometryFingerprint(corrected)) {
          changedIds.add(id)
        }
      }
      if (!hasGroupFinding) {
        const uncitedChangedIds = [...changedIds].filter(id => !citedIds.has(id))
        if (uncitedChangedIds.length > 0) {
          return Promise.resolve(`REJECTED\ncrop-only corrections modify uncited question heads: ${uncitedChangedIds.join(', ')}`)
        }
      }
      const unchangedCitedIds = [...citedIds].filter(id => !changedIds.has(id))
      if (changedIds.size === 0) {
        return Promise.resolve('REJECTED\nthe corrected draft changes no rendered crop geometry; move each stop-before boundary past the missing content')
      }
      if (unchangedCitedIds.length > 0) {
        return Promise.resolve(`REJECTED\nthe corrected draft leaves cited defective crop geometry unchanged: ${unchangedCitedIds.join(', ')}`)
      }
      for (const [id, finding] of findingByQuestionId) {
        const intents = finding.repairIntents ?? []
        const current = currentById.get(id)
        const corrected = correctedById.get(id)
        if (intents.includes('remove-crop')) {
          if (!removedQuestionIds.has(id)) {
            return Promise.resolve(`REJECTED\n${String(id)} declares remove-crop but is not listed in removedCropIds`)
          }
          continue
        }
        if (removedQuestionIds.has(id)) {
          return Promise.resolve(`REJECTED\nremoved crop ${String(id)} requires the remove-crop repairIntent`)
        }
        if (current === undefined || corrected === undefined) continue
        const pairedRegions = current.regions.flatMap((region) => {
          const next = corrected.regions.find(candidate => candidate.pageIndex === region.pageIndex)
          return next === undefined ? [] : [{ current: region, corrected: next }]
        })
        const intentSatisfied = (intent: CropRepairIntent): boolean => {
          switch (intent) {
            case 'expand-top': return pairedRegions.some(pair => pair.corrected.top < pair.current.top)
            case 'trim-top': return pairedRegions.some(pair => pair.corrected.top > pair.current.top)
            case 'expand-bottom': return pairedRegions.some(pair => pair.corrected.bottom > pair.current.bottom)
            case 'trim-bottom': return pairedRegions.some(pair => pair.corrected.bottom < pair.current.bottom)
            case 'trim-right': return pairedRegions.some(pair => pair.corrected.rightLimit < pair.current.rightLimit)
            case 'reassign-content': return changedIds.has(id)
            case 'remove-crop': return false
          }
        }
        const unsatisfied = intents.filter(intent => !intentSatisfied(intent))
        if (unsatisfied.length > 0) {
          return Promise.resolve(`REJECTED\ncorrected crop ${String(id)} does not perform its declared repairIntents: ${unsatisfied.join(', ')}`)
        }
        for (const pair of pairedRegions) {
          if (intents.includes('expand-bottom')
            && pair.corrected.bottom > pair.current.bottom) {
            const crossedNeighbor = request.questions.find(candidate => candidate.sourceHeadId !== id
              && candidate.regions.some(region => region.pageIndex === pair.current.pageIndex
                && pair.current.bottom <= region.top
                && pair.corrected.bottom > region.top
                && pair.current.right > region.left
                && pair.current.left < region.right))
            if (crossedNeighbor !== undefined) {
              const neighborFinding = findingByQuestionId.get(crossedNeighbor.sourceHeadId)
              if (!(neighborFinding?.repairIntents ?? []).includes('trim-top')) {
                return Promise.resolve(`REJECTED\nexpanding ${String(id)} into neighboring crop ${String(crossedNeighbor.sourceHeadId)} requires a cited trim-top finding for that neighbor`)
              }
            }
          }
          if (intents.includes('expand-top')
            && pair.corrected.top < pair.current.top) {
            const crossedNeighbor = request.questions.find(candidate => candidate.sourceHeadId !== id
              && candidate.regions.some(region => region.pageIndex === pair.current.pageIndex
                && pair.current.top >= region.bottom
                && pair.corrected.top < region.bottom
                && pair.current.right > region.left
                && pair.current.left < region.right))
            if (crossedNeighbor !== undefined) {
              const neighborFinding = findingByQuestionId.get(crossedNeighbor.sourceHeadId)
              if (!(neighborFinding?.repairIntents ?? []).includes('trim-bottom')) {
                return Promise.resolve(`REJECTED\nexpanding ${String(id)} into neighboring crop ${String(crossedNeighbor.sourceHeadId)} requires a cited trim-bottom finding for that neighbor`)
              }
            }
          }
        }
      }
      const token = randomUUID()
      accepted.set(token, {
        token,
        decision: 'revised',
        affectedQuestionIds: [...new Set([...changedIds, ...citedIds])],
        questions,
      })
      exec.concludeTurn()
      return Promise.resolve(`ACCEPTED\nvalidationToken=${token}`)
    },
  })
}

/**
 * Run semantic question-boundary detection in one short-lived agent loop.
 * @param ctx - Host context carrying agent, tool, subagent, and model services.
 * @param request - Selected OCR pages from the browser-held PDF.
 * @param config - Input, output, retry, and wall-clock limits.
 * @returns validated page crop regions or a stable failure.
 */
export async function segmentQuestionsWithAgent(
  ctx: Context,
  request: TeacherQuestionSegmentRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): Promise<TeacherQuestionSegmentationAgentResult> {
  const requestError = validateRequest(request, config)
  if (requestError !== undefined) return rejected('invalid-request', requestError)
  const agents = ctx.get('agents')
  const subagents = ctx.get('subagents')
  const modelConfig = ctx.get('agentDefaultModel')
  const tools = ctx.get('tools')
  const llm = ctx.get('llm')
  if (agents === undefined || subagents === undefined || modelConfig === undefined || tools === undefined || llm === undefined) {
    return rejected('tool-model-unavailable', 'tool-model agent services are unavailable')
  }
  const parent = agents.get(request.parentSessionId)
  if (parent === undefined) return rejected('session-unavailable', 'the current session is not live')

  const deadline = createQuestionChildDeadline(
    config.questionSegmentationAgentTimeoutMs,
    'question segmentation timed out',
  )
  const elements = indexElements(request.pages)
  const chunks = sourceChunks(elements, config.maxQuestionSourceChunkCharacters)
  const corePageIndexes = new Set(request.corePageIndexes ?? request.pages.map(page => page.pageIndex))
  const answerSectionPages = new Set([
    ...answerSectionPageIndexes(elements),
    ...(request.answerSectionPageIndexes ?? []),
  ])
  const learnerCorePageIndexes = new Set(
    [...corePageIndexes].filter(pageIndex => !answerSectionPages.has(pageIndex)),
  )
  const answerSectionElementIdSet = new Set([
    ...answerSectionElementIds(elements),
    ...elements.filter(element => (request.answerSectionPageIndexes ?? []).includes(element.page.pageIndex))
      .map(element => element.id as string),
  ])
  const coreElements = elements.filter(element => corePageIndexes.has(element.page.pageIndex))
  const headCandidateIds = possibleQuestionHeadIds(elements, learnerCorePageIndexes)
    .filter(id => !answerSectionElementIdSet.has(id as string))
  const protectedHeadCandidates = protectedQuestionHeadIds(elements, headCandidateIds)
  const unprotectedHeadCandidates = headCandidateIds.filter(id => !protectedHeadCandidates.has(id as string))
  const answerHeadingHints = coreElements.filter(element => (
    isSemanticTextElement(element.element)
      && (answerHeadingPattern.test(element.element.text) || isAnswerCoverHeading(element, elements))
  ))
  const explanationHeadingHints = coreElements.filter(element => (
    isSemanticTextElement(element.element)
      && answerOrExplanationBlockPattern.test(element.element.text)
  ))
  const semanticHints = {
    answerSectionPageIndexes: [...answerSectionPages].filter(pageIndex => corePageIndexes.has(pageIndex)),
    possibleQuestionHeadIds: headCandidateIds,
    protectedQuestionHeadIds: [...protectedHeadCandidates],
    unprotectedQuestionHeadIds: unprotectedHeadCandidates,
    imageElementIds: imageElementIds(elements, learnerCorePageIndexes),
    possibleSectionHeadingIds: coreElements
      .filter(element => sectionHeadingPattern.test(element.element.text)
        || isContextualNumberedTheoryHeading(element, elements))
      .map(element => element.id),
    possibleAnswerHeadingIds: answerHeadingHints.map(element => element.id),
    possibleExplanationHeadingIds: explanationHeadingHints.map(element => element.id),
  }
  const completeInlineSource = compactSourceRecord(elements)
  const inspectedChunks = new Set<number>()
  const inspectedPreviews = new Set<string>()
  const toolSuffix = runToolSuffix()
  const sourceToolName = `question_layout_${toolSuffix}`
  const previewToolName = `question_page_preview_${toolSuffix}`
  const submissionToolName = `submit_question_boundaries_${toolSuffix}`
  const accepted = new Map<string, AcceptedBoundaryDraft>()
  const submissionState: BoundarySubmissionState = { submissions: 0, seenDrafts: new Set() }
  const rejectedToolBudget: RejectedToolCallBudget = {
    callsByResult: new Map(),
    maxCalls: config.maxQuestionRejectedToolCalls,
    exhausted: false,
  }
  let run: SubagentRun | undefined
  let disposeSourceTool: (() => Promise<void>) | undefined
  let disposePreviewTool: (() => Promise<void>) | undefined
  let disposeSubmissionTool: (() => Promise<void>) | undefined
  let outcome: TeacherQuestionSegmentationAgentResult
  try {
    const selected = modelConfig.currentToolSelection()
    const modelInfo = await llm.resolveModelInfo(selected.provider, selected.model, deadline.signal)
    const previewSources = pagePreviewSources(request.pagePreviews ?? [])
    const attachments = ctx.get('attachments')
    const inlineEvidence = config.questionSegmentationInlineEvidence
      && chunks.length === 1
      && JSON.stringify(completeInlineSource).length <= config.maxQuestionCompactBoundaryCharacters
    if (!inlineEvidence && previewSources.length > 0 && modelInfo.inputModalities?.includes('image') !== true) {
      throw new QuestionSegmentationVisionError('the configured tool model does not declare image input')
    }
    if (!inlineEvidence && previewSources.length > 0 && attachments === undefined) {
      throw new QuestionSegmentationVisionError('image attachment services are unavailable')
    }
    const maxImages = attachments === undefined
      ? 0
      : Math.min(
        config.maxQuestionVisionImagesPerToolCall,
        attachments.imageLimits.maxImagesPerMessage,
      )
    if (!inlineEvidence && previewSources.length > 0 && maxImages < 1) {
      throw new QuestionSegmentationVisionError('the attachment provider admits no images per message')
    }
    if (!inlineEvidence) {
      disposeSourceTool = ctx.effect(
        () => tools.register(withRejectedToolCallBudget(
          sourceTool(sourceToolName, chunks, inspectedChunks),
          rejectedToolBudget,
        )),
        'teacher-workbench: question layout source',
      )
    }
    if (!inlineEvidence && previewSources.length > 0 && attachments !== undefined) {
      disposePreviewTool = ctx.effect(
        () => tools.register(visionImageTool(
          previewToolName,
          previewSources,
          inspectedPreviews,
          maxImages,
          source => attachments.saveImage(source),
        )),
        'teacher-workbench: question page previews',
      )
    }
    disposeSubmissionTool = ctx.effect(
      () => tools.register(withRejectedToolCallBudget(submissionTool(
        submissionToolName,
        request,
        config,
        elements,
        accepted,
        submissionState,
        () => inspectedChunks.size === chunks.length
          && (inlineEvidence || inspectedPreviews.size === previewSources.length),
        inlineEvidence,
      ), rejectedToolBudget)),
      'teacher-workbench: question boundary submission',
    )
    outcome = rejected('invalid-output', 'the agent did not produce a Host-accepted boundary draft; retry the cut')
    for (let agentRun = 0; agentRun < config.maxQuestionBoundaryAgentRuns; agentRun += 1) {
      deadline.renew()
      inspectedChunks.clear()
      inspectedPreviews.clear()
      if (inlineEvidence) {
        inspectedChunks.add(0)
      }
      accepted.clear()
      submissionState.submissions = 0
      submissionState.seenDrafts.clear()
      const recoveryInstruction = agentRun === 0
        ? ''
        : ' A previous child ended without a Host-accepted boundary result. Submit a corrected complete draft; the accepted boundary tool ends this run.'
      const evidenceInstruction = inlineEvidence
        ? ' Complete compact OCR evidence for every selected element is included below. Inspect the entire inlineSource before deciding boundaries. Visual validation follows in a separate annotated-page review, so this boundary pass uses no page images and calls no source or preview tool.'
        : ` Inspect every exact sourceChunkIndex through ${sourceToolName}. ${previewSources.length === 0 ? '' : `Inspect only the exact previewIds listed below through ${previewToolName}, requesting no more than ${String(maxImages)} ids per call. `}`
      const inlineSource = inlineEvidence
        ? completeInlineSource
        : undefined
      const decisionInstruction = inlineEvidence
        ? ' questions must be the complete ordered list of independent learner questions discovered from inlineSource, not an exception list. semanticHints are incomplete recall aids: inspect every text element and submit a genuine head even when it is absent from possibleQuestionHeadIds, including OCR-damaged labels. Classify every possibleQuestionHeadId as a question, retained content in nonQuestionHeadElementIds, or the start of a block belonging to no question in outsideBoundaryElementIds. protectedQuestionHeadIds are strong recall hints, not semantic authority; downgrade one only by putting the same id in outsideBoundaryElementIds when the complete source proves that it begins a title, preamble, summary, answer, or other non-question block. Put the first OCR element of every later-paper preamble or other non-question block in outsideBoundaryElementIds even when it is not a candidate. Never combine several independently answerable numbered, example, or variant tasks into one question merely because one detected head precedes them: each independent answer demand needs its own head. excludedElementIds is unavailable in this OCR-only pass because deleting unreviewed pixels can erase a stem; outsideBoundaryElementIds is the semantic stop for content that belongs to no question, while Host defaults and the later annotated visual review own other pixel removal. An unusable stopBeforeElementId is omitted so Host ownership can use the next accepted head or declared outside boundary. Every unlisted image element receives automatic geometric ownership, except a page-spanning image that covers multiple accepted heads is treated as a background layer. Use retainedImageElementIds or additionalElementIds only to override that default for a required shared visual. Never attach an element across an answer, explanation, section, theory, or later-paper boundary. The later visual review corrects diagrams, furniture, and edge pixels.'
        : ' Every possibleQuestionHeadId requires one explicit decision: use it as headElementId, put it in nonQuestionHeadElementIds when it is not an independent head but should remain eligible question content, or put it in outsideBoundaryElementIds when it begins a block that belongs to no question. Put the first OCR element of every later-paper title, preamble, summary, answer, or other non-question block in outsideBoundaryElementIds even when it is not a candidate. Use excludedElementIds only when inspected pixels inside an otherwise valid interval must be removed. Every imageElementId also requires an individual preview-backed decision: retain a question diagram in retainedImageElementIds, assign it through exactly one question\'s additionalElementIds when automatic ownership would be wrong, or exclude only visually confirmed furniture.'
      const prompt: SubagentStartRequest['prompt'] = [{
        type: 'text',
        text: `Segment the selected PDF pages into complete top-level questions.${recoveryInstruction}${evidenceInstruction} Only heads on corePageIndexes belong to this run. Adjacent inspection pages are read-only context for deciding whether a core-page question continues; never submit one of their heads. Infer this source's own question convention from the OCR text and geometry, then submit one draft to ${submissionToolName}. Apply the answer-obligation test: a head must visibly ask the learner to choose, fill, calculate, explain, prove, draw, judge, or otherwise produce something. A number, topic label, definition, property, formula, method step, theory summary, worked solution, or answer explanation is not a question by itself. A worked example that opens with a problem stem and has a visible response demand is a question. A group may validly contain zero questions; do not invent a task. semanticHints are fallible recall aids.${decisionInstruction} A bracketed citation without its own stem, options, subparts, table, or figure is nonQuestionHeadElementIds content. A title, paper preamble, summary, answer block, footer, or other transition that belongs to no question begins at an outsideBoundaryElementIds entry; that boundary stops preceding automatic ownership until the next submitted head. stopBeforeElementId is exclusive and names the first OCR element outside one question, never its final content. Use additionalElementIds only for content whose geometric owner is wrong. A Host-accepted ${submissionToolName} call concludes this run immediately.\n${JSON.stringify({ fileName: request.fileName, corePageIndexes: [...corePageIndexes], inspectionPageIndexes: request.pages.map(page => page.pageIndex), elementCount: elements.length, sourceChunkIndexes: chunks.map((_chunk, index) => index), ...(inlineEvidence ? {} : { previewIds: previewSources.map(source => source.id) }), semanticHints, ...(inlineSource === undefined ? {} : { inlineSource }) })}`,
      }]
      run = await subagents.start('spawn', {
        label: `Question segmentation: ${request.fileName}${agentRun === 0 ? '' : ` (recovery ${String(agentRun + 1)})`}`,
        prompt,
        parent,
        signal: deadline.signal,
        agentOptions: {
          ...questionSegmentationToolSelection(
            selected,
            modelInfo,
            config.questionSegmentationReasoningEnabled,
          ),
          toolChoice: 'required',
          ...(inlineEvidence ? { maxTokens: config.maxQuestionCompactBoundaryOutputTokens } : {}),
        },
        toolFilter: { allow: [
          ...(inlineEvidence ? [] : [sourceToolName]),
          ...(inlineEvidence || previewSources.length === 0 ? [] : [previewToolName]),
          submissionToolName,
        ] },
        persona: inlineEvidence
          ? `${COMPACT_QUESTION_SEGMENTATION_PERSONA}\n\nThe only callable tool in this run is ${submissionToolName}. Make that tool call as your first action; do not name or attempt any other tool.`
          : QUESTION_SEGMENTATION_SKILL.content,
      })
      const result = await run.result
      const completedRun = run
      run = undefined
      await completedRun.dispose()
      if (rejectedToolBudget.exhausted) {
        outcome = rejected('invalid-output', 'the child exhausted its rejected-tool-call budget')
        break
      }
      if (deadline.expired) {
        outcome = rejected('timed-out', 'the tool model did not finish before the deadline')
        break
      }
      if (result.stopReason !== 'completed') {
        outcome = rejected('model-failed', `the tool model stopped with ${result.stopReason}`)
        continue
      }
      const draft = accepted.size === 1 ? accepted.values().next().value : undefined
      if (draft === undefined) {
        outcome = rejected('invalid-output', 'the agent did not produce exactly one Host-accepted boundary draft; retry the cut')
        continue
      }
      outcome = { ok: true, value: { questions: draft.questions } }
      break
    }
  } catch (error) {
    outcome = error instanceof QuestionSegmentationReasoningError
      ? rejected('invalid-request', error.message)
      : error instanceof QuestionSegmentationVisionError
        ? rejected('vision-unavailable', error.message)
        : deadline.expired
          ? rejected('timed-out', 'the tool model did not finish before the deadline')
          : rejected('model-failed', error instanceof Error ? error.message : String(error))
  } finally {
    deadline.dispose()
  }
  if (run !== undefined) {
    try {
      await run.dispose()
    } catch (error) {
      if (outcome.ok) outcome = rejected('model-failed', error instanceof Error ? error.message : String(error))
    }
  }
  if (!outcome.ok && ['invalid-output', 'timed-out', 'model-failed', 'vision-unavailable'].includes(outcome.error.code)) {
    const questions = fallbackQuestionBoundaries(
      request,
      config,
      elements,
      learnerCorePageIndexes,
      answerSectionElementIdSet,
    )
    if (questions !== undefined) outcome = { ok: true, value: { questions } }
  }
  if (disposeSourceTool !== undefined) await disposeSourceTool()
  if (disposePreviewTool !== undefined) await disposePreviewTool()
  if (disposeSubmissionTool !== undefined) await disposeSubmissionTool()
  return outcome
}

/**
 * Visually inspect every preliminary question crop and optionally replace its processing-group boundaries.
 * @param ctx - Host context carrying agent, attachment, tool, subagent, and model services.
 * @param request - Preliminary crops plus their OCR and rendered source-page evidence.
 * @param config - Input, retry, image-batch, and wall-clock limits.
 * @returns accepted preliminary regions or one Host-validated replacement group.
 */
export async function reviewQuestionCropsWithAgent(
  ctx: Context,
  request: TeacherQuestionCropReviewRequest,
  config: TeacherQuestionSegmentationAgentConfig,
): Promise<TeacherQuestionCropReviewResult> {
  const requestError = validateCropReviewRequest(request, config)
  if (requestError !== undefined) return rejected('invalid-request', requestError)
  const agents = ctx.get('agents')
  const subagents = ctx.get('subagents')
  const modelConfig = ctx.get('agentDefaultModel')
  const tools = ctx.get('tools')
  const llm = ctx.get('llm')
  const attachments = ctx.get('attachments')
  if (agents === undefined || subagents === undefined || modelConfig === undefined || tools === undefined
    || llm === undefined || attachments === undefined) {
    return unresolvedCropReview(request)
  }
  const parent = agents.get(request.parentSessionId)
  if (parent === undefined) return unresolvedCropReview(request)

  const deadline = createQuestionChildDeadline(
    config.questionSegmentationAgentTimeoutMs,
    'question crop review timed out',
  )
  const elements = indexElements(request.pages)
  const rawPageSources = pagePreviewSources(request.pagePreviews)
  const cropSources = cropPreviewSources(request.crops, request.questions, elements)
  const reviewedQuestionIds = new Set(request.reviewQuestionIds)
  const scopedQuestions = request.questions.filter(question => reviewedQuestionIds.has(question.sourceHeadId))
  const reviewAttention = cropReviewAttentionRecords(
    request.questions.filter(question => reviewedQuestionIds.has(question.sourceHeadId)),
    elements,
    request.padding,
    config.maxQuestionAutoOwnedGapRatio,
  )
  const attentionByCropId = new Map(reviewAttention.map(attention => [attention.cropId, attention] as const))
  const expectedCropIds = new Set(cropSources.map(source => source.id))
  const expectedPageIds = new Set(rawPageSources.map(source => source.id))
  const inspectedImageIds = new Set<string>()
  const inspectedRepairChunks = new Set<string>()
  const reviewState: CropReviewState = {
    findingSubmissions: 0,
    revisionSubmissions: 0,
    draftFindings: new Map(),
    draftVerifications: new Map(),
    seenRevisionDrafts: new Set(),
  }
  const cropQuestionIdByPreviewId: ReadonlyMap<string, TeacherQuestionLayoutElementId> = new Map(request.questions.map(question => (
    [`crop-${String(question.sourceHeadId)}`, question.sourceHeadId] as const
  )))
  const reviewsCompleteGroup = request.reviewQuestionIds.length === request.questions.length
  let pageSources = rawPageSources
  const corePageIds = request.corePageIndexes.map(pageIndex => `page-${String(pageIndex + 1)}`)
  const answerSectionCorePageIndexes = [...new Set([
    ...answerSectionPageIndexes(elements),
    ...(request.answerSectionPageIndexes ?? []),
  ])]
    .filter(pageIndex => request.corePageIndexes.includes(pageIndex))
  const answerSectionPageIds = answerSectionCorePageIndexes
    .map(pageIndex => `page-${String(pageIndex + 1)}`)
  const learnerCorePageIndexes = new Set(request.corePageIndexes.filter(pageIndex => (
    !answerSectionCorePageIndexes.includes(pageIndex)
  )))
  const missingQuestionHeadCandidates = possibleQuestionHeadIds(elements, learnerCorePageIndexes)
  const protectedMissingQuestionHeadIds = protectedQuestionHeadIds(elements, missingQuestionHeadCandidates)
  const existingQuestionHeadIds = new Set<string>(request.questions.map(question => question.sourceHeadId))
  const uncoveredMissingQuestionHeadIds = new Set([...protectedMissingQuestionHeadIds].filter(id => (
    !existingQuestionHeadIds.has(id)
  )))
  const uncoveredMissingQuestionHeads = elements.flatMap(element => (
    uncoveredMissingQuestionHeadIds.has(element.id as string)
      ? [{
        headElementId: element.id,
        pageId: `page-${String(element.page.pageIndex + 1)}`,
        headText: element.element.text.slice(0, 160),
      }]
      : []
  ))
  const toolSuffix = runToolSuffix()
  const sourceToolName = `question_review_context_${toolSuffix}`
  const sheetToolName = `question_review_sheet_${toolSuffix}`
  const pageToolName = `question_review_page_${toolSuffix}`
  const cropToolName = `question_review_crop_${toolSuffix}`
  const findingsToolName = `submit_question_crop_findings_${toolSuffix}`
  const reviseToolName = `revise_question_boundaries_${toolSuffix}`
  const accepted = new Map<string, AcceptedCropReview>()
  const rejectedToolBudget: RejectedToolCallBudget = {
    callsByResult: new Map(),
    maxCalls: config.maxQuestionRejectedToolCalls,
    exhausted: false,
  }
  const rejectedToolBudgetExhausted = (): boolean => rejectedToolBudget.exhausted
  let run: SubagentRun | undefined
  let disposeSourceTool: (() => Promise<void>) | undefined
  let disposePageTool: (() => Promise<void>) | undefined
  let disposeCropTool: (() => Promise<void>) | undefined
  let disposeFindingsTool: (() => Promise<void>) | undefined
  let disposeReviseTool: (() => Promise<void>) | undefined
  let outcome: TeacherQuestionCropReviewResult
  try {
    if (!reviewsCompleteGroup) {
      pageSources = await annotatedReviewPageSources(request.pagePreviews, request.pages, scopedQuestions, true)
    }
    const selected = modelConfig.currentToolSelection()
    const modelInfo = await llm.resolveModelInfo(selected.provider, selected.model, deadline.signal)
    if (modelInfo.inputModalities?.includes('image') !== true) {
      throw new QuestionSegmentationVisionError('the configured tool model does not declare image input')
    }
    const maxImages = Math.min(
      config.maxQuestionVisionImagesPerToolCall,
      attachments.imageLimits.maxImagesPerMessage,
    )
    if (maxImages < 1) throw new QuestionSegmentationVisionError('the attachment provider admits no images per message')
    const compactReviewSources = config.questionSegmentationInlineEvidence
      ? [
        ...await reviewSheetSources(reviewsCompleteGroup
          ? await annotatedReviewPageSources(request.pagePreviews, request.pages, scopedQuestions, false)
          : pageSources, 'page'),
        ...await reviewSheetSources(cropSources, 'crop'),
      ]
      : []
    const compactReview = compactReviewSources.length > 0 && compactReviewSources.length <= maxImages
    const reviewPageSources = compactReview ? compactReviewSources : pageSources
    const expectedImageIds = new Set(compactReview
      ? reviewPageSources.map(source => source.id)
      : [...expectedPageIds, ...expectedCropIds])
    disposeSourceTool = ctx.effect(
      () => tools.register(withRejectedToolCallBudget(cropReviewRepairContextTool(
        sourceToolName,
        request,
        elements,
        cropQuestionIdByPreviewId,
        reviewState,
        inspectedRepairChunks,
        config.maxQuestionSourceChunkCharacters,
      ), rejectedToolBudget)),
      'teacher-workbench: question review repair context',
    )
    disposeReviseTool = ctx.effect(
      () => tools.register(withRejectedToolCallBudget(cropReviewRevisionTool(
        reviseToolName,
        request,
        config,
        elements,
        cropQuestionIdByPreviewId,
        reviewState,
        accepted,
        () => cropReviewRepairEvidenceComplete(
          reviewState,
          request,
          elements,
          cropQuestionIdByPreviewId,
          inspectedRepairChunks,
          config.maxQuestionSourceChunkCharacters,
        ),
      ), rejectedToolBudget)),
      'teacher-workbench: revised question boundaries',
    )
    if (compactReview) {
      disposePageTool = ctx.effect(
        () => tools.register(visionImageTool(
          sheetToolName,
          reviewPageSources,
          inspectedImageIds,
          maxImages,
          source => attachments.saveImage(source),
          true,
        )),
        'teacher-workbench: annotated question review sheets',
      )
    } else {
      disposePageTool = ctx.effect(
        () => tools.register(visionImageTool(
          pageToolName,
          pageSources,
          inspectedImageIds,
          maxImages,
          source => attachments.saveImage(source),
        )),
        'teacher-workbench: question review source pages',
      )
      disposeCropTool = ctx.effect(
        () => tools.register(visionImageTool(
          cropToolName,
          cropSources,
          inspectedImageIds,
          maxImages,
          source => attachments.saveImage(source),
        )),
        'teacher-workbench: question review crops',
      )
    }
    disposeFindingsTool = ctx.effect(
      () => tools.register(withRejectedToolCallBudget(cropReviewFindingsTool(
        findingsToolName,
        request,
        inspectedImageIds,
        expectedImageIds,
        expectedCropIds,
        expectedPageIds,
        new Set(corePageIds),
        new Set(answerSectionPageIds),
        elements,
        reviewState,
        accepted,
        config.maxQuestionBoundarySubmissions,
        reviewsCompleteGroup,
        attentionByCropId,
        compactReview,
      ), rejectedToolBudget)),
      'teacher-workbench: question crop findings',
    )
    outcome = rejected('invalid-output', 'the agent did not produce a Host-accepted crop review')
    for (let agentRun = 0; agentRun < config.maxQuestionBoundaryAgentRuns; agentRun += 1) {
      deadline.renew()
      inspectedImageIds.clear()
      inspectedRepairChunks.clear()
      delete reviewState.findings
      reviewState.findingSubmissions = 0
      reviewState.revisionSubmissions = 0
      reviewState.draftFindings.clear()
      reviewState.draftVerifications.clear()
      reviewState.seenRevisionDrafts.clear()
      accepted.clear()
      const coreCoverageInstruction = reviewsCompleteGroup
        ? ' This is the complete-group review. Match every independent problem whose source page id is listed in corePageIds to exactly one listed crop; adjacent preview pages are read-only continuation context and their independent problems do not need crops in this group. Pages listed in answerSectionPageIds belong to a document answer key: numbered solution or explanation heads on those pages are not missing learner questions and must not receive crops. A page-only missing-question finding is valid on any core page when visible source pixels establish an independent answer demand with no one-question crop. suggestedUncoveredQuestionHeads is a non-exhaustive OCR hint, never an allowlist.'
        : ' This is a crop-local recut review. Classify only the listed cropIds. Opaque gray vertical bands on annotated pages hide unrelated lanes: masked pixels are unavailable and cannot be cited as missing content, options, figures, continuation, or contamination. Unmasked unlisted questions remain present and unchanged and may be used only as same-lane boundary context. Do not report an unlisted question as missing, do not submit a pageId-only finding or missingQuestionHead, and do not replace the complete group.'
      const recoveryInstruction = agentRun === 0
        ? coreCoverageInstruction
        : ` A previous crop-review child ended without a Host-accepted result. Start the visual classification again and use only the listed cropIds and reviewSheetIds; an accepted review tool ends this run.${coreCoverageInstruction}`
      const reviewClassificationInstruction = reviewsCompleteGroup
        ? 'Match every independent source-page problem to exactly one crop. A pageId-only finding is permitted when an independent source problem has no one-question crop, even when its pixels are inside a larger crop that combines several problems; set missingQuestionHead to its visible printed head and cite the containing crop in evidence when applicable. Also classify that combined crop as defective with reassign-content. This explicit missing-question record requires a complete-group repair. Missing content from an existing single-question crop, including a diagram or options printed elsewhere on the source page, must cite that cropId and may include pageId in the same finding; never set missingQuestionHead for it. If content missing from one crop appears in another, cite both cropIds as separate findings with complementary repairIntents so both boundaries change. Build one complete classification: use cropId, answerDemand, evidence, topmostVisibleContent, bottommostVisibleContent, leftmostVisibleContent, rightmostVisibleContent, and requiredVisuals for a complete crop, plus attentionEvidence when visualAttention names it; use issue, evidence, cropId, and every required repairIntent for an existing-crop defect; use issue, evidence, pageId, and missingQuestionHead only for an independent problem with no one-question crop. A finding with missingQuestionHead requires a complete processing-group draft that explicitly classifies every possible question-head candidate and image element.'
        : 'Classify every listed crop exactly once and ignore unlisted questions except as read-only boundary context. Missing content from a listed crop must cite that cropId and may include pageId. If pixels belonging to one listed crop appear in another listed crop, cite both cropIds with complementary repairIntents so both local boundaries change. Never submit a pageId-only finding or missingQuestionHead in this crop-local recut. Record a complete crop with the exact cropId field, never verifyCropId, plus answerDemand, evidence, topmostVisibleContent, bottommostVisibleContent, leftmostVisibleContent, rightmostVisibleContent, and requiredVisuals, plus attentionEvidence when visualAttention names it; record an existing-crop defect with issue, evidence, cropId, and every required repairIntent. Host validation preserves every unlisted question and rejects a complete-group replacement.'
      const promptText = compactReview
        ? `Review every annotated source page and rendered crop from ${JSON.stringify(request.fileName)}.${recoveryInstruction} First call ${sheetToolName} once with every reviewSheetId. These ids exist only in that tool; never call read_image or any filesystem tool. A review-page sheet contains annotated source pages: each magenta rectangle is the exact sampled source region for its Q label, the blue dashed line is final owned OCR content before permitted white right padding, a red crossed region is erased, repeated Q labels form one stitched crop, and any opaque gray vertical band hides an unrelated page lane. Masked pixels are unavailable evidence and must never be cited as missing content, options, figures, continuation, or contamination. Except for a red crossed region, every source pixel inside a magenta rectangle is already present in that crop; never report those pixels as absent from the rendered crop. They can still prove that one crop incorrectly combines several independent questions. Unmasked source pixels outside a magenta rectangle are same-lane page context and are not inside that crop. A review-crop sheet contains the rendered outputs: the cyan frame is the exact outer boundary of the actual crop, while the gray field outside that frame is only sheet layout and is never crop whitespace. Judge margins and gaps only inside the cyan frame. Map Q labels through preliminaryQuestions and compare every actual crop with its boxed source region. Check that every crop has exactly one complete independent answer demand with all figures, options, subparts, and continuations, contains no second independent problem, answer, explanation, footer, adjacent problem, or avoidable vertical gap, and that every core-page problem has its own output crop. A collective answerDemand such as solving several separately labelled problems never verifies a crop. A magenta rectangle or Q label proves only that a crop exists; it never proves that the crop is one learner question. A page-only missing-question finding may identify a visible independent problem outside every box or inside a box that combines multiple problems; suggestedUncoveredQuestionHeads is only a non-exhaustive OCR hint. Compare adjacent and repeated boxes for missing or duplicated pixels. Report only visibly confirmed defects; possible or suspected findings are rejected. Immediately submit one ${findingsToolName} call listing every complete crop in verifiedCrops with its exact single visible answerDemand and visible task evidence, and every defect in findings. If a crop has no learner answer demand because it contains only theory, a method summary, an answer, a solution, or explanatory prose, report remove-crop instead of verifying it. Every expansion finding supplies outsideCropEvidence naming the required pixels outside the magenta rectangle; every trim finding supplies insideCropEvidence naming unwanted pixels actually visible in the rendered crop. A reassign-content finding that claims a missing continuation must identify source content outside the magenta rectangle; a page-binding line or the blue owned-content marker does not prove missing content. Resolve every visualAttention flag for a verified crop through attentionChecks. A crop defect cites cropId and every repairIntent; an independent problem without its own crop cites pageId plus missingQuestionHead. Never declare both expansion and trimming on the same crop edge. Recorded defects cannot be withdrawn during this visual run. A findings call with defects ends this visual pass; the Host starts a separate text-only repair child. Do not call a repair-context or revision tool here. An accepted clean findings call also ends the run. Do not narrate individual crops.\n${JSON.stringify({
          groupIndex: request.groupIndex,
          recutAttempt: request.recutAttempt,
          fullGroupCoverage: request.reviewQuestionIds.length === request.questions.length,
          cropLocalLaneMask: !reviewsCompleteGroup,
          corePageIds,
          answerSectionPageIds,
          suggestedUncoveredQuestionHeads: uncoveredMissingQuestionHeads,
          reviewSheetIds: reviewPageSources.map(source => source.id),
          visualAttention: reviewAttention,
          preliminaryQuestions: scopedQuestions.map(question => ({
            cropId: `crop-${String(question.sourceHeadId)}`,
            questionNo: question.questionNo,
            headPageId: `page-${String(question.headPageIndex + 1)}`,
            regionPageIds: [...new Set(question.regions.map(region => `page-${String(region.pageIndex + 1)}`))],
          })),
        })}`
        : `Review the listed crops from ${JSON.stringify(request.fileName)}.${recoveryInstruction} First inspect every pagePreviewId through ${pageToolName}; then inspect every cropId through ${cropToolName}. Keep source pages and crops in separate calls and request at most ${String(maxImages)} ids per call. Each page-x tool label is the authoritative source-page identity and must not be reordered or inferred from printed footer numbering; OCR pageIndex is zero-based and is used only for coordinate edits. Printed source text and each crop label's OCR head text identify the problem; no internal sequence position is a printed question number. In a crop-local recut, opaque gray vertical bands hide unrelated page lanes; masked pixels are unavailable and cannot support a finding. Content visible on an unmasked source lane is context, not proof that it appears inside a crop. Crops share one output width, so blank white pixels on the right are intentional padding and contain no source-page content; report neighboring-column contamination only when its text or graphics are visibly present inside the crop image. Before verifying any crop, fill answerDemand with the visible response the learner must produce; numbering, a topic title, definitions, formulas, theory summaries, and explanatory prose are not answer demands. A worked example with a visible problem stem still needs one crop containing only that stem, even when the source prints its answer and analysis immediately afterward. A crop is defective when it has no independent answer demand, omits any stem, option, subpart, continuation, answer blank, or figure, or includes any adjacent question, next-section title, answer or explanation, footer, decoration, or neighboring-column content that is not part of the question. A page-sized crop containing several theory topics or summary sections without one answer demand is a spurious question: submit one finding containing both cropId and pageId with repairIntents=["remove-crop"], then put that cropId in removedCropIds so the Host removes only that crop. A QR code, publisher resource label, or optional dynamic-demo block is furniture unless the problem explicitly instructs the learner to scan or use it; proximity alone never makes it required content. Compare each crop's first and last owned pixels with the source; trace unfinished clauses to the next source line and inspect every referenced or adjacent figure through its final edge or vertex. Thin answer lines, boxes, and other response marks may have no OCR element: inspect the source strip immediately after an unfinished prompt and require their actual dark pixels in the crop. Never infer that a response mark is visible from answerDemand or source text; if it is missing at an edge, report the crop for local expansion and correct it with verticalRegionEdits. Before marking a crop complete, scan all four edges: topmostVisibleContent, bottommostVisibleContent, leftmostVisibleContent, and rightmostVisibleContent must name the actual non-white edge pixels, not merely the intended question text, and requiredVisuals must name every required source visual with its visible crop location or say none when the source requires none. Inspect the final non-white pixels before intentional blank right padding. Registration fields, binding or trim lines, vertical page labels, printed page numbers, and running headers or footers are page furniture unless explicitly required by the question; report visible right-edge residue with trim-right. visualAttention is generated from suspicious source geometry. A named crop cannot be verified until attentionEvidence resolves every listed flag against source and crop pixels; if a detached slice is a watermark or an erased source image is a required diagram, report the defect instead. Compare every adjacent crop pair: a line, option, continuation, or figure missing from one crop but visible at the edge of the other requires two findings with complementary boundary repairIntents. A leading answer line in the next crop is not harmless whitespace when it completes the preceding prompt. A detached watermark, publisher mark, answer block, or other unrelated pixels below the last required line or figure are contamination even when separated by a large white gap; report only that crop for local correction. A visually detached lower-page block is not part of the preceding question merely because no later question head was detected; verify its semantic connection or report contamination. repairIntents are structural obligations: use expand-top or expand-bottom for missing edge pixels, trim-top or trim-bottom for extra vertical edge pixels, trim-right for unrelated right-edge pixels, reassign-content for an OCR element or figure that must change owner without a directional edge edit, and remove-crop only for a spurious crop. List every applicable intent and never use reassign-content to avoid naming a known edge direction. ${reviewClassificationInstruction} Submit exactly one ${findingsToolName} call containing complete verifiedCrops and findings arrays after every cropId has one classification. Recorded visual defects cannot be replaced or withdrawn in the same run. If defects are recorded, call ${sourceToolName} for chunk 0 of each repairTargetId returned by the findings tool and every remaining chunk it reports, then submit corrections to ${reviseToolName}. For any finding that cites a cropId, submit only the cited question heads and the Host will merge them into the unchanged group even when pageId is also present as evidence; the Host rejects changes to uncited questions. Put every spurious crop in removedCropIds; its combined cropId and pageId finding authorizes local deletion without a complete-group draft. outsideBoundaryElementIds names the first OCR element of each title, later-paper preamble, summary, answer, or other block that belongs to no question; it stops preceding automatic ownership until the next submitted head. stopBeforeElementId is exclusive: it names the first OCR element outside one question, never its last option, subpart, continuation line, or figure. When visible pixels have no usable OCR element, use verticalRegionEdits with exact pageIndex and top or bottom in the OCR page units reported by the repair-context tool; do not invent an element id for whitespace or a drawn line. Increasing top removes pixels from the crop top; decreasing top adds them; increasing bottom adds bottom pixels. Every edited side must move in a direction authorized by that crop's repairIntents. Expanding into a neighboring crop requires a cited complementary trim finding for that neighbor, so transferred pixels do not remain duplicated. Coordinate-only edits apply only to the cited question. verticalRegionEdits change top or bottom. sourceRightLimitEdits may only reduce rightLimit for trim-right without moving left or right; the document-wide output width remains fixed and the removed source area becomes white padding. Unrelated question boundaries remain unchanged. A correction that removes a previously sampled image must list that image in excludedElementIds and carry reassign-content; otherwise the Host preserves it. The Host rejects a correction that crosses another question head, contradicts a repairIntent, or leaves any cited crop geometry unchanged. A Host-accepted ${findingsToolName} or ${reviseToolName} call concludes this run immediately; do not call another tool after acceptance.\n${JSON.stringify({
          groupIndex: request.groupIndex,
          recutAttempt: request.recutAttempt,
          fullGroupCoverage: request.reviewQuestionIds.length === request.questions.length,
          cropLocalLaneMask: !reviewsCompleteGroup,
          corePageIds,
          answerSectionPageIds,
          suggestedUncoveredQuestionHeads: uncoveredMissingQuestionHeads,
          cropIds: cropSources.map(source => source.id),
          pagePreviewIds: pageSources.map(source => source.id),
          visualAttention: reviewAttention,
          semanticHints: {
            possibleQuestionHeadIds: possibleQuestionHeadIds(elements),
            protectedQuestionHeadIds: [...protectedMissingQuestionHeadIds],
          },
          preliminaryQuestions: scopedQuestions.map(question => ({
            sourceHeadId: question.sourceHeadId,
            headText: elements.find(element => element.id === question.sourceHeadId)?.element.text.slice(0, 160) ?? '',
            headPageIndex: question.headPageIndex,
            headPageId: `page-${String(question.headPageIndex + 1)}`,
            regions: question.regions.map(region => ({
              ...region,
              pageId: `page-${String(region.pageIndex + 1)}`,
            })),
          })),
        })}`
      const prompt: SubagentStartRequest['prompt'] = [
        { type: 'text', text: promptText },
      ]
      run = await subagents.start('spawn', {
        label: `Question crop review: ${request.fileName} group ${String(request.groupIndex + 1)}${agentRun === 0 ? '' : ` (recovery ${String(agentRun + 1)})`}`,
        prompt,
        parent,
        signal: deadline.signal,
        agentOptions: {
          ...questionSegmentationToolSelection(
            selected,
            modelInfo,
            config.questionSegmentationReasoningEnabled,
          ),
          toolChoice: 'required',
          ...(compactReview ? { maxTokens: config.maxQuestionCompactReviewOutputTokens } : {}),
        },
        toolFilter: { allow: [
          ...(compactReview ? [sheetToolName] : [pageToolName, cropToolName]),
          findingsToolName,
          ...(!compactReview ? [sourceToolName, reviseToolName] : []),
        ] },
        persona: compactReview ? COMPACT_QUESTION_CROP_REVIEW_PERSONA : QUESTION_CROP_REVIEW_SKILL.content,
      })
      let result = await run.result
      const completedRun = run
      run = undefined
      await completedRun.dispose()
      if (rejectedToolBudgetExhausted()) {
        outcome = unresolvedCropReview(request)
        break
      }
      if (compactReview
        && result.stopReason === 'completed'
        && accepted.size === 0
        && recordedCropReviewFindings(reviewState).length > 0
        && !rejectedToolBudgetExhausted()
        && !deadline.expired) {
        for (let repairRun = 0;
          repairRun < config.maxQuestionBoundaryAgentRuns && !rejectedToolBudgetExhausted();
          repairRun += 1) {
          deadline.renew()
          inspectedRepairChunks.clear()
          reviewState.revisionSubmissions = 0
          reviewState.seenRevisionDrafts.clear()
          accepted.clear()
          const repairTargets = cropReviewRepairTargetIds(reviewState)
          const repairPrompt: SubagentStartRequest['prompt'] = [{
            type: 'text',
            text: `Repair the recorded visual crop defects from ${JSON.stringify(request.fileName)}. The findings are immutable. Call ${sourceToolName} with chunk 0 for every repairTargetId and every remaining numbered chunk it reports. Then submit only the cited corrections through ${reviseToolName}; an accepted revision ends the run. A separate same-page magenta region or lane is reassigned through exact element ownership, not a directional trim of another region. Preserve every required image in full. Do not call an image or findings tool.${repairRun === 0 ? '' : ' A previous repair child ended without a Host-accepted revision; inspect the repair contexts again and correct the rejected draft.'}\n${JSON.stringify({
              groupIndex: request.groupIndex,
              recutAttempt: request.recutAttempt,
              repairTargetIds: repairTargets,
              findings: recordedCropReviewFindings(reviewState),
            })}`,
          }]
          run = await subagents.start('spawn', {
            label: `Question crop repair: ${request.fileName} group ${String(request.groupIndex + 1)}${repairRun === 0 ? '' : ` (recovery ${String(repairRun + 1)})`}`,
            prompt: repairPrompt,
            parent,
            signal: deadline.signal,
            agentOptions: {
              ...questionSegmentationToolSelection(
                selected,
                modelInfo,
                config.questionSegmentationReasoningEnabled,
              ),
              toolChoice: 'required',
              maxTokens: config.maxQuestionCompactReviewOutputTokens,
            },
            toolFilter: { allow: [sourceToolName, reviseToolName] },
            persona: COMPACT_QUESTION_CROP_REPAIR_PERSONA,
          })
          result = await run.result
          const completedRepairRun = run
          run = undefined
          await completedRepairRun.dispose()
          if (rejectedToolBudgetExhausted()
            || result.stopReason !== 'completed'
            || accepted.values().next().value !== undefined) break
        }
      }
      if (deadline.expired) {
        outcome = unresolvedCropReview(request)
      } else if (result.stopReason !== 'completed') {
        outcome = unresolvedCropReview(request)
      } else {
        const review = accepted.size === 1 ? accepted.values().next().value : undefined
        if (review === undefined) {
          const findings = recordedCropReviewFindings(reviewState)
          const citedIds = new Set(findings.flatMap((finding) => {
            if (finding.cropId === undefined) return []
            const id = cropQuestionIdByPreviewId.get(finding.cropId)
            return id === undefined ? [] : [id]
          }))
          outcome = findings.length > 0
            ? {
              ok: true,
              value: {
                decision: 'unresolved',
                affectedQuestionIds: citedIds.size > 0 ? [...citedIds] : request.reviewQuestionIds,
                questions: request.questions,
              },
            }
            : unresolvedCropReview(request)
        } else {
          outcome = {
            ok: true,
            value: {
              decision: review.decision,
              affectedQuestionIds: review.affectedQuestionIds,
              questions: review.questions,
            },
          }
        }
      }
      const unresolvedWithRecordedDefects = outcome.ok
        && outcome.value.decision === 'unresolved'
        && recordedCropReviewFindings(reviewState).length > 0
      if (deadline.expired
        || unresolvedWithRecordedDefects
        || (outcome.ok && outcome.value.decision !== 'unresolved')) break
    }
  } catch {
    outcome = unresolvedCropReview(request)
  } finally {
    deadline.dispose()
  }
  if (run !== undefined) {
    try {
      await run.dispose()
    } catch {
      // The latest crop geometry remains usable when a failed child cannot finish teardown.
    }
  }
  if (disposeSourceTool !== undefined) await disposeSourceTool()
  if (disposePageTool !== undefined) await disposePageTool()
  if (disposeCropTool !== undefined) await disposeCropTool()
  if (disposeFindingsTool !== undefined) await disposeFindingsTool()
  if (disposeReviseTool !== undefined) await disposeReviseTool()
  return outcome
}
