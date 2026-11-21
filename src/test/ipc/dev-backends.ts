import type { ExchangeRate, PaymentMethod, Resource, Service, SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { createCatalogIpcBackend } from './catalog-backend'
import { createPaymentMethodsIpcBackend } from './payment-methods-backend'
import { createRatesIpcBackend } from './rates-backend'
import { createResourcesIpcBackend } from './resources-backend'

export type BackendDecorator = (next: IpcBackend) => IpcBackend

export type DevBackendsOptions = {
  auth: IpcBackend
  session: () => SessionUser | null
  seed: {
    services: readonly Service[]
    resources: readonly Resource[]
    paymentMethods: readonly PaymentMethod[]
    rates: readonly ExchangeRate[]
  }
}

export function composeBackends(base: IpcBackend, ...decorators: BackendDecorator[]): IpcBackend {
  return decorators.reduce((backend, decorate) => decorate(backend), base)
}

export function createDevBackends({ auth, session, seed }: DevBackendsOptions): IpcBackend {
  return composeBackends(
    auth,
    (next) => createCatalogIpcBackend(next, { session, services: seed.services }),
    (next) => createResourcesIpcBackend(next, { session, resources: seed.resources }),
    (next) => createPaymentMethodsIpcBackend(next, { session, paymentMethods: seed.paymentMethods }),
    (next) => createRatesIpcBackend(next, { session, rates: seed.rates }),
  )
}
