import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { ClientHistory, Result } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { signInAs } from '@/test/session'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { createPayment } from '@/features/payments/api'
import { getClientHistory } from './api'

const MARIA_ID = 1
const JOSE_ID = 2
const DELETED_CARLOS_ID = 9
const MISSING_ID = 9999
const MARIA_SCHEDULED_APPOINTMENT = 12

type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

function recordInvokedCommands(): string[] {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
  const original = internals.invoke
  const calls: string[] = []
  internals.invoke = (cmd, args) => {
    calls.push(cmd)
    return original(cmd, args)
  }
  return calls
}

function dataOf<T>(result: Result<T>): T {
  if (result.status !== 'ok') throw new Error(`Se esperaba ok, llegó ${result.error.code}`)
  return result.data
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  signInAs('recepcion')
})

function historyOf(result: Result<ClientHistory>): ClientHistory {
  if (result.status !== 'ok') throw new Error(`Se esperaba ok, llegó ${result.error.code}`)
  return result.data
}

function errorCodeOf(result: Result<ClientHistory>): string {
  if (result.status !== 'error') throw new Error('Se esperaba error')
  return result.error.code
}

describe('getClientHistory', () => {
  it('devuelve el historial del cliente con sus citas y pagos', async () => {
    const history = historyOf(await getClientHistory(MARIA_ID))

    expect(history.client.id).toBe(MARIA_ID)
    expect(history.entries.map((entry) => entry.clientId)).toEqual([1, 1, 1])
    expect(history.totalMinutes).toBe(120)
    expect(history.paidByCurrency).toEqual({ USD: 5500, VES: 73000 })
  })

  it('un servicio inactivo con cita completada sigue mostrando su nombre', async () => {
    const history = historyOf(await getClientHistory(JOSE_ID))

    expect(history.entries.map((entry) => entry.serviceName)).toContain('Peeling químico (ejemplo)')
  })

  it('un recurso inactivo sigue resolviendo su nombre', async () => {
    const history = historyOf(await getClientHistory(JOSE_ID))

    expect(history.entries.map((entry) => entry.resourceName)).toContain('Manicure (Rosa)')
  })

  it('incluye a un cliente eliminado con su historial', async () => {
    const history = historyOf(await getClientHistory(DELETED_CARLOS_ID))

    expect(history.client.deletedAt).not.toBeNull()
    expect(history.entries).toHaveLength(1)
  })

  it('ordena de más reciente a más antigua', async () => {
    const history = historyOf(await getClientHistory(MARIA_ID))
    const starts = history.entries.map((entry) => entry.startsAt)

    expect(starts).toEqual(starts.toSorted().toReversed())
  })

  it('devuelve notFound si el cliente no existe', async () => {
    expect(errorCodeOf(await getClientHistory(MISSING_ID))).toBe('notFound')
  })

  it('devuelve unauthenticated sin sesión', async () => {
    commit({ ...getState(), sessionUserId: null })

    expect(errorCodeOf(await getClientHistory(MARIA_ID))).toBe('unauthenticated')
  })

  it('un usuario sin payments.read recibe forbidden', async () => {
    const withoutPayments = getState().users.map((user) =>
      user.username === 'recepcion'
        ? { ...user, permissions: user.permissions.filter((permission) => permission !== 'payments.read') }
        : user,
    )
    commit({ ...getState(), users: withoutPayments })
    signInAs('recepcion')

    expect(errorCodeOf(await getClientHistory(MARIA_ID))).toBe('forbidden')
  })

  it('un usuario sin clients.read recibe forbidden', async () => {
    const withoutClients = getState().users.map((user) =>
      user.username === 'recepcion'
        ? { ...user, permissions: user.permissions.filter((permission) => permission !== 'clients.read') }
        : user,
    )
    commit({ ...getState(), users: withoutClients })
    signInAs('recepcion')

    expect(errorCodeOf(await getClientHistory(MARIA_ID))).toBe('forbidden')
  })

  it('un historial con pendientes y vigentes expone los totales de Rust', async () => {
    const history = historyOf(await getClientHistory(MARIA_ID))

    expect(history.pendingByCurrency).toEqual({ USD: 0, VES: 0 })
    expect(history.collectedOnNonCompletedByCurrency).toEqual({ USD: 0, VES: 0 })
    expect(history.vesUsdEquivalentOfCompleted).toBe(2000)
  })

  it('un adelanto en una cita programada aparece como pendiente tras crearlo', async () => {
    dataOf(await createPayment({ appointmentId: MARIA_SCHEDULED_APPOINTMENT, methodId: 1, currency: 'USD', amountCents: 1500, rateBsPerUsdE4: null }))

    const history = historyOf(await getClientHistory(MARIA_ID))

    expect(history.pendingByCurrency).toEqual({ USD: 1500, VES: 0 })
    expect(history.paidByCurrency).toEqual({ USD: 5500, VES: 73000 })
  })

  it('delega en get_client_history y no consulta nada más', async () => {
    const calls = recordInvokedCommands()

    historyOf(await getClientHistory(MARIA_ID))

    expect(calls).toEqual(['get_client_history'])
  })

  it('no lee ni modifica el store: el historial sale de Rust', async () => {
    commit({ ...getState(), appointments: [], payments: [], clients: [] })
    const before = getState()

    const history = historyOf(await getClientHistory(MARIA_ID))

    expect(history.entries).toHaveLength(3)
    expect(getState()).toBe(before)
  })

  it('un fallo del canal es internal', async () => {
    stubRustCatalog({ failing: ['get_client_history'] })

    expect(errorCodeOf(await getClientHistory(MARIA_ID))).toBe('internal')
  })
})
