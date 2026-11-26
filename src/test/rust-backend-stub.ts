import { mockIPC } from '@tauri-apps/api/mocks'
import { todayLocal } from '@/lib/datetime'
import { createSeed } from '@/lib/mock/seed'
import { getState } from '@/lib/mock/store'
import type { Appointment, Client, ExchangeRate, PaymentMethod, Resource, Service } from '@/lib/model'

const STUB_INSTANT = '2026-11-12T09:00:00Z'

export type RustCatalogData = Readonly<{
  services?: readonly Service[]
  resources?: readonly Resource[]
  paymentMethods?: readonly PaymentMethod[]
  rates?: readonly ExchangeRate[]
  clients?: readonly Client[]
  appointments?: readonly Appointment[]
  failing?: readonly string[]
}>

type Handler = (data: RustCatalogData, includeInactive: boolean) => unknown

function summariesOf<T extends Readonly<{ active: boolean }>>(rows: readonly T[], includeInactive: boolean) {
  return rows
    .filter((row) => includeInactive || row.active)
    .map((row) => ({ ...row, createdAt: STUB_INSTANT, updatedAt: STUB_INSTANT }))
}

const LIST_HANDLERS: Readonly<Record<string, Handler>> = {
  list_services: ({ services = [] }, includeInactive) => summariesOf(services, includeInactive),
  list_resources: ({ resources = [] }, includeInactive) => summariesOf(resources, includeInactive),
  list_payment_methods: ({ paymentMethods = [] }, includeInactive) => summariesOf(paymentMethods, includeInactive),
  list_rates: ({ rates = [] }) => rates,
  list_clients: ({ clients = getState().clients }) => clients,
  list_appointments: ({ appointments = createSeed(todayLocal()).appointments }) => appointments,
}

function includeInactiveOf(args: unknown): boolean {
  const filter = (args as { filter?: { includeInactive?: boolean } } | undefined)?.filter
  return filter?.includeInactive === true
}

const CLIENT_NOT_FOUND = { code: 'notFound', message: 'Cliente no encontrado', field: null, entityIds: null }

function clientOf(data: RustCatalogData, args: unknown): Client {
  const id = (args as { id?: number } | undefined)?.id
  const found = (data.clients ?? getState().clients).find((client) => client.id === id)
  if (!found) throw CLIENT_NOT_FOUND
  return found
}

export function stubRustCatalog(data: RustCatalogData): string[] {
  const calls: string[] = []
  mockIPC((cmd, args) => {
    calls.push(cmd)
    if (data.failing?.includes(cmd)) throw new Error('canal caído')
    if (cmd === 'get_client') return clientOf(data, args)
    const handler = LIST_HANDLERS[cmd]
    return handler ? handler(data, includeInactiveOf(args)) : null
  })
  return calls
}
