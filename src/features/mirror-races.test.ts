import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createService, listServices } from '@/features/catalog/api'
import { createClient, listClients } from '@/features/clients/api'
import { createPaymentMethod, listPaymentMethods } from '@/features/payment-methods/api'
import { listRates, upsertRate } from '@/features/rates/api'
import { createResource, listResources } from '@/features/resources/api'
import { getState, resetStore } from '@/lib/mock/store'
import type { Result } from '@/lib/model'
import { deferred, type Deferred } from '@/test/deferred'

const INSTANT = '2026-11-12T09:00:00Z'
const ALL = { includeInactive: true }
const MUTATION_ID = 900
const STALE_ID = 801
const NEWER_ID = 802
const MUTATION_DATE = '2031-01-01'
const STALE_DATE = '2031-02-01'
const NEWER_DATE = '2031-03-01'

type EntityCase = Readonly<{
  entity: string
  listCommand: string
  mutationCommand: string
  mutationPayload: unknown
  rowWith: (key: string) => unknown
  keyOfMutation: string
  staleKey: string
  newerKey: string
  list: () => Promise<Result<unknown[]>>
  mutate: () => Promise<unknown>
  storeKeys: () => string[]
}>

const idKey = (id: number): string => String(id)

const CLIENT_ROW = (id: number) => ({
  id,
  firstName: 'De lista',
  lastName: 'Persona',
  nationalId: 'V-30111222',
  phone: '0414-5550000',
  deletedAt: null,
})

const CASES: readonly EntityCase[] = [
  {
    entity: 'catalog',
    listCommand: 'list_services',
    mutationCommand: 'create_service',
    mutationPayload: {
      id: MUTATION_ID,
      name: 'Nuevo',
      priceCents: 2_500,
      currency: 'USD',
      durationMin: 30,
      active: true,
      createdAt: INSTANT,
      updatedAt: INSTANT,
    },
    rowWith: (key) => ({
      id: Number(key),
      name: 'De lista',
      priceCents: 2_500,
      currency: 'USD',
      durationMin: 30,
      active: true,
      createdAt: INSTANT,
      updatedAt: INSTANT,
    }),
    keyOfMutation: idKey(MUTATION_ID),
    staleKey: idKey(STALE_ID),
    newerKey: idKey(NEWER_ID),
    list: () => listServices(ALL),
    mutate: () => createService({ name: 'Nuevo', priceCents: 2_500, durationMin: 30 }),
    storeKeys: () => getState().services.map((row) => idKey(row.id)),
  },
  {
    entity: 'resources',
    listCommand: 'list_resources',
    mutationCommand: 'create_resource',
    mutationPayload: { id: MUTATION_ID, name: 'Nueva', kind: 'cabin', active: true, createdAt: INSTANT, updatedAt: INSTANT },
    rowWith: (key) => ({ id: Number(key), name: 'De lista', kind: 'cabin', active: true, createdAt: INSTANT, updatedAt: INSTANT }),
    keyOfMutation: idKey(MUTATION_ID),
    staleKey: idKey(STALE_ID),
    newerKey: idKey(NEWER_ID),
    list: () => listResources(ALL),
    mutate: () => createResource({ name: 'Nueva', kind: 'cabin' }),
    storeKeys: () => getState().resources.map((row) => idKey(row.id)),
  },
  {
    entity: 'paymentMethods',
    listCommand: 'list_payment_methods',
    mutationCommand: 'create_payment_method',
    mutationPayload: { id: MUTATION_ID, name: 'Nuevo', active: true, createdAt: INSTANT, updatedAt: INSTANT },
    rowWith: (key) => ({ id: Number(key), name: 'De lista', active: true, createdAt: INSTANT, updatedAt: INSTANT }),
    keyOfMutation: idKey(MUTATION_ID),
    staleKey: idKey(STALE_ID),
    newerKey: idKey(NEWER_ID),
    list: () => listPaymentMethods(ALL),
    mutate: () => createPaymentMethod({ name: 'Nuevo' }),
    storeKeys: () => getState().paymentMethods.map((row) => idKey(row.id)),
  },
  {
    entity: 'clients',
    listCommand: 'list_clients',
    mutationCommand: 'create_client',
    mutationPayload: CLIENT_ROW(MUTATION_ID),
    rowWith: (key) => CLIENT_ROW(Number(key)),
    keyOfMutation: idKey(MUTATION_ID),
    staleKey: idKey(STALE_ID),
    newerKey: idKey(NEWER_ID),
    list: () => listClients({ query: null, includeDeleted: true }),
    mutate: () =>
      createClient({ firstName: 'Nueva', lastName: 'Persona', nationalId: 'V-30111222', phone: '0414-5550000' }),
    storeKeys: () => getState().clients.map((row) => idKey(row.id)),
  },
  {
    entity: 'rates',
    listCommand: 'list_rates',
    mutationCommand: 'upsert_rate',
    mutationPayload: { date: MUTATION_DATE, rateBsPerUsdE4: 123 },
    rowWith: (key) => ({ date: key, rateBsPerUsdE4: 456 }),
    keyOfMutation: MUTATION_DATE,
    staleKey: STALE_DATE,
    newerKey: NEWER_DATE,
    list: () => listRates(),
    mutate: () => upsertRate(MUTATION_DATE, 123),
    storeKeys: () => getState().rates.map((row) => row.date),
  },
]

function controlledBackend(entity: EntityCase): Deferred<unknown>[] {
  const pendingLists: Deferred<unknown>[] = []
  mockIPC((cmd) => {
    if (cmd === entity.listCommand) {
      const pending = deferred<unknown>()
      pendingLists.push(pending)
      return pending.promise
    }
    return cmd === entity.mutationCommand ? entity.mutationPayload : null
  })
  return pendingLists
}

async function untilIssued(pendingLists: readonly Deferred<unknown>[], count: number): Promise<void> {
  await vi.waitFor(() => expect(pendingLists).toHaveLength(count))
}

beforeEach(resetStore)
afterEach(() => clearMocks())

describe.each(CASES)('carreras del espejo: $entity', (entity) => {
  it('un list lento no pisa una mutación reflejada mientras estaba en vuelo y devuelve los datos de Rust', async () => {
    const pendingLists = controlledBackend(entity)

    const slowList = entity.list()
    await entity.mutate()
    await untilIssued(pendingLists, 1)
    pendingLists[0]?.resolve([entity.rowWith(entity.staleKey)])
    const result = await slowList

    expect(entity.storeKeys()).toContain(entity.keyOfMutation)
    expect(entity.storeKeys()).not.toContain(entity.staleKey)
    expect(result.status === 'ok' && result.data).toHaveLength(1)
  })

  it('con dos list fuera de orden gana el más reciente y el viejo devuelve sus datos', async () => {
    const pendingLists = controlledBackend(entity)

    const olderList = entity.list()
    const newerList = entity.list()
    await untilIssued(pendingLists, 2)
    pendingLists[1]?.resolve([entity.rowWith(entity.newerKey)])
    await newerList
    pendingLists[0]?.resolve([entity.rowWith(entity.staleKey)])
    const olderResult = await olderList

    expect(entity.storeKeys()).toEqual([entity.newerKey])
    expect(olderResult.status === 'ok' && olderResult.data).toHaveLength(1)
  })

  it('un list iniciado después de la mutación sí reemplaza el espejo', async () => {
    const pendingLists = controlledBackend(entity)
    await entity.mutate()

    const list = entity.list()
    await untilIssued(pendingLists, 1)
    pendingLists[0]?.resolve([entity.rowWith(entity.newerKey)])
    await list

    expect(entity.storeKeys()).toEqual([entity.newerKey])
  })
})
