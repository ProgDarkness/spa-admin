import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientSummary } from '@/lib/bindings'
import { getState, resetStore } from '@/lib/mock/store'
import { deferred, type Deferred } from '@/test/deferred'
import { createClient, getClient, listClients, reactivateClient, softDeleteClient, updateClient } from './api'

const REAL_ID = 55
const INPUT = { firstName: 'Real', lastName: 'De Rust', nationalId: 'V-30111222', phone: '0414-5550000' }

function summary(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return { id: 1, firstName: 'Ana', lastName: 'Real', nationalId: 'V-10000001', phone: '0414-0000001', deletedAt: null, ...overrides }
}

type Call = { cmd: string; args: unknown }

function rustReplies(handler: (cmd: string, args: unknown) => unknown): Call[] {
  const calls: Call[] = []
  mockIPC((cmd, args) => {
    calls.push({ cmd, args })
    return handler(cmd, args)
  })
  return calls
}

beforeEach(resetStore)
afterEach(() => clearMocks())

describe('listClients reemplaza el espejo con lo que devuelve Rust', () => {
  it('deja en el store exactamente las filas de Rust, eliminadas incluidas', async () => {
    rustReplies(() => [summary({ id: 1 }), summary({ id: REAL_ID, firstName: 'Otra' }), summary({ id: 56, deletedAt: '2026-11-01T10:00' })])

    await listClients({ query: null, includeDeleted: false })

    expect(getState().clients.map((client) => [client.id, client.firstName, client.deletedAt])).toEqual([
      [1, 'Ana', null],
      [REAL_ID, 'Otra', null],
      [56, 'Ana', '2026-11-01T10:00'],
    ])
  })

  it('vacía el store cuando Rust no devuelve clientes', async () => {
    rustReplies(() => [])

    await listClients({ query: null, includeDeleted: true })

    expect(getState().clients).toEqual([])
  })

  it('sin consulta hace una sola llamada con includeDeleted true y query vacía', async () => {
    const calls = rustReplies(() => [])

    await listClients({ query: null, includeDeleted: false })
    await listClients({ query: '   ', includeDeleted: false })

    expect(calls).toEqual([
      { cmd: 'list_clients', args: { filter: { query: '', includeDeleted: true } } },
      { cmd: 'list_clients', args: { filter: { query: '', includeDeleted: true } } },
    ])
  })

  it('con consulta primero reemplaza el espejo completo y luego consulta solo los ids visibles', async () => {
    const all = [summary({ id: 1 }), summary({ id: 2, firstName: 'Beto' }), summary({ id: 3, firstName: 'Cata' })]
    const calls = rustReplies((_, args) => {
      const { query } = (args as { filter: { query: string } }).filter
      return query === '' ? all : [all[1]]
    })

    const result = await listClients({ query: 'beto', includeDeleted: false })

    expect(calls.map((call) => call.args)).toEqual([
      { filter: { query: '', includeDeleted: true } },
      { filter: { query: 'beto', includeDeleted: true } },
    ])
    expect(getState().clients.map((client) => client.id)).toEqual([1, 2, 3])
    expect(result.status === 'ok' && result.data.map((client) => client.id)).toEqual([2])
  })

  it('con consulta devuelve las filas del espejo en el orden de la respuesta y respeta includeDeleted', async () => {
    const all = [summary({ id: 1 }), summary({ id: 2, deletedAt: '2026-11-01T10:00' }), summary({ id: 3 })]
    rustReplies((_, args) => {
      const { query } = (args as { filter: { query: string } }).filter
      return query === '' ? all : [all[2], all[1]]
    })

    const hidden = await listClients({ query: 'x', includeDeleted: false })
    const shown = await listClients({ query: 'x', includeDeleted: true })

    expect(hidden.status === 'ok' && hidden.data.map((client) => client.id)).toEqual([3])
    expect(shown.status === 'ok' && shown.data.map((client) => client.id)).toEqual([3, 2])
  })

  it('si falla la consulta filtrada devuelve el error y no reemplaza el espejo', async () => {
    const before = getState().clients
    const all = [summary({ id: 1 }), summary({ id: 2 })]
    rustReplies((_, args) => {
      const { query } = (args as { filter: { query: string } }).filter
      if (query !== '') throw new Error('canal caído')
      return all
    })

    const result = await listClients({ query: 'ana', includeDeleted: true })

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().clients).toBe(before)
  })

  it('con consulta arma el resultado solo con filas de la respuesta completa de esa misma operación', async () => {
    const all = [summary({ id: 1 }), summary({ id: 2 })]
    const appearedBetweenCalls = summary({ id: 3, firstName: 'Intermedia' })
    rustReplies((_, args) => {
      const { query } = (args as { filter: { query: string } }).filter
      return query === '' ? all : [all[1], appearedBetweenCalls, all[0]]
    })

    const result = await listClients({ query: 'x', includeDeleted: true })

    expect(result.status === 'ok' && result.data.map((client) => client.id)).toEqual([2, 1])
    expect(getState().clients.map((client) => client.id)).toEqual([1, 2])
  })

  it('con consulta un ticket obsoleto no reemplaza el espejo pero devuelve su propio resultado', async () => {
    const pending: Deferred<unknown>[] = []
    mockIPC(() => {
      const next = deferred<unknown>()
      pending.push(next)
      return next.promise
    })
    const older = listClients({ query: 'viejo', includeDeleted: true })
    const newer = listClients({ query: null, includeDeleted: true })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1]?.resolve([summary({ id: 20, firstName: 'Nueva' })])
    await newer
    pending[0]?.resolve([summary({ id: 10, firstName: 'Vieja' })])
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2]?.resolve([summary({ id: 10, firstName: 'Vieja' })])
    const olderResult = await older

    expect(getState().clients.map((client) => client.id)).toEqual([20])
    expect(olderResult.status === 'ok' && olderResult.data.map((client) => client.id)).toEqual([10])
  })

  it('una búsqueda nunca reduce el espejo a los resultados', async () => {
    const all = [summary({ id: 1 }), summary({ id: 2 }), summary({ id: 3 })]
    rustReplies((_, args) => {
      const { query } = (args as { filter: { query: string } }).filter
      return query === '' ? all : [all[0]]
    })

    await listClients({ query: 'ana', includeDeleted: false })

    expect(getState().clients).toHaveLength(3)
  })

  it('devuelve solo los activos sin includeDeleted y todos con includeDeleted', async () => {
    rustReplies(() => [summary({ id: 1 }), summary({ id: 2, deletedAt: '2026-11-01T10:00' })])

    const hidden = await listClients({ query: null, includeDeleted: false })
    const shown = await listClients({ query: null, includeDeleted: true })

    expect(hidden.status === 'ok' && hidden.data.map((client) => client.id)).toEqual([1])
    expect(shown.status === 'ok' && shown.data.map((client) => client.id)).toEqual([1, 2])
  })

  it('devuelve el error de Rust y no toca el espejo cuando el canal falla', async () => {
    const before = getState().clients
    rustReplies(() => {
      throw new Error('canal caído')
    })

    const result = await listClients({ query: null, includeDeleted: true })

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().clients).toBe(before)
  })

  it('propaga un AppError de Rust sin tocar el espejo', async () => {
    const before = getState().clients
    rustReplies(() => Promise.reject({ code: 'forbidden', message: 'x', field: null, entityIds: null }))

    const result = await listClients({ query: null, includeDeleted: true })

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState().clients).toBe(before)
  })
})

describe('las mutaciones reflejan la fila devuelta por Rust sin tocar el resto', () => {
  it('createClient hace upsert y llama create_client con la entrada', async () => {
    const before = getState().clients
    const calls = rustReplies(() => summary({ id: 90, ...INPUT }))

    await createClient(INPUT)

    expect(calls).toEqual([{ cmd: 'create_client', args: { input: INPUT } }])
    expect(getState().clients).toHaveLength(before.length + 1)
    expect(getState().clients.find((client) => client.id === 90)?.firstName).toBe('Real')
  })

  it('updateClient llama update_client con el id y reemplaza la fila', async () => {
    const calls = rustReplies(() => summary({ id: 1, firstName: 'Cambiada' }))

    await updateClient(1, INPUT)

    expect(calls).toEqual([{ cmd: 'update_client', args: { update: { id: 1, ...INPUT } } }])
    expect(getState().clients.find((client) => client.id === 1)?.firstName).toBe('Cambiada')
    expect(getState().clients).toHaveLength(9)
  })

  it('softDeleteClient y reactivateClient llaman set_client_deleted', async () => {
    const calls = rustReplies(() => summary({ id: 1, deletedAt: null }))

    await softDeleteClient(1)
    await reactivateClient(2)

    expect(calls).toEqual([
      { cmd: 'set_client_deleted', args: { deletion: { id: 1, deleted: true } } },
      { cmd: 'set_client_deleted', args: { deletion: { id: 2, deleted: false } } },
    ])
  })

  it('getClient llama get_client, devuelve la fila y no escribe el espejo', async () => {
    const before = getState().clients
    const calls = rustReplies(() => summary({ id: REAL_ID, firstName: 'Solo en Rust' }))

    const result = await getClient(REAL_ID)

    expect(calls).toEqual([{ cmd: 'get_client', args: { id: REAL_ID } }])
    expect(result).toMatchObject({ status: 'ok', data: { id: REAL_ID, firstName: 'Solo en Rust' } })
    expect(getState().clients).toBe(before)
  })

  it('un list en vuelo sí aplica su reemplazo aunque un getClient termine mientras tanto', async () => {
    const pendingList = deferred<unknown>()
    mockIPC((cmd) => (cmd === 'list_clients' ? pendingList.promise : summary({ id: REAL_ID })))

    const slowList = listClients({ query: null, includeDeleted: true })
    await getClient(REAL_ID)
    pendingList.resolve([summary({ id: 7, firstName: 'De lista' })])
    await slowList

    expect(getState().clients.map((client) => client.id)).toEqual([7])
  })

  it('un error de mutación se devuelve tal cual y no cambia el espejo', async () => {
    const before = getState().clients
    rustReplies(() =>
      Promise.reject({ code: 'nationalIdTaken', message: 'Ya existe un cliente con esa cédula', field: 'nationalId', entityIds: null }),
    )

    const result = await createClient(INPUT)

    expect(result).toMatchObject({ status: 'error', error: { code: 'nationalIdTaken', field: 'nationalId' } })
    expect(getState().clients).toBe(before)
  })

  it('conserva entityIds de clientDeletedReactivate', async () => {
    rustReplies(() =>
      Promise.reject({ code: 'clientDeletedReactivate', message: 'm', field: 'nationalId', entityIds: [9] }),
    )

    expect(await createClient(INPUT)).toMatchObject({
      status: 'error',
      error: { code: 'clientDeletedReactivate', entityIds: [9] },
    })
  })
})
