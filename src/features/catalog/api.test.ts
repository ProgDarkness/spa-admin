import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentUser } from '@/lib/mock/authorize'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { AppError, Service, ServiceInput } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createCatalogIpcBackend } from '@/test/ipc/catalog-backend'
import { signInAs } from '@/test/session'
import { createService, listServices, setServiceActive, updateService } from './api'

const validInput: ServiceInput = { name: 'Depilación', priceCents: 2_500, durationMin: 30 }
const INACTIVE_SEED_ID = 8
const SEED_SERVICE_COUNT = 8
const SEED_ACTIVE_COUNT = 7
const SERVICE_KEYS = ['active', 'currency', 'durationMin', 'id', 'name', 'priceCents']

let calls: { cmd: string; args: unknown }[]
let thrownByIpc: unknown

function installCatalogIpc(): void {
  const backend = createCatalogIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => currentUser(getState()), services: getState().services },
  )
  mockIPC((cmd, args) => {
    calls.push({ cmd, args })
    if (thrownByIpc !== undefined) throw thrownByIpc
    return backend(cmd, args)
  })
}

function appError(code: AppError['code'], field: string | null = null): AppError {
  return { code, message: 'mensaje del backend', field, entityIds: null }
}

function serviceOf(result: Awaited<ReturnType<typeof createService>>): Service {
  if (result.status !== 'ok') throw new Error('se esperaba ok')
  return result.data
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  calls = []
  thrownByIpc = undefined
  installCatalogIpc()
})

afterEach(() => clearMocks())

describe('listServices', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await listServices({ includeInactive: true })).toMatchObject({
      status: 'error',
      error: { code: 'unauthenticated' },
    })
  })

  it('pide siempre la colección completa a list_services sea cual sea el filtro del llamador', async () => {
    signInAs('lectura')

    await listServices({ includeInactive: false })
    await listServices({ includeInactive: true })

    expect(calls).toEqual([
      { cmd: 'list_services', args: { filter: { includeInactive: true } } },
      { cmd: 'list_services', args: { filter: { includeInactive: true } } },
    ])
  })

  it('incluye inactivos con includeInactive true', async () => {
    signInAs('lectura')

    const result = await listServices({ includeInactive: true })

    expect(result.status === 'ok' && result.data).toHaveLength(SEED_SERVICE_COUNT)
    expect(result.status === 'ok' && result.data.some((service) => !service.active)).toBe(true)
  })

  it('excluye inactivos con includeInactive false', async () => {
    signInAs('recepcion')

    const result = await listServices({ includeInactive: false })

    expect(result.status === 'ok' && result.data).toHaveLength(SEED_ACTIVE_COUNT)
    expect(result.status === 'ok' && result.data.every((service) => service.active)).toBe(true)
  })

  it('devuelve solo los campos de Service, sin las marcas de tiempo de Rust', async () => {
    signInAs('lectura')

    const result = await listServices({ includeInactive: true })

    expect(result.status === 'ok' && result.data.map((service) => Object.keys(service).sort())).toEqual(
      Array.from({ length: SEED_SERVICE_COUNT }, () => SERVICE_KEYS),
    )
  })

  it('con includeInactive false refleja la colección completa en el store y devuelve solo los activos', async () => {
    signInAs('lectura')
    const stale = getState().services.map((service) => (service.id === 1 ? { ...service, name: 'Nombre viejo' } : service))
    commit({ ...getState(), services: stale })

    const result = await listServices({ includeInactive: false })

    expect(getState().services).toHaveLength(SEED_SERVICE_COUNT)
    expect(getState().services.find((service) => service.id === 1)?.name).toBe('Limpieza facial (ejemplo)')
    expect(getState().services.find((service) => service.id === INACTIVE_SEED_ID)?.active).toBe(false)
    expect(result.status === 'ok' && result.data).toHaveLength(SEED_ACTIVE_COUNT)
    expect(result.status === 'ok' && result.data.every((service) => service.active)).toBe(true)
  })

  it('no toca el mock cuando Rust responde con error', async () => {
    const before = getState()

    await listServices({ includeInactive: true })

    expect(getState()).toBe(before)
  })

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)('entrega %s del backend intacto', async (code) => {
    thrownByIpc = appError(code)

    expect(await listServices({ includeInactive: true })).toEqual({ status: 'error', error: appError(code) })
  })

  it('convierte un fallo del canal en internal', async () => {
    thrownByIpc = new Error('canal caído')

    expect(await listServices({ includeInactive: true })).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('createService', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza con forbidden a lectura y a recepción sin cambiar el estado', async () => {
    const before = getState()
    signInAs('lectura')
    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    signInAs('recepcion')
    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })

    expect(getState().services).toBe(before.services)
  })

  it('envía la entrada en la clave input del comando create_service', async () => {
    signInAs('propietaria')

    await createService(validInput)

    expect(calls).toEqual([{ cmd: 'create_service', args: { input: validInput } }])
  })

  it.each([
    ['name', { ...validInput, name: '' }],
    ['priceCents', { ...validInput, priceCents: 0 }],
    ['durationMin', { ...validInput, durationMin: 12 }],
    ['name', { ...validInput, name: 'Limpieza facial (ejemplo)' }],
  ] as const)('mapea validation del campo %s y no toca el mock', async (field, input) => {
    signInAs('propietaria')
    const before = getState()

    const result = await createService(input)

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field } })
    expect(getState().services).toBe(before.services)
  })

  it('crea un servicio activo en USD y lo refleja en el mock sin mutar el estado previo', async () => {
    signInAs('propietaria')
    const before = getState()
    const previousServices = before.services

    const result = await createService({ ...validInput, name: '  Depilación  ' })

    expect(result).toEqual({
      status: 'ok',
      data: { id: 9, name: 'Depilación', priceCents: 2_500, currency: 'USD', durationMin: 30, active: true },
    })
    expect(previousServices).toHaveLength(SEED_SERVICE_COUNT)
    expect(before.services).toBe(previousServices)
    expect(getState().services).toHaveLength(SEED_SERVICE_COUNT + 1)
    expect(getState().services.at(-1)).toEqual(serviceOf(result))
    expect(getState().appointments).toBe(before.appointments)
  })

  it('convierte un fallo del canal en internal y no toca el mock', async () => {
    signInAs('propietaria')
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().services).toBe(before.services)
  })
})

describe('updateService', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await updateService(1, validInput)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza con forbidden al usuario de lectura', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await updateService(1, validInput)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState().services).toBe(before.services)
  })

  it('envía id y datos aplanados en la clave update del comando update_service', async () => {
    signInAs('propietaria')

    await updateService(1, validInput)

    expect(calls).toEqual([{ cmd: 'update_service', args: { update: { id: 1, ...validInput } } }])
  })

  it.each([
    ['name', { ...validInput, name: '' }],
    ['priceCents', { ...validInput, priceCents: 0 }],
    ['durationMin', { ...validInput, durationMin: 12 }],
    ['name', { ...validInput, name: 'Masaje relajante (ejemplo)' }],
  ] as const)('mapea validation del campo %s', async (field, input) => {
    signInAs('propietaria')

    expect(await updateService(1, input)).toMatchObject({ status: 'error', error: { code: 'validation', field } })
  })

  it('un id inexistente llega como validation con field id y no como notFound', async () => {
    signInAs('propietaria')
    const before = getState()

    const result = await updateService(999, validInput)

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'id' } })
    expect(getState().services).toBe(before.services)
  })

  it('actualiza solo el servicio objetivo sin mutar referencias previas', async () => {
    signInAs('propietaria')
    const before = getState()
    const previousTarget = before.services[0]
    const previousOther = before.services[1]

    const result = await updateService(1, validInput)

    expect(result).toMatchObject({ status: 'ok', data: { id: 1, ...validInput, active: true } })
    expect(before.services[0]).toBe(previousTarget)
    expect(previousTarget?.name).toBe('Limpieza facial (ejemplo)')
    expect(getState().services[0]).toEqual(serviceOf(result))
    expect(getState().services[1]).toBe(previousOther)
  })

  it('conserva el estado activo del servicio', async () => {
    signInAs('propietaria')

    const result = await updateService(INACTIVE_SEED_ID, validInput)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, active: false } })
  })

  it('no altera los snapshots de precio y duración de las citas existentes', async () => {
    signInAs('propietaria')
    const before = getState()
    const affected = before.appointments.filter((appointment) => appointment.serviceId === 1)
    expect(affected.length).toBeGreaterThan(0)

    await updateService(1, { name: 'Limpieza premium', priceCents: 9_900, durationMin: 120 })

    const after = getState().appointments
    expect(after).toBe(before.appointments)
    affected.forEach((appointment) => {
      const current = after.find((candidate) => candidate.id === appointment.id)
      expect(current?.priceCentsSnapshot).toBe(appointment.priceCentsSnapshot)
      expect(current?.durationMinSnapshot).toBe(appointment.durationMinSnapshot)
      expect(current?.endsAt).toBe(appointment.endsAt)
    })
    expect(getState().services[0]?.priceCents).toBe(9_900)
  })
})

describe('setServiceActive', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await setServiceActive(1, false)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza con forbidden al usuario de lectura', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await setServiceActive(1, false)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState().services).toBe(before.services)
  })

  it('envía id y estado en la clave activation del comando set_service_active', async () => {
    signInAs('propietaria')

    await setServiceActive(1, false)

    expect(calls).toEqual([{ cmd: 'set_service_active', args: { activation: { id: 1, active: false } } }])
  })

  it('un id inexistente llega como validation con field id y no como notFound', async () => {
    signInAs('propietaria')

    expect(await setServiceActive(999, false)).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'id' },
    })
  })

  it('desactiva sin borrar: sigue en el listado con includeInactive', async () => {
    signInAs('propietaria')
    const before = getState()

    const result = await setServiceActive(1, false)

    expect(result).toMatchObject({ status: 'ok', data: { id: 1, active: false } })
    expect(before.services[0]?.active).toBe(true)
    expect(getState().services).toHaveLength(SEED_SERVICE_COUNT)
    expect(getState().services[0]?.active).toBe(false)
    const all = await listServices({ includeInactive: true })
    const active = await listServices({ includeInactive: false })
    expect(all.status === 'ok' && all.data.find((service) => service.id === 1)?.active).toBe(false)
    expect(active.status === 'ok' && active.data.some((service) => service.id === 1)).toBe(false)
  })

  it('reactiva un servicio inactivo', async () => {
    signInAs('propietaria')

    const result = await setServiceActive(INACTIVE_SEED_ID, true)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, active: true } })
    expect(getState().services.find((service) => service.id === INACTIVE_SEED_ID)?.active).toBe(true)
  })

  it('es idempotente y no toca citas', async () => {
    signInAs('propietaria')
    const before = getState()

    const result = await setServiceActive(1, true)

    expect(result).toMatchObject({ status: 'ok', data: { id: 1, active: true } })
    expect(getState().appointments).toBe(before.appointments)
  })
})
