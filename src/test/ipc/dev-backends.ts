import type { AppointmentSummary, ClientSummary, ResourceSummary, ServiceSummary } from '@/lib/bindings'
import type { Appointment, Client, ExchangeRate, PaymentMethod, Resource, Service, SessionUser } from '@/lib/model'
import { createAppointmentsIpcBackend } from './appointments-backend'
import type { IpcBackend } from './auth-backend'
import { createCatalogIpcBackend } from './catalog-backend'
import { createClientsIpcBackend } from './clients-backend'
import { createPaymentMethodsIpcBackend } from './payment-methods-backend'
import { createRatesIpcBackend } from './rates-backend'
import { createResourcesIpcBackend } from './resources-backend'
import { createSharedRows } from './shared-rows'

export type BackendDecorator = (next: IpcBackend) => IpcBackend

export type DevBackendsOptions = {
  auth: IpcBackend
  session: () => SessionUser | null
  seed: {
    services: readonly Service[]
    resources: readonly Resource[]
    paymentMethods: readonly PaymentMethod[]
    rates: readonly ExchangeRate[]
    clients: readonly Client[]
    appointments: readonly Appointment[]
  }
  now?: () => number
}

export function composeBackends(base: IpcBackend, ...decorators: BackendDecorator[]): IpcBackend {
  return decorators.reduce((backend, decorate) => decorate(backend), base)
}

export function createDevBackends({ auth, session, seed, now }: DevBackendsOptions): IpcBackend {
  const clients = createSharedRows<ClientSummary>()
  const services = createSharedRows<ServiceSummary>()
  const resources = createSharedRows<ResourceSummary>()
  const appointments = createSharedRows<AppointmentSummary>()
  const clock = now ? { now } : {}
  return composeBackends(
    auth,
    (next) => createCatalogIpcBackend(next, { session, services: seed.services, shared: services }),
    (next) => createResourcesIpcBackend(next, { session, resources: seed.resources, shared: resources, appointments, ...clock }),
    (next) => createPaymentMethodsIpcBackend(next, { session, paymentMethods: seed.paymentMethods }),
    (next) => createRatesIpcBackend(next, { session, rates: seed.rates }),
    (next) => createClientsIpcBackend(next, { session, clients: seed.clients, shared: clients }),
    (next) =>
      createAppointmentsIpcBackend(next, {
        session,
        appointments: seed.appointments,
        clients,
        services,
        resources,
        shared: appointments,
        ...clock,
      }),
  )
}
