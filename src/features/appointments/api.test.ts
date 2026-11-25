import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { AppointmentStatus, AppointmentTransition, Id } from '@/lib/model'
import {
  CABIN_ONE,
  CABIN_TWO,
  DAY,
  MISSING_ID,
  NOW,
  appointmentById,
  appointmentTemplate,
  dataOf,
  errorOf,
  inputTemplate,
  resetWithEmptyAgenda,
  seedAppointments,
} from '@/test/appointment-fixtures'
import { signInAs } from '@/test/session'
import { createAppointment, listAppointments, transitionAppointment } from './api'

beforeEach(resetWithEmptyAgenda)

const range = (from: string, to: string, resourceId: Id | null = null) => ({ from, to, resourceId })

describe('listAppointments', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(errorOf(await listAppointments(range(DAY, DAY))).code).toBe('unauthenticated')
  })

  it('rechaza sin appointments.read con forbidden', async () => {
    signInAs('lectura')
    commit({
      ...getState(),
      users: getState().users.map((user) => (user.username === 'lectura' ? { ...user, permissions: ['clients.read'] } : user)),
    })

    expect(errorOf(await listAppointments(range(DAY, DAY))).code).toBe('forbidden')
  })

  it('permite leer a un usuario de solo lectura', async () => {
    signInAs('lectura')

    expect((await listAppointments(range(DAY, DAY))).status).toBe('ok')
  })

  it('rechaza fechas con formato inválido con validation', async () => {
    signInAs('recepcion')

    const error = errorOf(await listAppointments(range('13/11/2026', DAY)))

    expect(error).toMatchObject({ code: 'validation', field: 'from' })
  })

  it('rechaza from posterior a to con validation sobre el campo to', async () => {
    signInAs('recepcion')

    expect(errorOf(await listAppointments(range('2026-11-14', DAY)))).toMatchObject({ code: 'validation', field: 'to' })
  })

  it('incluye los límites from y to por fecha de inicio', async () => {
    signInAs('recepcion')
    seedAppointments(
      appointmentTemplate({ id: 1, startsAt: '2026-11-12T23:30', endsAt: '2026-11-13T00:00' }),
      appointmentTemplate({ id: 2, startsAt: '2026-11-13T08:00', endsAt: '2026-11-13T09:00' }),
      appointmentTemplate({ id: 3, startsAt: '2026-11-14T23:00', endsAt: '2026-11-15T00:00' }),
      appointmentTemplate({ id: 4, startsAt: '2026-11-15T00:00', endsAt: '2026-11-15T01:00' }),
      appointmentTemplate({ id: 5, startsAt: '2026-11-11T23:55', endsAt: '2026-11-12T00:55' }),
    )

    const rows = dataOf(await listAppointments(range('2026-11-12', '2026-11-14')))

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3])
  })

  it('ordena por startsAt', async () => {
    signInAs('recepcion')
    seedAppointments(
      appointmentTemplate({ id: 1, startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00` }),
      appointmentTemplate({ id: 2, startsAt: `${DAY}T09:00`, endsAt: `${DAY}T10:00` }),
      appointmentTemplate({ id: 3, startsAt: `${DAY}T12:00`, endsAt: `${DAY}T13:00` }),
    )

    const rows = dataOf(await listAppointments(range(DAY, DAY)))

    expect(rows.map((row) => row.id)).toEqual([2, 3, 1])
  })

  it('filtra por recurso cuando se indica y devuelve todos con null', async () => {
    signInAs('recepcion')
    seedAppointments(
      appointmentTemplate({ id: 1, resourceId: CABIN_ONE }),
      appointmentTemplate({ id: 2, resourceId: CABIN_TWO }),
    )

    expect(dataOf(await listAppointments(range(DAY, DAY, CABIN_TWO))).map((row) => row.id)).toEqual([2])
    expect(dataOf(await listAppointments(range(DAY, DAY, null)))).toHaveLength(2)
  })

  it('devuelve una lista nueva en cada llamada', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate())

    const first = dataOf(await listAppointments(range(DAY, DAY)))
    const second = dataOf(await listAppointments(range(DAY, DAY)))

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})


describe('transitionAppointment', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(errorOf(await transitionAppointment(1, 'cancel')).code).toBe('unauthenticated')
  })

  it('rechaza con forbidden a un usuario sin appointments.write', async () => {
    signInAs('lectura')
    seedAppointments(appointmentTemplate({ id: 1 }))

    expect(errorOf(await transitionAppointment(1, 'cancel')).code).toBe('forbidden')
    expect((await appointmentById(1)).status).toBe('scheduled')
  })

  it('cita inexistente: notFound', async () => {
    signInAs('recepcion')

    expect(errorOf(await transitionAppointment(MISSING_ID, 'cancel')).code).toBe('notFound')
  })

  it('el orden es authorize antes que notFound', async () => {
    signInAs('lectura')

    expect(errorOf(await transitionAppointment(MISSING_ID, 'start')).code).toBe('forbidden')
  })

  it.each([
    ['scheduled', 'start', 'inProgress'],
    ['scheduled', 'markNoShow', 'noShow'],
    ['scheduled', 'cancel', 'cancelled'],
    ['inProgress', 'complete', 'completed'],
    ['inProgress', 'cancel', 'cancelled'],
  ] as const)('%s con %s deja la cita en %s y la persiste', async (status, transition, target) => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1, status }))
    const previous = await appointmentById(1)

    const updated = dataOf(await transitionAppointment(1, transition))

    expect(updated).toEqual({ ...previous, status: target })
    expect(previous.status).toBe(status)
    expect(await appointmentById(1)).toEqual(updated)
  })

  it('completa desde scheduled cuando now == startsAt', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1, startsAt: NOW, endsAt: '2026-11-12T10:00' }))

    expect(dataOf(await transitionAppointment(1, 'complete')).status).toBe('completed')
  })

  it('completar desde scheduled un minuto antes de startsAt: invalidTransition', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1, startsAt: '2026-11-12T09:01', endsAt: '2026-11-12T10:01' }))
    const before = getState()

    expect(errorOf(await transitionAppointment(1, 'complete')).code).toBe('invalidTransition')
    expect(getState()).toBe(before)
  })

  const ILLEGAL: ReadonlyArray<[AppointmentStatus, AppointmentTransition]> = [
    ['scheduled', 'reopen'],
    ['inProgress', 'start'],
    ['inProgress', 'markNoShow'],
    ['inProgress', 'reopen'],
    ['completed', 'start'],
    ['completed', 'complete'],
    ['completed', 'markNoShow'],
    ['completed', 'cancel'],
    ['cancelled', 'start'],
    ['cancelled', 'complete'],
    ['cancelled', 'markNoShow'],
    ['cancelled', 'cancel'],
    ['noShow', 'start'],
    ['noShow', 'complete'],
    ['noShow', 'markNoShow'],
    ['noShow', 'cancel'],
  ]

  it.each(ILLEGAL)('%s con %s: invalidTransition sin tocar el store', async (status, transition) => {
    signInAs('propietaria')
    seedAppointments(appointmentTemplate({ id: 1, status, startsAt: '2026-11-12T08:00', endsAt: '2026-11-12T09:00' }))
    const before = getState()

    expect(errorOf(await transitionAppointment(1, transition)).code).toBe('invalidTransition')
    expect(getState()).toBe(before)
  })

  it('cancelar libera la franja: crear en la misma franja ahora es válido', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1, startsAt: `${DAY}T12:00`, endsAt: `${DAY}T13:00` }))
    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('overlap')

    await transitionAppointment(1, 'cancel')

    expect(dataOf(await createAppointment(inputTemplate())).status).toBe('scheduled')
  })
})

describe('transitionAppointment reopen', () => {
  const slot = { startsAt: `${DAY}T12:00`, endsAt: `${DAY}T13:00` }

  it('sin appointments.reopen: forbidden y la cita sigue igual', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1, status: 'cancelled', ...slot }))
    const before = getState()

    expect(errorOf(await transitionAppointment(1, 'reopen')).code).toBe('forbidden')
    expect(getState()).toBe(before)
  })

  it('forbidden por falta de reopen se evalúa antes que notFound', async () => {
    signInAs('recepcion')

    expect(errorOf(await transitionAppointment(MISSING_ID, 'reopen')).code).toBe('forbidden')
  })

  it('propietaria sobre cita inexistente: notFound', async () => {
    signInAs('propietaria')

    expect(errorOf(await transitionAppointment(MISSING_ID, 'reopen')).code).toBe('notFound')
  })

  it.each<AppointmentStatus>(['completed', 'cancelled', 'noShow'])('con franja libre reabre una cita %s a scheduled', async (status) => {
    signInAs('propietaria')
    seedAppointments(appointmentTemplate({ id: 1, status, ...slot }))
    const previous = await appointmentById(1)

    const reopened = dataOf(await transitionAppointment(1, 'reopen'))

    expect(reopened).toEqual({ ...previous, status: 'scheduled' })
    expect(previous.status).toBe(status)
    expect(await appointmentById(1)).toEqual(reopened)
  })

  it.each<AppointmentStatus>(['cancelled', 'noShow'])('con la franja ocupada reabrir %s: overlap con entityIds', async (status) => {
    signInAs('propietaria')
    seedAppointments(
      appointmentTemplate({ id: 1, status, ...slot }),
      appointmentTemplate({ id: 2, ...slot }),
      appointmentTemplate({ id: 3, status: 'inProgress', startsAt: `${DAY}T12:30`, endsAt: `${DAY}T13:30` }),
    )
    const before = getState()

    const error = errorOf(await transitionAppointment(1, 'reopen'))

    expect(error).toMatchObject({ code: 'overlap', entityIds: [2, 3] })
    expect(getState()).toBe(before)
  })

  it('una cita ocupante en otro recurso no genera overlap', async () => {
    signInAs('propietaria')
    seedAppointments(
      appointmentTemplate({ id: 1, status: 'cancelled', ...slot }),
      appointmentTemplate({ id: 2, resourceId: CABIN_TWO, ...slot }),
    )

    expect(dataOf(await transitionAppointment(1, 'reopen')).status).toBe('scheduled')
  })

  it('una cita cancelada en la misma franja no bloquea la reapertura', async () => {
    signInAs('propietaria')
    seedAppointments(
      appointmentTemplate({ id: 1, status: 'noShow', ...slot }),
      appointmentTemplate({ id: 2, status: 'cancelled', ...slot }),
    )

    expect(dataOf(await transitionAppointment(1, 'reopen')).status).toBe('scheduled')
  })

  it('reabrir una cita scheduled: invalidTransition', async () => {
    signInAs('propietaria')
    seedAppointments(appointmentTemplate({ id: 1, ...slot }))

    expect(errorOf(await transitionAppointment(1, 'reopen')).code).toBe('invalidTransition')
  })
})
