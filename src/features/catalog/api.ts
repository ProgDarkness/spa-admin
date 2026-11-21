import { commands, type ServiceSummary } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { authorize, type PermissionRequirement } from '@/lib/mock/authorize'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Id, PaymentMethod, Result, Service, ServiceInput, ServiceListFilter } from '@/lib/model'
import { mapOk, ok } from '@/lib/result'

const PAYMENT_METHODS_READ: PermissionRequirement = { anyOf: ['catalog.read', 'payments.read'] }
const SERVICE_CURRENCY = 'USD'

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

function mirrorServices(services: readonly Service[]): void {
  const state = getState()
  commit({ ...state, services: services.reduce(upsertById, state.services) })
}

function mirrorService(service: Service): void {
  mirrorServices([service])
}

function callServiceBackend(operation: () => Promise<Result<ServiceSummary>>): Promise<Result<Service>> {
  return callBackend(async () => mapOk(await operation(), toService), mirrorService)
}

export function listServices(filter: ServiceListFilter): Promise<Result<Service[]>> {
  return callBackend(async () => mapOk(await commands.listServices(filter), (rows) => rows.map(toService)), mirrorServices)
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

export async function listPaymentMethods(): Promise<Result<PaymentMethod[]>> {
  const access = authorize(getState(), PAYMENT_METHODS_READ)
  if (access.status === 'error') return access
  return ok([...getState().paymentMethods])
}
