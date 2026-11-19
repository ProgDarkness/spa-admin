import { addMinutes, crossesMidnight, dateOf, nowLocal, type TimeRange } from '@/lib/datetime'
import { authorize } from '@/lib/mock/authorize'
import { appendRow, commit, findById, getState, nextId, replaceById } from '@/lib/mock/store'
import type {
  Appointment,
  AppointmentInput,
  AppointmentMove,
  AppointmentRange,
  AppointmentTransition,
  Id,
  LocalDateTime,
  Resource,
  Result,
} from '@/lib/model'
import { err, ok, validationError } from '@/lib/result'
import { canTransition, findOverlaps, statusAfter } from './rules'
import { appointmentInputSchema, appointmentMoveSchema, appointmentRangeSchema } from './schemas'

const CLIENT_NOT_FOUND_MESSAGE = 'El cliente no existe'
const SERVICE_NOT_FOUND_MESSAGE = 'El servicio no existe'
const SERVICE_INACTIVE_MESSAGE = 'El servicio está inactivo'
const RESOURCE_NOT_FOUND_MESSAGE = 'El recurso no existe'
const RESOURCE_INACTIVE_MESSAGE = 'El recurso está inactivo'
const APPOINTMENT_NOT_FOUND_MESSAGE = 'La cita no existe'
const CROSSES_MIDNIGHT_MESSAGE = 'La cita no puede terminar después de la medianoche'
const OVERLAP_MESSAGE = 'El recurso ya tiene una cita en ese horario'
const INVALID_TRANSITION_MESSAGE = 'La cita no admite esa operación en su estado actual'

type Slot = { startsAt: LocalDateTime; durationMin: number; resourceId: Id }

function slotConflict(slot: Slot, ignoreId: Id | null): Result<never> | null {
  if (crossesMidnight(slot.startsAt, slot.durationMin)) {
    return err('crossesMidnight', CROSSES_MIDNIGHT_MESSAGE, { field: 'startsAt' })
  }
  const candidate: TimeRange & { resourceId: Id } = {
    startsAt: slot.startsAt,
    endsAt: addMinutes(slot.startsAt, slot.durationMin),
    resourceId: slot.resourceId,
  }
  const conflicts = findOverlaps(candidate, getState().appointments, ignoreId)
  if (conflicts.length === 0) return null
  return err('overlap', OVERLAP_MESSAGE, { field: 'startsAt', entityIds: conflicts.map((appointment) => appointment.id) })
}

function activeResourceFor(resourceId: Id): Result<Resource> {
  const resource = findById(getState().resources, resourceId)
  if (!resource) return err('notFound', RESOURCE_NOT_FOUND_MESSAGE, { field: 'resourceId' })
  if (!resource.active) return err('resourceInactive', RESOURCE_INACTIVE_MESSAGE, { field: 'resourceId' })
  return ok(resource)
}

function isInRange(appointment: Appointment, range: AppointmentRange): boolean {
  const day = dateOf(appointment.startsAt)
  const matchesResource = range.resourceId === null || appointment.resourceId === range.resourceId
  return day >= range.from && day <= range.to && matchesResource
}

export async function listAppointments(range: AppointmentRange): Promise<Result<Appointment[]>> {
  const access = authorize(getState(), 'appointments.read')
  if (access.status === 'error') return access
  const parsed = appointmentRangeSchema.safeParse(range)
  if (!parsed.success) return validationError(parsed.error.issues)
  const rows = getState()
    .appointments.filter((appointment) => isInRange(appointment, parsed.data))
    .toSorted((first, second) => first.startsAt.localeCompare(second.startsAt) || first.id - second.id)
  return ok(rows)
}

export async function createAppointment(input: AppointmentInput): Promise<Result<Appointment>> {
  const access = authorize(getState(), 'appointments.write')
  if (access.status === 'error') return access
  const parsed = appointmentInputSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error.issues)
  const state = getState()
  const { clientId, serviceId, resourceId, startsAt, notes } = parsed.data
  const client = findById(state.clients, clientId)
  if (!client || client.deletedAt !== null) return err('notFound', CLIENT_NOT_FOUND_MESSAGE, { field: 'clientId' })
  const service = findById(state.services, serviceId)
  if (!service) return err('notFound', SERVICE_NOT_FOUND_MESSAGE, { field: 'serviceId' })
  if (!findById(state.resources, resourceId)) {
    return err('notFound', RESOURCE_NOT_FOUND_MESSAGE, { field: 'resourceId' })
  }
  if (!service.active) return err('validation', SERVICE_INACTIVE_MESSAGE, { field: 'serviceId' })
  const resource = activeResourceFor(resourceId)
  if (resource.status === 'error') return resource
  const conflict = slotConflict({ startsAt, durationMin: service.durationMin, resourceId }, null)
  if (conflict) return conflict
  const created: Appointment = {
    id: nextId(state.appointments),
    clientId,
    serviceId,
    resourceId,
    startsAt,
    endsAt: addMinutes(startsAt, service.durationMin),
    status: 'scheduled',
    priceCentsSnapshot: service.priceCents,
    durationMinSnapshot: service.durationMin,
    notes,
  }
  commit({ ...state, appointments: appendRow(state.appointments, created) })
  return ok(created)
}

export async function moveAppointment(id: Id, move: AppointmentMove): Promise<Result<Appointment>> {
  const access = authorize(getState(), 'appointments.write')
  if (access.status === 'error') return access
  const parsed = appointmentMoveSchema.safeParse(move)
  if (!parsed.success) return validationError(parsed.error.issues)
  const state = getState()
  const existing = findById(state.appointments, id)
  if (!existing) return err('notFound', APPOINTMENT_NOT_FOUND_MESSAGE)
  if (existing.status !== 'scheduled') return err('invalidTransition', INVALID_TRANSITION_MESSAGE)
  const resource = activeResourceFor(parsed.data.resourceId)
  if (resource.status === 'error') return resource
  const slot: Slot = {
    startsAt: parsed.data.startsAt,
    durationMin: existing.durationMinSnapshot,
    resourceId: parsed.data.resourceId,
  }
  const conflict = slotConflict(slot, existing.id)
  if (conflict) return conflict
  const moved: Appointment = {
    ...existing,
    resourceId: slot.resourceId,
    startsAt: slot.startsAt,
    endsAt: addMinutes(slot.startsAt, slot.durationMin),
  }
  commit({ ...state, appointments: replaceById(state.appointments, moved) })
  return ok(moved)
}

export async function transitionAppointment(
  id: Id,
  transition: AppointmentTransition,
): Promise<Result<Appointment>> {
  const access = authorize(getState(), 'appointments.write')
  if (access.status === 'error') return access
  if (transition === 'reopen') {
    const reopenAccess = authorize(getState(), 'appointments.reopen')
    if (reopenAccess.status === 'error') return reopenAccess
  }
  const state = getState()
  const existing = findById(state.appointments, id)
  if (!existing) return err('notFound', APPOINTMENT_NOT_FOUND_MESSAGE)
  if (!canTransition(existing, transition, nowLocal())) {
    return err('invalidTransition', INVALID_TRANSITION_MESSAGE)
  }
  if (transition === 'reopen') {
    const conflict = slotConflict(
      { startsAt: existing.startsAt, durationMin: existing.durationMinSnapshot, resourceId: existing.resourceId },
      existing.id,
    )
    if (conflict) return conflict
  }
  const updated: Appointment = { ...existing, status: statusAfter(transition) }
  commit({ ...state, appointments: replaceById(state.appointments, updated) })
  return ok(updated)
}
