import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commands,
  type AppointmentStatus,
  type AppointmentSummary,
  type ClientHistory,
  type ClientSummary,
  type PaymentSummary,
  type ResourceSummary,
  type ServiceSummary,
} from '@/lib/bindings'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createClientHistoryIpcBackend } from './client-history-backend'
import { createSharedRows, type SharedRows } from './shared-rows'

const INSTANT = '2026-11-12T09:00:00.000Z'
const CLIENT = 1
const OTHER_CLIENT = 2
const DELETED_CLIENT = 3
const EMPTY_CLIENT = 4
const MISSING = 999
const ALL_PERMISSIONS: PermissionKey[] = ['clients.read', 'appointments.read', 'payments.read']

let session: SessionUser | null
let clients: SharedRows<ClientSummary>
let appointments: SharedRows<AppointmentSummary>
let services: SharedRows<ServiceSummary>
let resources: SharedRows<ResourceSummary>
let payments: SharedRows<PaymentSummary>

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function client(id: number, deletedAt: string | null = null): ClientSummary {
  return { id, firstName: `Nombre${id}`, lastName: `Apellido${id}`, nationalId: `V-${id}0000000`, phone: '0414-5550000', deletedAt }
}

function appointment(
  id: number,
  status: AppointmentStatus,
  overrides: Partial<AppointmentSummary> = {},
): AppointmentSummary {
  return {
    id,
    clientId: CLIENT,
    serviceId: 1,
    resourceId: 1,
    startsAt: `2026-11-1${id}T10:00`,
    endsAt: `2026-11-1${id}T11:00`,
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

function vesPayment(id: number, appointmentId: number, amountCents: number, usdEquivalentCents: number): PaymentSummary {
  return payment(id, appointmentId, { currency: 'VES', amountCents, rateBsPerUsdE4: 365_000, usdEquivalentCents })
}

function voided(row: PaymentSummary): PaymentSummary {
  return { ...row, voidedAt: '2026-11-12T10:00', voidedBy: 1, voidReason: 'error' }
}

function install(rows: { appointments?: AppointmentSummary[]; payments?: PaymentSummary[] } = {}): void {
  clients = createSharedRows([client(CLIENT), client(OTHER_CLIENT), client(DELETED_CLIENT, '2026-10-01T09:00'), client(EMPTY_CLIENT)])
  appointments = createSharedRows(rows.appointments ?? [])
  services = createSharedRows<ServiceSummary>([
    { id: 1, name: 'Limpieza facial', priceCents: 3_500, currency: 'USD', durationMin: 60, active: false, createdAt: INSTANT, updatedAt: INSTANT },
    { id: 2, name: 'Masaje', priceCents: 5_000, currency: 'USD', durationMin: 30, active: true, createdAt: INSTANT, updatedAt: INSTANT },
  ])
  resources = createSharedRows<ResourceSummary>([
    { id: 1, name: 'Cabina 1', kind: 'cabin', active: false, createdAt: INSTANT, updatedAt: INSTANT },
    { id: 2, name: 'Cabina 2', kind: 'cabin', active: true, createdAt: INSTANT, updatedAt: INSTANT },
  ])
  payments = createSharedRows(rows.payments ?? [])
  mockIPC(
    createClientHistoryIpcBackend(
      (command) => {
        throw new Error(`IPC no simulado: ${command}`)
      },
      { session: () => session, clients, appointments, services, resources, payments },
    ),
  )
}

beforeEach(() => {
  session = userWith(...ALL_PERMISSIONS)
  install()
})

afterEach(() => clearMocks())

async function historyOf(clientId: number): Promise<ClientHistory> {
  const outcome = await commands.getClientHistory(clientId)
  if (outcome.status !== 'ok') throw new Error(`se esperaba ok: ${JSON.stringify(outcome.error)}`)
  return outcome.data
}

const amounts = (usd: number, ves: number) => ({ USD: usd, VES: ves })

describe('autorización', () => {
  it('sin sesión es unauthenticated', async () => {
    session = null

    expect(await commands.getClientHistory(CLIENT)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it.each(ALL_PERMISSIONS)('faltar %s es forbidden', async (missing) => {
    session = userWith(...ALL_PERMISSIONS.filter((permission) => permission !== missing))

    expect(await commands.getClientHistory(CLIENT)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('el permiso se decide antes de buscar el cliente', async () => {
    session = userWith('clients.read')

    expect(await commands.getClientHistory(MISSING)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('un cliente inexistente es notFound para un usuario autorizado', async () => {
    expect(await commands.getClientHistory(MISSING)).toMatchObject({
      status: 'error',
      error: { code: 'notFound', message: 'Cliente no encontrado', field: null, entityIds: null },
    })
  })
})

describe('getClientHistory', () => {
  it('un cliente sin citas tiene historial vacío y totales en cero', async () => {
    const history = await historyOf(EMPTY_CLIENT)

    expect(history).toEqual({
      client: client(EMPTY_CLIENT),
      entries: [],
      totalMinutes: 0,
      paidByCurrency: amounts(0, 0),
      collectedOnNonCompletedByCurrency: amounts(0, 0),
      pendingByCurrency: amounts(0, 0),
      vesUsdEquivalentOfCompleted: 0,
    })
  })

  it('un cliente eliminado conserva su historial', async () => {
    install({ appointments: [appointment(1, 'completed', { clientId: DELETED_CLIENT })], payments: [payment(1, 1)] })

    const history = await historyOf(DELETED_CLIENT)

    expect(history.client.deletedAt).toBe('2026-10-01T09:00')
    expect(history.entries).toHaveLength(1)
    expect(history.paidByCurrency).toEqual(amounts(1_000, 0))
  })

  it('solo las citas completadas suman sus minutos congelados', async () => {
    install({
      appointments: [
        appointment(1, 'completed', { durationMinSnapshot: 60 }),
        appointment(2, 'completed', { durationMinSnapshot: 45 }),
        appointment(3, 'cancelled'),
        appointment(4, 'noShow'),
        appointment(5, 'scheduled'),
        appointment(6, 'inProgress'),
      ],
    })

    expect((await historyOf(CLIENT)).totalMinutes).toBe(105)
  })

  it('suma por moneda los pagos de citas completadas con el equivalente VES', async () => {
    install({
      appointments: [appointment(1, 'completed'), appointment(2, 'completed')],
      payments: [payment(1, 1, { amountCents: 3_500, usdEquivalentCents: 3_500 }), vesPayment(2, 1, 182_500, 5_000), vesPayment(3, 2, 73_000, 2_000)],
    })

    const history = await historyOf(CLIENT)

    expect(history.paidByCurrency).toEqual(amounts(3_500, 255_500))
    expect(history.vesUsdEquivalentOfCompleted).toBe(7_000)
    expect(history.collectedOnNonCompletedByCurrency).toEqual(amounts(0, 0))
    expect(history.pendingByCurrency).toEqual(amounts(0, 0))
  })

  it('un pago anulado se lista pero no suma en ningún total', async () => {
    install({
      appointments: [appointment(1, 'completed'), appointment(2, 'cancelled'), appointment(3, 'scheduled')],
      payments: [
        payment(1, 1, { amountCents: 6_000 }),
        voided(payment(2, 1, { amountCents: 1_000 })),
        voided(vesPayment(3, 1, 73_000, 2_000)),
        voided(payment(4, 2)),
        voided(payment(5, 3)),
      ],
    })

    const history = await historyOf(CLIENT)

    expect(history.paidByCurrency).toEqual(amounts(6_000, 0))
    expect(history.vesUsdEquivalentOfCompleted).toBe(0)
    expect(history.collectedOnNonCompletedByCurrency).toEqual(amounts(0, 0))
    expect(history.pendingByCurrency).toEqual(amounts(0, 0))
    expect(history.entries.flatMap((entry) => entry.payments)).toHaveLength(5)
  })

  it('los pagos en citas canceladas o no asistidas son cobrados en no completadas', async () => {
    install({
      appointments: [appointment(1, 'cancelled'), appointment(2, 'noShow')],
      payments: [payment(1, 1, { amountCents: 2_000 }), vesPayment(2, 2, 73_000, 2_000)],
    })

    const history = await historyOf(CLIENT)

    expect(history.collectedOnNonCompletedByCurrency).toEqual(amounts(2_000, 73_000))
    expect(history.paidByCurrency).toEqual(amounts(0, 0))
    expect(history.pendingByCurrency).toEqual(amounts(0, 0))
  })

  it('un adelanto en una cita programada o en curso es pendiente y en ningún otro lado', async () => {
    install({
      appointments: [appointment(1, 'scheduled'), appointment(2, 'inProgress')],
      payments: [payment(1, 1, { amountCents: 1_500 }), vesPayment(2, 2, 73_000, 2_000)],
    })

    const history = await historyOf(CLIENT)

    expect(history.pendingByCurrency).toEqual(amounts(1_500, 73_000))
    expect(history.paidByCurrency).toEqual(amounts(0, 0))
    expect(history.collectedOnNonCompletedByCurrency).toEqual(amounts(0, 0))
    expect(history.vesUsdEquivalentOfCompleted).toBe(0)
  })

  it('los pagos y citas de otros clientes no se filtran', async () => {
    install({
      appointments: [appointment(1, 'completed'), appointment(2, 'completed', { clientId: OTHER_CLIENT })],
      payments: [payment(1, 1), payment(2, 2, { amountCents: 9_000 })],
    })

    const history = await historyOf(CLIENT)

    expect(history.entries.map((entry) => entry.id)).toEqual([1])
    expect(history.paidByCurrency).toEqual(amounts(1_000, 0))
  })

  it('las entradas van de la más nueva a la más antigua con nombres aunque estén inactivos', async () => {
    install({
      appointments: [
        appointment(1, 'completed', { startsAt: '2026-11-10T10:00', endsAt: '2026-11-10T11:00' }),
        appointment(2, 'completed', { startsAt: '2026-11-12T10:00', endsAt: '2026-11-12T11:00', serviceId: 2, resourceId: 2 }),
        appointment(3, 'completed', { startsAt: '2026-11-12T10:00', endsAt: '2026-11-12T11:00', resourceId: 2 }),
      ],
    })

    const history = await historyOf(CLIENT)

    expect(history.entries.map((entry) => entry.id)).toEqual([3, 2, 1])
    expect(history.entries.map((entry) => [entry.serviceName, entry.resourceName])).toEqual([
      ['Limpieza facial', 'Cabina 2'],
      ['Masaje', 'Cabina 2'],
      ['Limpieza facial', 'Cabina 1'],
    ])
  })

  it('cada entrada aplana la cita y trae sus pagos ordenados por paid_at e id', async () => {
    install({
      appointments: [appointment(1, 'completed')],
      payments: [
        payment(3, 1, { paidAt: '2026-11-12T09:30' }),
        payment(2, 1, { paidAt: '2026-11-12T09:00' }),
        payment(1, 1, { paidAt: '2026-11-12T09:30' }),
      ],
    })

    const [entry] = (await historyOf(CLIENT)).entries

    expect(entry).toMatchObject({ id: 1, clientId: CLIENT, status: 'completed', serviceName: 'Limpieza facial' })
    expect(entry?.payments.map((row) => row.id)).toEqual([2, 1, 3])
  })

  it('los minutos salen del snapshot y no del servicio actual', async () => {
    install({ appointments: [appointment(1, 'completed', { durationMinSnapshot: 90 })] })

    expect((await historyOf(CLIENT)).totalMinutes).toBe(90)
  })

  it('cinco mil pagos en el tope se suman sin perder precisión', async () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => payment(index + 1, 1, { amountCents: 100_000_000_000, usdEquivalentCents: 100_000_000_000 }))
    install({ appointments: [appointment(1, 'completed')], payments: rows })

    expect((await historyOf(CLIENT)).paidByCurrency.USD).toBe(500_000_000_000_000)
  })

  it('omite la cita cuyo servicio o recurso no existe, como el JOIN de Rust', async () => {
    install({
      appointments: [
        appointment(1, 'completed'),
        appointment(2, 'completed', { serviceId: MISSING }),
        appointment(3, 'completed', { resourceId: MISSING }),
      ],
      payments: [payment(1, 1), payment(2, 2), payment(3, 3)],
    })

    const history = await historyOf(CLIENT)

    expect(history.entries.map((entry) => entry.id)).toEqual([1])
    expect(history.totalMinutes).toBe(60)
    expect(history.paidByCurrency).toEqual(amounts(1_000, 0))
  })

  it('una suma que excede el máximo entero seguro es un error interno y no pierde precisión', async () => {
    const rows = Array.from({ length: 90_073 }, (_, index) => payment(index + 1, 1, { amountCents: 100_000_000_000, usdEquivalentCents: 100_000_000_000 }))
    install({ appointments: [appointment(1, 'completed')], payments: rows })

    expect(await commands.getClientHistory(CLIENT)).toMatchObject({ status: 'error', error: { code: 'internal', field: null, entityIds: null } })
  })

  it('el equivalente VES acumulado que excede el máximo seguro también es un error interno', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => vesPayment(index + 1, 1, 1_000, 1_000_000_000_000_000))
    install({ appointments: [appointment(1, 'completed')], payments: rows })

    expect(await commands.getClientHistory(CLIENT)).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })

  it('un total exactamente en el máximo entero seguro se acepta', async () => {
    install({
      appointments: [appointment(1, 'completed')],
      payments: [payment(1, 1, { amountCents: Number.MAX_SAFE_INTEGER })],
    })

    expect((await historyOf(CLIENT)).paidByCurrency.USD).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('un argumento clientId con forma inválida es un fallo de canal', async () => {
    await expect(commands.getClientHistory('x' as never)).rejects.toThrow('argumento inválido')
  })
})
