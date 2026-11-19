import { describe, expect, it } from 'vitest'
import type { Appointment, AppointmentStatus, Client, Payment, Resource, Service } from '@/lib/model'
import { buildClientHistory, vesUsdEquivalentOfCompleted } from './compute'

const CLIENT: Client = { id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null }
const SERVICES: Service[] = [
  { id: 1, name: 'Limpieza', priceCents: 3500, currency: 'USD', durationMin: 60, active: true },
  { id: 2, name: 'Peeling', priceCents: 5000, currency: 'USD', durationMin: 45, active: false },
]
const RESOURCES: Resource[] = [
  { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
  { id: 2, name: 'Manicure', kind: 'manicure', active: false },
]

function appointment(id: number, status: AppointmentStatus, startsAt: string, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id,
    clientId: 1,
    serviceId: 1,
    resourceId: 1,
    startsAt,
    endsAt: startsAt,
    status,
    priceCentsSnapshot: 3500,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

function payment(id: number, appointmentId: number, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    appointmentId,
    methodId: 1,
    currency: 'USD',
    amountCents: 1000,
    rateBsPerUsdE4: null,
    usdEquivalentCents: 1000,
    paidAt: '2026-11-01T10:00',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

const VOIDED = { voidedAt: '2026-11-01T11:00', voidedBy: 1, voidReason: 'error' }

function build(appointments: Appointment[], payments: Payment[] = [], client: Client = CLIENT) {
  return buildClientHistory({ client, appointments, payments, services: SERVICES, resources: RESOURCES })
}

describe('buildClientHistory', () => {
  it('suma minutos solo de citas completadas', () => {
    const history = build([
      appointment(1, 'completed', '2026-11-01T10:00', { durationMinSnapshot: 60 }),
      appointment(2, 'completed', '2026-11-02T10:00', { durationMinSnapshot: 45 }),
      appointment(3, 'cancelled', '2026-11-03T10:00', { durationMinSnapshot: 90 }),
      appointment(4, 'noShow', '2026-11-04T10:00', { durationMinSnapshot: 30 }),
      appointment(5, 'scheduled', '2026-11-05T10:00', { durationMinSnapshot: 20 }),
      appointment(6, 'inProgress', '2026-11-06T10:00', { durationMinSnapshot: 10 }),
    ])

    expect(history.totalMinutes).toBe(105)
  })

  it('paidByCurrency suma pagos no anulados de citas completadas', () => {
    const history = build(
      [appointment(1, 'completed', '2026-11-01T10:00'), appointment(2, 'cancelled', '2026-11-02T10:00')],
      [
        payment(1, 1, { amountCents: 2000 }),
        payment(2, 1, { currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000, usdEquivalentCents: 2000 }),
        payment(3, 1, { amountCents: 999, ...VOIDED }),
        payment(4, 2, { amountCents: 500 }),
      ],
    )

    expect(history.paidByCurrency).toEqual({ USD: 2000, VES: 73000 })
  })

  it('collectedOnNonCompleted suma pagos activos de canceladas y no asistió y excluye anulados', () => {
    const history = build(
      [
        appointment(1, 'cancelled', '2026-11-01T10:00'),
        appointment(2, 'noShow', '2026-11-02T10:00'),
        appointment(3, 'completed', '2026-11-03T10:00'),
      ],
      [
        payment(1, 1, { amountCents: 700 }),
        payment(2, 2, { currency: 'VES', amountCents: 5000, rateBsPerUsdE4: 365000, usdEquivalentCents: 14 }),
        payment(3, 2, { amountCents: 400, ...VOIDED }),
        payment(4, 3, { amountCents: 900 }),
      ],
    )

    expect(history.collectedOnNonCompletedByCurrency).toEqual({ USD: 700, VES: 5000 })
  })

  it('los pagos de citas programadas o en curso no suman en totales pero se listan', () => {
    const history = build(
      [appointment(1, 'scheduled', '2026-11-01T10:00'), appointment(2, 'inProgress', '2026-11-02T10:00')],
      [payment(1, 1), payment(2, 2)],
    )

    expect(history.paidByCurrency).toEqual({ USD: 0, VES: 0 })
    expect(history.collectedOnNonCompletedByCurrency).toEqual({ USD: 0, VES: 0 })
    expect(history.entries.flatMap((entry) => entry.payments.map((item) => item.id)).toSorted()).toEqual([1, 2])
  })

  it('ordena las citas de más reciente a más antigua', () => {
    const history = build([
      appointment(1, 'completed', '2026-11-01T10:00'),
      appointment(2, 'scheduled', '2026-11-09T10:00'),
      appointment(3, 'cancelled', '2026-11-05T10:00'),
    ])

    expect(history.entries.map((entry) => entry.id)).toEqual([2, 3, 1])
  })

  it('excluye citas de otros clientes y pagos de otras citas', () => {
    const history = build(
      [appointment(1, 'completed', '2026-11-01T10:00'), appointment(2, 'completed', '2026-11-02T10:00', { clientId: 2 })],
      [payment(1, 1), payment(2, 2)],
    )

    expect(history.entries.map((entry) => entry.id)).toEqual([1])
    expect(history.entries[0]?.payments.map((item) => item.id)).toEqual([1])
    expect(history.paidByCurrency.USD).toBe(1000)
  })

  it('resuelve nombres de servicio y recurso inactivos', () => {
    const history = build([appointment(1, 'completed', '2026-11-01T10:00', { serviceId: 2, resourceId: 2 })])

    expect(history.entries[0]).toMatchObject({ serviceName: 'Peeling', resourceName: 'Manicure' })
  })

  it('usa nombres de respaldo si el servicio o recurso no existe', () => {
    const history = build([appointment(1, 'completed', '2026-11-01T10:00', { serviceId: 99, resourceId: 99 })])

    expect(history.entries[0]).toMatchObject({ serviceName: 'Servicio', resourceName: 'Recurso' })
  })

  it('conserva al cliente eliminado y su historial', () => {
    const deleted: Client = { ...CLIENT, deletedAt: '2026-11-07T10:00' }
    const history = build([appointment(1, 'completed', '2026-11-01T10:00')], [], deleted)

    expect(history.client.deletedAt).toBe('2026-11-07T10:00')
    expect(history.entries).toHaveLength(1)
  })

  it('devuelve ceros y lista vacía sin citas', () => {
    expect(build([])).toEqual({
      client: CLIENT,
      entries: [],
      totalMinutes: 0,
      paidByCurrency: { USD: 0, VES: 0 },
      collectedOnNonCompletedByCurrency: { USD: 0, VES: 0 },
    })
  })

  it('no muta las entradas', () => {
    const appointments = [appointment(1, 'completed', '2026-11-01T10:00'), appointment(2, 'completed', '2026-11-09T10:00')]
    const payments = [payment(1, 1)]
    const snapshot = structuredClone({ appointments, payments })

    build(appointments, payments)

    expect({ appointments, payments }).toEqual(snapshot)
  })
})

describe('vesUsdEquivalentOfCompleted', () => {
  it('suma el equivalente USD de pagos VES activos de citas completadas', () => {
    const history = build(
      [appointment(1, 'completed', '2026-11-01T10:00'), appointment(2, 'cancelled', '2026-11-02T10:00')],
      [
        payment(1, 1, { currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000, usdEquivalentCents: 2000 }),
        payment(2, 1, { currency: 'VES', amountCents: 100, rateBsPerUsdE4: 365000, usdEquivalentCents: 7, ...VOIDED }),
        payment(3, 1, { amountCents: 1500, usdEquivalentCents: 1500 }),
        payment(4, 2, { currency: 'VES', amountCents: 5000, rateBsPerUsdE4: 365000, usdEquivalentCents: 14 }),
      ],
    )

    expect(vesUsdEquivalentOfCompleted(history.entries)).toBe(2000)
  })
})
