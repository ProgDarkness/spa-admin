import { describe, expect, it } from 'vitest'
import {
  appointmentIdentitiesOf,
  clientIdentitiesOf,
  EXPECTED_DEV_APPOINTMENTS,
  EXPECTED_DEV_CLIENTS,
  EXPECTED_DEV_PAYMENT_METHODS,
  EXPECTED_DEV_RATES,
  EXPECTED_DEV_RESOURCES,
  EXPECTED_DEV_SERVICES,
  paymentMethodIdentitiesOf,
  rateIdentitiesOf,
  resourceIdentitiesOf,
  serviceIdentitiesOf,
} from './dev-seed-expectations'

describe('resourceIdentitiesOf', () => {
  it('conserva solo id, name, kind y active de cada fila', () => {
    const rows = [{ id: 1, name: 'A', kind: 'cabin', active: true, createdAt: 'x', updatedAt: 'y' }]

    expect(resourceIdentitiesOf(rows)).toEqual([{ id: 1, name: 'A', kind: 'cabin', active: true }])
  })

  it.each([[null], [undefined], ['texto'], [{}], [42]])('devuelve vacío si lo recibido no es un arreglo (%s)', (value) => {
    expect(resourceIdentitiesOf(value)).toEqual([])
  })

  it('devuelve vacío para un arreglo vacío', () => {
    expect(resourceIdentitiesOf([])).toEqual([])
  })
})

describe('appointmentIdentitiesOf', () => {
  it('conserva los campos de contrato de cada cita y descarta los demás', () => {
    const row = {
      id: 5,
      clientId: 4,
      serviceId: 1,
      resourceId: 1,
      startsAt: '2026-11-13T16:00',
      endsAt: '2026-11-13T17:00',
      status: 'scheduled',
      priceCentsSnapshot: 3500,
      durationMinSnapshot: 60,
      notes: null,
    }

    expect(appointmentIdentitiesOf([{ ...row, createdAt: 'x', updatedBy: 1 }])).toEqual([row])
  })

  it.each([[null], [undefined], ['texto'], [{}], [42]])('devuelve vacío si lo recibido no es un arreglo (%s)', (value) => {
    expect(appointmentIdentitiesOf(value)).toEqual([])
  })
})

describe('clientIdentitiesOf', () => {
  it('conserva id, nombre, apellido, cédula y teléfono, y reduce deletedAt a un indicador', () => {
    const rows = [
      { id: 1, firstName: 'Ana', lastName: 'Pérez', nationalId: 'V-12345678', phone: '0414-1234567', deletedAt: null, extra: 1 },
      { id: 2, firstName: 'Luis', lastName: 'Díaz', nationalId: 'V-87654321', phone: '0424-7654321', deletedAt: '2026-11-12T10:00' },
    ]

    expect(clientIdentitiesOf(rows)).toEqual([
      { id: 1, firstName: 'Ana', lastName: 'Pérez', nationalId: 'V-12345678', phone: '0414-1234567', deleted: false },
      { id: 2, firstName: 'Luis', lastName: 'Díaz', nationalId: 'V-87654321', phone: '0424-7654321', deleted: true },
    ])
  })

  it.each([[null], [undefined], ['texto'], [{}], [42]])('devuelve vacío si lo recibido no es un arreglo (%s)', (value) => {
    expect(clientIdentitiesOf(value)).toEqual([])
  })
})

describe('serviceIdentitiesOf', () => {
  it('conserva solo id y name de cada fila', () => {
    const rows = [{ id: 2, name: 'Corte', priceCents: 100, durationMin: 30 }]

    expect(serviceIdentitiesOf(rows)).toEqual([{ id: 2, name: 'Corte' }])
  })

  it('devuelve vacío si lo recibido no es un arreglo', () => {
    expect(serviceIdentitiesOf(null)).toEqual([])
  })
})

describe('paymentMethodIdentitiesOf', () => {
  it('conserva solo id, name y active de cada fila', () => {
    const rows = [{ id: 1, name: 'Efectivo', active: true, createdAt: 'x', updatedAt: 'y' }]

    expect(paymentMethodIdentitiesOf(rows)).toEqual([{ id: 1, name: 'Efectivo', active: true }])
  })

  it('devuelve vacío si lo recibido no es un arreglo', () => {
    expect(paymentMethodIdentitiesOf(null)).toEqual([])
  })
})

describe('rateIdentitiesOf', () => {
  it('conserva solo date y rateBsPerUsdE4 de cada fila', () => {
    const rows = [{ date: '2026-11-12', rateBsPerUsdE4: 365000, extra: 1 }]

    expect(rateIdentitiesOf(rows)).toEqual([{ date: '2026-11-12', rateBsPerUsdE4: 365000 }])
  })

  it('devuelve vacío si lo recibido no es un arreglo', () => {
    expect(rateIdentitiesOf(undefined)).toEqual([])
  })
})

describe('esperados del seed de desarrollo', () => {
  it('las tasas esperadas son siete días hasta la fecha de referencia, en orden descendente', () => {
    expect(EXPECTED_DEV_RATES).toHaveLength(7)
    expect(EXPECTED_DEV_RATES[0]).toEqual({ date: '2026-11-12', rateBsPerUsdE4: 365000 })
    expect(EXPECTED_DEV_RATES.map((rate) => rate.date)).toEqual(
      EXPECTED_DEV_RATES.map((rate) => rate.date).toSorted().toReversed(),
    )
  })

  it('los métodos de pago esperados son los cinco del seed, activos y ordenados por nombre como el backend', () => {
    expect(EXPECTED_DEV_PAYMENT_METHODS.map(({ id, name, active }) => [id, name, active])).toEqual([
      [1, 'Efectivo', true],
      [2, 'Pago móvil', true],
      [5, 'Punto de venta', true],
      [4, 'Transferencia', true],
      [3, 'Zelle', true],
    ])
  })

  it('los recursos esperados son Cabina 1, Cabina 2 y Manicure (Rosa) inactivo con ids 1 a 3', () => {
    expect(EXPECTED_DEV_RESOURCES.map(({ id, name, active }) => [id, name, active])).toEqual([
      [1, 'Cabina 1', true],
      [2, 'Cabina 2', true],
      [3, 'Manicure (Rosa)', false],
    ])
  })

  it('los clientes esperados son los nueve del mock con ids 1 a 9 y solo el último borrado', () => {
    expect(EXPECTED_DEV_CLIENTS.map(({ id, deleted }) => [id, deleted])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
      [6, false],
      [7, false],
      [8, false],
      [9, true],
    ])
    expect(EXPECTED_DEV_CLIENTS[0]).toEqual({
      id: 1,
      firstName: 'María',
      lastName: 'González',
      nationalId: 'V-12345678',
      phone: '0414-1234567',
      deleted: false,
    })
  })

  it('los servicios esperados provienen del seed y no están vacíos', () => {
    expect(EXPECTED_DEV_SERVICES.length).toBeGreaterThan(0)
    expect(EXPECTED_DEV_SERVICES.every((service) => typeof service.name === 'string' && service.name !== '')).toBe(true)
  })

  it('las citas esperadas son las dieciséis del mock con las mismas filas que el seed de Rust', () => {
    expect(
      EXPECTED_DEV_APPOINTMENTS.map((row) => [
        row.id,
        row.clientId,
        row.serviceId,
        row.resourceId,
        row.startsAt,
        row.endsAt,
        row.status,
        row.priceCentsSnapshot,
        row.durationMinSnapshot,
      ]),
    ).toEqual([
      [1, 1, 1, 1, '2026-10-05T08:00', '2026-10-05T09:00', 'completed', 3500, 60],
      [2, 2, 8, 1, '2026-10-15T10:00', '2026-10-15T10:45', 'completed', 5000, 45],
      [3, 3, 1, 1, '2026-10-20T12:00', '2026-10-20T13:00', 'cancelled', 3500, 60],
      [4, 1, 2, 1, '2026-11-01T14:00', '2026-11-01T15:00', 'completed', 4000, 60],
      [5, 4, 1, 1, '2026-11-13T16:00', '2026-11-13T17:00', 'scheduled', 3500, 60],
      [6, 5, 2, 1, '2026-11-10T18:00', '2026-11-10T19:00', 'noShow', 4000, 60],
      [7, 6, 6, 2, '2026-10-10T08:00', '2026-10-10T09:30', 'noShow', 6000, 90],
      [8, 7, 7, 2, '2026-10-25T10:00', '2026-10-25T11:00', 'completed', 12000, 60],
      [9, 2, 6, 2, '2026-11-09T12:00', '2026-11-09T13:30', 'completed', 6000, 90],
      [10, 3, 1, 2, '2026-11-11T14:00', '2026-11-11T15:00', 'cancelled', 3500, 60],
      [11, 8, 2, 2, '2026-11-12T16:00', '2026-11-12T17:00', 'inProgress', 4000, 60],
      [12, 1, 3, 2, '2026-11-14T18:00', '2026-11-14T18:30', 'scheduled', 1000, 30],
      [13, 9, 1, 2, '2026-10-31T23:00', '2026-11-01T00:00', 'completed', 3500, 60],
      [14, 2, 4, 3, '2026-10-07T08:00', '2026-10-07T08:45', 'completed', 1500, 45],
      [15, 7, 5, 3, '2026-10-17T10:00', '2026-10-17T11:00', 'completed', 2000, 60],
      [16, 5, 4, 3, '2026-11-10T12:00', '2026-11-10T12:45', 'completed', 1500, 45],
    ])
  })
})
