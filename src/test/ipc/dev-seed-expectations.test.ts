import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSeed } from '@/lib/mock/seed'
import {
  appointmentIdentitiesOf,
  clientIdentitiesOf,
  EXPECTED_DEV_APPOINTMENTS,
  EXPECTED_DEV_CLIENTS,
  EXPECTED_DEV_PAYMENT_METHODS,
  EXPECTED_DEV_PAYMENTS,
  paymentIdentitiesOf,
  SEED_REFERENCE_DATE,
  EXPECTED_DEV_RATES,
  EXPECTED_DEV_RESOURCES,
  EXPECTED_DEV_SERVICES,
  paymentMethodIdentitiesOf,
  rateIdentitiesOf,
  resourceIdentitiesOf,
  serviceIdentitiesOf,
} from './dev-seed-expectations'

const SEED_ROW = /seed\(\s*(\d+),\s*(\d+),\s*PaymentCurrency::(Usd|Ves),\s*([\d_]+),\s*(true|false),?\s*\)/g
const EXPECTED_ROW =
  /\(\s*(\d+),\s*(\d+),\s*(\d+),\s*"(USD|VES)",\s*([\d_]+),\s*(?:None|Some\(\s*([\d_]+),?\s*\)),\s*([\d_]+),\s*(?:None|Some\(\s*(VOID_REASON|"[^"]*"),?\s*\)),?\s*\)/g

function rustSource(file: string): string {
  return readFileSync(resolve(__dirname, '../../../src-tauri/src', file), 'utf8')
}

function digitsOf(raw: string | undefined): number {
  return Number((raw ?? '').replaceAll('_', ''))
}

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

  it('los pagos esperados son los once del mock con la tasa 365000 y solo el pago 7 anulado', () => {
    expect(EXPECTED_DEV_PAYMENTS).toEqual([
      { id: 1, appointmentId: 1, methodId: 1, currency: 'USD', amountCents: 3500, rateBsPerUsdE4: null, usdEquivalentCents: 3500, voidReason: null },
      { id: 2, appointmentId: 2, methodId: 2, currency: 'VES', amountCents: 182500, rateBsPerUsdE4: 365000, usdEquivalentCents: 5000, voidReason: null },
      { id: 3, appointmentId: 4, methodId: 3, currency: 'USD', amountCents: 2000, rateBsPerUsdE4: null, usdEquivalentCents: 2000, voidReason: null },
      { id: 4, appointmentId: 4, methodId: 2, currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000, usdEquivalentCents: 2000, voidReason: null },
      { id: 5, appointmentId: 8, methodId: 4, currency: 'USD', amountCents: 12000, rateBsPerUsdE4: null, usdEquivalentCents: 12000, voidReason: null },
      { id: 6, appointmentId: 9, methodId: 3, currency: 'USD', amountCents: 6000, rateBsPerUsdE4: null, usdEquivalentCents: 6000, voidReason: null },
      { id: 7, appointmentId: 9, methodId: 1, currency: 'USD', amountCents: 1000, rateBsPerUsdE4: null, usdEquivalentCents: 1000, voidReason: 'Monto digitado por error' },
      { id: 8, appointmentId: 10, methodId: 1, currency: 'USD', amountCents: 1500, rateBsPerUsdE4: null, usdEquivalentCents: 1500, voidReason: null },
      { id: 9, appointmentId: 13, methodId: 1, currency: 'USD', amountCents: 3500, rateBsPerUsdE4: null, usdEquivalentCents: 3500, voidReason: null },
      { id: 10, appointmentId: 14, methodId: 1, currency: 'USD', amountCents: 1500, rateBsPerUsdE4: null, usdEquivalentCents: 1500, voidReason: null },
      { id: 11, appointmentId: 15, methodId: 5, currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000, usdEquivalentCents: 2000, voidReason: null },
    ])
  })

  it('los pagos esperados coinciden con los del seed del mock', () => {
    expect(paymentIdentitiesOf(createSeed(SEED_REFERENCE_DATE).payments)).toEqual(EXPECTED_DEV_PAYMENTS)
  })

  it('los pagos esperados coinciden con la tabla SEED_PAYMENTS y las constantes del seed de Rust', () => {
    const source = rustSource('dev_seed_payments.rs')
    const rows = [...source.matchAll(SEED_ROW)].map((match) => ({
      appointmentId: Number(match[1]),
      methodId: Number(match[2]),
      currency: match[3]?.toUpperCase(),
      amountCents: digitsOf(match[4]),
      isVoided: match[5] === 'true',
    }))
    const rate = digitsOf(source.match(/const SEED_RATE_E4: i64 =\s*([\d_]+)\s*;/)?.[1])
    const reason = source.match(/const VOID_REASON: &str =\s*"([^"]*)"\s*;/)?.[1]

    expect(rows).toEqual(
      EXPECTED_DEV_PAYMENTS.map(({ appointmentId, methodId, currency, amountCents, voidReason }) => ({
        appointmentId,
        methodId,
        currency,
        amountCents,
        isVoided: voidReason !== null,
      })),
    )
    expect(EXPECTED_DEV_PAYMENTS.filter((payment) => payment.currency === 'VES').map((payment) => payment.rateBsPerUsdE4)).toEqual(
      rows.filter((row) => row.currency === 'VES').map(() => rate),
    )
    expect(EXPECTED_DEV_PAYMENTS.flatMap((payment) => (payment.voidReason === null ? [] : [payment.voidReason]))).toEqual([reason])
  })

  it('los pagos esperados coinciden con la tabla EXPECTED del test de Rust: tasa, equivalente y motivo exacto', () => {
    const source = rustSource('dev_seed_payments_test.rs')
    const reason = source.match(/const VOID_REASON: &str =\s*"([^"]*)"\s*;/)?.[1]
    const rows = [...source.matchAll(EXPECTED_ROW)].map((match) => ({
      id: Number(match[1]),
      appointmentId: Number(match[2]),
      methodId: Number(match[3]),
      currency: match[4],
      amountCents: digitsOf(match[5]),
      rateBsPerUsdE4: match[6] ? digitsOf(match[6]) : null,
      usdEquivalentCents: digitsOf(match[7]),
      voidReason: match[8] ? (match[8] === 'VOID_REASON' ? reason : match[8].slice(1, -1)) : null,
    }))

    expect(rows).toEqual(EXPECTED_DEV_PAYMENTS)
  })

  it('el parseo tolera tuplas y filas partidas en varias líneas por rustfmt', () => {
    const multiline = `seed(\n        9,\n        1,\n        PaymentCurrency::Usd,\n        3_500,\n        true,\n    )`
    const tuple = `(\n        7,\n        9,\n        1,\n        "USD",\n        1_000,\n        None,\n        1_000,\n        Some(VOID_REASON),\n    )`

    expect(multiline.match(SEED_ROW)?.[0]).toBe(multiline)
    expect(tuple.match(EXPECTED_ROW)?.[0]).toBe(tuple)
  })
})
