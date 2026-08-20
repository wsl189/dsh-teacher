/** Page-selection parsing for the reference question-cutting workflow. */

/** Normalized one-based page selection accepted by the MinerU bridge. */
export interface QuestionPageSelection {
  /** First selected page as a zero-based PDF index. */
  readonly start: number
  /** Last selected page as a zero-based PDF index. */
  readonly end: number
  /** Exact zero-based pages retained when the input contains gaps. */
  readonly pageIndexes: readonly number[]
  /** Teacher-facing normalized range, or an empty string for every page. */
  readonly label: string
}

/**
 * Parse the original workbench syntax (`1-5,8`) into a bounded page selection.
 * @param input - comma-separated one-based pages and inclusive ranges.
 * @param pageCount - positive number of pages in the uploaded PDF.
 * @returns a contiguous MinerU envelope plus the exact pages to retain.
 */
export function parseQuestionPageRange(input: string, pageCount: number): QuestionPageSelection {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new TypeError('PDF 页数无效')
  const normalized = input.trim().replaceAll('，', ',')
  if (normalized === '') {
    return {
      start: 0,
      end: pageCount - 1,
      pageIndexes: Array.from({ length: pageCount }, (_value, index) => index),
      label: '',
    }
  }

  const selected = new Set<number>()
  for (const rawPart of normalized.split(',')) {
    const part = rawPart.trim()
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/u.exec(part)
    if (match?.[1] === undefined) throw new TypeError(`页码格式无效：${part || '空项'}`)
    const first = Number(match[1])
    const last = Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > pageCount) {
      throw new TypeError(`页码范围必须在 1-${String(pageCount)} 之间`)
    }
    for (let page = first; page <= last; page += 1) selected.add(page - 1)
  }

  const pageIndexes = [...selected].sort((left, right) => left - right)
  const start = pageIndexes[0]
  const end = pageIndexes.at(-1)
  if (start === undefined || end === undefined) throw new TypeError('请至少选择一页')
  return { start, end, pageIndexes, label: normalized }
}
