import { describe, expect, it } from 'vitest'
import { isTimetableImportReady } from '../src/client/timetable-import.ts'

describe('timetable import review', () => {
  it('accepts class names without imposing a naming convention', () => {
    expect(isTimetableImportReady({ className: 'Grade 10 / A', kind: 'lesson', subject: '数学', teacherName: '' })).toBe(true)
    expect(isTimetableImportReady({ className: ' ', kind: 'lesson', subject: '数学', teacherName: '' })).toBe(false)
    expect(isTimetableImportReady({ className: 'A'.repeat(81), kind: 'lesson', subject: '数学', teacherName: '' })).toBe(false)
  })

  it('accepts a study supervisor without inventing a course', () => {
    expect(isTimetableImportReady({ className: '一班', kind: 'morningStudy', subject: '', teacherName: '王老师' })).toBe(true)
    expect(isTimetableImportReady({ className: '一班', kind: 'eveningStudy', subject: '', teacherName: '李老师' })).toBe(true)
    expect(isTimetableImportReady({ className: '一班', kind: 'lesson', subject: '', teacherName: '王老师' })).toBe(false)
    expect(isTimetableImportReady({ className: '一班', kind: 'morningStudy', subject: '', teacherName: '' })).toBe(false)
  })
})
