import { commands, type ServiceSummary } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { createMirrorSync, visibleRows } from '@/lib/mirror-sync'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Id, Result, Service, ServiceInput, ServiceListFilter } from '@/lib/model'
import { mapOk } from '@/lib/result'

const SERVICE_CURRENCY = 'USD'
const FULL_COLLECTION: ServiceListFilter = { includeInactive: true }

const mirrorSync = createMirrorSync()

function toService(summary: ServiceSummary): Service {
  return {
    id: summary.id,
    name: summary.name,
    priceCents: summary.priceCents,
    currency: SERVICE_CURRENCY,
    durationMin: summary.durationMin,
    active: summary.active,
  }
}

function replaceServices(services: readonly Service[]): void {
  commit({ ...getState(), services })
}

function mirrorService(service: Service): void {
  const state = getState()
  commit({ ...state, services: upsertById(state.services, service) })
}

function callServiceBackend(operation: () => Promise<Result<ServiceSummary>>): Promise<Result<Service>> {
  return callBackend(async () => mapOk(await operation(), toService), mirrorSync.reflectMutation(mirrorService))
}

export async function listServices(filter: ServiceListFilter): Promise<Result<Service[]>> {
  const full = await mirrorSync.list(
    async () => mapOk(await commands.listServices(FULL_COLLECTION), (rows) => rows.map(toService)),
    replaceServices,
  )
  return mapOk(full, (services) => visibleRows(services, filter))
}

export function createService(input: ServiceInput): Promise<Result<Service>> {
  return callServiceBackend(() => commands.createService(input))
}

export function updateService(id: Id, input: ServiceInput): Promise<Result<Service>> {
  return callServiceBackend(() => commands.updateService({ id, ...input }))
}

export function setServiceActive(id: Id, active: boolean): Promise<Result<Service>> {
  return callServiceBackend(() => commands.setServiceActive({ id, active }))
}
