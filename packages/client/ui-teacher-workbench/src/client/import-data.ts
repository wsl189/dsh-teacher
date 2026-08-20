/** Structured clipboard import and score-analysis helpers. */

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
 * Parse a tab/comma-separated roster copied from a spreadsheet.
 * @param source - clipboard text whose first non-empty row is the header.
 * @returns normalized rows or a parse diagnostic.
 */
export function parseStudentImport(source: string): StudentImportResult {
  const table = parseTable(source)
  const headerRow = table[0]
  if (headerRow === undefined || table.length < 2) {
    return { rows: [], error: '名册至少需要表头和一行学生数据' }
  }
  const headers = headerRow.map(normalizeHeader)
  const indexes = Object.fromEntries(
    Object.entries(ALIASES).map(([field, aliases]) => [field, findHeader(headers, aliases)]),
  ) as Record<keyof typeof ALIASES, number>
  if (indexes.name < 0) return { rows: [], error: '未找到姓名列' }
  const known = new Set(Object.values(indexes).filter(index => index >= 0))
  const rows = table.slice(1).flatMap((cells) => {
    const name = cell(cells, indexes.name)
    if (name === '') return []
    const extras: Record<string, string> = {}
    cells.forEach((value, index) => {
      const header = headerRow[index]?.trim() ?? ''
      if (!known.has(index) && header !== '' && value.trim() !== '') extras[header] = value.trim()
    })
    return [{
      name,
      studentNumber: cell(cells, indexes.studentNumber),
      gender: cell(cells, indexes.gender),
      guardian: cell(cells, indexes.guardian),
      relation: cell(cells, indexes.relation),
      phone: cell(cells, indexes.phone),
      address: cell(cells, indexes.address),
      extras,
    }]
  })
  return rows.length === 0 ? { rows, error: '没有可导入的学生行' } : { rows, error: null }
}

/**
 * Parse score rows and match them to one class roster by student number first,
 * then by an unambiguous name.
 * @param source - spreadsheet clipboard text.
 * @param students - students in the selected class.
 * @returns detected subjects, matched entries, and unmatched-row count.
 */
export function parseScoreImport(source: string, students: readonly TeacherStudent[]): ScoreImportResult {
  const table = parseTable(source)
  const headerRow = table[0]
  if (headerRow === undefined || table.length < 2) {
    return { subjects: [], entries: [], unmatched: 0, error: '成绩表至少需要表头和一行成绩数据' }
  }
  const originalHeaders = headerRow.map(header => header.trim())
  const headers = originalHeaders.map(normalizeHeader)
  const numberIndex = findHeader(headers, ALIASES.studentNumber)
  const nameIndex = findHeader(headers, ALIASES.name)
  if (numberIndex < 0 && nameIndex < 0) {
    return { subjects: [], entries: [], unmatched: 0, error: '未找到姓名或学号列' }
  }
  const ignored = new Set([numberIndex, nameIndex, findHeader(headers, ['排名', '名次', 'rank'])])
  const subjectColumns = originalHeaders
    .map((name, index) => ({ name, index }))
    .filter(column => column.name !== '' && !ignored.has(column.index))
  const byNumber = new Map(students.filter(item => item.studentNumber !== '').map(item => [normalizeCell(item.studentNumber), item]))
  const names = new Map<string, TeacherStudent[]>()
  for (const student of students) {
    const key = normalizeCell(student.name)
    names.set(key, [...(names.get(key) ?? []), student])
  }
  let unmatched = 0
  const entries: TeacherExamEntry[] = []
  for (const cells of table.slice(1)) {
    const number = cell(cells, numberIndex)
    const name = cell(cells, nameIndex)
    const named = names.get(normalizeCell(name))
    const student = (number === '' ? undefined : byNumber.get(normalizeCell(number)))
      ?? (named?.length === 1 ? named[0] : undefined)
    if (student === undefined) {
      unmatched += 1
      continue
    }
    const scores: Record<string, number> = {}
    for (const column of subjectColumns) {
      const raw = cells[column.index]?.trim() ?? ''
      if (raw === '') continue
      const value = Number(raw.replace(/，/g, '.'))
      if (Number.isFinite(value)) scores[column.name] = value
    }
    if (Object.keys(scores).length > 0) entries.push({ studentId: student.id, scores })
  }
  const subjects = subjectColumns
    .map(column => column.name)
    .filter(name => entries.some(entry => entry.scores[name] !== undefined))
  const error = entries.length === 0 ? '没有可导入的成绩行' : null
  return { subjects, entries, unmatched, error }
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

function parseTable(source: string): string[][] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() !== '')
  const delimiter = lines.some(line => line.includes('\t')) ? '\t' : ','
  return lines.map(line => delimiter === '\t' ? line.split('\t') : parseCsvLine(line))
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
