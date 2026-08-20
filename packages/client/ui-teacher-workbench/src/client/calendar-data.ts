/** Chinese lunar and statutory-holiday projection for the calendar panel. */

import chineseDays from 'chinese-days'

const FIRST_SUPPORTED_DATE = '1900-01-01'
const LAST_SUPPORTED_DATE = '2100-12-31'

/** One rendered Gregorian day and its Chinese-calendar annotations. */
export interface TeacherCalendarDay {
  /** Local ISO date. */
  date: string
  /** Gregorian day of month. */
  day: number
  /** Whether the day belongs to the displayed month. */
  inMonth: boolean
  /** Whether the day is today. */
  today: boolean
  /** Short lunar label used inside a calendar cell. */
  lunarShort: string
  /** Full lunar label used in the selected-day details. */
  lunarLong: string
  /** Statutory holiday name when the date belongs to an official day-off range. */
  holidayName: string
  /** Holiday name when the date is an official adjusted workday. */
  makeupWorkdayName: string
  /** Solar term that starts on this date. */
  solarTerm: string
}

/** Calendar month projection. */
export interface TeacherCalendarMonth {
  /** Year shown by the grid. */
  year: number
  /** One-based month shown by the grid. */
  month: number
  /** Monday-first six-week grid. */
  days: readonly TeacherCalendarDay[]
  /** Whether statutory day-off data is available for this year. */
  officialScheduleKnown: boolean
}

/**
 * Build a Monday-first six-week month grid.
 * @param cursor - any local date in the displayed month.
 * @param today - local date used to mark today.
 * @returns Gregorian, lunar, solar-term, and official-holiday data for 42 cells.
 */
export function buildTeacherCalendarMonth(cursor: Date, today = new Date()): TeacherCalendarMonth {
  const year = cursor.getFullYear()
  const monthIndex = cursor.getMonth()
  const first = new Date(year, monthIndex, 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, monthIndex, 1 - offset)
  const end = addDays(start, 41)
  const termStart = clampSupportedDate(formatLocalDate(start))
  const termEnd = clampSupportedDate(formatLocalDate(end))
  const solarTerms = new Map(chineseDays.getSolarTerms(termStart, termEnd).map(term => [term.date, term.name]))
  const todayKey = formatLocalDate(today)
  const scheduleDate = `${year}-01-01`
  const days = Array.from({ length: 42 }, (_, index): TeacherCalendarDay => {
    const date = addDays(start, index)
    const dateKey = formatLocalDate(date)
    const supported = isSupportedDate(dateKey)
    const lunar = supported ? chineseDays.getLunarDate(dateKey) : null
    const dayDetail = supported ? chineseDays.getDayDetail(dateKey) : { name: '', work: false }
    const officialName = officialHolidayName(dayDetail.name)
    return {
      date: dateKey,
      day: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      today: dateKey === todayKey,
      lunarShort: lunar === null ? '' : lunar.lunarDay === 1 ? lunar.lunarMonCN : lunar.lunarDayCN,
      lunarLong: lunar === null ? '' : `农历${lunar.yearCyl}（${lunar.zodiac}）年${lunar.lunarMonCN}${lunar.lunarDayCN}`,
      holidayName: officialName !== '' && !dayDetail.work ? officialName : '',
      makeupWorkdayName: officialName !== '' && dayDetail.work ? officialName : '',
      solarTerm: solarTerms.get(dateKey) ?? '',
    }
  })
  return {
    year,
    month: monthIndex + 1,
    days,
    officialScheduleKnown: isSupportedDate(scheduleDate)
      && officialHolidayName(chineseDays.getDayDetail(scheduleDate).name) !== '',
  }
}

/**
 * Format a local date without applying a UTC offset.
 * @param date - local calendar date.
 * @returns `YYYY-MM-DD`.
 */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parse a local ISO date without UTC conversion.
 * @param value - `YYYY-MM-DD`.
 * @returns local midnight on that date.
 */
export function parseLocalDate(value: string): Date {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function officialHolidayName(detailName: string): string {
  const [, chineseName] = detailName.split(',')
  return chineseName?.trim() ?? ''
}

function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isSupportedDate(value: string): boolean {
  return value >= FIRST_SUPPORTED_DATE && value <= LAST_SUPPORTED_DATE
}

function clampSupportedDate(value: string): string {
  if (value < FIRST_SUPPORTED_DATE) return FIRST_SUPPORTED_DATE
  if (value > LAST_SUPPORTED_DATE) return LAST_SUPPORTED_DATE
  return value
}
