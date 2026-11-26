import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError, AppointmentSummary } from '@/lib/bindings'
import {
  appointmentTemplate,
  DAY,
  dataOf,
  errorOf,
  inputTemplate,
  resetWithEmptyAgenda,
} from '@/test/appointment-fixtures'
import { signInAs } from '@/test/session'
import { createAppointment, listAppointments, moveAppointment, transitionAppointment } from './api'

type Call = { cmd: string; args: unknown }

let calls: Call[]

function stubIpc(handler: (cmd: string, args: unknown) => unknown): void {
  calls = []
  mockIPC((cmd, args) => {
    calls.push({ cmd, args })
    return handler(cmd, args)
  })
}

function summary(overrides: Partial<AppointmentSummary> = {}): AppointmentSummary {
  return appointmentTemplate(overrides)
}

function appError(overrides: Partial<AppError>): AppError {
  return { code: 'overlap', message: 'mensaje de Rust', field: null, entityIds: null, ...overrides }
}

beforeEach(() => {
  resetWithEmptyAgenda()
  signInAs('recepcion')
})

describe('listAppointments', () => {
  it('es una lectura filtrada en Rust que envía el rango tal cual', async () => {
    stubIpc(() => [summary()])
    const range = { from: DAY, to: DAY, resourceId: 2 }

    const rows = dataOf(await listAppointments(range))

    expect(calls).toEqual([{ cmd: 'list_appointments', args: { range } }])
    expect(rows).toEqual([appointmentTemplate()])
  })

  it('propaga el error de Rust sin validar localmente', async () => {
    const rustError = appError({ code: 'validation', field: 'to', message: 'Revisa el dato ingresado' })
    stubIpc(() => {
      throw rustError
    })

    expect(errorOf(await listAppointments({ from: '2026-11-14', to: DAY, resourceId: null }))).toEqual(rustError)
  })

  it('un fallo del canal es internal', async () => {
    stubIpc(() => {
      throw new Error('canal caído')
    })

    expect(errorOf(await listAppointments({ from: DAY, to: DAY, resourceId: null })).code).toBe('internal')
  })
})

describe('mutaciones', () => {
  it('createAppointment envía la entrada a Rust sin validar ni medianoche ni solape localmente y devuelve la cita de Rust', async () => {
    stubIpc(() => summary({ id: 12, startsAt: `${DAY}T23:30`, endsAt: `${DAY}T23:59` }))

    const created = dataOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T23:30` })))

    expect(calls).toEqual([
      { cmd: 'create_appointment', args: { input: inputTemplate({ startsAt: `${DAY}T23:30` }) } },
    ])
    expect(created.id).toBe(12)
  })

  it('propaga overlap con entityIds desde Rust', async () => {
    const rustError = appError({ code: 'overlap', field: 'startsAt', entityIds: [4, 5] })
    stubIpc(() => {
      throw rustError
    })

    const result = await createAppointment(inputTemplate())

    expect(errorOf(result)).toEqual(rustError)
  })

  it('moveAppointment envía id, inicio y recurso y devuelve la cita movida', async () => {
    stubIpc(() => summary({ id: 7, startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00`, resourceId: 2 }))

    const moved = dataOf(await moveAppointment(7, { startsAt: `${DAY}T15:00`, resourceId: 2 }))

    expect(calls).toEqual([
      { cmd: 'move_appointment', args: { movement: { id: 7, startsAt: `${DAY}T15:00`, resourceId: 2 } } },
    ])
    expect(moved).toEqual(appointmentTemplate({ id: 7, startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00`, resourceId: 2 }))
  })

  it('moveAppointment propaga crossesMidnight', async () => {
    const rustError = appError({ code: 'crossesMidnight', field: 'startsAt' })
    stubIpc(() => {
      throw rustError
    })

    const result = await moveAppointment(7, { startsAt: `${DAY}T23:30`, resourceId: 1 })

    expect(errorOf(result)).toEqual(rustError)
  })

  it('transitionAppointment envía id y transición y devuelve el nuevo estado', async () => {
    stubIpc(() => summary({ id: 7, status: 'inProgress' }))

    const started = dataOf(await transitionAppointment(7, 'start'))

    expect(calls).toEqual([{ cmd: 'transition_appointment', args: { request: { id: 7, transition: 'start' } } }])
    expect(started.status).toBe('inProgress')
  })

  it('transitionAppointment propaga invalidTransition desde Rust', async () => {
    const rustError = appError({ code: 'invalidTransition', message: 'La cita no admite esa operación en su estado actual' })
    stubIpc(() => {
      throw rustError
    })

    expect(errorOf(await transitionAppointment(7, 'reopen'))).toEqual(rustError)
  })

  it('un fallo del canal en una mutación es internal', async () => {
    stubIpc(() => {
      throw new Error('canal caído')
    })

    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('internal')
  })
})
