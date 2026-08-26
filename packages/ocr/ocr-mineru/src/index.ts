/**
 * MinerU `mineru-api` provider for the DSH OCR capability.
 * @module @deepseek-ai/dsh-ocr-mineru
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  OcrError,
  type OcrBoundingBox,
  type OcrExtractRequest,
  type OcrExtractedDocument,
  type OcrLayoutDocument,
  type OcrLayoutElement,
  type OcrLayoutLimits,
  type OcrLayoutPage,
  type OcrPageRange,
  type OcrLayoutRequest,
  type OcrProvider,
} from '@deepseek-ai/dsh-ocr'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { z as validation } from 'zod'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8000/file_parse'
const BACKEND_VALUES = ['pipeline', 'vlm-engine', 'hybrid-engine'] as const
const EFFORT_VALUES = ['medium', 'high'] as const
const LANGUAGE_VALUES = [
  'ch', 'ch_server', 'korean', 'ta', 'te', 'ka', 'th', 'el',
  'arabic', 'east_slavic', 'cyrillic', 'devanagari',
] as const
type MinerUBackend = typeof BACKEND_VALUES[number]
type MinerUEffort = typeof EFFORT_VALUES[number]
type MinerULanguage = typeof LANGUAGE_VALUES[number]
const DEFAULT_BACKEND: MinerUBackend = 'pipeline'
const DEFAULT_EFFORT: MinerUEffort = 'high'
const DEFAULT_LANGUAGE: MinerULanguage = 'ch'
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_OUTPUT_CHARACTERS = 500_000
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const DEFAULT_LAYOUT_BATCH_PAGES = 4

/** User-settings namespace for the MinerU provider. */
export const OCR_MINERU_SETTINGS_NAMESPACE = settingsNamespace('ocr-mineru')

const EXTENSION_BY_MEDIA_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
})

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.docx', '.pptx', '.xlsx',
])

const mineruResponseSchema = validation.looseObject({
  results: validation.record(validation.string(), validation.looseObject({
    md_content: validation.string().optional(),
    middle_json: validation.string().optional(),
  })),
})

const mineruLayoutResponseSchema = validation.looseObject({
  results: validation.record(validation.string(), validation.looseObject({
    middle_json: validation.string().optional(),
  })),
})

const mineruMiddleSchema = validation.looseObject({
  pdf_info: validation.array(validation.looseObject({
    page_idx: validation.number().int().nonnegative(),
    page_size: validation.tuple([validation.number().positive(), validation.number().positive()]),
    para_blocks: validation.array(validation.unknown()).optional(),
    preproc_blocks: validation.array(validation.unknown()).optional(),
    discarded_blocks: validation.array(validation.unknown()).optional(),
  })),
})

/** MinerU provider configuration exposed through the DSH plugin settings surface. */
export interface Config {
  /** Full self-hosted MinerU synchronous parsing endpoint. */
  readonly endpoint: string
  /** Supported local MinerU parsing backend. */
  readonly backend: MinerUBackend
  /** MinerU hybrid parsing effort. */
  readonly effort: MinerUEffort
  /** Supported MinerU OCR model language. */
  readonly language: MinerULanguage
  /** Per-document network deadline in milliseconds. */
  readonly timeoutMs: number
  /** Maximum decoded upload size accepted from a browser request. */
  readonly maxFileBytes: number
  /** Maximum Markdown characters returned to a DSH consumer. */
  readonly maxOutputCharacters: number
  /** Maximum JSON response bytes accepted from MinerU. */
  readonly maxResponseBytes: number
  /** Maximum PDF pages sent to MinerU in one structured-layout request. */
  readonly layoutBatchPages: number
}

/** Validated plugin configuration schema. */
export const Config: z<Config> = z.object({
  endpoint: z.string().pattern(/^https?:\/\/\S+$/u).default(DEFAULT_ENDPOINT),
  backend: z.union(BACKEND_VALUES).default(DEFAULT_BACKEND),
  effort: z.union(EFFORT_VALUES).default(DEFAULT_EFFORT),
  language: z.union(LANGUAGE_VALUES).default(DEFAULT_LANGUAGE),
  timeoutMs: z.natural().min(1_000).max(60 * 60 * 1000).default(DEFAULT_TIMEOUT_MS),
  maxFileBytes: z.natural().min(1_024).max(100 * 1024 * 1024).default(DEFAULT_MAX_FILE_BYTES),
  maxOutputCharacters: z.natural().min(1_000).max(5_000_000).default(DEFAULT_MAX_OUTPUT_CHARACTERS),
  maxResponseBytes: z.natural().min(16_384).max(64 * 1024 * 1024).default(DEFAULT_MAX_RESPONSE_BYTES),
  layoutBatchPages: z.natural().min(1).max(100).default(DEFAULT_LAYOUT_BATCH_PAGES),
})

/** Fetch-compatible dependency used by the provider and deterministic tests. */
export type MinerUFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** MinerU implementation registered as provider id `mineru`. */
export class MinerUProvider implements OcrProvider {
  readonly id = 'mineru'
  private readonly fetchImpl: MinerUFetch
  private readonly source: () => Config

  /**
   * @param source - resolved endpoint and limits, or a thunk read once per extraction.
   * @param fetchImpl - optional fetch implementation for tests.
   */
  constructor(source: Config | (() => Config), fetchImpl: MinerUFetch = globalThis.fetch) {
    this.source = typeof source === 'function' ? source : () => source
    this.fetchImpl = fetchImpl
  }

  /** @returns true when the configured endpoint is an HTTP(S) URL. */
  available(): boolean {
    return /^https?:\/\//u.test(this.source().endpoint)
  }

  /** @returns current MinerU upload and structured-layout page limits. */
  layoutLimits(): OcrLayoutLimits {
    const config = this.source()
    return { maxFileBytes: config.maxFileBytes, maxPagesPerRequest: config.layoutBatchPages }
  }

  /**
   * Upload one document to MinerU and normalize its Markdown response.
   * @param request - base64 bytes and source metadata.
   * @param signal - optional caller cancellation.
   * @returns extracted reading-order Markdown.
   */
  async extract(request: OcrExtractRequest, signal?: AbortSignal): Promise<OcrExtractedDocument> {
    const config = this.source()
    const decoded = decodeRequest(request, config.maxFileBytes)
    const imageDetail = request.enhanceImageDetail === true && request.mediaType.startsWith('image/')
    const passes = imageDetail ? await rasterPasses(decoded.bytes) : [{ label: 'whole document', bytes: decoded.bytes }]
    const extracted: string[] = []
    for (const [index, pass] of passes.entries()) {
      const passRequest = imageDetail
        ? { ...request, name: `${request.name}.detail-${String(index + 1)}.png`, mediaType: 'image/png' }
        : request
      const parsed = await this.callMinerU(config, createForm(passRequest, {
        bytes: pass.bytes,
        uploadName: imageDetail ? passRequest.name : decoded.uploadName,
      }, config, 'markdown'), signal)
      extracted.push(`## OCR pass: ${pass.label}\n\n${markdownFromResponse(parsed, request.includeDiscardedText === true)}`)
    }
    const completeMarkdown = imageDetail
      ? extracted.join('\n\n')
      : extracted[0]?.replace(/^## OCR pass: whole document\n\n/u, '') ?? ''
    const truncated = completeMarkdown.length > config.maxOutputCharacters
    return {
      name: request.name,
      mediaType: request.mediaType,
      markdown: truncated ? completeMarkdown.slice(0, config.maxOutputCharacters) : completeMarkdown,
      provider: this.id,
      truncated,
    }
  }

  /**
   * Request MinerU middle JSON and normalize line and non-text coordinates.
   * @param request - PDF bytes and optional inclusive page window.
   * @param signal - optional caller cancellation.
   * @returns source-page geometry suitable for deterministic question cropping.
   */
  async extractLayout(request: OcrLayoutRequest, signal?: AbortSignal): Promise<OcrLayoutDocument> {
    const config = this.source()
    const decoded = decodeRequest(request, config.maxFileBytes)
    const ranges = layoutRanges(request.pageRange, config.layoutBatchPages)
    const pages: OcrLayoutPage[] = []
    let sourcePdf: Promise<PDFDocument> | undefined
    for (const pageRange of ranges) {
      const batch = await this.extractLayoutRange(config, request, decoded, pageRange, signal)
      if (request.mediaType === 'application/pdf' && batch.length > 1) {
        for (const [index, normalized] of batch.entries()) {
          if (!normalized.suspicious) continue
          const retryRange = { start: normalized.page.pageIndex, end: normalized.page.pageIndex }
          const retried = await this.extractLayoutRange(config, request, decoded, retryRange, signal)
          const [replacement] = retried
          if (replacement === undefined || retried.length !== 1) {
            throw new OcrError('MinerU single-page layout recovery returned an unexpected page count', 'invalid-response')
          }
          batch[index] = replacement
        }
      }
      if (request.mediaType === 'application/pdf') {
        for (const [index, normalized] of batch.entries()) {
          if (!hasNumberedSequenceGap(normalized.page)) continue
          sourcePdf ??= PDFDocument.load(decoded.bytes)
          batch[index] = await this.recoverNumberedColumns(
            config,
            request,
            await sourcePdf,
            normalized,
            signal,
          )
        }
      }
      pages.push(...batch.map(normalized => normalized.page))
    }
    pages.sort((left, right) => left.pageIndex - right.pageIndex)
    if (pages.length === 0) throw new OcrError('MinerU returned no parsed pages', 'empty-result')
    return { name: request.name, provider: this.id, pages }
  }

  private async extractLayoutRange(
    config: Config,
    request: OcrLayoutRequest,
    decoded: DecodedRequest,
    pageRange: OcrPageRange | undefined,
    signal?: AbortSignal,
  ): Promise<NormalizedLayoutPage[]> {
    const batchRequest = pageRange === undefined ? request : { ...request, pageRange }
    const parsed = await this.callMinerU(config, createForm(batchRequest, decoded, config, 'layout'), signal)
    const validated = mineruLayoutResponseSchema.safeParse(parsed)
    if (!validated.success) throw new OcrError('MinerU layout response fields are invalid', 'invalid-response')
    const encoded = Object.values(validated.data.results)
      .map(result => result.middle_json ?? '')
      .find(content => content.trim() !== '')
    if (encoded === undefined) throw new OcrError('MinerU returned no structured document layout', 'empty-result')
    const middle = parseMiddleJson(encoded)
    return middle.pdf_info.map(page => normalizePage(page, pageRange?.start ?? 0))
  }

  private async recoverNumberedColumns(
    config: Config,
    request: OcrLayoutRequest,
    source: PDFDocument,
    original: NormalizedLayoutPage,
    signal?: AbortSignal,
  ): Promise<NormalizedLayoutPage> {
    if (original.page.width <= original.page.height) return original
    const halves = await Promise.all((['left', 'right'] as const).map(async (side) => {
      const bytes = await cropPdfPageHalf(source, original.page.pageIndex, side)
      if (bytes.byteLength > config.maxFileBytes) {
        throw new OcrError('MinerU column recovery exceeds the configured upload limit', 'file-too-large')
      }
      const name = `${request.name.replace(/\.pdf$/iu, '')}-page-${String(original.page.pageIndex + 1)}-${side}.pdf`
      const [page] = await this.extractLayoutRange(config, {
        name,
        mediaType: 'application/pdf',
        contentBase64: Buffer.from(bytes).toString('base64'),
      }, { bytes, uploadName: name }, undefined, signal)
      if (page === undefined) throw new OcrError('MinerU column recovery returned no page', 'empty-result')
      return mapHalfPage(page.page, original.page, side)
    }))
    return {
      page: mergeRecoveredColumns(original.page, halves),
      suspicious: false,
    }
  }

  private async callMinerU(
    config: Config,
    form: FormData,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const deadline = AbortSignal.timeout(config.timeoutMs)
    const combinedSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    let response: Response
    try {
      response = await this.fetchImpl(config.endpoint, {
        method: 'POST',
        body: form,
        signal: combinedSignal,
      })
    } catch (error) {
      throw new OcrError('MinerU service is unavailable or timed out', 'provider-unavailable', { cause: error })
    }
    if (!response.ok) throw new OcrError(`MinerU returned HTTP ${String(response.status)}`, 'provider-failure')
    const text = await readResponseText(response, config.maxResponseBytes)
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new OcrError('MinerU returned non-JSON output', 'invalid-response', { cause: error })
    }
  }
}

function layoutRanges(range: OcrPageRange | undefined, batchPages: number): Array<OcrPageRange | undefined> {
  if (range === undefined) return [undefined]
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start) {
    throw new OcrError('page range must be an ordered pair of non-negative integers', 'invalid-request')
  }
  const ranges: OcrPageRange[] = []
  for (let start = range.start; start <= range.end; start += batchPages) {
    ranges.push({ start, end: Math.min(range.end, start + batchPages - 1) })
  }
  return ranges
}

/** Services required by the provider plugin. */
export const inject = ['ocr']

/**
 * Register the MinerU provider.
 * @param ctx - Host context carrying the OCR runtime.
 * @param config - validated provider configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, OCR_MINERU_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // Each extraction snapshots the current section before validating bytes
    // or starting its request, so there is no derived state to rebuild.
    onChange: () => {},
  })
  const provider = new MinerUProvider(() => current())
  ctx.effect(() => ctx.ocr.registerProvider(provider), 'ocr-mineru: provider')
}

interface DecodedRequest {
  readonly bytes: Uint8Array
  readonly uploadName: string
}

function createForm(
  request: OcrExtractRequest | OcrLayoutRequest,
  decoded: DecodedRequest,
  config: Config,
  output: 'markdown' | 'layout',
): FormData {
  const form = new FormData()
  form.append('files', new Blob([Uint8Array.from(decoded.bytes)], { type: request.mediaType || 'application/octet-stream' }), decoded.uploadName)
  form.append('backend', config.backend)
  form.append('effort', config.effort)
  form.append('lang_list', config.language)
  form.append('parse_method', 'auto')
  form.append('formula_enable', 'true')
  form.append('table_enable', 'true')
  form.append('return_md', output === 'markdown' ? 'true' : 'false')
  form.append('return_middle_json', output === 'layout' || request.includeDiscardedText === true ? 'true' : 'false')
  form.append('return_model_output', 'false')
  form.append('return_content_list', 'false')
  form.append('return_images', 'false')
  form.append('response_format_zip', 'false')
  form.append('return_original_file', 'false')
  const pageRange = (request as OcrLayoutRequest).pageRange
  if (pageRange !== undefined) {
    const { start, end } = pageRange
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw new OcrError('page range must be an ordered pair of non-negative integers', 'invalid-request')
    }
    form.append('start_page_id', String(start))
    form.append('end_page_id', String(end))
  }
  return form
}

type MinerUMarkdownResults = validation.infer<typeof mineruResponseSchema>['results']

interface RasterPass {
  readonly label: string
  readonly bytes: Uint8Array
}

const ENHANCED_IMAGE_LONG_EDGE = 3_200
const ENHANCED_IMAGE_SCALE = 2
const LANDSCAPE_COLUMNS = 3
const LANDSCAPE_ROWS = 2
const PORTRAIT_COLUMNS = 2
const PORTRAIT_ROWS = 3
const REGION_OVERLAP_RATIO = 0.06

async function rasterPasses(bytes: Uint8Array): Promise<RasterPass[]> {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
  const { width, height } = metadata
  const scale = Math.min(ENHANCED_IMAGE_SCALE, ENHANCED_IMAGE_LONG_EDGE / Math.max(width, height))
  const whole = await sharp(bytes).resize({
    width: Math.max(width, Math.round(width * scale)),
    height: Math.max(height, Math.round(height * scale)),
    fit: 'fill',
  }).png().toBuffer()
  const columns = width >= height ? LANDSCAPE_COLUMNS : PORTRAIT_COLUMNS
  const rows = width >= height ? LANDSCAPE_ROWS : PORTRAIT_ROWS
  const regions: RasterPass[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const nominalLeft = Math.floor(column * width / columns)
      const nominalTop = Math.floor(row * height / rows)
      const nominalRight = Math.ceil((column + 1) * width / columns)
      const nominalBottom = Math.ceil((row + 1) * height / rows)
      const overlapX = Math.round((nominalRight - nominalLeft) * REGION_OVERLAP_RATIO)
      const overlapY = Math.round((nominalBottom - nominalTop) * REGION_OVERLAP_RATIO)
      const left = Math.max(0, nominalLeft - overlapX)
      const top = Math.max(0, nominalTop - overlapY)
      const right = Math.min(width, nominalRight + overlapX)
      const bottom = Math.min(height, nominalBottom + overlapY)
      const region = await sharp(bytes)
        .extract({ left, top, width: right - left, height: bottom - top })
        .resize({
          width: (right - left) * ENHANCED_IMAGE_SCALE,
          height: (bottom - top) * ENHANCED_IMAGE_SCALE,
          fit: 'fill',
        })
        .png()
        .toBuffer()
      regions.push({
        label: `overlapping visual region ${String(regions.length + 1)}/${String(columns * rows)}; normalized bounds ${left / width},${top / height},${right / width},${bottom / height}`,
        bytes: region,
      })
    }
  }
  return [{ label: 'enhanced whole image', bytes: whole }, ...regions]
}

function markdownFromResponse(parsed: unknown, includeDiscardedText: boolean): string {
  const validated = mineruResponseSchema.safeParse(parsed)
  if (!validated.success) throw new OcrError('MinerU response fields are invalid', 'invalid-response')
  const markdown = Object.values(validated.data.results)
    .map(result => result.md_content ?? '')
    .find(content => content.trim() !== '')
  if (markdown === undefined) throw new OcrError('MinerU returned no document content', 'empty-result')
  return includeDiscardedText ? prependDiscardedText(markdown, validated.data.results) : markdown
}

function prependDiscardedText(markdown: string, results: MinerUMarkdownResults): string {
  const encoded = Object.values(results)
    .map(result => result.middle_json ?? '')
    .find(content => content.trim() !== '')
  if (encoded === undefined) return markdown
  const middle = parseMiddleJson(encoded)
  const seen = new Set<string>()
  const supplemental = middle.pdf_info
    .flatMap(page => page.discarded_blocks ?? [])
    .flatMap(collectBlockText)
    .map(text => text.trim())
    .filter((text) => {
      if (text === '' || markdown.includes(text) || seen.has(text)) return false
      seen.add(text)
      return true
    })
  return supplemental.length === 0 ? markdown : `${supplemental.join('\n')}\n\n${markdown}`
}

function parseMiddleJson(encoded: string): validation.infer<typeof mineruMiddleSchema> {
  let middle: unknown
  try {
    middle = JSON.parse(encoded)
  } catch (error) {
    throw new OcrError('MinerU returned invalid middle JSON', 'invalid-response', { cause: error })
  }
  const parsed = mineruMiddleSchema.safeParse(middle)
  if (!parsed.success) throw new OcrError('MinerU middle JSON fields are invalid', 'invalid-response')
  return parsed.data
}

function collectBlockText(value: unknown): string[] {
  const block = asRecord(value)
  if (block === undefined) return []
  const lines = Array.isArray(block.lines) ? block.lines : []
  const text = lines.flatMap((line) => {
    const record = asRecord(line)
    if (record === undefined || !Array.isArray(record.spans)) return []
    const content = record.spans
      .map(asRecord)
      .filter(isRecord)
      .map(span => typeof span.content === 'string' ? span.content : '')
      .join('')
      .trim()
    return content === '' ? [] : [content]
  })
  const nested = Array.isArray(block.blocks) ? block.blocks : []
  return [...text, ...nested.flatMap(collectBlockText)]
}

type MinerUMiddlePage = validation.infer<typeof mineruMiddleSchema>['pdf_info'][number]
type UnknownRecord = Record<string, unknown>

interface NormalizedLayoutPage {
  readonly page: OcrLayoutPage
  readonly suspicious: boolean
}

interface NormalizedBlock {
  readonly elements: readonly OcrLayoutElement[]
  readonly suspicious: boolean
}

interface NumberedElementGroup {
  readonly number: number
  readonly elements: readonly OcrLayoutElement[]
}

const numberedHeadPattern = /^\s*((?:[0-9０-９]\s*)+)[.．、](?!\s*[0-9０-９]\s*[.．])\s*\S/u

function leadingQuestionNumber(text: string): number | undefined {
  const matched = numberedHeadPattern.exec(text.normalize('NFKC'))?.[1]
  if (matched === undefined) return undefined
  const value = Number(matched.replace(/\s/gu, ''))
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function hasNumberedSequenceGap(page: OcrLayoutPage): boolean {
  let previous: number | undefined
  for (const element of page.elements) {
    const current = leadingQuestionNumber(element.text)
    if (current === undefined) continue
    if (previous !== undefined && current > previous + 1) return true
    previous = current
  }
  return false
}

function numberedGroups(elements: readonly OcrLayoutElement[]): readonly NumberedElementGroup[] {
  const groups: Array<{ number: number; elements: OcrLayoutElement[] }> = []
  for (const element of elements) {
    const number = leadingQuestionNumber(element.text)
    if (number !== undefined) groups.push({ number, elements: [element] })
    else groups.at(-1)?.elements.push(element)
  }
  return groups
}

async function cropPdfPageHalf(
  source: PDFDocument,
  pageIndex: number,
  side: 'left' | 'right',
): Promise<Uint8Array> {
  if (pageIndex < 0 || pageIndex >= source.getPageCount()) {
    throw new OcrError('MinerU column recovery referenced an unknown page', 'invalid-response')
  }
  const target = await PDFDocument.create()
  const [page] = await target.copyPages(source, [pageIndex])
  if (page === undefined) throw new OcrError('MinerU column recovery could not copy its page', 'invalid-response')
  const { width, height } = page.getSize()
  const halfWidth = width / 2
  const left = side === 'left' ? 0 : halfWidth
  page.setCropBox(left, 0, halfWidth, height)
  page.setMediaBox(left, 0, halfWidth, height)
  target.addPage(page)
  return target.save({ useObjectStreams: true })
}

function mapHalfPage(
  half: OcrLayoutPage,
  target: OcrLayoutPage,
  side: 'left' | 'right',
): readonly OcrLayoutElement[] {
  const targetHalfWidth = target.width / 2
  const scaleX = targetHalfWidth / half.width
  const scaleY = target.height / half.height
  const offsetX = side === 'left' ? 0 : targetHalfWidth
  return half.elements.map(element => ({
    ...element,
    bbox: [
      offsetX + element.bbox[0] * scaleX,
      element.bbox[1] * scaleY,
      offsetX + element.bbox[2] * scaleX,
      element.bbox[3] * scaleY,
    ] as OcrBoundingBox,
  }))
}

function mergeRecoveredColumns(
  original: OcrLayoutPage,
  halves: readonly (readonly OcrLayoutElement[])[],
): OcrLayoutPage {
  const divider = original.width / 2
  const originalGroups = numberedGroups(original.elements)
  const recoveredGroups = halves.flatMap(numberedGroups)
  const originalNumbers = new Set(originalGroups.map(group => group.number))
  const removed = new Set<OcrLayoutElement>()
  const added: OcrLayoutElement[] = []
  for (const recovered of recoveredGroups) {
    const matching = originalGroups.find(group => group.number === recovered.number)
    if (matching === undefined) {
      if (!originalNumbers.has(recovered.number)) added.push(...recovered.elements)
      continue
    }
    const crossesDivider = matching.elements.some(element => element.bbox[0] < divider && element.bbox[2] > divider)
    const recoveredCrossesDivider = recovered.elements.some(element => element.bbox[0] < divider && element.bbox[2] > divider)
    if (!crossesDivider || recoveredCrossesDivider) continue
    matching.elements.forEach(element => removed.add(element))
    added.push(...recovered.elements)
  }
  if (added.length === 0) return original
  const elements = [...original.elements.filter(element => !removed.has(element)), ...added]
  elements.sort((left, right) => {
    const leftLane = (left.bbox[0] + left.bbox[2]) / 2 < divider ? 0 : 1
    const rightLane = (right.bbox[0] + right.bbox[2]) / 2 < divider ? 0 : 1
    return leftLane - rightLane || left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0]
  })
  return { ...original, elements }
}

function normalizePage(page: MinerUMiddlePage, pageOffset: number): NormalizedLayoutPage {
  const [width, height] = page.page_size
  const preprocessed = page.preproc_blocks ?? []
  const preprocessedByBox = new Map(preprocessed.flatMap((block) => {
    const key = blockKey(block, width, height)
    return key === undefined ? [] : [[key, block] as const]
  }))
  let suspicious = false
  const blocks = page.para_blocks === undefined || (page.para_blocks.length === 0 && preprocessed.length > 0)
    ? preprocessed
    : page.para_blocks
  suspicious ||= page.para_blocks !== undefined && page.para_blocks.length === 0 && preprocessed.length > 0
  const elements = blocks.flatMap((block) => {
    const normalized = normalizeBlock(block, width, height)
    suspicious ||= normalized.suspicious
    if (hasMeaningfulElements(normalized.elements)) return normalized.elements
    const key = blockKey(block, width, height)
    const fallback = key === undefined ? undefined : preprocessedByBox.get(key)
    if (fallback === undefined || fallback === block) return normalized.elements
    const recovered = normalizeBlock(fallback, width, height)
    if (!hasMeaningfulElements(recovered.elements)) return normalized.elements
    suspicious = true
    return recovered.elements
  })
  return {
    page: { pageIndex: page.page_idx + pageOffset, width, height, elements },
    suspicious,
  }
}

function normalizeBlock(value: unknown, width: number, height: number): NormalizedBlock {
  const block = asRecord(value)
  if (block === undefined) return { elements: [], suspicious: false }
  const blockType = normalizeElementType(block.type)
  const blockBox = normalizeBox(block.bbox, width, height)
  const lines = Array.isArray(block.lines) ? block.lines : []
  let suspicious = false
  const elements = lines.flatMap((line) => {
    const normalized = normalizeLine(line, blockType, width, height)
    if (blockBox === undefined) return normalized
    return normalized.filter((element) => {
      if (boxCenterInside(element.bbox, blockBox)) return true
      suspicious = true
      return false
    })
  })
  const nested = Array.isArray(block.blocks) ? block.blocks : []
  for (const child of nested) {
    const normalized = normalizeBlock(child, width, height)
    elements.push(...normalized.elements)
    suspicious ||= normalized.suspicious
  }
  if (elements.length === 0 && blockBox !== undefined && blockType !== 'text' && blockType !== 'equation') {
    elements.push({ type: blockType, text: '', bbox: blockBox })
  }
  return { elements, suspicious }
}

function blockKey(value: unknown, width: number, height: number): string | undefined {
  const block = asRecord(value)
  if (block === undefined) return undefined
  const bbox = normalizeBox(block.bbox, width, height)
  return bbox === undefined ? undefined : `${normalizeElementType(block.type)}:${bbox.join(',')}`
}

function hasMeaningfulElements(elements: readonly OcrLayoutElement[]): boolean {
  return elements.some(element => element.text.trim() !== '' || (element.type !== 'text' && element.type !== 'equation'))
}

function boxCenterInside(inner: OcrBoundingBox, outer: OcrBoundingBox): boolean {
  const centerX = (inner[0] + inner[2]) / 2
  const centerY = (inner[1] + inner[3]) / 2
  return centerX >= outer[0] && centerX <= outer[2] && centerY >= outer[1] && centerY <= outer[3]
}

function normalizeLine(
  value: unknown,
  blockType: OcrLayoutElement['type'],
  width: number,
  height: number,
): OcrLayoutElement[] {
  const line = asRecord(value)
  if (line === undefined) return []
  const spans = Array.isArray(line.spans) ? line.spans.map(asRecord).filter(isRecord) : []
  const text = spans.map(span => typeof span.content === 'string' ? span.content : '').join('').trim()
  const spanTypes = spans.map(span => normalizeElementType(span.type))
  const type = blockType === 'text' && spanTypes.length > 0 && spanTypes.every(item => item === 'equation')
    ? 'equation'
    : blockType
  const bbox = normalizeBox(line.bbox, width, height)
    ?? unionBoxes(spans.map(span => normalizeBox(span.bbox, width, height)).filter(isBox))
  return bbox === undefined ? [] : [{ type, text, bbox }]
}

function normalizeElementType(value: unknown): OcrLayoutElement['type'] {
  const type = typeof value === 'string' ? value.toLowerCase() : ''
  if (type.includes('equation') || type.includes('formula')) return 'equation'
  if (type.includes('image') || type.includes('figure') || type.includes('chart')) return 'image'
  if (type.includes('table')) return 'table'
  if (type === 'text' || type === 'title' || type === 'list') return 'text'
  return 'other'
}

function normalizeBox(value: unknown, width: number, height: number): OcrBoundingBox | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(item => typeof item === 'number' && Number.isFinite(item))) {
    return undefined
  }
  const [rawX0, rawY0, rawX1, rawY1] = value as [number, number, number, number]
  const x0 = Math.max(0, Math.min(width, rawX0))
  const y0 = Math.max(0, Math.min(height, rawY0))
  const x1 = Math.max(0, Math.min(width, rawX1))
  const y1 = Math.max(0, Math.min(height, rawY1))
  return x1 <= x0 || y1 <= y0 ? undefined : [x0, y0, x1, y1]
}

function unionBoxes(boxes: OcrBoundingBox[]): OcrBoundingBox | undefined {
  if (boxes.length === 0) return undefined
  return [
    Math.min(...boxes.map(box => box[0])),
    Math.min(...boxes.map(box => box[1])),
    Math.max(...boxes.map(box => box[2])),
    Math.max(...boxes.map(box => box[3])),
  ]
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function isRecord(value: UnknownRecord | undefined): value is UnknownRecord {
  return value !== undefined
}

function isBox(value: OcrBoundingBox | undefined): value is OcrBoundingBox {
  return value !== undefined
}

function decodeRequest(request: OcrExtractRequest, maxFileBytes: number): DecodedRequest {
  const name = request.name.trim()
  if (name === '' || name.length > 255) throw new OcrError('document name is missing or too long', 'invalid-request')
  if (request.contentBase64.length > Math.ceil(maxFileBytes / 3) * 4) {
    throw new OcrError(`document exceeds the configured ${String(maxFileBytes)} byte limit`, 'file-too-large')
  }
  const bytes = Buffer.from(request.contentBase64, 'base64')
  if (bytes.toString('base64') !== request.contentBase64) {
    throw new OcrError('document bytes are not canonical base64', 'invalid-request')
  }
  if (bytes.byteLength === 0) throw new OcrError('document is empty', 'invalid-request')
  if (bytes.byteLength > maxFileBytes) {
    throw new OcrError(`document exceeds the configured ${String(maxFileBytes)} byte limit`, 'file-too-large')
  }
  const safeName = name.split(/[\\/]/u).at(-1)?.replace(/[\u0000-\u001f]/gu, '_') ?? ''
  const dot = safeName.lastIndexOf('.')
  const extension = dot < 0 ? '' : safeName.slice(dot).toLowerCase()
  const inferred = EXTENSION_BY_MEDIA_TYPE[request.mediaType]
  const uploadName = extension === '' && inferred !== undefined ? `${safeName}${inferred}` : safeName
  const uploadDot = uploadName.lastIndexOf('.')
  const uploadExtension = uploadDot < 0 ? '' : uploadName.slice(uploadDot).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(uploadExtension)) {
    throw new OcrError('supported document formats are PDF, images, DOCX, PPTX, and XLSX', 'unsupported-format')
  }
  return { bytes, uploadName }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new OcrError('MinerU response exceeds the configured size limit', 'invalid-response')
      }
      output += decoder.decode(next.value, { stream: true })
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}
