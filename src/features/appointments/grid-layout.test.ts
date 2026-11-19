import { describe, expect, it } from 'vitest'
import type { Appointment, Resource } from '@/lib/model'
import {
  appointmentBox,
  durationMinOf,
  isOutsideAgendaHours,
  isSlotBlocked,
  nowLineOffset,
  slotKeyOf,
  slotStartsOf,
  visibleResourcesFor,
} from './grid-layout'

const DAY = '2026-11-13'

function resource(id: number, active: boolean): Resource {
  return { id, name: `R${id}`, kind: 'cabin', active }
}

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 1,
    clientId: 1,
    serviceId: 1,
    resourceId: 1,
    startsAt: `${DAY}T10:00`,
    endsAt: `${DAY}T11:00`,
    status: 'scheduled',
    priceCentsSnapshot: 1,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

describe('slotStartsOf', () => {
  it('genera 32 franjas de 08:00 a 23:30', () => {
    const slots = slotStartsOf(DAY)

    expect(slots).toHaveLength(32)
    expect(slots[0]).toBe(`${DAY}T08:00`)
    expect(slots[1]).toBe(`${DAY}T08:30`)
    expect(slots.at(-1)).toBe(`${DAY}T23:30`)
    expect(slots).toContain(`${DAY}T23:00`)
  })
})

describe('slotKeyOf', () => {
  it.each([
    ['10:00', '10:00'],
    ['10:29', '10:00'],
    ['10:30', '10:30'],
    ['10:55', '10:30'],
    ['21:00', '21:00'],
    ['23:30', '23:30'],
  ])('%s cae en la franja %s', (time, expected) => {
    expect(slotKeyOf(`${DAY}T${time}`)).toBe(`${DAY}T${expected}`)
  })

  it('no recorta lo anterior a las 08:00 a la primera franja', () => {
    expect(slotKeyOf(`${DAY}T06:15`)).toBe(`${DAY}T06:00`)
    expect(slotStartsOf(DAY)).not.toContain(slotKeyOf(`${DAY}T06:15`))
  })
})

describe('isOutsideAgendaHours', () => {
  it.each([
    ['00:00', true],
    ['07:59', true],
    ['08:00', false],
    ['21:00', false],
    ['23:30', false],
    ['23:59', false],
  ])('%s fuera de horario: %s', (time, expected) => {
    expect(isOutsideAgendaHours(`${DAY}T${time}`)).toBe(expected)
  })
})

describe('visibleResourcesFor', () => {
  const resources = [resource(1, true), resource(2, false), resource(3, true)]

  it('incluye los activos y omite los inactivos sin citas', () => {
    expect(visibleResourcesFor(resources, []).map((row) => row.id)).toEqual([1, 3])
  })

  it('incluye un inactivo que tiene citas ese día', () => {
    const visible = visibleResourcesFor(resources, [appointment({ resourceId: 2 })])

    expect(visible.map((row) => row.id)).toEqual([1, 2, 3])
  })

  it('conserva el orden original y no muta la entrada', () => {
    const copy = [...resources]

    visibleResourcesFor(resources, [appointment({ resourceId: 2 })])

    expect(resources).toEqual(copy)
  })
})

describe('isSlotBlocked', () => {
  const slot = `${DAY}T10:30`
  const rows = [appointment({ id: 1, startsAt: `${DAY}T10:00`, endsAt: `${DAY}T11:00` })]

  it('bloquea una franja cubierta por una cita que la atraviesa', () => {
    expect(isSlotBlocked(slot, 1, rows)).toBe(true)
  })

  it('no bloquea la franja que empieza justo cuando termina la cita', () => {
    expect(isSlotBlocked(`${DAY}T11:00`, 1, rows)).toBe(false)
  })

  it('no bloquea en otro recurso ni por citas canceladas', () => {
    expect(isSlotBlocked(slot, 2, rows)).toBe(false)
    expect(isSlotBlocked(slot, 1, [appointment({ status: 'cancelled' })])).toBe(false)
  })
})

describe('nowLineOffset', () => {
  const slotStart = `${DAY}T10:00`

  it('devuelve 0 al inicio de la franja', () => {
    expect(nowLineOffset(slotStart, `${DAY}T10:00`)).toBe(0)
  })

  it('devuelve la fracción transcurrida dentro de la franja', () => {
    expect(nowLineOffset(slotStart, `${DAY}T10:15`)).toBe(0.5)
    expect(nowLineOffset(slotStart, `${DAY}T10:06`)).toBeCloseTo(0.2)
  })

  it('devuelve null antes del inicio de la franja', () => {
    expect(nowLineOffset(slotStart, `${DAY}T09:59`)).toBeNull()
  })

  it('devuelve null al llegar al fin de la franja y después', () => {
    expect(nowLineOffset(slotStart, `${DAY}T10:30`)).toBeNull()
    expect(nowLineOffset(slotStart, `${DAY}T18:00`)).toBeNull()
  })

  it('devuelve null en otro día a la misma hora', () => {
    expect(nowLineOffset(slotStart, '2026-11-14T10:15')).toBeNull()
  })
})

describe('appointmentBox', () => {
  const dayStart = `${DAY}T08:00`

  it('posiciona una cita de 60 min a las 16:00 en la franja 16 con alto de 2 franjas', () => {
    expect(appointmentBox(`${DAY}T16:00`, 60, dayStart, 30)).toEqual({ topSlots: 16, heightSlots: 2 })
  })

  it('admite inicio a mitad de franja', () => {
    expect(appointmentBox(`${DAY}T10:15`, 30, dayStart, 30)).toEqual({ topSlots: 4.5, heightSlots: 1 })
  })

  it.each([
    [30, 1],
    [60, 2],
    [90, 3],
  ])('una duracion de %i min ocupa %i franjas', (durationMin, heightSlots) => {
    expect(appointmentBox(`${DAY}T09:00`, durationMin, dayStart, 30)).toEqual({ topSlots: 2, heightSlots })
  })

  it('recorta lo que empieza antes del rango visible', () => {
    expect(appointmentBox(`${DAY}T07:30`, 60, dayStart, 30)).toEqual({ topSlots: 0, heightSlots: 1 })
  })

  it('recorta lo que termina despues del rango visible', () => {
    expect(appointmentBox(`${DAY}T23:30`, 90, dayStart, 30)).toEqual({ topSlots: 31, heightSlots: 1 })
  })

  it('devuelve null si queda totalmente fuera del rango visible', () => {
    expect(appointmentBox(`${DAY}T06:00`, 60, dayStart, 30)).toBeNull()
  })
})

describe('durationMinOf', () => {
  it('calcula la duracion real entre inicio y fin', () => {
    expect(durationMinOf({ startsAt: `${DAY}T16:00`, endsAt: `${DAY}T17:30` })).toBe(90)
  })

  it('cruza medianoche', () => {
    expect(durationMinOf({ startsAt: `${DAY}T23:30`, endsAt: '2026-11-14T00:30' })).toBe(60)
  })
})
