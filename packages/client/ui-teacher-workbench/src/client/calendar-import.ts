/** Deterministic school-calendar projection from MinerU Markdown. */

/** One editable item shown before a recognized school calendar is imported. */
export interface CalendarImportDraft {
  /** Browser-local identity for review edits. */
  readonly id: string
  /** Whether this row will be imported. */
  readonly selected: boolean
  /** Local ISO date. */
  readonly date: string
  /** Optional local start time. */
  readonly time: string
  /** Editable calendar title. */
  readonly title: string
  /** Editable source detail. */
  readonly details: string
}

interface ParsedCalendarItem {
  readonly date: string
  readonly title: string
  readonly details: string
}

interface DateAnchor {
  readonly start: number
  readonly end: number
  readonly year: number
  readonly month: number
  readonly days: readonly number[]
}

interface TableCell {
  readonly text: string
  readonly columnSpan: number
  readonly rowSpan: number
}

const DATE_PATTERN = new RegExp(
  String.raw`(?:(?<year>(?:19|20)\d{2})\s*年\s*)?(?<month>1[0-2]|0?[1-9])\s*月\s*`
    + String.raw`(?<days>[0-3]?\d(?:\s*[,，、和及/]\s*[0-3]?\d)*(?:\s*[-—至~]\s*[0-3]?\d)?)\s*(?:日|号)?`,
  'gu',
)

/**
 * Parse MinerU Markdown or HTML-table Markdown into reviewable calendar items.
 * @param markdown - reading-order document content.
 * @param fallbackYear - selected calendar year when the document has no year heading.
 * @returns deduplicated dated items in source order.
 */
export function parseSchoolCalendar(markdown: string, fallbackYear: number): CalendarImportDraft[] {
  const normalized = normalizeDocument(markdown)
  const documentYear = inferDocumentYear(normalized) ?? fallbackYear
  const tableItems = parseTableRows(extractTableRows(markdown), documentYear)
  const parsed = tableItems.length > 0 ? tableItems : parseBlock(normalized, documentYear)
  const deduplicated: ParsedCalendarItem[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    const key = `${item.date}\u0000${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    deduplicated.push(item)
  }
  return deduplicated.map((item, index) => ({
    id: `calendar-import-${String(index + 1)}`,
    selected: true,
    date: item.date,
    time: '',
    title: item.title,
    details: item.details,
  }))
}

function parseBlock(text: string, documentYear: number): ParsedCalendarItem[] {
  const anchors = collectDateAnchors(text, documentYear)
  const items: ParsedCalendarItem[] = []
  for (const [index, anchor] of anchors.entries()) {
    const next = anchors[index + 1]
    const segment = cleanSegment(text.slice(anchor.end, next?.start ?? text.length))
    const entries = extractEntries(segment)
    for (const day of anchor.days) {
      const date = isoDate(anchor.year, anchor.month, day)
      if (date === null) continue
      for (const entry of entries) items.push({ date, ...entry })
    }
  }
  return items
}

function parseTableRows(rows: readonly (readonly TableCell[])[], documentYear: number): ParsedCalendarItem[] {
  const activeDates = new Map<number, readonly string[]>()
  const columnRoles = new Map<number, 'content' | 'metadata'>()
  const occupiedThroughRow = new Map<number, number>()
  const items: ParsedCalendarItem[] = []
  for (const [rowIndex, row] of rows.entries()) {
    let column = 0
    for (const cell of row) {
      while (rangeOverlapsRowSpan(column, cell.columnSpan, rowIndex, occupiedThroughRow)) column += 1
      const text = normalizeDocument(cell.text)
      const role = tableColumnRole(text)
      if (role !== undefined) {
        for (let offset = 0; offset < cell.columnSpan; offset += 1) columnRoles.set(column + offset, role)
        occupyFutureRows(column, cell, rowIndex, occupiedThroughRow)
        column += cell.columnSpan
        continue
      }
      const anchors = collectDateAnchors(text, documentYear)
      if (anchors[0]?.start === 0) {
        const dates = anchors.flatMap(anchor => anchor.days.flatMap((day) => {
          const date = isoDate(anchor.year, anchor.month, day)
          return date === null ? [] : [date]
        }))
        for (let offset = 0; offset < cell.columnSpan; offset += 1) activeDates.set(column + offset, dates)
        items.push(...parseBlock(text, documentYear))
        occupyFutureRows(column, cell, rowIndex, occupiedThroughRow)
        column += cell.columnSpan
        continue
      }
      if (columnRoles.get(column) !== 'metadata') {
        const dates = activeDates.get(column) ?? []
        const entries = extractEntries(text)
        for (const date of dates) {
          for (const entry of entries) items.push({ date, ...entry })
        }
      }
      occupyFutureRows(column, cell, rowIndex, occupiedThroughRow)
      column += cell.columnSpan
    }
  }
  return items
}

function rangeOverlapsRowSpan(
  column: number,
  columnSpan: number,
  rowIndex: number,
  occupiedThroughRow: ReadonlyMap<number, number>,
): boolean {
  for (let offset = 0; offset < columnSpan; offset += 1) {
    if ((occupiedThroughRow.get(column + offset) ?? rowIndex) > rowIndex) return true
  }
  return false
}

function occupyFutureRows(
  column: number,
  cell: TableCell,
  rowIndex: number,
  occupiedThroughRow: Map<number, number>,
): void {
  if (cell.rowSpan <= 1) return
  for (let offset = 0; offset < cell.columnSpan; offset += 1) {
    occupiedThroughRow.set(column + offset, rowIndex + cell.rowSpan)
  }
}

function collectDateAnchors(text: string, documentYear: number): DateAnchor[] {
  const anchors: DateAnchor[] = []
  let rollingYear = documentYear
  let previousMonth: number | undefined
  for (const match of text.matchAll(DATE_PATTERN)) {
    const month = Number(match.groups?.month)
    const explicitYear = match.groups?.year === undefined ? undefined : Number(match.groups.year)
    if (explicitYear !== undefined) rollingYear = explicitYear
    else if (previousMonth !== undefined && previousMonth >= 10 && month <= 2) rollingYear += 1
    previousMonth = month
    const days = parseDays(match.groups?.days ?? '')
    if (days.length === 0) continue
    anchors.push({
      start: match.index,
      end: match.index + match[0].length,
      year: rollingYear,
      month,
      days,
    })
  }
  return anchors
}

function parseDays(value: string): number[] {
  const range = value.match(/^\s*(\d{1,2})\s*[-—至~]\s*(\d{1,2})\s*$/u)
  if (range !== null) {
    const start = Number(range[1])
    const end = Number(range[2])
    if (start < 1 || end > 31 || end < start) return []
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }
  return value.split(/[,，、和及/]/u)
    .map(part => Number(part.trim()))
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 31)
}

function extractEntries(segment: string): Array<{ title: string; details: string }> {
  const lines = segment
    .split(/\n+/u)
    .flatMap(line => line.split(/(?=\s*\d{1,2}[.、](?!\d)\s*)/u))
    .map(line => cleanLine(line))
    .filter(line => line !== '' && !isTableMetadata(line))
  return lines.map((line) => {
    const title = line.length > 120 ? line.slice(0, 120).trimEnd() : line
    return { title, details: line.length > 120 ? line : '' }
  })
}

function cleanLine(value: string): string {
  return value
    .replace(/^[-*#>\s]+/u, '')
    .replace(/^\d{1,2}[.、]\s*/u, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[:：|]+|[:：|]+$/gu, '')
    .trim()
}

function isTableMetadata(value: string): boolean {
  if (/^(?:周[一二三四五六日天]|第?\d{1,2}周|内容|负责人|部门|备注)$/u.test(value)) return true
  if (/^(?:-{3,}|:?-{2,}:?)$/u.test(value)) return true
  return /^(?:校历|工作安排)$/u.test(value)
}

function normalizeDocument(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:td|th|tr|p|div|li|h[1-6])\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\|/gu, '\n')
    .replace(/\r/gu, '')
    .replace(/[\t\u00a0]+/gu, ' ')
    .replace(/\n[ ]+/gu, '\n')
    .replace(/[ ]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function extractTableRows(value: string): TableCell[][] {
  const htmlRows = [...value.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) => {
    const body = row[1] ?? ''
    return [...body.matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/giu)].map((cell): TableCell => {
      const attributes = cell[1] ?? ''
      const columnSpan = attributes.match(/\bcolspan\s*=\s*["']?(\d+)/iu)
      const rowSpan = attributes.match(/\browspan\s*=\s*["']?(\d+)/iu)
      return {
        text: cell[2] ?? '',
        columnSpan: Math.max(1, Number(columnSpan?.[1] ?? 1)),
        rowSpan: Math.max(1, Number(rowSpan?.[1] ?? 1)),
      }
    })
  }).filter(row => row.length > 0)
  if (htmlRows.length > 0) return htmlRows
  return value.split('\n')
    .filter(line => line.includes('|'))
    .map(line => line.split('|').slice(1, -1).map(text => ({ text, columnSpan: 1, rowSpan: 1 })))
    .filter(row => row.length > 0)
}

function cleanSegment(value: string): string {
  return value.replace(/^[\s:：|]+/u, '').replace(/[\s|]+$/u, '').trim()
}

function inferDocumentYear(value: string): number | undefined {
  const match = value.match(/((?:19|20)\d{2})\s*年/u)
  return match === null ? undefined : Number(match[1])
}

function tableColumnRole(value: string): 'content' | 'metadata' | undefined {
  if (/^内容$/u.test(value)) return 'content'
  if (/^(?:负责人|部门|备注)$/u.test(value)) return 'metadata'
  return undefined
}

function isoDate(year: number, month: number, day: number): string | null {
  const projected = new Date(year, month - 1, day)
  if (projected.getFullYear() !== year || projected.getMonth() !== month - 1 || projected.getDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}
