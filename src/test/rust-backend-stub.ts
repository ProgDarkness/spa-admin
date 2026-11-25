import { mockIPC } from '@tauri-apps/api/mocks'
import type { ExchangeRate, PaymentMethod, Resource, Service } from '@/lib/model'

const STUB_INSTANT = '2026-11-12T09:00:00Z'

export type RustCatalogData = Readonly<{
  services?: readonly Service[]
  resources?: readonly Resource[]
  paymentMethods?: readonly PaymentMethod[]
  rates?: readonly ExchangeRate[]
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
}

function includeInactiveOf(args: unknown): boolean {
  const filter = (args as { filter?: { includeInactive?: boolean } } | undefined)?.filter
  return filter?.includeInactive === true
}

export function stubRustCatalog(data: RustCatalogData): string[] {
  const calls: string[] = []
  mockIPC((cmd, args) => {
    calls.push(cmd)
    if (data.failing?.includes(cmd)) throw new Error('canal caído')
    const handler = LIST_HANDLERS[cmd]
    return handler ? handler(data, includeInactiveOf(args)) : null
  })
  return calls
}
