import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentUser } from '@/lib/mock/authorize'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { AppError, Resource, ResourceInput } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createResourcesIpcBackend } from '@/test/ipc/resources-backend'
import { createSharedRows } from '@/test/ipc/shared-rows'
import { signInAs } from '@/test/session'
import {
  createResource,
  listFutureAppointmentsOfResource,
  listResources,
  setResourceActive,
  updateResource,
} from './api'

const NOW = '2026-11-12T09:00'
const MANAGER = 'propietaria'
const NO_MANAGE = 'lectura'
const CABIN_WITH_FUTURE = 1
const INACTIVE_MANICURE = 3
const MISSING_ID = 999
const SEED_RESOURCE_COUNT = 3
const RESOURCE_KEYS = ['active', 'id', 'kind', 'name']

const validInput: ResourceInput = { name: 'Sala de masajes', kind: 'cabin' }

let calls: { cmd: string; args: unknown }[]
let thrownByIpc: unknown

function installResourcesIpc(): void {
  const backend = createResourcesIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => currentUser(getState()), resources: getState().resources, appointments: createSharedRows() },
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

function resourceOf(result: Awaited<ReturnType<typeof createResource>>): Resource {
  if (result.status !== 'ok') throw new Error('se esperaba ok')
  return result.data
}

beforeEach(() => {
  freezeDate(NOW)
  resetStore()
  calls = []
  thrownByIpc = undefined
  installResourcesIpc()
})

afterEach(() => clearMocks())

describe('listResources', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await listResources({ includeInactive: true })

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin appointments.read ni resources.manage con forbidden', async () => {
    signInAs(NO_MANAGE)
    commit({
      ...getState(),
      users: getState().users.map((user) =>
        user.username === NO_MANAGE ? { ...user, permissions: ['clients.read'] } : user,
      ),
    })

    const result = await listResources({ includeInactive: true })

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('permite a quien solo tiene appointments.read', async () => {
    signInAs(NO_MANAGE)

    const result = await listResources({ includeInactive: false })

    expect(result.status).toBe('ok')
  })

  it('pide siempre la colección completa a list_resources sea cual sea el filtro del llamador', async () => {
    signInAs(MANAGER)

    await listResources({ includeInactive: false })
    await listResources({ includeInactive: true })

    expect(calls).toEqual([
      { cmd: 'list_resources', args: { filter: { includeInactive: true } } },
      { cmd: 'list_resources', args: { filter: { includeInactive: true } } },
    ])
  })

  it('oculta inactivos con includeInactive false', async () => {
    signInAs(MANAGER)

    const result = await listResources({ includeInactive: false })

    expect(result.status === 'ok' && result.data.map((resource) => resource.id)).toEqual([1, 2])
  })

  it('incluye inactivos con includeInactive true', async () => {
    signInAs(MANAGER)

    const result = await listResources({ includeInactive: true })

    expect(result.status === 'ok' && result.data.map((resource) => resource.id)).toEqual([1, 2, 3])
  })

  it('devuelve solo los campos de Resource, sin las marcas de tiempo de Rust', async () => {
    signInAs(MANAGER)

    const result = await listResources({ includeInactive: true })

    expect(result.status === 'ok' && result.data.map((resource) => Object.keys(resource).sort())).toEqual(
      Array.from({ length: SEED_RESOURCE_COUNT }, () => RESOURCE_KEYS),
    )
  })

  it('con includeInactive false refleja la colección completa en el store y devuelve solo los activos', async () => {
    signInAs(MANAGER)
    const stale = getState().resources.map((resource) => (resource.id === 1 ? { ...resource, name: 'Nombre viejo' } : resource))
    commit({ ...getState(), resources: stale })

    const result = await listResources({ includeInactive: false })

    expect(getState().resources).toHaveLength(SEED_RESOURCE_COUNT)
    expect(getState().resources.find((resource) => resource.id === 1)?.name).toBe('Cabina 1')
    expect(getState().resources.find((resource) => resource.id === INACTIVE_MANICURE)?.active).toBe(false)
    expect(result.status === 'ok' && result.data).toHaveLength(SEED_RESOURCE_COUNT - 1)
    expect(result.status === 'ok' && result.data.every((resource) => resource.active)).toBe(true)
  })

  it('no toca el mock cuando Rust responde con error', async () => {
    const before = getState()

    await listResources({ includeInactive: true })

    expect(getState()).toBe(before)
  })

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)('entrega %s del backend intacto', async (code) => {
    thrownByIpc = appError(code)

    expect(await listResources({ includeInactive: true })).toEqual({ status: 'error', error: appError(code) })
  })

  it('convierte un fallo del canal en internal', async () => {
    thrownByIpc = new Error('canal caído')

    expect(await listResources({ includeInactive: true })).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('createResource', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await createResource(validInput)

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin resources.manage con forbidden y no escribe', async () => {
    signInAs(NO_MANAGE)
    const before = getState()

    const result = await createResource(validInput)

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('envía la entrada en la clave input del comando create_resource', async () => {
    signInAs(MANAGER)

    await createResource(validInput)

    expect(calls).toEqual([{ cmd: 'create_resource', args: { input: validInput } }])
  })

  it.each([
    ['name', { ...validInput, name: '  ' }],
    ['name', { ...validInput, name: 'Cabina 1' }],
    ['kind', { ...validInput, kind: 'sauna' as 'cabin' }],
  ] as const)('mapea validation del campo %s y no toca el mock', async (field, input) => {
    signInAs(MANAGER)
    const before = getState()

    const result = await createResource(input)

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field } })
    expect(getState().resources).toBe(before.resources)
  })

  it('crea un recurso activo con id siguiente y nombre recortado, y lo refleja en el mock', async () => {
    signInAs(MANAGER)
    const before = getState()

    const result = await createResource({ name: '  Cabina 3  ', kind: 'cabin' })

    expect(result).toEqual({ status: 'ok', data: { id: 4, name: 'Cabina 3', kind: 'cabin', active: true } })
    expect(before.resources).toHaveLength(SEED_RESOURCE_COUNT)
    expect(getState().resources).toHaveLength(SEED_RESOURCE_COUNT + 1)
    expect(getState().resources.at(-1)).toEqual(resourceOf(result))
    expect(getState().appointments).toBe(before.appointments)
  })

  it('convierte un fallo del canal en internal y no toca el mock', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await createResource(validInput)).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().resources).toBe(before.resources)
  })

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)('entrega %s del backend intacto', async (code) => {
    thrownByIpc = appError(code)

    expect(await createResource(validInput)).toEqual({ status: 'error', error: appError(code) })
  })
})

describe('updateResource', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await updateResource(1, { name: 'Nueva', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin resources.manage con forbidden', async () => {
    signInAs(NO_MANAGE)
    const before = getState()

    const result = await updateResource(1, { name: 'Nueva', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState().resources).toBe(before.resources)
  })

  it('envía id y datos aplanados en la clave update del comando update_resource', async () => {
    signInAs(MANAGER)

    await updateResource(1, validInput)

    expect(calls).toEqual([{ cmd: 'update_resource', args: { update: { id: 1, ...validInput } } }])
  })

  it.each([
    ['name', { ...validInput, name: '' }],
    ['name', { ...validInput, name: 'Cabina 2' }],
    ['kind', { ...validInput, kind: 'sauna' as 'cabin' }],
  ] as const)('mapea validation del campo %s', async (field, input) => {
    signInAs(MANAGER)

    expect(await updateResource(1, input)).toMatchObject({ status: 'error', error: { code: 'validation', field } })
  })

  it('un id inexistente llega como validation con field id y no como notFound', async () => {
    signInAs(MANAGER)
    const before = getState()

    const result = await updateResource(MISSING_ID, validInput)

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'id' } })
    expect(getState().resources).toBe(before.resources)
  })

  it('un id inexistente gana a los datos inválidos', async () => {
    signInAs(MANAGER)

    const result = await updateResource(MISSING_ID, { name: '', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'id' } })
  })

  it('actualiza nombre y kind conservando active e id', async () => {
    signInAs(MANAGER)

    const result = await updateResource(INACTIVE_MANICURE, { name: 'Manicure 2', kind: 'manicure' })

    expect(result).toEqual({
      status: 'ok',
      data: { id: INACTIVE_MANICURE, name: 'Manicure 2', kind: 'manicure', active: false },
    })
  })

  it('refleja el cambio en el mock sin mutar la fila previa ni tocar las citas', async () => {
    signInAs(MANAGER)
    const before = getState()
    const previousRow = before.resources[0]
    const previousOther = before.resources[1]

    const result = await updateResource(1, { name: 'Renombrada', kind: 'cabin' })

    expect(previousRow?.name).toBe('Cabina 1')
    expect(getState().resources[0]).toEqual(resourceOf(result))
    expect(getState().resources[1]).toBe(previousOther)
    expect(getState().appointments).toBe(before.appointments)
  })

  it('convierte un fallo del canal en internal y no toca el mock', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await updateResource(1, validInput)).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().resources).toBe(before.resources)
  })
})

describe('setResourceActive', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await setResourceActive(1, false)

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin resources.manage con forbidden', async () => {
    signInAs(NO_MANAGE)

    const result = await setResourceActive(1, false)

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('envía id y estado en la clave activation del comando set_resource_active', async () => {
    signInAs(MANAGER)

    await setResourceActive(1, false)

    expect(calls).toEqual([{ cmd: 'set_resource_active', args: { activation: { id: 1, active: false } } }])
  })

  it.each([false, true])('un id inexistente con active %s llega como validation con field id', async (active) => {
    signInAs(MANAGER)

    const result = await setResourceActive(MISSING_ID, active)

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'id' } })
    expect(result).not.toMatchObject({ error: { code: 'notFound' } })
  })

  it('desactiva un recurso sin citas futuras y lo refleja en el mock', async () => {
    signInAs(MANAGER)
    const previousRow = getState().resources[0]

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'ok', data: { id: CABIN_WITH_FUTURE, active: false } })
    expect(previousRow?.active).toBe(true)
    expect(getState().resources.find((resource) => resource.id === CABIN_WITH_FUTURE)?.active).toBe(false)
    expect(getState().resources).toHaveLength(SEED_RESOURCE_COUNT)
  })

  it('reactivar siempre está permitido y no consulta bloqueos', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(INACTIVE_MANICURE, true)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_MANICURE, active: true } })
    expect(getState().resources.find((resource) => resource.id === INACTIVE_MANICURE)?.active).toBe(true)
  })

  it('reactivar un recurso con citas futuras llama a Rust y no bloquea', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(CABIN_WITH_FUTURE, true)

    expect(result).toMatchObject({ status: 'ok', data: { active: true } })
    expect(calls).toHaveLength(1)
  })

  it('convierte un fallo del canal en internal y no toca el mock', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await setResourceActive(1, false)).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().resources).toBe(before.resources)
  })
})


describe('setResourceActive: la guarda de citas futuras la decide Rust', () => {
  it('con citas futuras en el espejo de citas no bloquea localmente y solo llama a set_resource_active', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'ok', data: { active: false } })
    expect(calls).toEqual([{ cmd: 'set_resource_active', args: { activation: { id: CABIN_WITH_FUTURE, active: false } } }])
  })

  it('entrega resourceHasFutureAppointments con sus entityIds tal como lo devuelve Rust y no toca el espejo', async () => {
    signInAs(MANAGER)
    const rustError: AppError = {
      code: 'resourceHasFutureAppointments',
      message: 'mensaje de Rust',
      field: null,
      entityIds: [7, 8],
    }
    thrownByIpc = rustError
    const before = getState()

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toEqual({ status: 'error', error: rustError })
    expect(getState().resources).toBe(before.resources)
  })

  it.each(['sessionLocked', 'unauthenticated', 'forbidden', 'internal'] as const)(
    'entrega el error %s de Rust sin consultas previas',
    async (code) => {
      signInAs(MANAGER)
      thrownByIpc = appError(code)

      const result = await setResourceActive(CABIN_WITH_FUTURE, false)

      expect(result).toEqual({ status: 'error', error: appError(code) })
      expect(calls.map((call) => call.cmd)).toEqual(['set_resource_active'])
    },
  )
})

describe('listFutureAppointmentsOfResource', () => {
  const rustFuture = [
    { id: 5, startsAt: '2026-11-13T16:00' },
    { id: 9, startsAt: '2026-11-14T10:00' },
  ]

  it('delega en list_future_appointments_of_resource con el id y devuelve lo que responde Rust', async () => {
    clearMocks()
    mockIPC((cmd, args) => {
      calls.push({ cmd, args })
      return rustFuture
    })

    const result = await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)

    expect(calls).toEqual([{ cmd: 'list_future_appointments_of_resource', args: { id: CABIN_WITH_FUTURE } }])
    expect(result).toEqual({ status: 'ok', data: rustFuture })
  })

  it.each(['sessionLocked', 'unauthenticated', 'forbidden', 'validation', 'internal'] as const)(
    'entrega el error %s de Rust y ninguna cita',
    async (code) => {
      signInAs(MANAGER)
      thrownByIpc = appError(code)

      expect(await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)).toEqual({
        status: 'error',
        error: appError(code),
      })
    },
  )

  it('un fallo del canal es internal', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')

    expect(await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)).toMatchObject({
      status: 'error',
      error: { code: 'internal' },
    })
  })

  it('con el backend simulado rechaza sin resources.manage con forbidden y recurso inexistente con validation id', async () => {
    signInAs(NO_MANAGE)
    const forbidden = await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)
    signInAs(MANAGER)
    const missing = await listFutureAppointmentsOfResource(MISSING_ID)

    expect(forbidden).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(missing).toMatchObject({ status: 'error', error: { code: 'validation', field: 'id' } })
  })
})
