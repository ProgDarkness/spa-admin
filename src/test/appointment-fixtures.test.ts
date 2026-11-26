import { beforeEach, describe, expect, it } from 'vitest'
import { signInAs } from './session'
import { err, ok } from '@/lib/result'
import {
  ACTIVE_CLIENT,
  CABIN_ONE,
  DAY,
  FACIAL_SERVICE_ID,
  appointmentById,
  appointmentTemplate,
  dataOf,
  errorOf,
  inputTemplate,
  resetWithEmptyAgenda,
  seedAppointments,
  storedAppointments,
} from './appointment-fixtures'

beforeEach(() => {
  resetWithEmptyAgenda()
})

describe('resetWithEmptyAgenda', () => {
  it('congela la fecha y deja la agenda vacía', async () => {
    signInAs('recepcion')

    expect(new Date().getDate()).toBe(12)
    expect(await storedAppointments()).toEqual([])
  })
})

describe('appointmentTemplate', () => {
  it('construye una cita programada válida con el rango de una hora', () => {
    const template = appointmentTemplate()

    expect(template).toMatchObject({ status: 'scheduled', startsAt: `${DAY}T10:00`, endsAt: `${DAY}T11:00`, resourceId: CABIN_ONE })
    expect(template.durationMinSnapshot).toBe(60)
    expect(template.notes).toBeNull()
  })

  it('aplica los overrides sin perder el resto de campos', () => {
    const template = appointmentTemplate({ id: 5, status: 'completed' })

    expect(template).toMatchObject({ id: 5, status: 'completed', serviceId: FACIAL_SERVICE_ID })
  })

  it('devuelve objetos nuevos en cada llamada', () => {
    const first = appointmentTemplate()
    const second = appointmentTemplate()
    first.notes = 'mutada'

    expect(second.notes).toBeNull()
    expect(first).not.toBe(second)
  })
})

describe('inputTemplate', () => {
  it('construye una entrada válida con cliente activo y sin notas', () => {
    expect(inputTemplate()).toEqual({
      clientId: ACTIVE_CLIENT,
      serviceId: FACIAL_SERVICE_ID,
      resourceId: CABIN_ONE,
      startsAt: `${DAY}T12:00`,
      notes: null,
    })
  })

  it('aplica overrides y no comparte referencias entre llamadas', () => {
    const first = inputTemplate({ notes: 'a' })
    const second = inputTemplate()
    first.startsAt = 'otra'

    expect(first.notes).toBe('a')
    expect(second.notes).toBeNull()
    expect(second.startsAt).toBe(`${DAY}T12:00`)
  })
})

describe('seedAppointments y appointmentById', () => {
  it('reemplaza las citas del backend y permite recuperarlas por id', async () => {
    signInAs('recepcion')
    seedAppointments(appointmentTemplate({ id: 1 }), appointmentTemplate({ id: 2 }))

    expect((await storedAppointments()).map((row) => row.id)).toEqual([1, 2])
    expect((await appointmentById(2)).id).toBe(2)
  })

  it('lanza si la cita no existe', async () => {
    signInAs('recepcion')

    await expect(appointmentById(999)).rejects.toThrow('Cita inexistente 999')
  })
})

describe('dataOf y errorOf', () => {
  it('dataOf devuelve los datos de un resultado ok y lanza ante un error', () => {
    expect(dataOf(ok(3))).toBe(3)
    expect(() => dataOf(err('notFound', 'x'))).toThrow('Se esperaba ok y llegó notFound')
  })

  it('errorOf devuelve el error y lanza ante un ok', () => {
    expect(errorOf(err('overlap', 'choque')).message).toBe('choque')
    expect(() => errorOf(ok(1))).toThrow('Se esperaba un error')
  })
})
