import { beforeEach, describe, expect, it } from 'vitest'
import { getState, type StoreState } from '@/lib/mock/store'
import type { AppointmentStatus } from '@/lib/model'
import {
  BROW_SERVICE_ID,
  CABIN_TWO,
  DAY,
  DELETED_CLIENT,
  FACIAL_DURATION_MIN,
  FACIAL_PRICE_CENTS,
  INACTIVE_MANICURE,
  INACTIVE_SERVICE,
  MISSING_ID,
  appointmentById,
  appointmentTemplate,
  dataOf,
  errorOf,
  inputTemplate,
  resetWithEmptyAgenda,
  seedAppointments,
} from '@/test/appointment-fixtures'
import { signInAs } from '@/test/session'
import { createAppointment, transitionAppointment } from './api'

function withoutRefreshedCatalogs(state: StoreState): Omit<StoreState, 'services' | 'resources'> {
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== 'services' && key !== 'resources'),
  ) as Omit<StoreState, 'services' | 'resources'>
}

function expectRecordsUntouched(before: StoreState): void {
  expect(withoutRefreshedCatalogs(getState())).toEqual(withoutRefreshedCatalogs(before))
  expect(getState().clients).toBe(before.clients)
  expect(getState().appointments).toBe(before.appointments)
  expect(getState().payments).toBe(before.payments)
}

beforeEach(resetWithEmptyAgenda)

describe('createAppointment', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('unauthenticated')
  })

  it('rechaza con forbidden a un usuario que solo lee y no escribe', async () => {
    signInAs('lectura')
    const before = getState()

    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('forbidden')
    expect(getState()).toBe(before)
  })

  it('rechaza minutos que no son múltiplo de 5 con validation sobre startsAt', async () => {
    signInAs('recepcion')

    const error = errorOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T12:03` })))

    expect(error).toMatchObject({ code: 'validation', field: 'startsAt' })
  })

  it('rechaza un formato de fecha inválido con validation', async () => {
    signInAs('recepcion')

    expect(errorOf(await createAppointment(inputTemplate({ startsAt: '13-11-2026 12:00' }))).code).toBe('validation')
  })

  it('cliente inexistente: notFound sobre clientId', async () => {
    signInAs('recepcion')

    expect(errorOf(await createAppointment(inputTemplate({ clientId: MISSING_ID })))).toMatchObject({
      code: 'notFound',
      field: 'clientId',
    })
  })

  it('cliente borrado: notFound sobre clientId', async () => {
    signInAs('recepcion')

    expect(errorOf(await createAppointment(inputTemplate({ clientId: DELETED_CLIENT })))).toMatchObject({
      code: 'notFound',
      field: 'clientId',
    })
  })

  it('servicio inexistente: notFound sobre serviceId', async () => {
    signInAs('recepcion')

    expect(errorOf(await createAppointment(inputTemplate({ serviceId: MISSING_ID })))).toMatchObject({
      code: 'notFound',
      field: 'serviceId',
    })
  })

  it('servicio inactivo: validation sobre serviceId', async () => {
    signInAs('recepcion')

    expect(errorOf(await createAppointment(inputTemplate({ serviceId: INACTIVE_SERVICE })))).toMatchObject({
      code: 'validation',
      field: 'serviceId',
    })
  })

  it('recurso inexistente: notFound sobre resourceId', async () => {
    signInAs('recepcion')

    expect(errorOf(await createAppointment(inputTemplate({ resourceId: MISSING_ID })))).toMatchObject({
      code: 'notFound',
      field: 'resourceId',
    })
  })

  it('recurso inactivo: resourceInactive', async () => {
    signInAs('recepcion')
    const before = getState()

    const error = errorOf(await createAppointment(inputTemplate({ resourceId: INACTIVE_MANICURE })))

    expect(error.code).toBe('resourceInactive')
    expectRecordsUntouched(before)
  })

  it('crea con estado scheduled, endsAt = inicio + duración y snapshots del servicio', async () => {
    signInAs('recepcion')

    const created = dataOf(await createAppointment(inputTemplate({ notes: 'primera vez' })))

    expect(created).toMatchObject({
      status: 'scheduled',
      startsAt: `${DAY}T12:00`,
      endsAt: `${DAY}T13:00`,
      priceCentsSnapshot: FACIAL_PRICE_CENTS,
      durationMinSnapshot: FACIAL_DURATION_MIN,
      notes: 'primera vez',
    })
    expect(appointmentById(created.id)).toEqual(created)
  })

  it('endsAt usa la duración del servicio elegido', async () => {
    signInAs('recepcion')

    const created = dataOf(await createAppointment(inputTemplate({ serviceId: BROW_SERVICE_ID })))

    expect(created.endsAt).toBe(`${DAY}T12:30`)
    expect(created.durationMinSnapshot).toBe(30)
  })

  it('asigna un id nuevo sin tocar las citas previas', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 7 }))
    const previousRows = getState().appointments

    const created = dataOf(await createAppointment(inputTemplate()))

    expect(created.id).toBe(8)
    expect(getState().appointments).not.toBe(previousRows)
    expect(previousRows).toHaveLength(1)
  })

  it('23:00 con 60 min termina a las 00:00 y se permite', async () => {
    signInAs('recepcion')

    const created = dataOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T23:00` })))

    expect(created.endsAt).toBe('2026-11-14T00:00')
  })

  it('23:30 con 60 min cruza la medianoche y se rechaza', async () => {
    signInAs('recepcion')
    const before = getState()

    const error = errorOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T23:30` })))

    expect(error.code).toBe('crossesMidnight')
    expectRecordsUntouched(before)
  })

  it('rechaza un solape exacto con overlap y entityIds de la cita en conflicto', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 41 }))
    const before = getState()

    const error = errorOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T10:00` })))

    expect(error).toMatchObject({ code: 'overlap', entityIds: [41] })
    expectRecordsUntouched(before)
  })

  it('lista todas las citas en conflicto', async () => {
    signInAs('recepcion')
    seedAppointments(
      appointmentTemplate({ id: 41, startsAt: `${DAY}T10:00`, endsAt: `${DAY}T11:00` }),
      appointmentTemplate({ id: 42, startsAt: `${DAY}T11:00`, endsAt: `${DAY}T12:00` }),
    )

    const error = errorOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T10:30` })))

    expect(error.entityIds).toEqual([41, 42])
  })

  it('permite citas contiguas: el fin de una es el inicio de otra', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 41 }))

    expect((await createAppointment(inputTemplate({ startsAt: `${DAY}T11:00` }))).status).toBe('ok')
    expect((await createAppointment(inputTemplate({ startsAt: `${DAY}T09:00` }))).status).toBe('ok')
  })

  it('permite la misma franja en otro recurso', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 41 }))

    expect((await createAppointment(inputTemplate({ startsAt: `${DAY}T10:00`, resourceId: CABIN_TWO }))).status).toBe('ok')
  })

  it.each<AppointmentStatus>(['cancelled', 'noShow'])('crear sobre una cita %s es válido', async (status) => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 41, status }))

    expect((await createAppointment(inputTemplate({ startsAt: `${DAY}T10:00` }))).status).toBe('ok')
  })

  it.each<AppointmentStatus>(['scheduled', 'inProgress', 'completed'])('una cita %s bloquea la creación', async (status) => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 41, status }))

    expect(errorOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T10:00` }))).code).toBe('overlap')
  })

  it('crear tras cancelar una cita en la misma franja es válido', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 41 }))
    dataOf(await transitionAppointment(41, 'cancel'))

    expect((await createAppointment(inputTemplate({ startsAt: `${DAY}T10:00` }))).status).toBe('ok')
  })
})

