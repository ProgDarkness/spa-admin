import type {
  AppointmentSummary,
  ClientSummary,
  ExchangeRate as RateSummary,
  PaymentMethodSummary,
  PaymentSummary,
  ResourceSummary,
  ServiceSummary,
} from '@/lib/bindings'
import type { Appointment, Client, ExchangeRate, Payment, PaymentMethod, Resource, Service, SessionUser } from '@/lib/model'
import { createAppointmentsIpcBackend } from './appointments-backend'
import type { IpcBackend } from './auth-backend'
import { createCatalogIpcBackend } from './catalog-backend'
import { createClientHistoryIpcBackend } from './client-history-backend'
import { createClientsIpcBackend } from './clients-backend'
import { createPaymentMethodsIpcBackend } from './payment-methods-backend'
import { createPaymentsIpcBackend } from './payments-backend'
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
    payments: readonly Payment[]
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
  const paymentMethods = createSharedRows<PaymentMethodSummary>()
  const rates = createSharedRows<RateSummary>()
  const payments = createSharedRows<PaymentSummary>()
  const clock = now ? { now } : {}
  return composeBackends(
    auth,
    (next) => createCatalogIpcBackend(next, { session, services: seed.services, shared: services }),
    (next) => createResourcesIpcBackend(next, { session, resources: seed.resources, shared: resources, appointments, ...clock }),
    (next) => createPaymentMethodsIpcBackend(next, { session, paymentMethods: seed.paymentMethods, shared: paymentMethods }),
    (next) => createRatesIpcBackend(next, { session, rates: seed.rates, shared: rates }),
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
    (next) =>
      createPaymentsIpcBackend(next, {
        session,
        payments: seed.payments,
        appointments,
        paymentMethods,
        rates,
        shared: payments,
        ...clock,
      }),
    (next) => createClientHistoryIpcBackend(next, { session, clients, appointments, services, resources, payments }),
  )
}
