import { overlaps, type TimeRange } from '@/lib/datetime'
import type { Appointment, AppointmentStatus, AppointmentTransition, Id, LocalDateTime } from '@/lib/model'

export const SLOT_BLOCKING_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'inProgress', 'completed']

const FINAL_STATUSES: readonly AppointmentStatus[] = ['completed', 'cancelled', 'noShow']

const TRANSITION_ORDER: readonly AppointmentTransition[] = ['start', 'complete', 'markNoShow', 'cancel', 'reopen']

const TARGET_STATUS: Record<AppointmentTransition, AppointmentStatus> = {
  start: 'inProgress',
  complete: 'completed',
  markNoShow: 'noShow',
  cancel: 'cancelled',
  reopen: 'scheduled',
}

const SOURCE_STATUSES: Record<AppointmentTransition, readonly AppointmentStatus[]> = {
  start: ['scheduled'],
  complete: ['scheduled', 'inProgress'],
  markNoShow: ['scheduled'],
  cancel: ['scheduled', 'inProgress'],
  reopen: FINAL_STATUSES,
}

export function blocksSlot(status: AppointmentStatus): boolean {
  return SLOT_BLOCKING_STATUSES.includes(status)
}

export function findOverlaps(
  candidate: TimeRange & { resourceId: Id },
  existing: readonly Appointment[],
  ignoreId: Id | null,
): Appointment[] {
  return existing.filter(
    (appointment) =>
      appointment.id !== ignoreId &&
      appointment.resourceId === candidate.resourceId &&
      blocksSlot(appointment.status) &&
      overlaps(candidate, appointment),
  )
}

export function statusAfter(transition: AppointmentTransition): AppointmentStatus {
  return TARGET_STATUS[transition]
}

export function canTransition(appointment: Appointment, transition: AppointmentTransition, now: LocalDateTime): boolean {
  if (!SOURCE_STATUSES[transition].includes(appointment.status)) return false
  if (transition === 'complete' && appointment.status === 'scheduled') return now >= appointment.startsAt
  return true
}

export function availableTransitions(
  appointment: Appointment,
  now: LocalDateTime,
  canReopen: boolean,
): AppointmentTransition[] {
  return TRANSITION_ORDER.filter(
    (transition) => (transition !== 'reopen' || canReopen) && canTransition(appointment, transition, now),
  )
}
