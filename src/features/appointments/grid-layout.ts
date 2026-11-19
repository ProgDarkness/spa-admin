import { addMinutes, dateOf, overlaps, type TimeRange } from '@/lib/datetime'
import type { Appointment, Id, LocalDate, LocalDateTime, Resource } from '@/lib/model'
import { blocksSlot } from './rules'

const AGENDA_START_HOUR = 8
const AGENDA_END_HOUR = 24
const SLOT_DURATION_MIN = 30

const MINUTES_PER_HOUR = 60
const SLOT_COUNT = ((AGENDA_END_HOUR - AGENDA_START_HOUR) * MINUTES_PER_HOUR) / SLOT_DURATION_MIN
const HOUR_PREFIX_LENGTH = 'YYYY-MM-DDTHH'.length
const HOUR_START_INDEX = 'YYYY-MM-DDT'.length
const MINUTES_START_INDEX = HOUR_PREFIX_LENGTH + 1

function timeLabelOf(hour: number, minutes: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function slotStartsOf(date: LocalDate): LocalDateTime[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const totalMinutes = AGENDA_START_HOUR * MINUTES_PER_HOUR + index * SLOT_DURATION_MIN
    return `${date}T${timeLabelOf(Math.floor(totalMinutes / MINUTES_PER_HOUR), totalMinutes % MINUTES_PER_HOUR)}`
  })
}

export function dayStartOf(date: LocalDate): LocalDateTime {
  return `${date}T${timeLabelOf(AGENDA_START_HOUR, 0)}`
}

export function slotKeyOf(startsAt: LocalDateTime): LocalDateTime {
  const minutes = Number(startsAt.slice(MINUTES_START_INDEX))
  const flooredMinutes = minutes - (minutes % SLOT_DURATION_MIN)
  return `${startsAt.slice(0, HOUR_PREFIX_LENGTH)}:${String(flooredMinutes).padStart(2, '0')}`
}

export function isOutsideAgendaHours(startsAt: LocalDateTime): boolean {
  const hour = Number(startsAt.slice(HOUR_START_INDEX, HOUR_PREFIX_LENGTH))
  return hour < AGENDA_START_HOUR || hour >= AGENDA_END_HOUR
}

export function visibleResourcesFor(resources: readonly Resource[], dayAppointments: readonly Appointment[]): Resource[] {
  const resourceIdsWithAppointments = new Set(dayAppointments.map((appointment) => appointment.resourceId))
  return resources.filter((resource) => resource.active || resourceIdsWithAppointments.has(resource.id))
}

export function isSlotBlocked(slotStart: LocalDateTime, resourceId: Id, dayAppointments: readonly Appointment[]): boolean {
  const slot: TimeRange = { startsAt: slotStart, endsAt: addMinutes(slotStart, SLOT_DURATION_MIN) }
  return dayAppointments.some(
    (appointment) =>
      appointment.resourceId === resourceId &&
      blocksSlot(appointment.status) &&
      overlaps(slot, appointment),
  )
}

function minutesOfDayOf(value: LocalDateTime): number {
  return Number(value.slice(HOUR_START_INDEX, HOUR_PREFIX_LENGTH)) * MINUTES_PER_HOUR + Number(value.slice(MINUTES_START_INDEX))
}

export function nowLineOffset(slotStart: LocalDateTime, now: LocalDateTime): number | null {
  if (dateOf(slotStart) !== dateOf(now)) return null
  const elapsedMinutes = minutesOfDayOf(now) - minutesOfDayOf(slotStart)
  if (elapsedMinutes < 0 || elapsedMinutes >= SLOT_DURATION_MIN) return null
  return elapsedMinutes / SLOT_DURATION_MIN
}

export type AppointmentBox = { topSlots: number; heightSlots: number }

export function appointmentBox(
  startsAt: LocalDateTime,
  durationMin: number,
  dayStart: LocalDateTime,
  slotMinutes: number,
): AppointmentBox | null {
  const visibleEnd = SLOT_COUNT * slotMinutes
  const start = minutesOfDayOf(startsAt) - minutesOfDayOf(dayStart)
  const clippedStart = Math.max(start, 0)
  const clippedEnd = Math.min(start + durationMin, visibleEnd)
  if (clippedEnd <= clippedStart) return null
  return { topSlots: clippedStart / slotMinutes, heightSlots: (clippedEnd - clippedStart) / slotMinutes }
}

export const SLOT_MINUTES = SLOT_DURATION_MIN
export const VISIBLE_SLOT_COUNT = SLOT_COUNT

const MS_PER_MINUTE = 60_000

function epochMinutesOf(value: LocalDateTime): number {
  return Date.parse(`${value}:00Z`) / MS_PER_MINUTE
}

export function durationMinOf(appointment: Pick<Appointment, 'startsAt' | 'endsAt'>): number {
  return epochMinutesOf(appointment.endsAt) - epochMinutesOf(appointment.startsAt)
}
