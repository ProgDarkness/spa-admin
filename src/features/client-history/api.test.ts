import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { ClientHistory, Result } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { getClientHistory } from './api'

const MARIA_ID = 1
const JOSE_ID = 2
const DELETED_CARLOS_ID = 9
const MISSING_ID = 9999

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
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

  it('no modifica el store', async () => {
    const before = getState()

    await getClientHistory(MARIA_ID)

    expect(getState()).toBe(before)
  })
})
