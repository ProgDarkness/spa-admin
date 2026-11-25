import type { LocalDate, LocalDateTime, YearMonth } from './model'

export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export type TimeRange = { startsAt: LocalDateTime; endsAt: LocalDateTime }

const MINUTE_MS = 60_000
const MINUTES_PER_DAY = 1_440
const DAYS_PER_WEEK = 7
const DATE_LENGTH = 'YYYY-MM-DD'.length
const MONTH_LENGTH = 'YYYY-MM'.length

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function formatUtc(instantMs: number): LocalDateTime {
  const d = new Date(instantMs)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function toUtcMs(t: LocalDateTime): number {
  return Date.parse(`${t}:00Z`)
}

export function toLocalDateTime(d: Date): LocalDateTime {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function nowLocal(): LocalDateTime {
  return toLocalDateTime(new Date())
}

export function dateOf(t: LocalDateTime): LocalDate {
  return t.slice(0, DATE_LENGTH)
}

export function monthOf(t: LocalDateTime | LocalDate): YearMonth {
  return t.slice(0, MONTH_LENGTH)
}

export function todayLocal(): LocalDate {
  return dateOf(nowLocal())
}

export function addMinutes(t: LocalDateTime, minutes: number): LocalDateTime {
  return formatUtc(toUtcMs(t) + minutes * MINUTE_MS)
}

export function addDays(d: LocalDate, days: number): LocalDate {
  return dateOf(addMinutes(`${d}T00:00`, days * MINUTES_PER_DAY))
}

export function startOfWeek(d: LocalDate): LocalDate {
  const sundayBasedWeekday = new Date(toUtcMs(`${d}T00:00`)).getUTCDay()
  const daysSinceMonday = (sundayBasedWeekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK
  return addDays(d, -daysSinceMonday)
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

export function crossesMidnight(startsAt: LocalDateTime, durationMin: number): boolean {
  const endsAt = addMinutes(startsAt, durationMin)
  return endsAt > `${addDays(dateOf(startsAt), 1)}T00:00`
}

export function isExistingDate(date: string): boolean {
  return LOCAL_DATE_PATTERN.test(date) && addMinutes(`${date}T00:00`, 0) === `${date}T00:00`
}
