/** Structured MinerU document import and score-analysis helpers. */

import type {
  TeacherExam,
  TeacherExamEntry,
  TeacherStudent,
  TeacherStudentId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** One normalized roster row ready for the controller. */
export interface StudentImportRow {
  /** Student name. */
  name: string
  /** Student number. */
  studentNumber: string
  /** Optional gender. */
  gender: string
  /** Optional guardian. */
  guardian: string
  /** Optional guardian relationship. */
  relation: string
  /** Optional phone. */
  phone: string
  /** Optional address. */
  address: string
  /** Unrecognized imported columns. */
  extras: Record<string, string>
}

/** Parsed roster result. */
export interface StudentImportResult {
  /** Accepted non-empty rows. */
  rows: StudentImportRow[]
  /** Human-readable parse failure, absent when rows were accepted. */
  error: string | null
}

/** Parsed score rows matched against the selected class roster. */
export interface ScoreImportResult {
  /** Subject columns detected from the header. */
  subjects: string[]
  /** Matched score entries. */
  entries: TeacherExamEntry[]
  /** Non-empty source rows that did not match the roster. */
  unmatched: number
  /** Human-readable parse failure. */
  error: string | null
}

/** One student's aggregate row for a selected exam. */
export interface ExamStudentSummary {
  /** Roster identity. */
  studentId: TeacherStudentId
  /** Sum across present subjects. */
  total: number
  /** One-based total-score rank. */
  rank: number
}

/** Aggregate statistics for a selected exam. */
export interface ExamSummary {
  /** Number of matched entries. */
  count: number
  /** Subject columns in first-seen order. */
  subjects: string[]
  /** Total-score average. */
  average: number
  /** Highest total. */
  highest: number
  /** Lowest total. */
  lowest: number
  /** Percentage at or above the configured pass total. */
  passRate: number
  /** Percentage at or above the configured excellent total. */
  excellentRate: number
  /** Ranked student totals. */
  students: ExamStudentSummary[]
}

const ALIASES = {
  name: ['姓名', '学生姓名', '名字', 'name'],
  studentNumber: ['学号', '学生学号', '编号', 'studentid', 'studentno', 'id'],
  gender: ['性别', 'gender'],
  guardian: ['监护人', '家长', '家长姓名', 'guardian'],
  relation: ['关系', '与学生关系', 'relation'],
  phone: ['电话', '手机号', '联系电话', 'phone', 'mobile'],
  address: ['地址', '家庭住址', 'address'],
} as const

/**
 * Parse roster rows from a MinerU document or delimited text.
 * @param source - MinerU Markdown, HTML tables, or delimited text.
 * @returns normalized rows or a parse diagnostic.
 */
export function parseStudentImport(source: string): StudentImportResult {
  const tables = parseTables(source)
  if (tables.every(table => table.length < 2)) {
    return { rows: [], error: '名册至少需要表头和一行学生数据' }
  }
  const rows: StudentImportRow[] = []
  const seenRows = new Set<string>()
  let foundHeader = false
  for (const table of tables) {
    const headerIndex = table.findIndex(row => findHeader(row.map(normalizeHeader), ALIASES.name) >= 0)
    if (headerIndex < 0) continue
    foundHeader = true
    const headerRow = table[headerIndex] ?? []
    const headers = headerRow.map(normalizeHeader)
    const indexes = Object.fromEntries(
      Object.entries(ALIASES).map(([field, aliases]) => [field, findHeader(headers, aliases)]),
    ) as Record<keyof typeof ALIASES, number>
    const known = new Set(Object.values(indexes).filter(index => index >= 0))
    for (const cells of table.slice(headerIndex + 1)) {
      const name = cell(cells, indexes.name)
      if (name === '' || ALIASES.name.map(normalizeHeader).includes(normalizeHeader(name))) continue
      const extras: Record<string, string> = {}
      cells.forEach((value, index) => {
        const header = headerRow[index]?.trim() ?? ''
        if (!known.has(index) && header !== '' && value.trim() !== '') extras[header] = value.trim()
      })
      const row = {
        name,
        studentNumber: cell(cells, indexes.studentNumber),
        gender: cell(cells, indexes.gender),
        guardian: cell(cells, indexes.guardian),
        relation: cell(cells, indexes.relation),
        phone: cell(cells, indexes.phone),
        address: cell(cells, indexes.address),
        extras,
      }
      const signature = JSON.stringify(row)
      if (!seenRows.has(signature)) {
        seenRows.add(signature)
        rows.push(row)
      }
    }
  }
  if (!foundHeader) return { rows: [], error: '未找到姓名列' }
  return rows.length === 0 ? { rows, error: '没有可导入的学生行' } : { rows, error: null }
}

/**
 * Parse score rows and match them to one class roster by student number first,
 * then by an unambiguous name.
 * @param source - MinerU Markdown, HTML tables, or delimited text.
 * @param students - students in the selected class.
 * @returns detected subjects, matched entries, and unmatched-row count.
 */
export function parseScoreImport(source: string, students: readonly TeacherStudent[]): ScoreImportResult {
  const tables = parseTables(source)
  if (tables.every(table => table.length < 2)) {
    return { subjects: [], entries: [], unmatched: 0, error: '成绩表至少需要表头和一行成绩数据' }
  }
  const byNumber = new Map(students.filter(item => item.studentNumber !== '').map(item => [normalizeCell(item.studentNumber), item]))
  const names = new Map<string, TeacherStudent[]>()
  for (const student of students) {
    const key = normalizeCell(student.name)
    names.set(key, [...(names.get(key) ?? []), student])
  }
  const unmatchedRows = new Set<string>()
  const entries: TeacherExamEntry[] = []
  const entryIndexes = new Map<TeacherStudentId, number>()
  const subjects: string[] = []
  let foundHeader = false
  for (const table of tables) {
    const headerIndex = table.findIndex((row) => {
      const headers = row.map(normalizeHeader)
      return findHeader(headers, ALIASES.studentNumber) >= 0 || findHeader(headers, ALIASES.name) >= 0
    })
    if (headerIndex < 0) continue
    foundHeader = true
    const originalHeaders = (table[headerIndex] ?? []).map(header => header.trim())
    const headers = originalHeaders.map(normalizeHeader)
    const numberIndex = findHeader(headers, ALIASES.studentNumber)
    const nameIndex = findHeader(headers, ALIASES.name)
    const ignored = new Set([numberIndex, nameIndex, findHeader(headers, ['排名', '名次', 'rank'])])
    const subjectColumns = originalHeaders
      .map((name, index) => ({ name, index }))
      .filter(column => column.name !== '' && !ignored.has(column.index))
    for (const column of subjectColumns) if (!subjects.includes(column.name)) subjects.push(column.name)
    for (const cells of table.slice(headerIndex + 1)) {
      const number = cell(cells, numberIndex)
      const name = cell(cells, nameIndex)
      if ((numberIndex >= 0 && ALIASES.studentNumber.map(normalizeHeader).includes(normalizeHeader(number)))
        || (nameIndex >= 0 && ALIASES.name.map(normalizeHeader).includes(normalizeHeader(name)))) continue
      if (number === '' && name === '') continue
      const named = names.get(normalizeCell(name))
      const student = (number === '' ? undefined : byNumber.get(normalizeCell(number)))
        ?? (named?.length === 1 ? named[0] : undefined)
      if (student === undefined) {
        unmatchedRows.add(JSON.stringify(cells.map(normalizeCell)))
        continue
      }
      const scores: Record<string, number> = {}
      for (const column of subjectColumns) {
        const raw = cells[column.index]?.trim() ?? ''
        if (raw === '') continue
        const value = Number(raw.replace(/，/g, '.'))
        if (Number.isFinite(value)) scores[column.name] = value
      }
      if (Object.keys(scores).length > 0) {
        const existingIndex = entryIndexes.get(student.id)
        if (existingIndex === undefined) {
          entryIndexes.set(student.id, entries.length)
          entries.push({ studentId: student.id, scores })
        } else {
          const existing = entries[existingIndex]
          if (existing !== undefined) {
            entries[existingIndex] = { studentId: student.id, scores: { ...scores, ...existing.scores } }
          }
        }
      }
    }
  }
  if (!foundHeader) return { subjects: [], entries: [], unmatched: 0, error: '未找到姓名或学号列' }
  const importedSubjects = subjects.filter(name => entries.some(entry => entry.scores[name] !== undefined))
  const error = entries.length === 0 ? '没有可导入的成绩行' : null
  return { subjects: importedSubjects, entries, unmatched: unmatchedRows.size, error }
}

/**
 * Calculate total-score diagnosis for one exam.
 * @param exam - selected exam.
 * @param passScore - configured per-subject pass line.
 * @param excellentScore - configured per-subject excellent line.
 * @returns aggregate and ranked student totals.
 */
export function summarizeExam(exam: TeacherExam, passScore: number, excellentScore: number): ExamSummary {
  const subjects: string[] = []
  for (const entry of exam.entries) {
    for (const subject of Object.keys(entry.scores)) if (!subjects.includes(subject)) subjects.push(subject)
  }
  const totals = exam.entries.map(entry => ({
    studentId: entry.studentId,
    total: subjects.reduce((sum, subject) => sum + (entry.scores[subject] ?? 0), 0),
  }))
  const sorted = [...totals].sort((left, right) => right.total - left.total)
  const students = totals.map(row => ({
    ...row,
    rank: sorted.findIndex(candidate => candidate.studentId === row.studentId) + 1,
  }))
  const count = totals.length
  const totalValues = totals.map(row => row.total)
  const thresholdScale = subjects.length
  return {
    count,
    subjects,
    average: count === 0 ? 0 : totalValues.reduce((sum, value) => sum + value, 0) / count,
    highest: count === 0 ? 0 : Math.max(...totalValues),
    lowest: count === 0 ? 0 : Math.min(...totalValues),
    passRate: count === 0 ? 0 : totals.filter(row => row.total >= passScore * thresholdScale).length / count * 100,
    excellentRate: count === 0 ? 0 : totals.filter(row => row.total >= excellentScore * thresholdScale).length / count * 100,
    students,
  }
}

function parseTables(source: string): string[][][] {
  const normalized = source.replace(/\r\n?/g, '\n')
  const html = [...normalized.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)]
    .map(match => parseHtmlTable(match[1] ?? ''))
    .filter(table => table.length > 0)
  if (html.length > 0) return html

  const markdown: string[][][] = []
  let current: string[][] = []
  for (const line of normalized.split('\n')) {
    const row = parseMarkdownRow(line)
    if (row === null) {
      if (current.length > 0) markdown.push(current)
      current = []
    } else if (!row.every(cell => /^:?-{3,}:?$/u.test(cell.trim()))) {
      current.push(row)
    }
  }
  if (current.length > 0) markdown.push(current)
  if (markdown.length > 0) return markdown

  const lines = normalized.split('\n').filter(line => line.trim() !== '')
  const delimiter = lines.some(line => line.includes('\t')) ? '\t' : ','
  return [lines.map(line => delimiter === '\t' ? line.split('\t') : parseCsvLine(line))]
}

function parseHtmlTable(source: string): string[][] {
  return [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map(row => (
    [...(row[1] ?? '').matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/giu)]
      .map(cell => cleanDocumentCell(cell[1] ?? ''))
  )).filter(row => row.length > 0)
}

function parseMarkdownRow(line: string): string[] | null {
  if (!line.includes('|')) return null
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '')
  const cells: string[] = []
  let value = ''
  let escaped = false
  for (const char of trimmed) {
    if (escaped) {
      value += char
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '|') {
      cells.push(cleanDocumentCell(value))
      value = ''
    } else {
      value += char
    }
  }
  if (escaped) value += '\\'
  cells.push(cleanDocumentCell(value))
  return cells.length < 2 ? null : cells
}

function cleanDocumentCell(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/[*_`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index)
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(value)
      value = ''
    } else {
      value += char
    }
  }
  cells.push(value)
  return cells
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-（）()]/g, '')
}

function normalizeCell(value: string): string {
  return value.trim().toLowerCase().replace(/\s/g, '')
}

function findHeader(headers: readonly string[], aliases: readonly string[]): number {
  const normalized = aliases.map(normalizeHeader)
  return headers.findIndex(header => normalized.includes(header))
}

function cell(cells: readonly string[], index: number): string {
  return index < 0 ? '' : (cells[index]?.trim() ?? '')
}
