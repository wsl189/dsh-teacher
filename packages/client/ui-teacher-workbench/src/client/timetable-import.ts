/** Deterministic timetable projection from MinerU Markdown. */

import type {
  TeacherTimetableEntryKind,
  TeacherWeekday,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Context supplied by the active timetable view. */
export interface TimetableImportDefaults {
  /** Selected class when the source omits class labels. */
  readonly className: string
  /** Existing names in the selected grade, used to preserve local class naming. */
  readonly classNames: readonly string[]
  /** Selected grade when the source omits grade labels. */
  readonly grade: string
  /** Row family selected by the active view. */
  readonly kind: TeacherTimetableEntryKind
  /** Teacher name used when a personal table omits teacher labels. */
  readonly teacherName: string
}

/** One editable timetable entry shown before OCR results are imported. */
export interface TimetableImportDraft {
  /** Browser-local identity for review edits. */
  readonly id: string
  /** Whether this row will be imported. */
  readonly selected: boolean
  /** Class display name. */
  readonly className: string
  /** Grade label. */
  readonly grade: string
  /** Regular lesson, morning study, or evening study. */
  readonly kind: TeacherTimetableEntryKind
  /** Weekday using Monday as one. */
  readonly weekday: TeacherWeekday
  /** One-based lesson or study slot. */
  readonly period: number
  /** Optional local start time. */
  readonly startTime: string
  /** Optional local end time. */
  readonly endTime: string
  /** Course or study-session label. */
  readonly subject: string
  /** Teacher responsible for the entry. */
  readonly teacherName: string
  /** Optional classroom or location. */
  readonly location: string
}

type ParsedTimetableEntry = Omit<TimetableImportDraft, 'id' | 'selected'>

interface TableCell {
  readonly text: string
  readonly columnSpan: number
  readonly rowSpan: number
}

interface CarriedCell {
  readonly text: string
  readonly throughRow: number
}

interface MatrixColumn {
  readonly index: number
  readonly weekday: TeacherWeekday
  readonly className: string
  readonly grade: string
  readonly fixedClass: boolean
}

interface DocumentTable {
  readonly heading: string
  readonly rows: readonly (readonly string[])[]
}

const WEEKDAY_LABELS: Readonly<Record<string, TeacherWeekday>> = Object.freeze({
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
})

const COMPACT_SUBJECTS = Object.freeze([
  '道德与法治', '体育与健康', '德语与西班牙语', '德国与西班牙', '信息技术', '通用技术',
  '心理健康', '劳动技术', '校本课程', '综合实践', '语言与数学', '生物学', '思想政治',
  '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '体育',
  '音乐', '美术', '科学', '日语', '俄语', '德语', '西班牙语', '劳动', '班会', '自习',
  '早读', '晨读', '晚读',
].sort((left, right) => right.length - left.length))

/**
 * Parse reading-order Markdown or an HTML/Markdown table into reviewable rows.
 * @param markdown - document content returned by the shared OCR service.
 * @param defaults - selected view context used only for omitted fields.
 * @returns deduplicated timetable entries in source order.
 */
export function parseTimetable(
  markdown: string,
  defaults: TimetableImportDefaults,
): TimetableImportDraft[] {
  const documents = detailedOcrDocuments(markdown)
  const rows = extractTableRows(markdown)
  const documentText = normalizeText(markdown)
  const documentClass = extractDocumentClass(markdown)
  const context: TimetableImportDefaults = {
    ...defaults,
    className: documentClass?.className || defaults.className || '',
    grade: documentClass?.grade || defaults.grade || '',
    teacherName: documentClass?.className ? '' : defaults.teacherName,
  }
  const tableEntries = [
    ...documents.flatMap(document => parseStudyClassTables(document, context)),
    ...documents.flatMap(document => parseMatrixTable(extractTableRows(document), context)),
  ]
  const recordEntries = tableEntries.length > 0 ? [] : parseRecordTable(rows, context)
  const blockEntries = tableEntries.length + recordEntries.length > 0
    ? []
    : parseTextLines(documentText, context)
  const parsed = [...tableEntries, ...recordEntries, ...blockEntries]
  const deduplicated: ParsedTimetableEntry[] = []
  const seen = new Map<string, number>()
  for (const item of parsed) {
    if (item.subject === '') continue
    const key = [item.className, item.grade, item.kind, item.weekday, item.period].join('\u0000')
    const prior = seen.get(key)
    if (prior === undefined) {
      seen.set(key, deduplicated.length)
      deduplicated.push(item)
    } else {
      deduplicated[prior] = item
    }
  }
  return deduplicated.map((item, index) => ({
    id: `timetable-import-${String(index + 1)}`,
    selected: isPlausibleClassName(item.className) && item.subject !== '',
    ...item,
  }))
}

function detailedOcrDocuments(markdown: string): string[] {
  const marker = /^## OCR pass: (.+)$/gmu
  const matches = [...markdown.matchAll(marker)]
  if (matches.length === 0) return [markdown]
  const documents = matches.map((match, index) => ({
    label: match[1]?.trim() ?? '',
    body: markdown.slice(match.index + match[0].length, matches[index + 1]?.index ?? markdown.length),
  }))
  const detailed = documents.filter(document => document.label !== 'enhanced whole image')
  return (detailed.length > 0 ? detailed : documents).map(document => document.body)
}

/**
 * Decide whether OCR text is safe to use as a class name without correction.
 * @param value - recognized or teacher-edited class label.
 * @returns whether the normalized label has content before a final `班` marker.
 */
export function isPlausibleClassName(value: string): boolean {
  const text = cleanValue(value)
  return text.length <= 80 && /^.+班$/u.test(text)
}

function extractDocumentClass(value: string): { className: string; grade: string } | undefined {
  const tableStart = value.search(/<table\b|(?:^|\n)\s*\|/iu)
  const heading = tableStart >= 0 ? value.slice(0, tableStart) : value.split('\n').slice(0, 5).join('\n')
  const text = normalizeText(heading)
  const classItem = extractClass(text)
  if (classItem !== undefined) return classItem
  const grade = extractGrade(text)
  return grade === '' ? undefined : { className: '', grade }
}

function parseStudyClassTables(
  markdown: string,
  defaults: TimetableImportDefaults,
): ParsedTimetableEntry[] {
  return extractHtmlTables(markdown).flatMap(({ heading, rows }) => {
    const headingKind = inferKind(heading, defaults.kind)
    if (headingKind === 'lesson') return []
    const headerIndex = rows.findIndex((row) => {
      const [label = ''] = row
      return /^(?:班级|班别)$/u.test(cleanLabel(label))
        && row.slice(1).filter(cell => isPlausibleClassName(extractClass(cell)?.className ?? cell)).length >= 2
    })
    if (headerIndex < 0) return []
    const header = rows[headerIndex] ?? []
    const columns = header.flatMap((cell, index): MatrixColumn[] => {
      if (index === 0) return []
      const extracted = extractClass(cell)
      const sourceName = extracted?.className ?? cleanValue(cell)
      if (!isPlausibleClassName(sourceName)) return []
      const grade = extracted?.grade || defaults.grade
      const className = classNameForOrdinal(grade, classOrdinal(sourceName), defaults.classNames) || sourceName
      return [{ index, weekday: 1, className, grade, fixedClass: true }]
    })
    if (columns.length < 2) return []
    const periods = new Map<string, number>()
    const entries: ParsedTimetableEntry[] = []
    for (const row of rows.slice(headerIndex + 1)) {
      const label = row[0] ?? ''
      const weekday = parseWeekday(label)
      if (weekday === undefined) continue
      const kind = inferKind(`${heading}\n${label}`, headingKind)
      const periodKey = `${kind}:${String(weekday)}`
      const period = (periods.get(periodKey) ?? 0) + 1
      periods.set(periodKey, period)
      for (const column of columns) {
        const teacherName = cleanValue(row[column.index] ?? '').replace(/[＊*]+$/gu, '').trim()
        if (teacherName === '' || /^(?:[-—/]|无|空)$/u.test(teacherName)) continue
        entries.push({
          className: column.className,
          grade: column.grade,
          kind,
          weekday,
          period,
          startTime: '',
          endTime: '',
          subject: studySubject(label, kind),
          teacherName,
          location: '',
        })
      }
    }
    return entries
  })
}

function parseMatrixTable(
  rows: readonly (readonly string[])[],
  defaults: TimetableImportDefaults,
): ParsedTimetableEntry[] {
  const entries: ParsedTimetableEntry[] = []
  const headerIndexes = rows.flatMap((row, index) => (
    weekdayHeaderColumns(row, rows[index + 1]).length >= 2 ? [index] : []
  ))
  headerIndexes.forEach((headerIndex, blockIndex) => {
    const endIndex = headerIndexes[blockIndex + 1] ?? rows.length
    entries.push(...parseMatrixBlock(rows.slice(headerIndex, endIndex), defaults))
  })
  return entries
}

function parseMatrixBlock(
  rows: readonly (readonly string[])[],
  defaults: TimetableImportDefaults,
): ParsedTimetableEntry[] {
  const header = rows[0] ?? []
  const possibleSubheader = rows[1] ?? []
  const weekdayColumns = weekdayHeaderColumns(header, possibleSubheader)
  if (weekdayColumns.length < 2) return []
  const weekdayIndexes = new Set(weekdayColumns.map(column => column.index))
  const classColumn = header.findIndex(cell => /(?:班级|班别)/u.test(cleanLabel(cell)))
  const gradeColumn = header.findIndex(cell => /年级/u.test(cleanLabel(cell)))
  let slotColumn = header.findIndex(cell => /(?:节次|节数|课次|时间|时段)/u.test(cleanLabel(cell)))
  if (slotColumn < 0) {
    const width = Math.max(header.length, ...rows.map(row => row.length))
    const candidates = Array.from({ length: width }, (_unused, index) => index)
      .filter(index => !weekdayIndexes.has(index))
    slotColumn = candidates.reduce((best, candidate) => (
      periodColumnScore(rows.slice(1), candidate) > periodColumnScore(rows.slice(1), best)
        ? candidate
        : best
    ), candidates[0] ?? -1)
  }
  if (slotColumn < 0) return []
  const hasClassSubheader = weekdayColumns
    .filter(column => parseClassHeader(possibleSubheader[column.index]) !== undefined)
    .length >= 2
  const rawBodyRows = rows.slice(hasClassSubheader ? 2 : 1)
  const courseColumns = timetableColumns(
    weekdayColumns,
    hasClassSubheader ? possibleSubheader : undefined,
    rawBodyRows,
    slotColumn,
    defaults,
  )
  if (courseColumns.length === 0) return []
  const bodyRows = defaults.kind === 'lesson'
    ? mergeSplitCourseRows(rawBodyRows, slotColumn, courseColumns.map(column => column.index))
    : rawBodyRows
  const entries: ParsedTimetableEntry[] = []
  const studyPeriods = { morningStudy: 0, eveningStudy: 0 }
  let highestPeriod = 0
  for (const row of bodyRows) {
    if (row.filter(cell => parseWeekday(cell) !== undefined).length >= 2) continue
    const slotText = row[slotColumn] ?? ''
    const kind = inferKind(slotText, defaults.kind)
    const rawPeriod = parsePeriod(slotText)
    let period = rawPeriod
    if (period === undefined && kind !== 'lesson') {
      studyPeriods[kind] += 1
      period = studyPeriods[kind]
    }
    if (period === undefined && kind === 'lesson' && rowHasCourseCells(row, courseColumns.map(column => column.index))) {
      period = highestPeriod + 1
    }
    if (period === undefined) continue
    if (rawPeriod !== undefined && kind === 'lesson') {
      period = rawPeriod > highestPeriod ? rawPeriod : highestPeriod + 1
    }
    if (kind === 'lesson') highestPeriod = Math.max(highestPeriod, period)
    const times = parseTimes(slotText)
    const rowClass = extractClass(row[classColumn] ?? '')
    const rawClassName = cleanValue(row[classColumn] ?? '')
    const className = rowClass?.className || (isPlausibleClassName(rawClassName) ? rawClassName : '') || defaults.className
    const grade = cleanValue(row[gradeColumn] ?? '') || rowClass?.grade || defaults.grade
    for (const column of courseColumns) {
      const parsed = parseCourseCell(row[column.index] ?? '', {
        className: column.className || className,
        grade: column.grade || grade,
        teacherName: defaults.teacherName,
      })
      if (parsed === null) continue
      entries.push({
        className: column.fixedClass ? column.className : parsed.className,
        grade: column.fixedClass ? column.grade : parsed.grade,
        kind,
        weekday: column.weekday,
        period,
        startTime: times.startTime,
        endTime: times.endTime,
        subject: parsed.subject,
        teacherName: parsed.teacherName,
        location: parsed.location,
      })
    }
  }
  return entries
}

function weekdayHeaderColumns(
  header: readonly string[],
  subheader: readonly string[] | undefined,
): Array<{ readonly index: number; readonly weekday: TeacherWeekday }> {
  const direct = new Map<number, TeacherWeekday>()
  header.forEach((cell, index) => {
    const weekday = parseWeekday(cell)
    if (weekday !== undefined) direct.set(index, weekday)
  })
  if (subheader === undefined) return [...direct].map(([index, weekday]) => ({ index, weekday }))
  for (const run of ascendingClassRuns(subheader)) {
    const weekdays = new Set<TeacherWeekday>()
    for (let index = run.start; index <= run.end; index += 1) {
      const weekday = direct.get(index)
      if (weekday !== undefined) weekdays.add(weekday)
    }
    const joined = parseWeekday(header.slice(run.start, run.end + 1).join(''))
    if (joined !== undefined) weekdays.add(joined)
    if (weekdays.size !== 1) continue
    const [weekday] = weekdays
    if (weekday === undefined) continue
    for (let index = run.start; index <= run.end; index += 1) direct.set(index, weekday)
  }
  return [...direct].sort(([left], [right]) => left - right).map(([index, weekday]) => ({ index, weekday }))
}

function ascendingClassRuns(row: readonly string[]): Array<{ readonly start: number; readonly end: number }> {
  const runs: Array<{ start: number; end: number }> = []
  let start = -1
  let prior = 0
  row.forEach((cell, index) => {
    const ordinal = parseClassHeader(cell)?.ordinal
    if (ordinal === 1) {
      if (start >= 0 && index - start >= 2) runs.push({ start, end: index - 1 })
      start = index
      prior = 1
    } else if (start >= 0 && ordinal === prior + 1) {
      prior = ordinal
    } else {
      if (start >= 0 && index - start >= 2) runs.push({ start, end: index - 1 })
      start = -1
      prior = 0
    }
  })
  if (start >= 0 && row.length - start >= 2) runs.push({ start, end: row.length - 1 })
  return runs
}

function mergeSplitCourseRows(
  rows: readonly (readonly string[])[],
  slotColumn: number,
  courseColumns: readonly number[],
): string[][] {
  const merged: string[][] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = [...(rows[index] ?? [])]
    const next = rows[index + 1]
    const rowPeriod = parsePeriod(row[slotColumn] ?? '')
    const nextPeriod = next === undefined ? undefined : parsePeriod(next[slotColumn] ?? '')
    const subjectCells = courseColumns.filter(column => looksLikeCourse(row[column] ?? '')).length
    const populatedCells = courseColumns.filter(column => cleanValue(row[column] ?? '') !== '').length
    const companionCells = next === undefined
      ? 0
      : courseColumns.filter(column => cleanValue(next[column] ?? '') !== '').length
    const companionPeople = next === undefined
      ? 0
      : courseColumns.filter(column => looksLikePerson(next[column] ?? '')).length
    const threshold = Math.max(2, Math.ceil(courseColumns.length / 2))
    const canMerge = next !== undefined
      && (subjectCells >= threshold || (populatedCells >= threshold && companionPeople >= threshold))
      && companionCells >= threshold
      && (nextPeriod === undefined || nextPeriod === rowPeriod)
    if (!canMerge) {
      merged.push(row)
      continue
    }
    for (const column of courseColumns) {
      const subject = cleanValue(row[column] ?? '')
      const companion = cleanValue(next[column] ?? '')
      row[column] = subject === companion ? subject : `${subject}${companion}`
    }
    merged.push(row)
    index += 1
  }
  return merged
}

function rowHasCourseCells(row: readonly string[], columns: readonly number[]): boolean {
  return columns.filter(column => looksLikeCourse(row[column] ?? '')).length >= Math.max(2, Math.ceil(columns.length / 2))
}

function looksLikeCourse(value: string): boolean {
  const text = cleanValue(value).replace(/^目习/u, '自习')
  return COMPACT_SUBJECTS.some(subject => text.startsWith(subject))
    || /(?:自习|班会|答疑|阅读|实验|实践|活动|选修|复习|辅导|训练|拓展|社团|作业)/u.test(text)
}

function looksLikePerson(value: string): boolean {
  const text = cleanValue(value)
  return !looksLikeCourse(text) && /^[\p{Script=Han}·]{2,5}$/u.test(text)
}

function periodColumnScore(rows: readonly (readonly string[])[], column: number): number {
  if (column < 0) return -1
  return rows.filter(row => parsePeriod(row[column] ?? '') !== undefined).length
}

function timetableColumns(
  columns: readonly { readonly index: number; readonly weekday: TeacherWeekday }[],
  subheader: readonly string[] | undefined,
  rows: readonly (readonly string[])[],
  slotColumn: number,
  defaults: TimetableImportDefaults,
): MatrixColumn[] {
  const usable = columns.filter(column => !isRepeatedPeriodColumn(rows, slotColumn, column.index))
  if (subheader === undefined) {
    return usable.map(column => ({
      ...column,
      className: defaults.className,
      grade: defaults.grade,
      fixedClass: false,
    }))
  }
  const grouped = new Map<TeacherWeekday, typeof usable>()
  for (const column of usable) grouped.set(column.weekday, [...(grouped.get(column.weekday) ?? []), column])
  return [...grouped.entries()].flatMap(([weekday, weekdayColumns]) => {
    const labels = weekdayColumns.map(column => parseClassHeader(subheader[column.index]))
    const ordinals = labels.map(label => label?.ordinal)
    const ordered = ordinals.every((ordinal, index) => (
      ordinal !== undefined && (index === 0 || ordinal > (ordinals[index - 1] ?? 0))
    ))
    return weekdayColumns.map((column, index): MatrixColumn => {
      const label = labels[index]
      const ordinal = ordered ? label?.ordinal : index + 1
      const extracted = label?.className === undefined ? undefined : extractClass(label.className)
      return {
        index: column.index,
        weekday,
        className: extracted?.className || classNameForOrdinal(defaults.grade, ordinal, defaults.classNames) || defaults.className,
        grade: extracted?.grade || defaults.grade,
        fixedClass: true,
      }
    })
  })
}

function isRepeatedPeriodColumn(
  rows: readonly (readonly string[])[],
  slotColumn: number,
  candidateColumn: number,
): boolean {
  let compared = 0
  let matched = 0
  for (const row of rows) {
    const slot = parsePeriod(row[slotColumn] ?? '')
    const candidate = parsePeriod(row[candidateColumn] ?? '')
    if (slot === undefined || candidate === undefined) continue
    compared += 1
    if (slot === candidate) matched += 1
  }
  return compared >= 2 && matched / compared >= 0.75
}

function parseClassHeader(value: string | undefined): { className?: string; ordinal?: number } | undefined {
  const text = cleanValue(value ?? '')
  if (text === '') return undefined
  const extracted = extractClass(text)
  if (extracted !== undefined) return { className: extracted.className }
  const match = text.match(/^([一二三四五六七八九十百\d]+)\s*(?:班)?$/u)
  if (match === null) return undefined
  const ordinal = chineseNumber(match[1] ?? '')
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? { ordinal } : undefined
}

function classNameForOrdinal(grade: string, ordinal: number | undefined, classNames: readonly string[]): string {
  if (ordinal === undefined) return ''
  const existing = classNames.find(className => classOrdinal(className) === ordinal)
  if (existing !== undefined) return existing
  if (grade === '') return ''
  const normalizedGrade = grade.replace(/(?:年级|年)$/u, '')
  return `${normalizedGrade}（${String(ordinal)}）班`
}

function classOrdinal(value: string): number | undefined {
  const match = cleanValue(value).match(/[（(]?([一二三四五六七八九十百\d]+)[)）]?\s*班$/u)
  if (match === null) return undefined
  const ordinal = chineseNumber(match[1] ?? '')
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : undefined
}

function parseRecordTable(
  rows: readonly (readonly string[])[],
  defaults: TimetableImportDefaults,
): ParsedTimetableEntry[] {
  const headerIndex = rows.findIndex(row => row.some(cell => /^(?:星期|周几|周次)$/u.test(cleanLabel(cell)))
    && row.some(cell => /^(?:课程|科目|学科|内容)$/u.test(cleanLabel(cell))))
  if (headerIndex < 0) return []
  const header = rows[headerIndex] ?? []
  const column = (pattern: RegExp): number => header.findIndex(cell => pattern.test(cleanLabel(cell)))
  const weekdayColumn = column(/^(?:星期|周几|周次)$/u)
  const periodColumn = column(/^(?:节次|节数|课次|时间|时段)$/u)
  const subjectColumn = column(/^(?:课程|科目|学科|内容)$/u)
  const classColumn = column(/^(?:班级|班别)$/u)
  const gradeColumn = column(/^年级$/u)
  const teacherColumn = column(/^(?:教师|老师|任课教师)$/u)
  const locationColumn = column(/^(?:地点|教室|场地)$/u)
  const kindColumn = column(/^(?:类型|类别)$/u)
  const entries: ParsedTimetableEntry[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const weekday = parseWeekday(row[weekdayColumn] ?? '')
    const kind = inferKind(row[kindColumn] ?? row[periodColumn] ?? '', defaults.kind)
    const period = parsePeriod(row[periodColumn] ?? '') ?? 1
    const subject = cleanValue(row[subjectColumn] ?? '')
    if (weekday === undefined || subject === '') continue
    const extractedClass = extractClass(row[classColumn] ?? '')
    const times = parseTimes(row[periodColumn] ?? '')
    entries.push({
      className: extractedClass?.className
        || (isPlausibleClassName(row[classColumn] ?? '') ? cleanValue(row[classColumn] ?? '') : '')
        || defaults.className,
      grade: cleanValue(row[gradeColumn] ?? '') || extractedClass?.grade || defaults.grade,
      kind,
      weekday,
      period,
      startTime: times.startTime,
      endTime: times.endTime,
      subject,
      teacherName: cleanValue(row[teacherColumn] ?? '') || defaults.teacherName,
      location: cleanValue(row[locationColumn] ?? ''),
    })
  }
  return entries
}

function parseTextLines(text: string, defaults: TimetableImportDefaults): ParsedTimetableEntry[] {
  const entries: ParsedTimetableEntry[] = []
  for (const line of text.split('\n').map(cleanValue).filter(Boolean)) {
    const weekday = parseWeekday(line)
    const period = parsePeriod(line)
    if (weekday === undefined || period === undefined) continue
    const kind = inferKind(line, defaults.kind)
    const times = parseTimes(line)
    const parsed = parseCourseCell(
      line
        .replace(/(?:星期|周)[一二三四五六日天]/gu, ' ')
        .replace(/第?[一二三四五六七八九十百\d]+\s*(?:节|课)/gu, ' '),
      defaults,
    )
    if (parsed === null) continue
    entries.push({
      ...parsed,
      kind,
      weekday,
      period,
      startTime: times.startTime,
      endTime: times.endTime,
    })
  }
  return entries
}

function parseCourseCell(
  value: string,
  defaults: Pick<TimetableImportDefaults, 'className' | 'grade' | 'teacherName'>,
): Pick<ParsedTimetableEntry, 'className' | 'grade' | 'subject' | 'teacherName' | 'location'> | null {
  const text = normalizeCell(value).replace(/^目习/u, '自习')
  if (text === '' || /^(?:[-—/]|无|空)$/u.test(text)) return null
  const explicitSubject = labelledValue(text, /(?:课程|科目|学科|内容)/u)
  const explicitTeacher = labelledValue(text, /(?:任课教师|教师|老师)/u)
  const explicitClass = labelledValue(text, /(?:班级|班别)/u)
  const explicitGrade = labelledValue(text, /年级/u)
  const explicitLocation = labelledValue(text, /(?:地点|教室|场地)/u)
  const extractedClass = extractClass(explicitClass || text)
  const teacherMatch = text.match(/[\p{Script=Han}A-Za-z·]{1,20}(?:老师|教师)/u)?.[0] ?? ''
  const locationMatch = text.match(/[\p{Script=Han}A-Za-z0-9（）()\-]{1,24}(?:教室|实验室|功能室|体育馆|操场|报告厅)/u)?.[0] ?? ''
  const compact = splitCompactCourse(text)
  const className = extractedClass?.className
    || (isPlausibleClassName(explicitClass) ? explicitClass : '')
    || defaults.className
  const grade = explicitGrade || extractedClass?.grade || defaults.grade
  const teacherName = explicitTeacher || compact?.teacherName || teacherMatch || defaults.teacherName
  const location = explicitLocation || locationMatch
  let subject = explicitSubject || compact?.subject || ''
  if (subject === '') {
    const removable = [explicitClass, extractedClass?.className ?? '', teacherName, location]
    const candidates = text.split(/[\n;,；，、/]+/u)
      .map(part => removable.reduce((current, token) => token === '' ? current : current.replaceAll(token, ' '), part))
      .map(part => part
        .replace(/(?:班级|班别|年级|任课教师|教师|老师|地点|教室|场地)\s*[:：]/gu, ' ')
        .replace(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim())
      .filter(part => part !== '' && !/^(?:第?[一二三四五六七八九十百\d]+\s*(?:节|课)|星期?[一二三四五六日天]|周[一二三四五六日天])$/u.test(part))
    subject = candidates[0] ?? ''
  }
  return { className, grade, subject, teacherName, location }
}

function splitCompactCourse(value: string): { subject: string; teacherName: string } | undefined {
  const subject = COMPACT_SUBJECTS.find(candidate => value.startsWith(candidate))
  if (subject === undefined) return undefined
  let remainder = cleanValue(value.slice(subject.length))
  if (remainder.startsWith(subject)) remainder = cleanValue(remainder.slice(subject.length))
  if (remainder === '') return { subject, teacherName: '' }
  const startsWithAnotherSubject = COMPACT_SUBJECTS.some(candidate => remainder.startsWith(candidate))
  if (startsWithAnotherSubject || /^(?:答疑|阅读|晨读|晚读|实验|实践|活动|选修|复习|辅导|训练|拓展|社团|作业)$/u.test(remainder)) {
    return undefined
  }
  return /^[\p{Script=Han}A-Za-z·]{2,12}$/u.test(remainder)
    ? { subject, teacherName: remainder }
    : undefined
}

function inferKind(value: string, fallback: TeacherTimetableEntryKind): TeacherTimetableEntryKind {
  if (/(?:早自习|早读|晨读)/u.test(value)) return 'morningStudy'
  if (/(?:晚自习|晚读)/u.test(value)) return 'eveningStudy'
  return fallback
}

function studySubject(value: string, kind: TeacherTimetableEntryKind): string {
  const marker = cleanValue(value).match(/[（(]\s*(语文?|英(?:语)?|数(?:学)?|物(?:理)?|化(?:学)?|生(?:物)?|政(?:治)?|史|历史|地(?:理)?)\s*[)）]/u)?.[1] ?? ''
  const subjects: Readonly<Record<string, string>> = Object.freeze({
    语: '语文',
    语文: '语文',
    英: '英语',
    英语: '英语',
    数: '数学',
    数学: '数学',
    物: '物理',
    物理: '物理',
    化: '化学',
    化学: '化学',
    生: '生物',
    生物: '生物',
    政: '政治',
    政治: '政治',
    史: '历史',
    历史: '历史',
    地: '地理',
    地理: '地理',
  })
  return subjects[marker] ?? (kind === 'eveningStudy' ? '晚自习' : '早读')
}

function parseWeekday(value: string): TeacherWeekday | undefined {
  const normalized = cleanLabel(value)
  const match = normalized.match(/(?:星期|周)([一二三四五六日天])/u)
    ?? normalized.match(/^([一二三四五六日天])$/u)
  if (match === null) return undefined
  return WEEKDAY_LABELS[match[1] ?? '']
}

function parsePeriod(value: string): number | undefined {
  const normalized = cleanValue(value)
  const match = normalized.match(/第?\s*([一二三四五六七八九十百\d]+)\s*(?:节|课)/u)
    ?? normalized.match(/^\s*([一二三四五六七八九十百\d]+)\s*$/u)
  if (match === null) return undefined
  const period = chineseNumber(match[1] ?? '')
  return period >= 1 && period <= 20 ? period : undefined
}

function parseTimes(value: string): { startTime: string; endTime: string } {
  const matches = [...value.replaceAll('：', ':').matchAll(/(?:^|\D)((?:[01]?\d|2[0-3]):[0-5]\d)(?!\d)/gu)]
    .map(match => normalizeTime(match[1] ?? ''))
  return { startTime: matches[0] ?? '', endTime: matches[1] ?? '' }
}

function extractClass(value: string): { className: string; grade: string } | undefined {
  const text = cleanValue(value)
  const match = text.match(/(?<![\p{Script=Han}\d])(?:高|初|小)?[一二三四五六七八九\d]+(?:年级)?\s*[（(]?\s*[一二三四五六七八九十\d]+\s*[)）]?\s*班/u)
    ?? text.match(/(?<![\p{Script=Han}\d])[一二三四五六七八九十\d]+\s*班/u)
  if (match === null) return undefined
  const className = match[0].replace(/\s+/gu, '')
  return { className, grade: extractGrade(className) }
}

function extractGrade(value: string): string {
  const text = cleanValue(value)
  const prefixed = text.match(/(?:高|初|小)\s*[一二三四五六123456]\s*(?:年级|年)?/u)?.[0]
  if (prefixed !== undefined) return prefixed.replace(/\s+/gu, '').replace(/(?:年级|年)$/u, '')
  return text.match(/[一二三四五六七八九123456789]\s*年级/u)?.[0].replace(/\s+/gu, '') ?? ''
}

function labelledValue(text: string, label: RegExp): string {
  const match = text.match(new RegExp(`${label.source}\\s*[:：]\\s*([^\\n;,；，]+)`, 'u'))
  return cleanValue(match?.[1] ?? '')
}

function extractTableRows(value: string): string[][] {
  const htmlRows = [...value.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) => {
    const body = row[1] ?? ''
    return [...body.matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/giu)].map((cell): TableCell => {
      const attributes = cell[1] ?? ''
      return {
        text: cell[2] ?? '',
        columnSpan: positiveSpan(attributes, 'colspan'),
        rowSpan: positiveSpan(attributes, 'rowspan'),
      }
    })
  }).filter(row => row.length > 0)
  if (htmlRows.length > 0) return expandHtmlRows(htmlRows)
  return value.split('\n')
    .filter(line => line.includes('|'))
    .map((line) => {
      const cells = line.split('|')
      if (cells[0]?.trim() === '') cells.shift()
      if (cells.at(-1)?.trim() === '') cells.pop()
      return cells.map(normalizeCell)
    })
    .filter(row => row.length > 0 && !row.every(cell => /^:?-{2,}:?$/u.test(cell)))
}

function extractHtmlTables(value: string): DocumentTable[] {
  const matches = [...value.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/giu)]
  let previousEnd = 0
  return matches.map((match) => {
    const start = match.index
    const table = match[0]
    const heading = normalizeText(value.slice(previousEnd, start))
    previousEnd = start + table.length
    return { heading, rows: extractTableRows(table) }
  })
}

function expandHtmlRows(rows: readonly (readonly TableCell[])[]): string[][] {
  const carried = new Map<number, CarriedCell>()
  const expanded: string[][] = []
  rows.forEach((row, rowIndex) => {
    const target: string[] = []
    let column = 0
    const carry = (): void => {
      while ((carried.get(column)?.throughRow ?? -1) >= rowIndex) {
        target[column] = carried.get(column)?.text ?? ''
        column += 1
      }
    }
    carry()
    for (const cell of row) {
      carry()
      const text = normalizeCell(cell.text)
      for (let offset = 0; offset < cell.columnSpan; offset += 1) {
        target[column + offset] = text
        if (cell.rowSpan > 1) {
          carried.set(column + offset, { text, throughRow: rowIndex + cell.rowSpan - 1 })
        }
      }
      column += cell.columnSpan
    }
    carry()
    expanded.push(target)
  })
  return expanded
}

function positiveSpan(attributes: string, name: 'colspan' | 'rowspan'): number {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'iu'))
  return Math.max(1, Number(match?.[1] ?? 1))
}

function normalizeText(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:td|th|tr|p|div|li|h[1-6])\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\r/gu, '')
    .replace(/[\t\u00a0]+/gu, ' ')
    .replace(/[ ]+\n/gu, '\n')
    .replace(/\n[ ]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function normalizeCell(value: string): string {
  return normalizeText(value).replace(/\s*\|\s*/gu, '\n').trim()
}

function cleanLabel(value: string): string {
  return cleanValue(value).replace(/\s+/gu, '')
}

function cleanValue(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/^[-*#>\s]+/u, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[:：]+|[:：]+$/gu, '')
    .trim()
}

function normalizeTime(value: string): string {
  const [hour = '', minute = ''] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute}`
}

function chineseNumber(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value)
  const digits: Readonly<Record<string, number>> = Object.freeze({
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  })
  if (value === '十') return 10
  if (value.startsWith('十')) return 10 + (digits[value[1] ?? ''] ?? 0)
  if (value.includes('十')) {
    const [tens = '', ones = ''] = value.split('十')
    return (digits[tens] ?? 0) * 10 + (digits[ones] ?? 0)
  }
  return digits[value] ?? Number.NaN
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
