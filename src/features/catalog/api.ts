import { authorize, type PermissionRequirement } from '@/lib/mock/authorize'
import { appendRow, commit, findById, getState, nextId, replaceById } from '@/lib/mock/store'
import type { Id, PaymentMethod, Result, Service, ServiceInput, ServiceListFilter } from '@/lib/model'
import { err, ok, validationError } from '@/lib/result'
import { serviceInputSchema } from './schemas'

const CATALOG_READ = 'catalog.read'
const CATALOG_WRITE = 'catalog.write'
const PAYMENT_METHODS_READ: PermissionRequirement = { anyOf: ['catalog.read', 'payments.read'] }
const SERVICE_NOT_FOUND_MESSAGE = 'El servicio no existe'

function serviceNotFound(): Result<never> {
  return err('notFound', SERVICE_NOT_FOUND_MESSAGE)
}

export async function listServices(filter: ServiceListFilter): Promise<Result<Service[]>> {
  const access = authorize(getState(), CATALOG_READ)
  if (access.status === 'error') return access
  const { services } = getState()
  return ok(services.filter((service) => filter.includeInactive || service.active))
}

export async function createService(input: ServiceInput): Promise<Result<Service>> {
  const access = authorize(getState(), CATALOG_WRITE)
  if (access.status === 'error') return access
  const parsed = serviceInputSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error.issues)
  const state = getState()
  const created: Service = { id: nextId(state.services), ...parsed.data, currency: 'USD', active: true }
  commit({ ...state, services: appendRow(state.services, created) })
  return ok(created)
}

export async function updateService(id: Id, input: ServiceInput): Promise<Result<Service>> {
  const access = authorize(getState(), CATALOG_WRITE)
  if (access.status === 'error') return access
  const parsed = serviceInputSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error.issues)
  const state = getState()
  const existing = findById(state.services, id)
  if (!existing) return serviceNotFound()
  const updated: Service = { ...existing, ...parsed.data }
  commit({ ...state, services: replaceById(state.services, updated) })
  return ok(updated)
}

export async function setServiceActive(id: Id, active: boolean): Promise<Result<Service>> {
  const access = authorize(getState(), CATALOG_WRITE)
  if (access.status === 'error') return access
  const state = getState()
  const existing = findById(state.services, id)
  if (!existing) return serviceNotFound()
  const updated: Service = { ...existing, active }
  commit({ ...state, services: replaceById(state.services, updated) })
  return ok(updated)
}

export async function listPaymentMethods(): Promise<Result<PaymentMethod[]>> {
  const access = authorize(getState(), PAYMENT_METHODS_READ)
  if (access.status === 'error') return access
  return ok([...getState().paymentMethods])
}
