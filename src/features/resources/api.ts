import { commands, type ResourceSummary } from '@/lib/bindings'
import { nowLocal } from '@/lib/datetime'
import { callBackend } from '@/lib/ipc'
import { authorize } from '@/lib/mock/authorize'
import { commit, findById, getState, upsertById } from '@/lib/mock/store'
import type { Appointment, Id, Resource, ResourceInput, ResourceListFilter, Result } from '@/lib/model'
import { err, mapOk, ok } from '@/lib/result'

const MISSING_RESOURCE_MESSAGE = 'El recurso no existe'
const HAS_FUTURE_APPOINTMENTS_MESSAGE = 'El recurso tiene citas futuras que deben reubicarse antes de desactivarlo'
const RESOURCES_MANAGE = 'resources.manage'
const SESSION_PROBE_FILTER: ResourceListFilter = { includeInactive: false }

export type FutureAppointmentSummary = Pick<Appointment, 'id' | 'startsAt'>

function futureScheduledAppointmentsOf(resourceId: Id): Appointment[] {
  const now = nowLocal()
  return getState()
    .appointments.filter(
      (appointment) =>
        appointment.resourceId === resourceId && appointment.status === 'scheduled' && appointment.startsAt >= now,
    )
    .toSorted((first, second) => first.startsAt.localeCompare(second.startsAt) || first.id - second.id)
}

function toResource(summary: ResourceSummary): Resource {
  return { id: summary.id, name: summary.name, kind: summary.kind, active: summary.active }
}

function mirrorResources(resources: readonly Resource[]): void {
  const state = getState()
  commit({ ...state, resources: resources.reduce(upsertById, state.resources) })
}

function mirrorResource(resource: Resource): void {
  mirrorResources([resource])
}

function callResourceBackend(operation: () => Promise<Result<ResourceSummary>>): Promise<Result<Resource>> {
  return callBackend(async () => mapOk(await operation(), toResource), mirrorResource)
}

export function listResources(filter: ResourceListFilter): Promise<Result<Resource[]>> {
  return callBackend(
    async () => mapOk(await commands.listResources(filter), (rows) => rows.map(toResource)),
    mirrorResources,
  )
}

export function createResource(input: ResourceInput): Promise<Result<Resource>> {
  return callResourceBackend(() => commands.createResource(input))
}

export function updateResource(id: Id, input: ResourceInput): Promise<Result<Resource>> {
  return callResourceBackend(() => commands.updateResource({ id, ...input }))
}

async function futureAppointmentsBlock(resourceId: Id): Promise<Result<never> | null> {
  if (findById(getState().resources, resourceId)?.active === false) return null
  if (authorize(getState(), RESOURCES_MANAGE).status === 'error') return null
  const blocking = futureScheduledAppointmentsOf(resourceId)
  if (blocking.length === 0) return null
  const rustSession = await listResources(SESSION_PROBE_FILTER)
  if (rustSession.status === 'error') return rustSession
  return err('resourceHasFutureAppointments', HAS_FUTURE_APPOINTMENTS_MESSAGE, {
    entityIds: blocking.map((appointment) => appointment.id),
  })
}

export async function setResourceActive(id: Id, active: boolean): Promise<Result<Resource>> {
  const blocked = active ? null : await futureAppointmentsBlock(id)
  if (blocked) return blocked
  return callResourceBackend(() => commands.setResourceActive({ id, active }))
}

export async function listFutureAppointmentsOfResource(id: Id): Promise<Result<FutureAppointmentSummary[]>> {
  const access = authorize(getState(), RESOURCES_MANAGE)
  if (access.status === 'error') return access
  if (!findById(getState().resources, id)) return err('validation', MISSING_RESOURCE_MESSAGE, { field: 'id' })
  const rustSession = await listResources(SESSION_PROBE_FILTER)
  if (rustSession.status === 'error') return rustSession
  return ok(futureScheduledAppointmentsOf(id).map(({ id: appointmentId, startsAt }) => ({ id: appointmentId, startsAt })))
}
