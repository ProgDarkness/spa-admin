import type {
  AppointmentSummary,
  AppointmentTransition,
  ClientSummary,
  ResourceSummary,
  ServiceSummary,
} from '@/lib/bindings'
import { addMinutes, crossesMidnight, dateOf, isExistingDate, LOCAL_DATE_TIME_PATTERN, toLocalDateTime } from '@/lib/datetime'
import { canTransition, findOverlaps, statusAfter } from '@/features/appointments/rules'
import type { Appointment, SessionUser } from '@/lib/model'
import { countCodePoints, hasDisallowedTextCharacter, trimUnicodeWhitespace } from '@/lib/text'
import type { IpcBackend } from './auth-backend'
import {
  appointmentNotFoundError,
  crossesMidnightError,
  invalidTransitionError,
  overlapError,
  referenceMissingError,
  resourceInactiveError,
  validationError,
} from './ipc-errors'
import { nextRecordId, payloadOf, replaceRecord, requirePermission, type Fields } from './record-backend-support'
import type { SharedRows } from './shared-rows'

export type AppointmentsBackendOptions = {
  session: () => SessionUser | null
  appointments: readonly Appointment[]
  clients: SharedRows<ClientSummary>
  services: SharedRows<ServiceSummary>
  resources: SharedRows<ResourceSummary>
  shared?: SharedRows<AppointmentSummary>
  now?: () => number
}

type Slot = { resourceId: number; startsAt: string; endsAt: string }

const APPOINTMENTS_READ = 'appointments.read'
const APPOINTMENTS_WRITE = 'appointments.write'
const APPOINTMENTS_REOPEN = 'appointments.reopen'
const TRANSITIONS: readonly unknown[] = ['start', 'complete', 'markNoShow', 'cancel', 'reopen'] satisfies readonly AppointmentTransition[]
const START_STEP_MIN = 5
const MINUTES_START_INDEX = 'YYYY-MM-DDTHH:'.length
const MAX_NOTES_CHARS = 500
const MAX_RANGE_DAYS = 366
const DAY_MS = 86_400_000

function isTransition(value: unknown): value is AppointmentTransition {
  return TRANSITIONS.includes(value)
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function integerField(fields: Fields, key: string): number {
  const value = fields[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`argumento inválido: ${key}`)
  return value
}

function positiveIdField(fields: Fields, key: string): number {
  const value = fields[key]
  if (!isPositiveId(value)) throw validationError(key)
  return value
}

function validStart(value: unknown): string {
  const isExisting = typeof value === 'string' && LOCAL_DATE_TIME_PATTERN.test(value) && addMinutes(value, 0) === value
  if (!isExisting) throw validationError('startsAt')
  if (Number(value.slice(MINUTES_START_INDEX)) % START_STEP_MIN !== 0) throw validationError('startsAt')
  return value
}

function validNotes(raw: unknown): string | null {
  if (raw !== null && raw !== undefined && typeof raw !== 'string') throw validationError('notes')
  const trimmed = trimUnicodeWhitespace(raw ?? '')
  if (hasDisallowedTextCharacter(trimmed) || countCodePoints(trimmed) > MAX_NOTES_CHARS) throw validationError('notes')
  return trimmed === '' ? null : trimmed
}

function validDay(value: unknown): value is string {
  return typeof value === 'string' && isExistingDate(value)
}

function isWithinSpan(from: string, to: string): boolean {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
  return days >= 0 && days < MAX_RANGE_DAYS
}

type ValidRange = { from: string; to: string; resourceId: number | null }

function validatedRange(fields: Fields): ValidRange {
  const { from, to, resourceId } = fields
  if (!validDay(from)) throw validationError('from')
  if (!validDay(to) || !isWithinSpan(from, to)) throw validationError('to')
  if (resourceId === null || resourceId === undefined) return { from, to, resourceId: null }
  if (!isPositiveId(resourceId)) throw validationError('resourceId')
  return { from, to, resourceId }
}

function chronologically(first: AppointmentSummary, second: AppointmentSummary): number {
  return first.startsAt.localeCompare(second.startsAt) || first.id - second.id
}

function slotEndOf(startsAt: string, durationMin: number): string {
  if (crossesMidnight(startsAt, durationMin)) throw crossesMidnightError()
  return addMinutes(startsAt, durationMin)
}

export function createAppointmentsIpcBackend(next: IpcBackend, options: AppointmentsBackendOptions): IpcBackend {
  const now = options.now ?? Date.now
  let rows: readonly AppointmentSummary[] = options.appointments.map((appointment) => ({ ...appointment }))
  options.shared?.write(rows)

  function setRows(updated: readonly AppointmentSummary[]): void {
    rows = updated
    options.shared?.write(updated)
  }

  function localMinuteNow(): string {
    return toLocalDateTime(new Date(now()))
  }

  function requireAppointment(id: number): AppointmentSummary {
    const found = rows.find((row) => row.id === id)
    if (!found) throw appointmentNotFoundError()
    return found
  }

  function requireExistingResource(resourceId: number): ResourceSummary {
    const found = options.resources.read().find((resource) => resource.id === resourceId)
    if (!found) throw referenceMissingError('resourceId')
    return found
  }

  function requireActiveResource(resourceId: number): void {
    if (!requireExistingResource(resourceId).active) throw resourceInactiveError()
  }

  function ensureSlotFree(slot: Slot, exceptId: number | null): void {
    const conflicts = findOverlaps(slot, rows, exceptId).toSorted(chronologically)
    if (conflicts.length > 0) throw overlapError(conflicts.map((conflict) => conflict.id))
  }

  function listAppointments(args: unknown): AppointmentSummary[] {
    requirePermission(options.session, APPOINTMENTS_READ, APPOINTMENTS_WRITE)
    const range = validatedRange(payloadOf(args, 'range'))
    return rows
      .filter((row) => {
        const day = dateOf(row.startsAt)
        return day >= range.from && day <= range.to && (range.resourceId === null || row.resourceId === range.resourceId)
      })
      .toSorted(chronologically)
  }

  function createAppointment(args: unknown): AppointmentSummary {
    requirePermission(options.session, APPOINTMENTS_WRITE)
    const fields = payloadOf(args, 'input')
    const clientId = positiveIdField(fields, 'clientId')
    const serviceId = positiveIdField(fields, 'serviceId')
    const resourceId = positiveIdField(fields, 'resourceId')
    const startsAt = validStart(fields.startsAt)
    const notes = validNotes(fields.notes)
    const client = options.clients.read().find((row) => row.id === clientId)
    if (!client || client.deletedAt !== null) throw referenceMissingError('clientId')
    const service = options.services.read().find((row) => row.id === serviceId)
    if (!service) throw referenceMissingError('serviceId')
    const resource = requireExistingResource(resourceId)
    if (!service.active) throw validationError('serviceId')
    if (!resource.active) throw resourceInactiveError()
    const endsAt = slotEndOf(startsAt, service.durationMin)
    ensureSlotFree({ resourceId, startsAt, endsAt }, null)
    const created: AppointmentSummary = {
      id: nextRecordId(rows),
      clientId,
      serviceId,
      resourceId,
      startsAt,
      endsAt,
      status: 'scheduled',
      priceCentsSnapshot: service.priceCents,
      durationMinSnapshot: service.durationMin,
      notes,
    }
    setRows([...rows, created])
    return created
  }

  function moveAppointment(args: unknown): AppointmentSummary {
    requirePermission(options.session, APPOINTMENTS_WRITE)
    const fields = payloadOf(args, 'movement')
    const id = integerField(fields, 'id')
    const resourceId = positiveIdField(fields, 'resourceId')
    const startsAt = validStart(fields.startsAt)
    const before = requireAppointment(id)
    if (before.status !== 'scheduled') throw invalidTransitionError()
    if (before.resourceId === resourceId && before.startsAt === startsAt) return before
    requireActiveResource(resourceId)
    const endsAt = slotEndOf(startsAt, before.durationMinSnapshot)
    ensureSlotFree({ resourceId, startsAt, endsAt }, before.id)
    const after: AppointmentSummary = { ...before, resourceId, startsAt, endsAt }
    setRows(replaceRecord(rows, after))
    return after
  }

  function ensureCanHoldSlot(appointment: AppointmentSummary, currentMinute: string): void {
    if (appointment.endsAt > currentMinute) requireActiveResource(appointment.resourceId)
    ensureSlotFree(appointment, appointment.id)
  }

  function transitionAppointment(args: unknown): AppointmentSummary {
    requirePermission(options.session, APPOINTMENTS_WRITE)
    const fields = payloadOf(args, 'request')
    const id = integerField(fields, 'id')
    const transition = fields.transition
    if (!isTransition(transition)) throw new Error('argumento inválido: transition')
    if (transition === 'reopen') requirePermission(options.session, APPOINTMENTS_REOPEN)
    const currentMinute = localMinuteNow()
    const before = requireAppointment(id)
    if (!canTransition(before, transition, currentMinute)) throw invalidTransitionError()
    const status = statusAfter(transition)
    if (status === 'scheduled') ensureCanHoldSlot(before, currentMinute)
    const after: AppointmentSummary = { ...before, status }
    setRows(replaceRecord(rows, after))
    return after
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_appointments: listAppointments,
    create_appointment: createAppointment,
    move_appointment: moveAppointment,
    transition_appointment: transitionAppointment,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
