import { commands, type FutureAppointment, type ResourceSummary } from '@/lib/bindings'
import { callBackend, settle } from '@/lib/ipc'
import { createMirrorSync, visibleRows } from '@/lib/mirror-sync'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Id, Resource, ResourceInput, ResourceListFilter, Result } from '@/lib/model'
import { mapOk } from '@/lib/result'

const FULL_COLLECTION: ResourceListFilter = { includeInactive: true }

const mirrorSync = createMirrorSync()

function toResource(summary: ResourceSummary): Resource {
  return { id: summary.id, name: summary.name, kind: summary.kind, active: summary.active }
}

function replaceResources(resources: readonly Resource[]): void {
  commit({ ...getState(), resources })
}

function mirrorResource(resource: Resource): void {
  const state = getState()
  commit({ ...state, resources: upsertById(state.resources, resource) })
}

function callResourceBackend(operation: () => Promise<Result<ResourceSummary>>): Promise<Result<Resource>> {
  return callBackend(async () => mapOk(await operation(), toResource), mirrorSync.reflectMutation(mirrorResource))
}

export async function listResources(filter: ResourceListFilter): Promise<Result<Resource[]>> {
  const full = await mirrorSync.list(
    async () => mapOk(await commands.listResources(FULL_COLLECTION), (rows) => rows.map(toResource)),
    replaceResources,
  )
  return mapOk(full, (resources) => visibleRows(resources, filter))
}

export function createResource(input: ResourceInput): Promise<Result<Resource>> {
  return callResourceBackend(() => commands.createResource(input))
}

export function updateResource(id: Id, input: ResourceInput): Promise<Result<Resource>> {
  return callResourceBackend(() => commands.updateResource({ id, ...input }))
}

export function setResourceActive(id: Id, active: boolean): Promise<Result<Resource>> {
  return callResourceBackend(() => commands.setResourceActive({ id, active }))
}

export function listFutureAppointmentsOfResource(id: Id): Promise<Result<FutureAppointment[]>> {
  return settle(() => commands.listFutureAppointmentsOfResource(id))
}
