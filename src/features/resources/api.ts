import { nowLocal } from '@/lib/datetime'
import { authorize } from '@/lib/mock/authorize'
import { appendRow, commit, findById, getState, nextId, replaceById } from '@/lib/mock/store'
import type { Appointment, Id, Resource, ResourceInput, ResourceListFilter, Result } from '@/lib/model'
import { err, ok, validationError } from '@/lib/result'
import { resourceInputSchema } from './schemas'

const NOT_FOUND_MESSAGE = 'El recurso no existe'
const HAS_FUTURE_APPOINTMENTS_MESSAGE = 'El recurso tiene citas futuras que deben reubicarse antes de desactivarlo'

function futureScheduledAppointmentsOf(resourceId: Id): Appointment[] {
  const now = nowLocal()
  return getState()
    .appointments.filter(
      (appointment) =>
        appointment.resourceId === resourceId && appointment.status === 'scheduled' && appointment.startsAt >= now,
    )
    .toSorted((first, second) => first.startsAt.localeCompare(second.startsAt) || first.id - second.id)
}

export async function listResources(filter: ResourceListFilter): Promise<Result<Resource[]>> {
  const access = authorize(getState(), { anyOf: ['appointments.read', 'resources.manage'] })
  if (access.status === 'error') return access
  const rows = getState().resources.filter((resource) => filter.includeInactive || resource.active)
  return ok([...rows])
}

export async function createResource(input: ResourceInput): Promise<Result<Resource>> {
  const access = authorize(getState(), 'resources.manage')
  if (access.status === 'error') return access
  const parsed = resourceInputSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error.issues)
  const state = getState()
  const created: Resource = { id: nextId(state.resources), ...parsed.data, active: true }
  commit({ ...state, resources: appendRow(state.resources, created) })
  return ok(created)
}

export async function updateResource(id: Id, input: ResourceInput): Promise<Result<Resource>> {
  const access = authorize(getState(), 'resources.manage')
  if (access.status === 'error') return access
  const parsed = resourceInputSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error.issues)
  const state = getState()
  const existing = findById(state.resources, id)
  if (!existing) return err('notFound', NOT_FOUND_MESSAGE)
  const updated: Resource = { ...existing, ...parsed.data }
  commit({ ...state, resources: replaceById(state.resources, updated) })
  return ok(updated)
}

export async function setResourceActive(id: Id, active: boolean): Promise<Result<Resource>> {
  const access = authorize(getState(), 'resources.manage')
  if (access.status === 'error') return access
  const state = getState()
  const existing = findById(state.resources, id)
  if (!existing) return err('notFound', NOT_FOUND_MESSAGE)
  if (!active) {
    const blocking = futureScheduledAppointmentsOf(id)
    if (blocking.length > 0) {
      return err('resourceHasFutureAppointments', HAS_FUTURE_APPOINTMENTS_MESSAGE, {
        entityIds: blocking.map((appointment) => appointment.id),
      })
    }
  }
  const updated: Resource = { ...existing, active }
  commit({ ...state, resources: replaceById(state.resources, updated) })
  return ok(updated)
}

export async function listFutureAppointmentsOfResource(id: Id): Promise<Result<Appointment[]>> {
  const access = authorize(getState(), 'resources.manage')
  if (access.status === 'error') return access
  if (!findById(getState().resources, id)) return err('notFound', NOT_FOUND_MESSAGE)
  return ok(futureScheduledAppointmentsOf(id))
}
