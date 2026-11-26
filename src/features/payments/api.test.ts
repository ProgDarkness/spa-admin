import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { Payment, PaymentInput } from '@/lib/model'
import { installDevIpc } from '@/test/dev-ipc'
import { signInAs } from '@/test/session'
import {
  appointmentTemplate,
  dataOf,
  errorOf,
  MISSING_ID,
  NOW,
  resetWithEmptyAgenda,
} from '@/test/appointment-fixtures'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { createPayment, listPayments, voidPayment } from './api'

const APPOINTMENT_ID = 100
const OTHER_APPOINTMENT_ID = 101
const CASH_METHOD = 1
const MOBILE_METHOD = 2
const DAY_RATE = 365000
const RECEPTION_ID = 2
type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

function input(overrides: Partial<PaymentInput> = {}): PaymentInput {
  return { appointmentId: APPOINTMENT_ID, methodId: CASH_METHOD, currency: 'USD', amountCents: 2000, rateBsPerUsdE4: null, ...overrides }
}

function recordInvokedCommands(): string[] {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
  const original = internals.invoke
  const calls: string[] = []
  internals.invoke = (cmd, args) => {
    calls.push(cmd)
    return original(cmd, args)
  }
  return calls
}

async function storedPayments(): Promise<Payment[]> {
  const lists = await Promise.all([APPOINTMENT_ID, OTHER_APPOINTMENT_ID].map((id) => listPayments(id)))
  return lists.flatMap((list) => dataOf(list))
}

beforeEach(() => {
  resetWithEmptyAgenda()
  installDevIpc({
    appointments: [
      appointmentTemplate({ id: APPOINTMENT_ID }),
      appointmentTemplate({ id: OTHER_APPOINTMENT_ID, startsAt: '2026-11-13T14:00', endsAt: '2026-11-13T15:00' }),
    ],
    payments: [],
  })
  signInAs('recepcion')
})

describe('createPayment', () => {
  it('registra el pago en Rust y lo devuelve', async () => {
    const created = dataOf(await createPayment(input({ amountCents: 3500 })))

    expect(created).toMatchObject({
      id: 1,
      appointmentId: APPOINTMENT_ID,
      currency: 'USD',
      amountCents: 3500,
      rateBsPerUsdE4: null,
      usdEquivalentCents: 3500,
      paidAt: NOW,
      voidedAt: null,
    })
    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([created])
  })

  it('un pago VES sin tasa usa la tasa del día que decide Rust', async () => {
    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 182500, methodId: MOBILE_METHOD })))

    expect(created.rateBsPerUsdE4).toBe(DAY_RATE)
    expect(created.usdEquivalentCents).toBe(5000)
  })

  it('una tasa explícita viaja a Rust y se guarda copiada', async () => {
    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 400000 })))

    expect(created.rateBsPerUsdE4).toBe(400000)
    expect(created.usdEquivalentCents).toBe(1825)
  })

  it('un pago USD ignora una tasa enviada y guarda null', async () => {
    const created = dataOf(await createPayment(input({ rateBsPerUsdE4: 400000 })))

    expect(created.rateBsPerUsdE4).toBeNull()
    expect(created.usdEquivalentCents).toBe(2000)
  })

  it('permite pagos mixtos USD y VES en la misma cita con ids secuenciales', async () => {
    const usd = dataOf(await createPayment(input()))
    const ves = dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000, methodId: MOBILE_METHOD })))

    expect([usd.id, ves.id]).toEqual([1, 2])
    expect(dataOf(await listPayments(APPOINTMENT_ID))).toHaveLength(2)
  })

  it('una tasa manual pisa la del día aunque haya una registrada', async () => {
    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000 })))

    expect(created.rateBsPerUsdE4).toBe(365000)
    expect(created.usdEquivalentCents).toBe(2000)
  })

  it('sin tasa manual ni tasa del día devuelve rateMissing y no guarda', async () => {
    commit({ ...getState(), rates: [] })
    installDevIpc({ appointments: [appointmentTemplate({ id: APPOINTMENT_ID })], payments: [] })

    const error = errorOf(await createPayment(input({ currency: 'VES', amountCents: 73000 })))

    expect(error).toMatchObject({ code: 'rateMissing', field: 'rateBsPerUsdE4' })
    expect(await storedPayments()).toEqual([])
  })

  it('no consulta métodos, tasas ni citas antes de crear', async () => {
    const calls = recordInvokedCommands()

    dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000 })))

    expect(calls).toEqual(['create_payment'])
  })

  it('devuelve los errores de Rust sin guardar nada', async () => {
    commit({ ...getState(), rates: [] })
    installDevIpc({ appointments: [appointmentTemplate({ id: APPOINTMENT_ID })], payments: [] })

    const missingRate = errorOf(await createPayment(input({ currency: 'VES', amountCents: 73000 })))
    const missingAppointment = errorOf(await createPayment(input({ appointmentId: MISSING_ID })))
    const invalidAmount = errorOf(await createPayment(input({ amountCents: 0 })))

    expect(missingRate).toMatchObject({ code: 'rateMissing', field: 'rateBsPerUsdE4' })
    expect(missingAppointment).toMatchObject({ code: 'notFound', field: 'appointmentId' })
    expect(invalidAmount).toMatchObject({ code: 'validation', field: 'amountCents' })
    expect(await storedPayments()).toEqual([])
  })

  it('el usuario de solo lectura recibe forbidden desde Rust', async () => {
    signInAs('lectura')

    expect(errorOf(await createPayment(input())).code).toBe('forbidden')
    signInAs('recepcion')
    expect(await storedPayments()).toEqual([])
  })

  it('sin sesión recibe unauthenticated', async () => {
    commit({ ...getState(), sessionUserId: null })

    expect(errorOf(await createPayment(input())).code).toBe('unauthenticated')
  })

  it('un fallo del canal es internal', async () => {
    stubRustCatalog({ failing: ['create_payment'] })

    expect(errorOf(await createPayment(input())).code).toBe('internal')
  })

  it('acepta la entrada congelada sin mutarla', async () => {
    const frozen = Object.freeze(input())

    dataOf(await createPayment(frozen))

    expect(frozen).toEqual(input())
  })
})

describe('listPayments', () => {
  it('lee de Rust solo los pagos de la cita, anulados incluidos', async () => {
    const first = dataOf(await createPayment(input()))
    dataOf(await createPayment(input({ appointmentId: OTHER_APPOINTMENT_ID })))
    const voided = dataOf(await voidPayment(first.id, 'error'))

    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([voided])
  })

  it('devuelve lista vacía para una cita sin pagos o inexistente', async () => {
    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([])
    expect(dataOf(await listPayments(MISSING_ID))).toEqual([])
  })

  it('sin sesión es unauthenticated', async () => {
    commit({ ...getState(), sessionUserId: null })

    expect(errorOf(await listPayments(APPOINTMENT_ID)).code).toBe('unauthenticated')
  })
})

describe('voidPayment', () => {
  let paymentId: number

  beforeEach(async () => {
    paymentId = dataOf(await createPayment(input())).id
  })

  it('guarda cuándo, quién y el motivo recortado y lo persiste', async () => {
    const voided = dataOf(await voidPayment(paymentId, '  Monto digitado por error  '))

    expect(voided).toMatchObject({ id: paymentId, voidedAt: NOW, voidedBy: RECEPTION_ID, voidReason: 'Monto digitado por error' })
    expect(await storedPayments()).toEqual([voided])
  })

  it.each(['', '   ', '\t\n'])('Rust rechaza el motivo %j en reason y el pago sigue activo', async (reason) => {
    expect(errorOf(await voidPayment(paymentId, reason))).toMatchObject({ code: 'validation', field: 'reason' })
    expect((await storedPayments())[0]?.voidedAt).toBeNull()
  })

  it('la doble anulación es alreadyVoided con el id y conserva la primera', async () => {
    const first = dataOf(await voidPayment(paymentId, 'primero'))

    const error = errorOf(await voidPayment(paymentId, 'segundo'))

    expect(error).toMatchObject({ code: 'alreadyVoided', entityIds: [paymentId] })
    expect(await storedPayments()).toEqual([first])
  })

  it('un pago inexistente es notFound', async () => {
    expect(errorOf(await voidPayment(MISSING_ID, 'motivo')).code).toBe('notFound')
  })

  it('no toca los demás pagos', async () => {
    const other = dataOf(await createPayment(input({ amountCents: 500 })))

    dataOf(await voidPayment(paymentId, 'error'))

    const stored = await storedPayments()
    expect(stored).toHaveLength(2)
    expect(stored.find((row) => row.id === other.id)).toEqual(other)
  })

  it('el usuario de solo lectura recibe forbidden', async () => {
    signInAs('lectura')

    expect(errorOf(await voidPayment(paymentId, 'motivo')).code).toBe('forbidden')
  })
})
