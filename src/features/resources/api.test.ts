import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentUser } from '@/lib/mock/authorize'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Appointment, AppError, Id, Resource, ResourceInput } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createResourcesIpcBackend } from '@/test/ipc/resources-backend'
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
const CABIN_ALSO_WITH_FUTURE = 2
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
    { session: () => currentUser(getState()), resources: getState().resources },
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

function appointmentsOf(resourceId: Id): Appointment[] {
  return getState().appointments.filter((appointment) => appointment.resourceId === resourceId)
}

function withAppointments(rows: readonly Appointment[]): void {
  commit({ ...getState(), appointments: rows })
}

function appointmentTemplate(overrides: Partial<Appointment>): Appointment {
  return {
    id: 100,
    clientId: 1,
    serviceId: 1,
    resourceId: CABIN_WITH_FUTURE,
    startsAt: '2026-11-13T10:00',
    endsAt: '2026-11-13T11:00',
    status: 'scheduled',
    priceCentsSnapshot: 1000,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
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

  it('envía el filtro tal cual al comando list_resources', async () => {
    signInAs(MANAGER)

    await listResources({ includeInactive: false })
    await listResources({ includeInactive: true })

    expect(calls).toEqual([
      { cmd: 'list_resources', args: { filter: { includeInactive: false } } },
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

  it('refleja en el mock lo que dice Rust sin perder los inactivos que el filtro omite', async () => {
    signInAs(MANAGER)
    const stale = getState().resources.map((resource) => (resource.id === 1 ? { ...resource, name: 'Nombre viejo' } : resource))
    commit({ ...getState(), resources: stale })

    await listResources({ includeInactive: false })

    expect(getState().resources).toHaveLength(SEED_RESOURCE_COUNT)
    expect(getState().resources.find((resource) => resource.id === 1)?.name).toBe('Cabina 1')
    expect(getState().resources.find((resource) => resource.id === INACTIVE_MANICURE)?.active).toBe(false)
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
    withAppointments([])

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
    withAppointments([])
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
    withAppointments([])
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await setResourceActive(1, false)).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().resources).toBe(before.resources)
  })
})

describe('setResourceActive: guarda transitoria de citas futuras (D9)', () => {
  it('bloquea con citas scheduled futuras del seed, lista sus ids y no llama a Rust', async () => {
    signInAs(MANAGER)
    const before = getState()
    const expectedIds = appointmentsOf(CABIN_WITH_FUTURE)
      .filter((appointment) => appointment.status === 'scheduled' && appointment.startsAt >= NOW)
      .map((appointment) => appointment.id)

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(expectedIds).toEqual([5])
    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'resourceHasFutureAppointments', entityIds: expectedIds },
    })
    expect(calls.map((call) => call.cmd)).toEqual(['list_resources'])
    expect(getState().appointments).toBe(before.appointments)
    expect(getState().resources).toEqual(before.resources)
  })

  it('bloquea la otra cabina con su propia cita futura', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(CABIN_ALSO_WITH_FUTURE, false)

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'resourceHasFutureAppointments', entityIds: [12] },
    })
  })

  it('lista todos los ids bloqueantes en orden de inicio', async () => {
    signInAs(MANAGER)
    withAppointments([
      appointmentTemplate({ id: 7, startsAt: '2026-11-14T10:00' }),
      appointmentTemplate({ id: 8, startsAt: '2026-11-15T10:00' }),
    ])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'error', error: { entityIds: [7, 8] } })
  })

  it.each(['completed', 'cancelled', 'noShow', 'inProgress'] as const)(
    'una cita futura %s no bloquea y se llama a Rust',
    async (status) => {
      signInAs(MANAGER)
      withAppointments([appointmentTemplate({ status })])

      const result = await setResourceActive(CABIN_WITH_FUTURE, false)

      expect(result.status).toBe('ok')
      expect(calls.map((call) => call.cmd)).toEqual(['set_resource_active'])
    },
  )

  it('una cita scheduled pasada no bloquea', async () => {
    signInAs(MANAGER)
    withAppointments([appointmentTemplate({ startsAt: '2026-11-12T08:59' })])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result.status).toBe('ok')
  })

  it('una cita scheduled que empieza exactamente ahora bloquea', async () => {
    signInAs(MANAGER)
    withAppointments([appointmentTemplate({ id: 9, startsAt: NOW })])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'error', error: { entityIds: [9] } })
  })

  it('una cita futura de otro recurso no bloquea', async () => {
    signInAs(MANAGER)
    withAppointments([appointmentTemplate({ resourceId: CABIN_ALSO_WITH_FUTURE })])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result.status).toBe('ok')
  })

  it('con bloqueo solo se hace la lectura de confirmación y sin bloqueo solo se desactiva', async () => {
    signInAs(MANAGER)
    await setResourceActive(CABIN_WITH_FUTURE, false)
    const commandsWhenBlocked = calls.map((call) => call.cmd)
    calls = []
    withAppointments([])

    await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(commandsWhenBlocked).toEqual(['list_resources'])
    expect(calls.map((call) => call.cmd)).toEqual(['set_resource_active'])
  })

  it('la lectura de confirmación usa el filtro por defecto', async () => {
    signInAs(MANAGER)

    await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(calls).toEqual([{ cmd: 'list_resources', args: { filter: { includeInactive: false } } }])
  })

  it.each(['sessionLocked', 'unauthenticated', 'forbidden', 'internal'] as const)(
    'con citas futuras y Rust respondiendo %s entrega ese error y no la guarda ni llama a desactivar',
    async (code) => {
      signInAs(MANAGER)
      thrownByIpc = appError(code)

      const result = await setResourceActive(CABIN_WITH_FUTURE, false)

      expect(result).toEqual({ status: 'error', error: appError(code) })
      expect(calls.map((call) => call.cmd)).toEqual(['list_resources'])
    },
  )

  it('con citas futuras y un fallo del canal entrega internal y no la guarda', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(result).not.toMatchObject({ error: { code: 'resourceHasFutureAppointments' } })
  })

  it('con Rust confirmando la sesión y citas futuras entrega la guarda con los entityIds', async () => {
    signInAs(MANAGER)
    withAppointments([
      appointmentTemplate({ id: 7, startsAt: '2026-11-14T10:00' }),
      appointmentTemplate({ id: 8, startsAt: '2026-11-15T10:00' }),
    ])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'resourceHasFutureAppointments', entityIds: [7, 8] },
    })
  })

  it('desactivar un recurso ya inactivo con citas futuras scheduled no bloquea y llama a Rust', async () => {
    signInAs(MANAGER)
    withAppointments([appointmentTemplate({ resourceId: INACTIVE_MANICURE })])

    const result = await setResourceActive(INACTIVE_MANICURE, false)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_MANICURE, active: false } })
    expect(calls.map((call) => call.cmd)).toEqual(['set_resource_active'])
  })

  it('un error de Rust llega intacto cuando el chequeo transitorio no bloquea', async () => {
    signInAs(MANAGER)
    withAppointments([])
    thrownByIpc = appError('sessionLocked')

    expect(await setResourceActive(CABIN_WITH_FUTURE, false)).toEqual({ status: 'error', error: appError('sessionLocked') })
  })

  it('sin permiso en el mock no revela las citas: decide Rust con su propio forbidden', async () => {
    signInAs(NO_MANAGE)

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(calls.map((call) => call.cmd)).toEqual(['set_resource_active'])
  })

  it('no revela las citas sin sesión: decide Rust con unauthenticated', async () => {
    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })
})

describe('listFutureAppointmentsOfResource', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await listFutureAppointmentsOfResource(1)

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin resources.manage con forbidden', async () => {
    signInAs(NO_MANAGE)

    const result = await listFutureAppointmentsOfResource(1)

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('un recurso inexistente llega como validation con field id y no como notFound', async () => {
    signInAs(MANAGER)

    const result = await listFutureAppointmentsOfResource(MISSING_ID)

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'id' } })
  })

  it('confirma la sesión con una sola lectura de recursos con el filtro por defecto', async () => {
    signInAs(MANAGER)

    await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)

    expect(calls).toEqual([{ cmd: 'list_resources', args: { filter: { includeInactive: false } } }])
  })

  it.each(['sessionLocked', 'unauthenticated', 'forbidden', 'internal'] as const)(
    'con Rust respondiendo %s entrega ese error y ninguna cita',
    async (code) => {
      signInAs(MANAGER)
      thrownByIpc = appError(code)

      const result = await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)

      expect(result).toEqual({ status: 'error', error: appError(code) })
    },
  )

  it('devuelve solo id e inicio de cada cita con Rust confirmando la sesión', async () => {
    signInAs(MANAGER)
    withAppointments([appointmentTemplate({ id: 7, startsAt: '2026-11-14T10:00', notes: 'privada' })])

    const result = await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)

    expect(result).toEqual({ status: 'ok', data: [{ id: 7, startsAt: '2026-11-14T10:00' }] })
  })

  it('devuelve solo las scheduled futuras del recurso ordenadas por inicio', async () => {
    signInAs(MANAGER)
    withAppointments([
      appointmentTemplate({ id: 2, startsAt: '2026-11-15T10:00' }),
      appointmentTemplate({ id: 1, startsAt: '2026-11-14T10:00' }),
      appointmentTemplate({ id: 3, status: 'cancelled' }),
      appointmentTemplate({ id: 4, startsAt: '2026-11-10T10:00' }),
      appointmentTemplate({ id: 5, resourceId: CABIN_ALSO_WITH_FUTURE }),
    ])

    const result = await listFutureAppointmentsOfResource(CABIN_WITH_FUTURE)

    expect(result.status === 'ok' && result.data.map((appointment) => appointment.id)).toEqual([1, 2])
  })
})
