import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError, AppointmentSummary } from '@/lib/bindings'
import { commit, getState } from '@/lib/mock/store'
import {
  appointmentTemplate,
  DAY,
  dataOf,
  errorOf,
  inputTemplate,
  resetWithEmptyAgenda,
  seedAppointments,
} from '@/test/appointment-fixtures'
import { deferred } from '@/test/deferred'
import { signInAs } from '@/test/session'
import { createAppointment, listAppointments, moveAppointment, syncAppointmentsMirror, transitionAppointment } from './api'

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

  it('no reemplaza el espejo de citas', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 7 })] })
    stubIpc(() => [summary({ id: 1 })])

    await listAppointments({ from: DAY, to: DAY, resourceId: null })

    expect(getState().appointments.map((row) => row.id)).toEqual([7])
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

describe('syncAppointmentsMirror', () => {
  it('pide la colección completa con list_all_appointments y reemplaza el espejo con la respuesta', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 7 })] })
    stubIpc(() => [summary({ id: 1 }), summary({ id: 2 })])

    const result = await syncAppointmentsMirror()

    expect(calls).toEqual([{ cmd: 'list_all_appointments', args: {} }])
    expect(dataOf(result).map((row) => row.id)).toEqual([1, 2])
    expect(getState().appointments.map((row) => row.id)).toEqual([1, 2])
  })

  it('las citas de hace 8 meses y de dentro de 200 días sobreviven a la sincronización', async () => {
    seedAppointments(
      appointmentTemplate({ id: 1, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T11:00' }),
      appointmentTemplate({ id: 2, startsAt: '2027-05-30T10:00', endsAt: '2027-05-30T11:00' }),
    )
    commit({ ...getState(), appointments: [] })

    await syncAppointmentsMirror()

    expect(getState().appointments.map((row) => row.id)).toEqual([1, 2])
  })

  it('con error de Rust deja el espejo intacto y devuelve el error', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 7 })] })
    const rustError = appError({ code: 'forbidden' })
    stubIpc(() => {
      throw rustError
    })

    const result = await syncAppointmentsMirror()

    expect(errorOf(result)).toEqual(rustError)
    expect(getState().appointments.map((row) => row.id)).toEqual([7])
  })

  it('descarta una lista obsoleta que llega después de una mutación', async () => {
    const pending = deferred<AppointmentSummary[]>()
    stubIpc((cmd) => (cmd === 'list_all_appointments' ? pending.promise : summary({ id: 9 })))

    const sync = syncAppointmentsMirror()
    await createAppointment(inputTemplate())
    pending.resolve([summary({ id: 1 })])
    await sync

    expect(getState().appointments.map((row) => row.id)).toEqual([9])
  })
})

describe('mutaciones', () => {
  it('createAppointment envía la entrada a Rust sin validar ni medianoche ni solape localmente y refleja la cita', async () => {
    stubIpc(() => summary({ id: 12, startsAt: `${DAY}T23:30`, endsAt: `${DAY}T23:59` }))

    const created = dataOf(await createAppointment(inputTemplate({ startsAt: `${DAY}T23:30` })))

    expect(calls).toEqual([
      { cmd: 'create_appointment', args: { input: inputTemplate({ startsAt: `${DAY}T23:30` }) } },
    ])
    expect(created.id).toBe(12)
    expect(getState().appointments.map((row) => row.id)).toEqual([12])
  })

  it('propaga overlap con entityIds desde Rust y no toca el espejo', async () => {
    const rustError = appError({ code: 'overlap', field: 'startsAt', entityIds: [4, 5] })
    stubIpc(() => {
      throw rustError
    })

    const result = await createAppointment(inputTemplate())

    expect(errorOf(result)).toEqual(rustError)
    expect(getState().appointments).toEqual([])
  })

  it('moveAppointment envía id, inicio y recurso y refleja la cita movida', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 7 })] })
    stubIpc(() => summary({ id: 7, startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00`, resourceId: 2 }))

    dataOf(await moveAppointment(7, { startsAt: `${DAY}T15:00`, resourceId: 2 }))

    expect(calls).toEqual([
      { cmd: 'move_appointment', args: { movement: { id: 7, startsAt: `${DAY}T15:00`, resourceId: 2 } } },
    ])
    expect(getState().appointments).toEqual([appointmentTemplate({ id: 7, startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00`, resourceId: 2 })])
  })

  it('moveAppointment propaga crossesMidnight y deja el espejo intacto', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 7 })] })
    const rustError = appError({ code: 'crossesMidnight', field: 'startsAt' })
    stubIpc(() => {
      throw rustError
    })

    const result = await moveAppointment(7, { startsAt: `${DAY}T23:30`, resourceId: 1 })

    expect(errorOf(result)).toEqual(rustError)
    expect(getState().appointments).toEqual([appointmentTemplate({ id: 7 })])
  })

  it('transitionAppointment envía id y transición y refleja el nuevo estado', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 7 })] })
    stubIpc(() => summary({ id: 7, status: 'inProgress' }))

    dataOf(await transitionAppointment(7, 'start'))

    expect(calls).toEqual([{ cmd: 'transition_appointment', args: { request: { id: 7, transition: 'start' } } }])
    expect(getState().appointments[0]?.status).toBe('inProgress')
  })

  it('transitionAppointment propaga invalidTransition desde Rust', async () => {
    const rustError = appError({ code: 'invalidTransition', message: 'La cita no admite esa operación en su estado actual' })
    stubIpc(() => {
      throw rustError
    })

    expect(errorOf(await transitionAppointment(7, 'reopen'))).toEqual(rustError)
  })

  it('un fallo del canal en una mutación es internal y no toca el espejo', async () => {
    stubIpc(() => {
      throw new Error('canal caído')
    })

    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('internal')
    expect(getState().appointments).toEqual([])
  })
})
