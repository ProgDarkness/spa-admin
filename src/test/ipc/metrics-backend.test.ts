import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commands,
  type AppointmentStatus,
  type AppointmentSummary,
  type MonthlyMetrics,
  type PaymentSummary,
} from '@/lib/bindings'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createMetricsIpcBackend } from './metrics-backend'
import { createSharedRows } from './shared-rows'

const NOVEMBER = '2026-11'
const CLIENT = 1
const OTHER_CLIENT = 2
const SAFE_LIMIT = Number.MAX_SAFE_INTEGER
const MAX_PAYMENT = 100_000_000_000

let session: SessionUser | null

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function appointment(
  id: number,
  status: AppointmentStatus,
  startsAt: string,
  overrides: Partial<AppointmentSummary> = {},
): AppointmentSummary {
  return {
    id,
    clientId: CLIENT,
    serviceId: 1,
    resourceId: 1,
    startsAt,
    endsAt: startsAt,
    status,
    priceCentsSnapshot: 3_500,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

function payment(id: number, appointmentId: number, overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    id,
    appointmentId,
    methodId: 1,
    currency: 'USD',
    amountCents: 1_000,
    rateBsPerUsdE4: null,
    usdEquivalentCents: 1_000,
    paidAt: '2026-11-12T09:00',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

function vesPayment(id: number, appointmentId: number, amountCents: number): PaymentSummary {
  return payment(id, appointmentId, { currency: 'VES', amountCents, rateBsPerUsdE4: 365_000, usdEquivalentCents: 1 })
}

function voided(row: PaymentSummary): PaymentSummary {
  return { ...row, voidedAt: '2026-11-12T10:00', voidedBy: 1, voidReason: 'error' }
}

function install(rows: { appointments?: AppointmentSummary[]; payments?: PaymentSummary[] } = {}): void {
  mockIPC(
    createMetricsIpcBackend(
      (command) => {
        throw new Error(`IPC no simulado: ${command}`)
      },
      {
        session: () => session,
        appointments: createSharedRows(rows.appointments ?? []),
        payments: createSharedRows(rows.payments ?? []),
      },
    ),
  )
}

beforeEach(() => {
  session = userWith('metrics.read')
  install()
})

afterEach(() => clearMocks())

async function metricsOf(month: string): Promise<MonthlyMetrics> {
  const outcome = await commands.getMonthlyMetrics(month)
  if (outcome.status !== 'ok') throw new Error(`se esperaba ok: ${JSON.stringify(outcome.error)}`)
  return outcome.data
}

const amounts = (usd: number, ves: number) => ({ USD: usd, VES: ves })
const noCounts = { scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, noShow: 0 }

describe('autorización', () => {
  it('sin sesión es unauthenticated', async () => {
    session = null

    expect(await commands.getMonthlyMetrics(NOVEMBER)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('sin metrics.read es forbidden', async () => {
    session = userWith('clients.read', 'payments.read', 'appointments.read')

    expect(await commands.getMonthlyMetrics(NOVEMBER)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('el permiso se decide antes de validar el mes', async () => {
    session = userWith('clients.read')

    expect(await commands.getMonthlyMetrics('no-es-mes')).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })
})

describe('validación del mes', () => {
  it.each([
    '2026-13',
    '2026-00',
    '0000-01',
    '9999-12',
    '10000-01',
    '26-11',
    '2026-1',
    '2026/11',
    '2026-11-01',
    '',
    ' ',
    ' 2026-11',
    '2026-11 ',
    '2026-11\n',
    '２０２６-11',
    'abcd-ef',
  ])('rechaza %j sobre el campo month', async (month) => {
    expect(await commands.getMonthlyMetrics(month)).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'month', entityIds: null },
    })
  })

  it.each(['0001-01', '9998-12'])('acepta el extremo %s', async (month) => {
    expect((await metricsOf(month)).month).toBe(month)
  })

  it('un argumento month que no es texto es un fallo de canal', async () => {
    await expect(commands.getMonthlyMetrics(7 as never)).rejects.toThrow('argumento inválido')
  })
})

describe('getMonthlyMetrics', () => {
  it('un mes sin citas es todo ceros y conserva el mes pedido', async () => {
    expect(await metricsOf(NOVEMBER)).toEqual({
      month: NOVEMBER,
      newClients: 0,
      recurringClients: 0,
      appointments: noCounts,
      revenueByCurrency: amounts(0, 0),
      collectedOnNonCompletedByCurrency: amounts(0, 0),
      pendingByCurrency: amounts(0, 0),
    })
  })

  it('cuenta cada estado del mes', async () => {
    install({
      appointments: [
        appointment(1, 'scheduled', '2026-11-02T10:00'),
        appointment(2, 'inProgress', '2026-11-03T10:00'),
        appointment(3, 'completed', '2026-11-04T10:00'),
        appointment(4, 'completed', '2026-11-05T10:00'),
        appointment(5, 'cancelled', '2026-11-06T10:00'),
        appointment(6, 'noShow', '2026-11-07T10:00'),
      ],
    })

    expect((await metricsOf(NOVEMBER)).appointments).toEqual({ scheduled: 1, inProgress: 1, completed: 2, cancelled: 1, noShow: 1 })
  })

  it('el inicio del mes es inclusivo y el inicio del siguiente exclusivo', async () => {
    install({
      appointments: [
        appointment(1, 'completed', '2026-10-31T23:59'),
        appointment(2, 'completed', '2026-11-01T00:00'),
        appointment(3, 'completed', '2026-11-30T23:59'),
        appointment(4, 'completed', '2026-12-01T00:00'),
      ],
    })

    expect((await metricsOf(NOVEMBER)).appointments.completed).toBe(2)
  })

  it('diciembre incluye su último minuto y excluye el primero de enero', async () => {
    install({
      appointments: [
        appointment(1, 'completed', '2026-12-31T23:59'),
        appointment(2, 'completed', '2027-01-01T00:00'),
        appointment(3, 'completed', '2026-11-30T23:59'),
      ],
    })

    expect((await metricsOf('2026-12')).appointments.completed).toBe(1)
    expect((await metricsOf('2027-01')).appointments.completed).toBe(1)
  })

  it('los pagos se atribuyen al mes de la cita y no al del pago', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-30T10:00')],
      payments: [payment(1, 1, { amountCents: 2_000, paidAt: '2026-12-02T09:00' })],
    })

    expect((await metricsOf(NOVEMBER)).revenueByCurrency).toEqual(amounts(2_000, 0))
    expect((await metricsOf('2026-12')).revenueByCurrency).toEqual(amounts(0, 0))
  })

  it('suma USD y VES por separado sin convertir', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-04T10:00'), appointment(2, 'completed', '2026-11-05T10:00')],
      payments: [payment(1, 1, { amountCents: 2_000 }), payment(2, 2, { amountCents: 500 }), vesPayment(3, 1, 54_750)],
    })

    expect((await metricsOf(NOVEMBER)).revenueByCurrency).toEqual(amounts(2_500, 54_750))
  })

  it('un pago anulado no suma en ningún bucket', async () => {
    install({
      appointments: [
        appointment(1, 'completed', '2026-11-04T10:00'),
        appointment(2, 'cancelled', '2026-11-05T10:00'),
        appointment(3, 'scheduled', '2026-11-06T10:00'),
      ],
      payments: [payment(1, 1), voided(payment(2, 1, { amountCents: 9_999 })), voided(payment(3, 2)), voided(payment(4, 3))],
    })

    const found = await metricsOf(NOVEMBER)

    expect(found.revenueByCurrency).toEqual(amounts(1_000, 0))
    expect(found.collectedOnNonCompletedByCurrency).toEqual(amounts(0, 0))
    expect(found.pendingByCurrency).toEqual(amounts(0, 0))
  })

  it('cada estado alimenta exactamente su bucket', async () => {
    install({
      appointments: [
        appointment(1, 'completed', '2026-11-04T10:00'),
        appointment(2, 'cancelled', '2026-11-05T10:00'),
        appointment(3, 'noShow', '2026-11-06T10:00'),
        appointment(4, 'scheduled', '2026-11-07T10:00'),
        appointment(5, 'inProgress', '2026-11-08T10:00'),
      ],
      payments: [
        payment(1, 1, { amountCents: 1 }),
        payment(2, 2, { amountCents: 10 }),
        payment(3, 3, { amountCents: 100 }),
        payment(4, 4, { amountCents: 1_000 }),
        payment(5, 5, { amountCents: 10_000 }),
      ],
    })

    const found = await metricsOf(NOVEMBER)

    expect(found.revenueByCurrency).toEqual(amounts(1, 0))
    expect(found.collectedOnNonCompletedByCurrency).toEqual(amounts(110, 0))
    expect(found.pendingByCurrency).toEqual(amounts(11_000, 0))
  })

  it('una seña en cita programada cae en pendiente en su moneda', async () => {
    install({
      appointments: [appointment(1, 'scheduled', '2026-11-20T10:00')],
      payments: [vesPayment(1, 1, 73_000)],
    })

    expect((await metricsOf(NOVEMBER)).pendingByCurrency).toEqual(amounts(0, 73_000))
  })

  it('un pago de una cita inexistente no suma en ningún bucket', async () => {
    install({ payments: [payment(1, 99)] })

    expect((await metricsOf(NOVEMBER)).revenueByCurrency).toEqual(amounts(0, 0))
  })
})

describe('clientes nuevos y recurrentes', () => {
  it('con una completada anterior es recurrente y el resto nuevo', async () => {
    install({
      appointments: [
        appointment(1, 'completed', '2026-09-10T10:00'),
        appointment(2, 'completed', '2026-11-04T10:00'),
        appointment(3, 'completed', '2026-11-05T10:00', { clientId: OTHER_CLIENT }),
      ],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([1, 1])
  })

  it('dos completadas en el mes cuentan una sola vez', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-04T10:00'), appointment(2, 'completed', '2026-11-20T10:00')],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([1, 0])
  })

  it('una cancelada anterior no vuelve recurrente al cliente', async () => {
    install({
      appointments: [
        appointment(1, 'cancelled', '2026-09-10T10:00'),
        appointment(2, 'noShow', '2026-10-10T10:00'),
        appointment(3, 'completed', '2026-11-04T10:00'),
      ],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([1, 0])
  })

  it('una completada que empieza en el primer minuto del mes es nueva', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-10-31T23:59', { clientId: OTHER_CLIENT }), appointment(2, 'completed', '2026-11-01T00:00')],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([1, 0])
  })

  it('una completada posterior al mes no vuelve recurrente al cliente', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-04T10:00'), appointment(2, 'completed', '2026-12-04T10:00')],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([1, 0])
  })

  it('sin completadas en el mes el cliente no está en ningún grupo', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-09-10T10:00'), appointment(2, 'scheduled', '2026-11-04T10:00')],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([0, 0])
  })
})

describe('clientes borrados', () => {
  const DELETED_CLIENT = 3

  it('un cliente borrado cuenta como nuevo y sus montos suman en el ingreso', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-04T10:00', { clientId: DELETED_CLIENT })],
      payments: [payment(1, 1, { amountCents: 1_500 })],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([1, 0])
    expect(found.appointments.completed).toBe(1)
    expect(found.revenueByCurrency).toEqual(amounts(1_500, 0))
  })

  it('un cliente borrado con una completada anterior cuenta como recurrente', async () => {
    install({
      appointments: [
        appointment(1, 'completed', '2026-09-04T10:00', { clientId: DELETED_CLIENT }),
        appointment(2, 'completed', '2026-11-04T10:00', { clientId: DELETED_CLIENT }),
      ],
    })

    const found = await metricsOf(NOVEMBER)

    expect([found.newClients, found.recurringClients]).toEqual([0, 1])
  })
})

describe('topes', () => {
  it('cinco mil pagos en el tope se suman sin perder precisión', async () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => payment(index + 1, 1, { amountCents: MAX_PAYMENT }))
    install({ appointments: [appointment(1, 'completed', '2026-11-04T10:00')], payments: rows })

    expect((await metricsOf(NOVEMBER)).revenueByCurrency.USD).toBe(500_000_000_000_000)
  })

  it('un total exactamente en el máximo entero seguro pasa', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-04T10:00')],
      payments: [payment(1, 1, { amountCents: SAFE_LIMIT })],
    })

    expect((await metricsOf(NOVEMBER)).revenueByCurrency.USD).toBe(SAFE_LIMIT)
  })

  it.each(['completed', 'cancelled', 'scheduled'] as const)('una suma de citas %s que excede el máximo seguro es un error interno', async (status) => {
    const rows = Array.from({ length: 90_073 }, (_, index) => payment(index + 1, 1, { amountCents: MAX_PAYMENT }))
    install({ appointments: [appointment(1, status, '2026-11-04T10:00')], payments: rows })

    expect(await commands.getMonthlyMetrics(NOVEMBER)).toMatchObject({
      status: 'error',
      error: { code: 'internal', field: null, entityIds: null },
    })
  })

  it('una suma en VES que excede el máximo seguro es un error interno', async () => {
    install({
      appointments: [appointment(1, 'completed', '2026-11-04T10:00')],
      payments: [vesPayment(1, 1, SAFE_LIMIT), vesPayment(2, 1, 1)],
    })

    expect(await commands.getMonthlyMetrics(NOVEMBER)).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})
