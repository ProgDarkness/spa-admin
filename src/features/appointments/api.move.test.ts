import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { AppointmentStatus } from '@/lib/model'
import {
  CABIN_ONE,
  CABIN_TWO,
  DAY,
  FACIAL_DURATION_MIN,
  FACIAL_PRICE_CENTS,
  FACIAL_SERVICE_ID,
  INACTIVE_MANICURE,
  MISSING_ID,
  appointmentById,
  appointmentTemplate,
  dataOf,
  errorOf,
  resetWithEmptyAgenda,
  seedAppointments,
} from '@/test/appointment-fixtures'
import { signInAs } from '@/test/session'
import { moveAppointment } from './api'

beforeEach(resetWithEmptyAgenda)

describe('moveAppointment', () => {
  const target = { startsAt: `${DAY}T14:00`, resourceId: CABIN_TWO }

  it('rechaza sin sesión con unauthenticated', async () => {
    expect(errorOf(await moveAppointment(1, target)).code).toBe('unauthenticated')
  })

  it('rechaza con forbidden a un usuario sin appointments.write', async () => {
    signInAs('lectura')
    seedAppointments(appointmentTemplate({ id: 1 }))

    expect(errorOf(await moveAppointment(1, target)).code).toBe('forbidden')
  })

  it('rechaza minutos inválidos con validation', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))

    expect(errorOf(await moveAppointment(1, { ...target, startsAt: `${DAY}T14:07` }))).toMatchObject({
      code: 'validation',
      field: 'startsAt',
    })
  })

  it('cita inexistente: notFound', async () => {
    signInAs('recepcion')

    expect(errorOf(await moveAppointment(MISSING_ID, target)).code).toBe('notFound')
  })

  it.each<AppointmentStatus>(['inProgress', 'completed', 'cancelled', 'noShow'])(
    'mover una cita %s: invalidTransition',
    async (status) => {
      signInAs('recepcion')
      seedAppointments(appointmentTemplate({ id: 1, status }))
      const before = getState()

      expect(errorOf(await moveAppointment(1, target)).code).toBe('invalidTransition')
      expect(getState()).toBe(before)
    },
  )

  it('recurso destino inexistente: notFound sobre resourceId', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))

    expect(errorOf(await moveAppointment(1, { ...target, resourceId: MISSING_ID }))).toMatchObject({
      code: 'notFound',
      field: 'resourceId',
    })
  })

  it('recurso destino inactivo: resourceInactive', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))

    expect(errorOf(await moveAppointment(1, { ...target, resourceId: INACTIVE_MANICURE })).code).toBe('resourceInactive')
  })

  it('mover a 23:00 con 60 min se permite y a 23:30 cruza la medianoche', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))

    expect(dataOf(await moveAppointment(1, { ...target, startsAt: `${DAY}T23:00` })).endsAt).toBe('2026-11-14T00:00')
    expect(errorOf(await moveAppointment(1, { ...target, startsAt: `${DAY}T23:30` })).code).toBe('crossesMidnight')
  })

  it('rechaza el solape con otra cita y devuelve su id', async () => {
    signInAs('recepcion')
    seedAppointments(
      appointmentTemplate({ id: 1 }),
      appointmentTemplate({ id: 2, resourceId: CABIN_TWO, startsAt: `${DAY}T14:30`, endsAt: `${DAY}T15:30` }),
    )
    const before = getState()

    const error = errorOf(await moveAppointment(1, target))

    expect(error).toMatchObject({ code: 'overlap', entityIds: [2] })
    expect(getState()).toBe(before)
  })

  it('excluye la propia cita del solape: moverla 30 minutos dentro de su franja es válido', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))

    const moved = dataOf(await moveAppointment(1, { startsAt: `${DAY}T10:30`, resourceId: CABIN_ONE }))

    expect(moved).toMatchObject({ startsAt: `${DAY}T10:30`, endsAt: `${DAY}T11:30` })
  })

  it('mueve de recurso y de hora recalculando endsAt con durationMinSnapshot', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))

    const moved = dataOf(await moveAppointment(1, target))

    expect(moved).toMatchObject({ resourceId: CABIN_TWO, startsAt: `${DAY}T14:00`, endsAt: `${DAY}T15:00`, status: 'scheduled' })
    expect(await appointmentById(1)).toEqual(moved)
  })

  it('conserva los snapshots aunque el servicio haya cambiado de precio y duración', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }))
    commit({
      ...getState(),
      services: getState().services.map((service) =>
        service.id === FACIAL_SERVICE_ID ? { ...service, priceCents: 9_900, durationMin: 120 } : service,
      ),
    })

    const moved = dataOf(await moveAppointment(1, target))

    expect(moved.priceCentsSnapshot).toBe(FACIAL_PRICE_CENTS)
    expect(moved.durationMinSnapshot).toBe(FACIAL_DURATION_MIN)
    expect(moved.endsAt).toBe(`${DAY}T15:00`)
  })

  it('solo cambia la cita movida y deja intacta a la vecina', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }), appointmentTemplate({ id: 2, resourceId: CABIN_TWO, startsAt: `${DAY}T09:00`, endsAt: `${DAY}T10:00` }))
    const previousAppointment = await appointmentById(1)
    const untouchedSibling = await appointmentById(2)

    const moved = dataOf(await moveAppointment(1, target))

    expect(previousAppointment.startsAt).toBe(`${DAY}T10:00`)
    expect(moved.startsAt).toBe(`${DAY}T14:00`)
    expect(await appointmentById(2)).toEqual(untouchedSibling)
  })
})

