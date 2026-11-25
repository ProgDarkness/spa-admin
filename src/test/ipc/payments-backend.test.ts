import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commands,
  type AppointmentStatus,
  type AppointmentSummary,
  type ExchangeRate,
  type PaymentInput,
  type PaymentMethodSummary,
  type PaymentSummary,
} from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { PermissionKey, SessionUser } from '@/lib/model'
import vectors from '@/lib/usd-equivalent-vectors.json'
import { createPaymentsIpcBackend } from './payments-backend'
import { createSharedRows, type SharedRows } from './shared-rows'

const SEED = createSeed('2026-11-12')
const NOW_MS = new Date(2026, 10, 12, 9, 0, 30).getTime()
const LATER_MS = new Date(2026, 10, 12, 9, 45, 10).getTime()
const NOW_LOCAL = '2026-11-12T09:00'
const LATER_LOCAL = '2026-11-12T09:45'
const TODAY = '2026-11-12'
const DAY_RATE = 365_000
const CASH = 1
const MOBILE = 2
const INACTIVE_METHOD = 9
const MISSING = 999
const INSTANT = '2026-11-12T09:00:00.000Z'
const MAX_AMOUNT = 100_000_000_000
const MAX_RATE = 100_000_000_000
const OWNER_ID = 50
const RECEPTION_ID = 51

const ALL_PERMISSIONS: PermissionKey[] = ['payments.read', 'payments.write']

let session: SessionUser | null
let appointments: SharedRows<AppointmentSummary>
let methods: SharedRows<PaymentMethodSummary>
let rates: SharedRows<ExchangeRate>
let published: SharedRows<PaymentSummary>
let nowMs: number

function userWith(id: number, ...permissions: PermissionKey[]): SessionUser {
  return { id, username: `u${id}`, roleName: 'Prueba', permissions }
}

function appointmentWith(status: AppointmentStatus): number {
  const found = SEED.appointments.find((appointment) => appointment.status === status)
  if (!found) throw new Error(`el seed no tiene citas ${status}`)
  return found.id
}

const COMPLETED = appointmentWith('completed')

function usd(amountCents: number, overrides: Partial<PaymentInput> = {}): PaymentInput {
  return { appointmentId: COMPLETED, methodId: CASH, currency: 'USD', amountCents, rateBsPerUsdE4: null, ...overrides }
}

function ves(amountCents: number, rate: number | null, overrides: Partial<PaymentInput> = {}): PaymentInput {
  return { appointmentId: COMPLETED, methodId: MOBILE, currency: 'VES', amountCents, rateBsPerUsdE4: rate, ...overrides }
}

function methodRows(): PaymentMethodSummary[] {
  const active = SEED.paymentMethods.map((method) => ({ ...method, createdAt: INSTANT, updatedAt: INSTANT }))
  return [...active, { id: INACTIVE_METHOD, name: 'Cheque', active: false, createdAt: INSTANT, updatedAt: INSTANT }]
}

function install(seed: readonly PaymentSummary[] = [], rateRows: readonly ExchangeRate[] = [{ date: TODAY, rateBsPerUsdE4: DAY_RATE }]) {
  appointments = createSharedRows<AppointmentSummary>(SEED.appointments)
  methods = createSharedRows(methodRows())
  rates = createSharedRows(rateRows)
  published = createSharedRows()
  mockIPC(
    createPaymentsIpcBackend(
      (command) => {
        throw new Error(`IPC no simulado: ${command}`)
      },
      { session: () => session, payments: seed, appointments, paymentMethods: methods, rates, shared: published, now: () => nowMs },
    ),
  )
}

beforeEach(() => {
  session = userWith(OWNER_ID, ...ALL_PERMISSIONS)
  nowMs = NOW_MS
  install()
})

afterEach(() => clearMocks())

function dataOf<T>(outcome: { status: 'ok'; data: T } | { status: 'error'; error: unknown }): T {
  if (outcome.status !== 'ok') throw new Error(`se esperaba ok: ${JSON.stringify(outcome.error)}`)
  return outcome.data
}

async function failureOf(operation: () => Promise<{ status: string; error?: unknown }>): Promise<string> {
  const outcome = await operation()
  if (outcome.status !== 'error') return 'ok'
  const error = outcome.error as { code: string; field: string | null }
  return error.field ? `${error.code}:${error.field}` : error.code
}

async function pay(input: PaymentInput): Promise<PaymentSummary> {
  return dataOf(await commands.createPayment(input))
}

describe('autorización', () => {
  it('rechaza todos los comandos sin sesión con unauthenticated', async () => {
    session = null
    const outcomes = [
      await commands.listPayments(COMPLETED),
      await commands.listAllPayments(),
      await commands.createPayment(usd(1000)),
      await commands.voidPayment({ id: 1, reason: 'error' }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it('con solo payments.read lista y no escribe', async () => {
    session = userWith(OWNER_ID, 'payments.read')

    expect(await commands.listAllPayments()).toMatchObject({ status: 'ok' })
    expect(await commands.listPayments(COMPLETED)).toMatchObject({ status: 'ok' })
    expect(await commands.createPayment(usd(1000))).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(await commands.voidPayment({ id: 1, reason: 'x' })).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('con solo payments.write lista, crea y anula', async () => {
    session = userWith(OWNER_ID, 'payments.write')

    const created = await pay(usd(1000))

    expect(await commands.listAllPayments()).toMatchObject({ status: 'ok', data: [created] })
    expect(await commands.voidPayment({ id: created.id, reason: 'error' })).toMatchObject({ status: 'ok' })
  })

  it('sin ningún permiso de pagos todo es forbidden', async () => {
    session = userWith(OWNER_ID, 'clients.read')
    const outcomes = [
      await commands.listPayments(COMPLETED),
      await commands.listAllPayments(),
      await commands.createPayment(usd(1000)),
      await commands.voidPayment({ id: 1, reason: 'error' }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } }))
  })

  it('el permiso se decide antes que el formato y la existencia', async () => {
    session = userWith(OWNER_ID, 'payments.read')

    expect(await failureOf(() => commands.createPayment(usd(0, { appointmentId: MISSING })))).toBe('forbidden')
    expect(await failureOf(() => commands.voidPayment({ id: MISSING, reason: '' }))).toBe('forbidden')
  })
})

describe('createPayment', () => {
  it('guarda un pago USD con la hora local, sin tasa y con equivalente igual al monto', async () => {
    const created = await pay(usd(3_500))

    expect(created).toEqual({
      id: 1,
      appointmentId: COMPLETED,
      methodId: CASH,
      currency: 'USD',
      amountCents: 3_500,
      rateBsPerUsdE4: null,
      usdEquivalentCents: 3_500,
      paidAt: NOW_LOCAL,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    })
  })

  it('un pago USD ignora una tasa válida enviada y rechaza una inválida', async () => {
    const ignored = await pay(usd(2_000, { rateBsPerUsdE4: 400_000 }))

    expect(ignored.rateBsPerUsdE4).toBeNull()
    expect(await failureOf(() => commands.createPayment(usd(2_000, { rateBsPerUsdE4: 0 })))).toBe('validation:rateBsPerUsdE4')
    expect(await failureOf(() => commands.createPayment(usd(2_000, { rateBsPerUsdE4: MAX_RATE + 1 })))).toBe(
      'validation:rateBsPerUsdE4',
    )
  })

  it('una tasa explícita pisa la del día y se copia al pago', async () => {
    const created = await pay(ves(182_500, 400_000))

    expect(created.rateBsPerUsdE4).toBe(400_000)
    expect(created.usdEquivalentCents).toBe(4_563)
  })

  it('sin tasa explícita usa la tasa de hoy', async () => {
    const created = await pay(ves(182_500, null))

    expect(created.rateBsPerUsdE4).toBe(DAY_RATE)
    expect(created.usdEquivalentCents).toBe(5_000)
  })

  it.each(vectors)(
    'el vector $amountCents a tasa $rateE4 con equivalente $expected se resuelve como en Rust',
    async ({ amountCents, rateE4, expected }) => {
      const outcome = await commands.createPayment(ves(amountCents, rateE4))

      if (expected >= 1) {
        expect(dataOf(outcome).usdEquivalentCents).toBe(expected)
        return
      }
      expect(outcome).toMatchObject({ status: 'error', error: { code: 'validation', field: 'amountCents' } })
      expect(dataOf(await commands.listAllPayments())).toEqual([])
    },
  )

  it('hay vectores de borde con equivalente cero para probar el rechazo', () => {
    expect(vectors.some((vector) => vector.expected === 0)).toBe(true)
  })

  it.each([0, -1, MAX_RATE + 1])('la tasa %i queda rechazada en rateBsPerUsdE4', async (rate) => {
    expect(await failureOf(() => commands.createPayment(ves(1_000, rate)))).toBe('validation:rateBsPerUsdE4')
  })

  it('un monto por encima del tope queda rechazado aunque el equivalente sea válido', async () => {
    expect(await failureOf(() => commands.createPayment(ves(MAX_AMOUNT + 1, MAX_RATE)))).toBe('validation:amountCents')
  })

  it('un monto VES que no llega a un céntimo de dólar se rechaza y el mínimo se acepta', async () => {
    expect(await failureOf(() => commands.createPayment(ves(1, DAY_RATE)))).toBe('validation:amountCents')
    expect(await failureOf(() => commands.createPayment(ves(18, DAY_RATE)))).toBe('validation:amountCents')
    expect((await pay(ves(19, DAY_RATE))).usdEquivalentCents).toBe(1)
    expect(dataOf(await commands.listAllPayments())).toHaveLength(1)
  })

  it('sin ninguna tasa un pago VES es rateMissing y no se guarda nada', async () => {
    install([], [])

    const outcome = await commands.createPayment(ves(182_500, null))

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'rateMissing', field: 'rateBsPerUsdE4' } })
    expect(dataOf(await commands.listAllPayments())).toEqual([])
  })

  it('solo la tasa del día del pago cuenta como valor por defecto', async () => {
    install([], [
      { date: '2026-11-11', rateBsPerUsdE4: DAY_RATE },
      { date: '2026-11-13', rateBsPerUsdE4: DAY_RATE },
    ])

    expect(await failureOf(() => commands.createPayment(ves(182_500, null)))).toBe('rateMissing:rateBsPerUsdE4')
  })

  it('corregir la tasa después no altera un pago guardado', async () => {
    const created = await pay(ves(182_500, null))
    rates.write([{ date: TODAY, rateBsPerUsdE4: 500_000 }])

    const listed = dataOf(await commands.listAllPayments())

    expect(listed[0]).toEqual(created)
    expect(listed[0]?.usdEquivalentCents).toBe(5_000)
  })

  it('acepta el pago en una cita de cualquier estado', async () => {
    const statuses: AppointmentStatus[] = ['scheduled', 'inProgress', 'completed', 'cancelled', 'noShow']

    for (const status of statuses) {
      const created = await pay(usd(1_000, { appointmentId: appointmentWith(status) }))
      expect(created.appointmentId).toBe(appointmentWith(status))
    }
  })

  it('permite varios pagos parciales en la misma cita con ids correlativos', async () => {
    const first = await pay(usd(1_000))
    const second = await pay(usd(2_000))

    expect([first.id, second.id]).toEqual([1, 2])
  })

  it('reporta cita o método inexistentes en su propio campo, la cita primero', async () => {
    expect(await failureOf(() => commands.createPayment(usd(1_000, { appointmentId: MISSING })))).toBe('notFound:appointmentId')
    expect(await failureOf(() => commands.createPayment(usd(1_000, { methodId: MISSING })))).toBe('notFound:methodId')
    expect(await failureOf(() => commands.createPayment(usd(1_000, { appointmentId: MISSING, methodId: MISSING })))).toBe(
      'notFound:appointmentId',
    )
  })

  it('un método inactivo es validation en methodId', async () => {
    expect(await failureOf(() => commands.createPayment(usd(1_000, { methodId: INACTIVE_METHOD })))).toBe('validation:methodId')
  })

  it.each([
    [usd(1_000, { appointmentId: 0 }), 'validation:appointmentId'],
    [usd(1_000, { appointmentId: -1 }), 'validation:appointmentId'],
    [usd(1_000, { methodId: 0 }), 'validation:methodId'],
    [usd(0), 'validation:amountCents'],
    [usd(-5), 'validation:amountCents'],
    [usd(MAX_AMOUNT + 1), 'validation:amountCents'],
    [ves(1_000, 0), 'validation:rateBsPerUsdE4'],
    [ves(1_000, MAX_RATE + 1), 'validation:rateBsPerUsdE4'],
  ])('rechaza la entrada mal formada %#', async (input, expected) => {
    expect(await failureOf(() => commands.createPayment(input))).toBe(expected)
    expect(dataOf(await commands.listAllPayments())).toEqual([])
  })

  it('acepta el monto máximo con la tasa máxima', async () => {
    const created = await pay(ves(MAX_AMOUNT, MAX_RATE))

    expect(created.usdEquivalentCents).toBe(10_000)
  })

  it('un monto máximo con tasa 1 produce un equivalente que cabe en un entero seguro', async () => {
    const created = await pay(ves(MAX_AMOUNT, 1))

    expect(Number.isSafeInteger(created.usdEquivalentCents)).toBe(true)
    expect(created.usdEquivalentCents).toBe(MAX_AMOUNT * 10_000)
  })

  it.each([
    ['appointmentId', usd(1_000, { appointmentId: 2 ** 53 })],
    ['methodId', usd(1_000, { methodId: 2 ** 53 })],
    ['amountCents', usd(2 ** 53)],
    ['rateBsPerUsdE4', ves(1_000, 2 ** 53)],
  ])('un entero no seguro en %s es validation sobre ese campo', async (field, input) => {
    expect(await failureOf(() => commands.createPayment(input))).toBe(`validation:${field}`)
  })

  it('un id no seguro al anular es validation sobre id', async () => {
    expect(await failureOf(() => commands.voidPayment({ id: 2 ** 53, reason: 'error' }))).toBe('validation:id')
  })

  it('un argumento con forma inválida es un fallo de canal y no un AppError', async () => {
    await expect(commands.createPayment({ ...usd(1_000), amountCents: 'x' } as never)).rejects.toThrow('argumento inválido')
    await expect(commands.createPayment({ ...usd(1_000), currency: 'EUR' } as never)).rejects.toThrow('argumento inválido')
  })

  it('el pago nuevo no comparte referencia con el devuelto', async () => {
    const created = await pay(usd(1_000))

    expect(published.read()[0]).toEqual(created)
    expect(published.read()[0]).not.toBe(created)
  })
})

describe('voidPayment', () => {
  it('guarda cuándo, quién y el motivo recortado', async () => {
    const created = await pay(usd(1_000))
    nowMs = LATER_MS
    session = userWith(RECEPTION_ID, 'payments.write')

    const voided = dataOf(await commands.voidPayment({ id: created.id, reason: '  Monto digitado por error  ' }))

    expect(voided).toEqual({
      ...created,
      voidedAt: LATER_LOCAL,
      voidedBy: RECEPTION_ID,
      voidReason: 'Monto digitado por error',
    })
  })

  it.each(['', '   ', '\t\n', 'a'.repeat(201), 'con\u0000nulo', 'dos\nlineas'])(
    'rechaza el motivo %j en reason y el pago sigue activo',
    async (reason) => {
      const created = await pay(usd(1_000))

      expect(await failureOf(() => commands.voidPayment({ id: created.id, reason }))).toBe('validation:reason')
      expect(published.read()[0]?.voidedAt).toBeNull()
    },
  )

  it('acepta un motivo de exactamente doscientos caracteres', async () => {
    const created = await pay(usd(1_000))

    const voided = dataOf(await commands.voidPayment({ id: created.id, reason: '🙂'.repeat(200) }))

    expect([...(voided.voidReason ?? '')]).toHaveLength(200)
  })

  it('un pago inexistente es notFound sin campo', async () => {
    expect(await commands.voidPayment({ id: MISSING, reason: 'error' })).toMatchObject({
      status: 'error',
      error: { code: 'notFound', message: 'El pago no existe', field: null, entityIds: null },
    })
  })

  it('el motivo se valida antes de buscar el pago', async () => {
    expect(await failureOf(() => commands.voidPayment({ id: MISSING, reason: ' ' }))).toBe('validation:reason')
  })

  it('anular dos veces es alreadyVoided con el id y conserva la primera anulación', async () => {
    const created = await pay(usd(1_000))
    const first = dataOf(await commands.voidPayment({ id: created.id, reason: 'primera' }))
    nowMs = LATER_MS

    const second = await commands.voidPayment({ id: created.id, reason: 'segunda' })

    expect(second).toMatchObject({ status: 'error', error: { code: 'alreadyVoided', field: null, entityIds: [created.id] } })
    expect(published.read()[0]).toEqual(first)
  })
})

describe('listados', () => {
  it('list_payments filtra por cita y ordena por paid_at e id', async () => {
    await pay(usd(1_000))
    nowMs = LATER_MS
    await pay(usd(2_000, { appointmentId: appointmentWith('cancelled') }))
    nowMs = NOW_MS
    await pay(usd(3_000))

    const listed = dataOf(await commands.listPayments(COMPLETED))

    expect(listed.map((payment) => payment.id)).toEqual([1, 3])
  })

  it('list_all_payments ordena por paid_at e id y no filtra anulados', async () => {
    const seeded: PaymentSummary[] = [
      { ...paymentRow(5), paidAt: '2026-11-12T10:00' },
      { ...paymentRow(2), paidAt: '2026-11-12T10:00' },
      { ...paymentRow(9), paidAt: '2026-11-11T08:00', voidedAt: '2026-11-11T08:30', voidedBy: 1, voidReason: 'x' },
    ]
    install(seeded)

    const listed = dataOf(await commands.listAllPayments())

    expect(listed.map((payment) => payment.id)).toEqual([9, 2, 5])
  })

  it('parte de los pagos recibidos y asigna el siguiente id al mayor', async () => {
    install([paymentRow(7)])

    const created = await pay(usd(1_000))

    expect(created.id).toBe(8)
    expect(published.read().map((payment) => payment.id)).toEqual([7, 8])
  })
})

function paymentRow(id: number): PaymentSummary {
  return {
    id,
    appointmentId: COMPLETED,
    methodId: CASH,
    currency: 'USD',
    amountCents: 1_000,
    rateBsPerUsdE4: null,
    usdEquivalentCents: 1_000,
    paidAt: NOW_LOCAL,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  }
}
