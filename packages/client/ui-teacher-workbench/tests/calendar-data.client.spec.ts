import { describe, expect, it } from 'vitest'
import {
  buildTeacherCalendarMonth,
  formatLocalDate,
  parseLocalDate,
} from '../src/client/calendar-data.ts'

describe('teacher calendar projection', () => {
  it('builds a Monday-first month with lunar and 2026 statutory-holiday data', () => {
    const month = buildTeacherCalendarMonth(new Date(2026, 9, 1), new Date(2026, 9, 1))
    expect(month).toMatchObject({ year: 2026, month: 10, officialScheduleKnown: true })
    expect(month.days).toHaveLength(42)
    expect(month.days[0]?.date).toBe('2026-09-28')
    expect(month.days.at(-1)?.date).toBe('2026-11-08')
    expect(month.days.find(day => day.date === '2026-10-01')).toMatchObject({
      today: true,
      holidayName: '国庆节',
      makeupWorkdayName: '',
      lunarShort: '廿一',
    })
    expect(month.days.find(day => day.date === '2026-10-10')).toMatchObject({
      holidayName: '',
      makeupWorkdayName: '国庆节',
      lunarShort: '九月',
    })
    expect(month.days.some(day => day.solarTerm !== '')).toBe(true)
  })

  it('marks years without a published schedule and handles lunar-range edge cells', () => {
    expect(buildTeacherCalendarMonth(new Date(2027, 0, 1)).officialScheduleKnown).toBe(false)
    expect(buildTeacherCalendarMonth(new Date(1899, 11, 1)).officialScheduleKnown).toBe(false)
    expect(() => buildTeacherCalendarMonth(new Date(1900, 0, 1))).not.toThrow()
    expect(buildTeacherCalendarMonth(new Date(1900, 0, 1)).days[0]).toMatchObject({
      date: '1900-01-01',
    })
    expect(() => buildTeacherCalendarMonth(new Date(2100, 11, 1))).not.toThrow()
  })

  it('formats and parses local dates without UTC conversion', () => {
    const value = new Date(2026, 7, 18)
    expect(formatLocalDate(value)).toBe('2026-08-18')
    const parsed = parseLocalDate('2026-08-18')
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 7, 18])
  })
})
