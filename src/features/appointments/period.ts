import { addDays, startOfWeek } from '@/lib/datetime'
import type { LocalDate } from '@/lib/model'

export type AgendaView = 'day' | 'week'

const DAYS_PER_WEEK = 7
const LAST_DAY_OFFSET_IN_WEEK = DAYS_PER_WEEK - 1
const DAY_LABEL_FORMAT = new Intl.DateTimeFormat('es-VE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const SHORT_DAY_LABEL_FORMAT = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function utcInstantOf(date: LocalDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

export function periodRangeOf(view: AgendaView, date: LocalDate): { from: LocalDate; to: LocalDate } {
  if (view === 'day') return { from: date, to: date }
  const from = startOfWeek(date)
  return { from, to: addDays(from, LAST_DAY_OFFSET_IN_WEEK) }
}

export function shiftDate(view: AgendaView, date: LocalDate, direction: 1 | -1): LocalDate {
  return addDays(date, direction * (view === 'day' ? 1 : DAYS_PER_WEEK))
}

export function formatDayLabel(date: LocalDate): string {
  return DAY_LABEL_FORMAT.format(utcInstantOf(date))
}

export function formatShortDayLabel(date: LocalDate): string {
  return SHORT_DAY_LABEL_FORMAT.format(utcInstantOf(date))
}

export function formatPeriodLabel(view: AgendaView, date: LocalDate): string {
  if (view === 'day') return formatDayLabel(date)
  const { from, to } = periodRangeOf(view, date)
  return `${formatShortDayLabel(from)} – ${formatDayLabel(to)}`
}
