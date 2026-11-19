import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Appointment, Id } from '@/lib/model'
import { freezeDate } from '@/test/clock'
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

beforeEach(() => {
  freezeDate(NOW)
  resetStore()
})

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
})

describe('createResource', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await createResource({ name: 'Cabina 3', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin resources.manage con forbidden y no escribe', async () => {
    signInAs(NO_MANAGE)
    const before = getState()

    const result = await createResource({ name: 'Cabina 3', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('rechaza nombre vacío con validation y field name', async () => {
    signInAs(MANAGER)
    const before = getState()

    const result = await createResource({ name: '  ', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'name' } })
    expect(getState()).toBe(before)
  })

  it('rechaza un kind inválido con validation', async () => {
    signInAs(MANAGER)

    const result = await createResource({ name: 'Sala', kind: 'sauna' as 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'kind' } })
  })

  it('crea un recurso activo con id siguiente y nombre recortado', async () => {
    signInAs(MANAGER)

    const result = await createResource({ name: '  Cabina 3  ', kind: 'cabin' })

    expect(result).toEqual({
      status: 'ok',
      data: { id: 4, name: 'Cabina 3', kind: 'cabin', active: true },
    })
    expect(getState().resources).toHaveLength(4)
  })

  it('no muta el arreglo de recursos previo', async () => {
    signInAs(MANAGER)
    const previous = getState().resources

    await createResource({ name: 'Cabina 3', kind: 'cabin' })

    expect(previous).toHaveLength(3)
    expect(getState().resources).not.toBe(previous)
  })
})

describe('updateResource', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    const result = await updateResource(1, { name: 'Nueva', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin resources.manage con forbidden', async () => {
    signInAs(NO_MANAGE)

    const result = await updateResource(1, { name: 'Nueva', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('rechaza validación antes que notFound', async () => {
    signInAs(MANAGER)

    const result = await updateResource(MISSING_ID, { name: '', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'name' } })
  })

  it('rechaza un id inexistente con notFound', async () => {
    signInAs(MANAGER)

    const result = await updateResource(MISSING_ID, { name: 'Nueva', kind: 'cabin' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('actualiza nombre y kind conservando active e id', async () => {
    signInAs(MANAGER)

    const result = await updateResource(INACTIVE_MANICURE, { name: 'Manicure 2', kind: 'manicure' })

    expect(result).toEqual({
      status: 'ok',
      data: { id: INACTIVE_MANICURE, name: 'Manicure 2', kind: 'manicure', active: false },
    })
  })

  it('no muta la fila previa ni toca las citas', async () => {
    signInAs(MANAGER)
    const previousRow = getState().resources[0]
    const previousAppointments = getState().appointments

    await updateResource(1, { name: 'Renombrada', kind: 'cabin' })

    expect(previousRow?.name).toBe('Cabina 1')
    expect(getState().appointments).toBe(previousAppointments)
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

  it('rechaza un id inexistente con notFound', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(MISSING_ID, false)

    expect(result).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('desactiva un recurso sin citas futuras', async () => {
    signInAs(MANAGER)
    withAppointments([])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'ok', data: { id: CABIN_WITH_FUTURE, active: false } })
    expect(getState().resources.find((resource) => resource.id === CABIN_WITH_FUTURE)?.active).toBe(false)
  })

  it('bloquea con citas scheduled futuras del seed y lista sus ids', async () => {
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
    expect(getState()).toBe(before)
  })

  it('bloquea la otra cabina con su propia cita futura', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(CABIN_ALSO_WITH_FUTURE, false)

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'resourceHasFutureAppointments', entityIds: [12] },
    })
  })

  it('lista todos los ids bloqueantes', async () => {
    signInAs(MANAGER)
    withAppointments([
      appointmentTemplate({ id: 7, startsAt: '2026-11-14T10:00' }),
      appointmentTemplate({ id: 8, startsAt: '2026-11-15T10:00' }),
    ])

    const result = await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(result).toMatchObject({ status: 'error', error: { entityIds: [7, 8] } })
  })

  it.each(['completed', 'cancelled', 'noShow', 'inProgress'] as const)(
    'una cita futura %s no bloquea',
    async (status) => {
      signInAs(MANAGER)
      withAppointments([appointmentTemplate({ status })])

      const result = await setResourceActive(CABIN_WITH_FUTURE, false)

      expect(result.status).toBe('ok')
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

  it('reactivar siempre está permitido', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(INACTIVE_MANICURE, true)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_MANICURE, active: true } })
  })

  it('reactivar un recurso con citas futuras no consulta bloqueos', async () => {
    signInAs(MANAGER)

    const result = await setResourceActive(CABIN_WITH_FUTURE, true)

    expect(result).toMatchObject({ status: 'ok', data: { active: true } })
  })

  it('no muta la fila previa al desactivar', async () => {
    signInAs(MANAGER)
    withAppointments([])
    const previousRow = getState().resources[0]

    await setResourceActive(CABIN_WITH_FUTURE, false)

    expect(previousRow?.active).toBe(true)
    expect(getState().resources).not.toContain(previousRow)
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

  it('rechaza un recurso inexistente con notFound', async () => {
    signInAs(MANAGER)

    const result = await listFutureAppointmentsOfResource(MISSING_ID)

    expect(result).toMatchObject({ status: 'error', error: { code: 'notFound' } })
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
