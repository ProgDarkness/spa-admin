import { describe, expect, it } from 'vitest'
import type { Appointment, AppointmentStatus, Currency, Id, Payment } from '@/lib/model'
import { computeMonthlyMetrics } from './compute'

let sequence = 0

function appointment(clientId: Id, startsAt: string, status: AppointmentStatus = 'completed'): Appointment {
  sequence += 1
  return {
    id: sequence,
    clientId,
    serviceId: 1,
    resourceId: 1,
    startsAt,
    endsAt: startsAt,
    status,
    priceCentsSnapshot: 1000,
    durationMinSnapshot: 30,
    notes: null,
  }
}

function payment(target: Appointment, currency: Currency, amountCents: number, voided = false): Payment {
  sequence += 1
  return {
    id: sequence,
    appointmentId: target.id,
    methodId: 1,
    currency,
    amountCents,
    rateBsPerUsdE4: currency === 'VES' ? 365000 : null,
    usdEquivalentCents: amountCents,
    paidAt: target.startsAt,
    voidedAt: voided ? target.startsAt : null,
    voidedBy: voided ? 1 : null,
    voidReason: voided ? 'error' : null,
  }
}

describe('computeMonthlyMetrics clientes nuevos y recurrentes', () => {
  it('cliente con completed en octubre y noviembre es recurrente en noviembre y nuevo en octubre', () => {
    const rows = [appointment(1, '2026-10-05T10:00'), appointment(1, '2026-11-03T10:00')]

    const november = computeMonthlyMetrics('2026-11', rows, [])
    const october = computeMonthlyMetrics('2026-10', rows, [])

    expect([november.newClients, november.recurringClients]).toEqual([0, 1])
    expect([october.newClients, october.recurringClients]).toEqual([1, 0])
  })

  it('cliente con su primera completed en noviembre es nuevo', () => {
    const november = computeMonthlyMetrics('2026-11', [appointment(2, '2026-11-20T10:00')], [])

    expect([november.newClients, november.recurringClients]).toEqual([1, 0])
  })

  it('dos completed en el mismo mes sin historial previo cuentan como un solo nuevo', () => {
    const rows = [appointment(3, '2026-11-02T10:00'), appointment(3, '2026-11-09T10:00')]

    const november = computeMonthlyMetrics('2026-11', rows, [])

    expect([november.newClients, november.recurringClients]).toEqual([1, 0])
  })

  it('una completed posterior al mes no vuelve recurrente ni nuevo al cliente en ese mes', () => {
    const rows = [appointment(4, '2026-11-02T10:00'), appointment(4, '2026-12-02T10:00')]

    const november = computeMonthlyMetrics('2026-11', rows, [])
    const december = computeMonthlyMetrics('2026-12', rows, [])

    expect([november.newClients, november.recurringClients]).toEqual([1, 0])
    expect([december.newClients, december.recurringClients]).toEqual([0, 1])
  })

  it('citas no completadas previas no hacen recurrente al cliente', () => {
    const rows = [appointment(5, '2026-10-05T10:00', 'noShow'), appointment(5, '2026-11-05T10:00')]

    const november = computeMonthlyMetrics('2026-11', rows, [])

    expect([november.newClients, november.recurringClients]).toEqual([1, 0])
  })

  it('un cliente con solo citas canceladas en el mes no cuenta como nuevo ni recurrente', () => {
    const november = computeMonthlyMetrics('2026-11', [appointment(6, '2026-11-05T10:00', 'cancelled')], [])

    expect([november.newClients, november.recurringClients]).toEqual([0, 0])
  })
})

describe('computeMonthlyMetrics límite de mes', () => {
  const lastMinuteOfOctober = appointment(7, '2026-10-31T23:30')
  const firstMinuteOfNovember = appointment(8, '2026-11-01T00:00')
  const rows = [lastMinuteOfOctober, firstMinuteOfNovember]

  it('2026-10-31T23:30 cuenta en octubre', () => {
    const october = computeMonthlyMetrics('2026-10', rows, [])

    expect(october.appointments.completed).toBe(1)
    expect(october.newClients).toBe(1)
  })

  it('2026-11-01T00:00 cuenta en noviembre', () => {
    const november = computeMonthlyMetrics('2026-11', rows, [])

    expect(november.appointments.completed).toBe(1)
    expect(november.newClients).toBe(1)
  })

  it('el ingreso sigue el mes de la cita y no el del pago', () => {
    const payments = [payment(lastMinuteOfOctober, 'USD', 500)]

    expect(computeMonthlyMetrics('2026-10', rows, payments).revenueByCurrency.USD).toBe(500)
    expect(computeMonthlyMetrics('2026-11', rows, payments).revenueByCurrency.USD).toBe(0)
  })
})

describe('computeMonthlyMetrics conteos por estado', () => {
  const rows = [
    appointment(1, '2026-11-02T10:00', 'scheduled'),
    appointment(2, '2026-11-03T10:00', 'scheduled'),
    appointment(3, '2026-11-04T10:00', 'completed'),
    appointment(4, '2026-11-05T10:00', 'cancelled'),
    appointment(5, '2026-11-06T10:00', 'noShow'),
    appointment(6, '2026-11-07T10:00', 'noShow'),
    appointment(7, '2026-11-08T10:00', 'inProgress'),
    appointment(8, '2026-12-01T10:00', 'scheduled'),
  ]

  it('cuenta cada estado por separado dentro del mes', () => {
    const { appointments } = computeMonthlyMetrics('2026-11', rows, [])

    expect(appointments).toEqual({ scheduled: 2, inProgress: 1, completed: 1, cancelled: 1, noShow: 2 })
  })

  it('inProgress entra en su propio contador', () => {
    const only = [appointment(9, '2026-11-08T10:00', 'inProgress')]

    expect(computeMonthlyMetrics('2026-11', only, []).appointments).toEqual({
      scheduled: 0,
      inProgress: 1,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    })
  })
})

describe('computeMonthlyMetrics ingresos', () => {
  const completed = appointment(1, '2026-11-02T10:00', 'completed')
  const cancelled = appointment(2, '2026-11-03T10:00', 'cancelled')
  const noShow = appointment(3, '2026-11-04T10:00', 'noShow')
  const scheduled = appointment(4, '2026-11-05T10:00', 'scheduled')
  const rows = [completed, cancelled, noShow, scheduled]

  it('suma por moneda sin convertir y excluye pagos anulados', () => {
    const payments = [
      payment(completed, 'USD', 2000),
      payment(completed, 'VES', 73000),
      payment(completed, 'USD', 500),
      payment(completed, 'USD', 9999, true),
    ]

    const { revenueByCurrency } = computeMonthlyMetrics('2026-11', rows, payments)

    expect(revenueByCurrency).toEqual({ USD: 2500, VES: 73000 })
  })

  it('los cobros de canceladas y no asistidas van aparte y no son ingreso', () => {
    const payments = [
      payment(cancelled, 'USD', 1500),
      payment(noShow, 'VES', 4000),
      payment(noShow, 'USD', 700, true),
      payment(scheduled, 'USD', 300),
    ]

    const metrics = computeMonthlyMetrics('2026-11', rows, payments)

    expect(metrics.revenueByCurrency).toEqual({ USD: 0, VES: 0 })
    expect(metrics.collectedOnNonCompletedByCurrency).toEqual({ USD: 1500, VES: 4000 })
  })

  it('ignora pagos de citas inexistentes', () => {
    const orphan = { ...payment(completed, 'USD', 800), appointmentId: 99999 }

    const metrics = computeMonthlyMetrics('2026-11', rows, [orphan])

    expect(metrics.revenueByCurrency).toEqual({ USD: 0, VES: 0 })
    expect(metrics.collectedOnNonCompletedByCurrency).toEqual({ USD: 0, VES: 0 })
  })
})

describe('computeMonthlyMetrics mes vacío e inmutabilidad', () => {
  it('devuelve ceros y el mes pedido', () => {
    expect(computeMonthlyMetrics('2027-01', [], [])).toEqual({
      month: '2027-01',
      newClients: 0,
      recurringClients: 0,
      appointments: { scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, noShow: 0 },
      revenueByCurrency: { USD: 0, VES: 0 },
      collectedOnNonCompletedByCurrency: { USD: 0, VES: 0 },
    })
  })

  it('no muta las entradas ni el orden', () => {
    const rows = [appointment(1, '2026-11-09T10:00'), appointment(1, '2026-10-01T10:00')]
    const payments = [payment(rows[0]!, 'USD', 100)]
    const rowsBefore = structuredClone(rows)
    const paymentsBefore = structuredClone(payments)

    computeMonthlyMetrics('2026-11', rows, payments)

    expect(rows).toEqual(rowsBefore)
    expect(payments).toEqual(paymentsBefore)
  })
})

describe('computeMonthlyMetrics sin depender del espejo de clientes', () => {
  it('cuenta clientes nuevos y recurrentes solo con los clientId de las citas', () => {
    const march = appointment(500, '2026-03-10T09:00')
    const november = appointment(500, '2026-11-10T09:00')
    const newcomer = appointment(501, '2026-11-11T09:00')

    const metrics = computeMonthlyMetrics('2026-11', [march, november, newcomer], [])

    expect(metrics).toMatchObject({ newClients: 1, recurringClients: 1 })
  })
})
