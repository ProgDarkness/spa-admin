import { invoke } from '@tauri-apps/api/core'
import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { freezeDate } from '@/test/clock'
import { commit, EMPTY_STATE, getState, resetStore } from '@/lib/mock/store'
import {
  clientIdentitiesOf,
  EXPECTED_DEV_CLIENTS,
  EXPECTED_DEV_PAYMENT_METHODS,
  EXPECTED_DEV_RATES,
  EXPECTED_DEV_RESOURCES,
  EXPECTED_DEV_SERVICES,
  paymentMethodIdentitiesOf,
  rateIdentitiesOf,
  SEED_REFERENCE_DATE,
  resourceIdentitiesOf,
  serviceIdentitiesOf,
} from './dev-seed-expectations'
import { DEV_BROWSER_BACKEND_CACHE, DEV_BROWSER_IPC_SENTINEL, installDevBrowserIpc } from './dev-browser-ipc'

type TauriWindow = { __TAURI_INTERNALS__?: unknown }

const OWNER_CREDENTIALS = { credentials: { username: 'propietaria', password: DEV_PASSWORD } }

function internals(): unknown {
  return (window as TauriWindow).__TAURI_INTERNALS__
}

beforeEach(() => {
  resetStore()
  clearMocks()
  delete (window as TauriWindow).__TAURI_INTERNALS__
  Reflect.deleteProperty(window, DEV_BROWSER_IPC_SENTINEL)
  Reflect.deleteProperty(window, DEV_BROWSER_BACKEND_CACHE)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('installDevBrowserIpc', () => {
  it('se instala en desarrollo sin internals y permite iniciar sesión con los usuarios de ejemplo', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const installed = installDevBrowserIpc()

    expect(installed).toBe(true)
    await expect(invoke('login', OWNER_CREDENTIALS)).resolves.toMatchObject({ username: 'propietaria' })
    expect(getState().sessionUserId).toBe(1)
  })

  it('siembra el store vacío con el seed de ejemplo al instalarse', () => {
    vi.stubEnv('NODE_ENV', 'development')
    commit(EMPTY_STATE)

    installDevBrowserIpc()

    expect(getState().users.length).toBeGreaterThan(0)
    expect(getState().clients.length).toBeGreaterThan(0)
  })

  it('no pisa un estado ya mutado al instalarse', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const mutated = { ...EMPTY_STATE, clients: [], sessionUserId: 7 }
    commit(mutated)

    installDevBrowserIpc()

    expect(getState()).toBe(mutated)
  })

  it('instalarse dos veces conserva el estado sembrado por la primera', () => {
    vi.stubEnv('NODE_ENV', 'development')
    commit(EMPTY_STATE)
    installDevBrowserIpc()
    const afterFirstInstall = getState()

    installDevBrowserIpc()

    expect(getState()).toBe(afterFirstInstall)
  })

  it('responde setup_status sin primer arranque pendiente y registra la actividad', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()

    await expect(invoke('setup_status')).resolves.toEqual({ needsOwner: false, clockRollback: null })
    await expect(invoke('record_activity')).resolves.toBeNull()
  })

  it('setup_owner con usuarios existentes agrega nada y falla forbidden', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()
    const before = getState().users

    await expect(invoke('setup_owner', { input: { username: 'x', password: 'una-clave-larga' } })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(getState().users).toBe(before)
  })

  it('setup_owner sobre un store vacío agrega la propietaria al mock', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    commit({ ...getState(), users: [] })
    installDevBrowserIpc()

    await invoke('setup_owner', { input: { username: 'dueña', password: 'una-clave-larga' } })

    expect(getState().users.map((user) => user.username)).toEqual(['dueña'])
    expect(getState().sessionUserId).toBe(getState().users[0]?.id)
  })

  it('atiende los comandos de catálogo con la sesión iniciada y rechaza sin sesión', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()

    await expect(invoke('list_services', { filter: { includeInactive: true } })).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    await invoke('login', OWNER_CREDENTIALS)
    const services = await invoke('list_services', { filter: { includeInactive: true } })

    expect(serviceIdentitiesOf(services)).toEqual(EXPECTED_DEV_SERVICES)
  })

  it('atiende los comandos de recursos con la sesión iniciada y rechaza sin sesión', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()

    await expect(invoke('list_resources', { filter: { includeInactive: true } })).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    await invoke('login', OWNER_CREDENTIALS)
    const resources = await invoke('list_resources', { filter: { includeInactive: true } })

    expect(resourceIdentitiesOf(resources)).toEqual(EXPECTED_DEV_RESOURCES)
  })

  it('atiende los comandos de métodos de pago con la sesión iniciada y rechaza sin sesión', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()

    await expect(invoke('list_payment_methods', { filter: { includeInactive: true } })).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    await invoke('login', OWNER_CREDENTIALS)
    const methods = await invoke('list_payment_methods', { filter: { includeInactive: true } })

    expect(paymentMethodIdentitiesOf(methods)).toEqual(EXPECTED_DEV_PAYMENT_METHODS)
  })

  it('atiende los comandos de tasas con la sesión iniciada y rechaza sin sesión', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    freezeDate(`${SEED_REFERENCE_DATE}T09:00`)
    resetStore()
    installDevBrowserIpc()

    await expect(invoke('list_rates')).rejects.toMatchObject({ code: 'unauthenticated' })
    await invoke('login', OWNER_CREDENTIALS)
    const rates = await invoke('list_rates')

    expect(rateIdentitiesOf(rates)).toEqual(EXPECTED_DEV_RATES)
  })

  it('atiende los comandos de clientes con los nueve del seed, el noveno eliminado, y rechaza sin sesión', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    freezeDate(`${SEED_REFERENCE_DATE}T09:00`)
    resetStore()
    installDevBrowserIpc()
    const listAll = { filter: { query: '', includeDeleted: true } }

    await expect(invoke('list_clients', listAll)).rejects.toMatchObject({ code: 'unauthenticated' })
    await invoke('login', OWNER_CREDENTIALS)
    const clients = await invoke('list_clients', listAll)

    expect(clientIdentitiesOf(clients)).toEqual(EXPECTED_DEV_CLIENTS)
    expect(EXPECTED_DEV_CLIENTS.map((client) => client.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(EXPECTED_DEV_CLIENTS.filter((client) => client.deleted).map((client) => client.id)).toEqual([9])
  })

  it('una reinstalación con el store ya sembrado conserva las citas creadas', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()
    await invoke('login', OWNER_CREDENTIALS)
    const created = (await invoke('create_appointment', {
      input: { clientId: 1, serviceId: 1, resourceId: 1, startsAt: '2026-11-20T10:00', notes: null },
    })) as { id: number }
    clearMocks()
    delete (window as TauriWindow).__TAURI_INTERNALS__

    const reinstalled = installDevBrowserIpc()

    const listed = (await invoke('list_appointments', {
      range: { from: '2026-11-20', to: '2026-11-20', resourceId: null },
    })) as { id: number }[]
    expect(reinstalled).toBe(true)
    expect(listed.map((row) => row.id)).toEqual([created.id])
  })

  it('marca window con el centinela al instalarse', () => {
    vi.stubEnv('NODE_ENV', 'development')

    installDevBrowserIpc()

    expect(Reflect.get(window, DEV_BROWSER_IPC_SENTINEL)).toBe(true)
  })

  it('no marca window con el centinela si no se instala', () => {
    vi.stubEnv('NODE_ENV', 'production')

    installDevBrowserIpc()

    expect(DEV_BROWSER_IPC_SENTINEL in window).toBe(false)
  })

  it('no se instala si ya hay internals de Tauri', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const nativeInternals = { invoke: vi.fn() }
    ;(window as TauriWindow).__TAURI_INTERNALS__ = nativeInternals

    const installed = installDevBrowserIpc()

    expect(installed).toBe(false)
    expect(internals()).toBe(nativeInternals)
  })

  it.each(['production', 'test'])('no se instala con NODE_ENV %s', (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)

    const installed = installDevBrowserIpc()

    expect(installed).toBe(false)
    expect(internals()).toBeUndefined()
  })
})
