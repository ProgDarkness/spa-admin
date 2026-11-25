import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listServices } from '@/features/catalog/api'
import { listResources } from '@/features/resources/api'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Client } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { signInAs } from '@/test/session'
import { getClientHistory } from './api'

const JOSE_ID = 2
const INACTIVE_SERVICE_NAME = 'Peeling químico (ejemplo)'
const INACTIVE_RESOURCE_NAME = 'Manicure (Rosa)'

async function entriesOfJose() {
  const history = await getClientHistory(JOSE_ID)
  if (history.status !== 'ok') throw new Error('se esperaba ok')
  return history.data.entries
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  signInAs('recepcion')
  stubRustCatalog({ services: getState().services, resources: getState().resources })
})
afterEach(() => clearMocks())

describe('getClientHistory tras listar solo activos', () => {
  it('conserva el nombre del servicio inactivo con cita pasada', async () => {
    await listServices({ includeInactive: false })

    expect((await entriesOfJose()).map((entry) => entry.serviceName)).toContain(INACTIVE_SERVICE_NAME)
  })

  it('conserva el nombre del recurso inactivo con cita pasada', async () => {
    await listResources({ includeInactive: false })

    expect((await entriesOfJose()).map((entry) => entry.resourceName)).toContain(INACTIVE_RESOURCE_NAME)
  })
})

function rustClient(overrides: Partial<Client> = {}): Client {
  return {
    id: JOSE_ID,
    firstName: 'José',
    lastName: 'Actualizado en Rust',
    nationalId: 'V-14567890',
    phone: '0424-2345678',
    deletedAt: null,
    ...overrides,
  }
}

describe('getClientHistory refresca el cliente desde Rust', () => {
  it('usa los datos del cliente que devuelve Rust y no los del espejo', async () => {
    stubRustCatalog({
      services: getState().services,
      resources: getState().resources,
      clients: [rustClient()],
    })

    const history = await getClientHistory(JOSE_ID)

    expect(history).toMatchObject({ status: 'ok', data: { client: { lastName: 'Actualizado en Rust' } } })
    expect(getState().clients.find((client) => client.id === JOSE_ID)?.lastName).not.toBe('Actualizado en Rust')
  })

  it('arma el historial de un cliente que solo existe en Rust', async () => {
    commit({ ...getState(), clients: [] })
    stubRustCatalog({ services: getState().services, resources: getState().resources, clients: [rustClient()] })

    const history = await getClientHistory(JOSE_ID)

    expect(history.status).toBe('ok')
    expect((await entriesOfJose()).length).toBeGreaterThan(0)
  })

  it('consulta get_client con el id pedido y luego sincroniza citas', async () => {
    const calls = stubRustCatalog({ clients: [rustClient()] })

    await getClientHistory(JOSE_ID)

    expect(calls).toEqual(['get_client', 'list_all_appointments'])
  })

  it('responde notFound si Rust no tiene al cliente aunque el espejo sí', async () => {
    stubRustCatalog({ clients: [] })

    expect(await getClientHistory(JOSE_ID)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('devuelve el error y no arma historial si falla get_client', async () => {
    stubRustCatalog({ clients: [rustClient()], failing: ['get_client'] })

    expect(await getClientHistory(JOSE_ID)).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })

  it('re-autoriza tras el refresco: si la sesión se cierra durante get_client responde unauthenticated', async () => {
    mockIPC((cmd) => {
      if (cmd !== 'get_client') return null
      commit({ ...getState(), sessionUserId: null })
      return rustClient()
    })

    expect(await getClientHistory(JOSE_ID)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('no consulta a Rust sin los permisos requeridos', async () => {
    signInAs('lectura')
    commit({
      ...getState(),
      users: getState().users.map((user) =>
        user.username === 'lectura' ? { ...user, permissions: ['clients.read'] } : user,
      ),
    })
    const calls: string[] = []
    mockIPC((cmd) => {
      calls.push(cmd)
      return null
    })

    expect(await getClientHistory(JOSE_ID)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(calls).toEqual([])
  })
})

describe('getClientHistory sincroniza las citas desde Rust', () => {
  it('arma las entradas con las citas de Rust y no con las del espejo', async () => {
    const rustAppointment = { ...getState().appointments[0]!, id: 700, clientId: JOSE_ID }
    stubRustCatalog({
      services: getState().services,
      resources: getState().resources,
      clients: [rustClient()],
      appointments: [rustAppointment],
    })

    const entries = await entriesOfJose()

    expect(entries.map((entry) => entry.id)).toEqual([700])
  })

  it('consulta get_client y luego list_all_appointments', async () => {
    const calls = stubRustCatalog({ clients: [rustClient()] })

    await getClientHistory(JOSE_ID)

    expect(calls).toEqual(['get_client', 'list_all_appointments'])
  })

  it('devuelve el error y no arma historial si falla list_all_appointments', async () => {
    stubRustCatalog({ clients: [rustClient()], failing: ['list_all_appointments'] })

    expect(await getClientHistory(JOSE_ID)).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('getClientHistory lee el store una sola vez al final', () => {
  it('muestra un pago reflejado en el store mientras corrían get_client y la sincronización', async () => {
    const appointment = getState().appointments.find((row) => row.clientId === JOSE_ID)
    if (!appointment) throw new Error('el seed debe tener una cita de José')
    const lateNote = 'pago tardío'
    mockIPC((cmd) => {
      if (cmd === 'get_client') return rustClient()
      commit({
        ...getState(),
        payments: [
          ...getState().payments,
          {
            id: 900,
            appointmentId: appointment.id,
            methodId: 1,
            currency: 'USD',
            amountCents: 100,
            rateBsPerUsdE4: null,
            usdEquivalentCents: 100,
            paidAt: '2026-11-12T09:00',
            voidedAt: null,
            voidedBy: null,
            voidReason: lateNote,
          },
        ],
      })
      return getState().appointments
    })

    const entry = (await entriesOfJose()).find((candidate) => candidate.id === appointment.id)

    expect(entry?.payments.map((payment) => payment.id)).toContain(900)
  })
})
