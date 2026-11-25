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
  seedAppointments,
} from '@/test/appointment-fixtures'
import { deferred } from '@/test/deferred'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { createPayment, listPayments, syncPaymentsMirror, voidPayment } from './api'

const APPOINTMENT_ID = 100
const OTHER_APPOINTMENT_ID = 101
const CASH_METHOD = 1
const MOBILE_METHOD = 2
const DAY_RATE = 365000
const RECEPTION_ID = 2
const STALE_PAYMENT: Payment = {
  id: 777,
  appointmentId: APPOINTMENT_ID,
  methodId: CASH_METHOD,
  currency: 'USD',
  amountCents: 100,
  rateBsPerUsdE4: null,
  usdEquivalentCents: 100,
  paidAt: NOW,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
}

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

function delayFirstReplyOf(command: string, gate: Promise<void>): void {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
  const original = internals.invoke
  let isPending = true
  internals.invoke = async (cmd, args) => {
    const value = await original(cmd, args)
    if (cmd === command && isPending) {
      isPending = false
      await gate
    }
    return value
  }
}

beforeEach(() => {
  resetWithEmptyAgenda()
  commit({ ...getState(), payments: [] })
  seedAppointments(
    appointmentTemplate({ id: APPOINTMENT_ID }),
    appointmentTemplate({ id: OTHER_APPOINTMENT_ID, startsAt: '2026-11-13T14:00', endsAt: '2026-11-13T15:00' }),
  )
  signInAs('recepcion')
})

describe('createPayment', () => {
  it('registra el pago en Rust, lo devuelve y lo refleja en el espejo', async () => {
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
    expect(getState().payments).toEqual([created])
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
    installDevIpc()

    const error = errorOf(await createPayment(input({ currency: 'VES', amountCents: 73000 })))

    expect(error).toMatchObject({ code: 'rateMissing', field: 'rateBsPerUsdE4' })
    expect(getState().payments).toEqual([])
  })

  it('no consulta métodos, tasas ni citas antes de crear', async () => {
    const calls = recordInvokedCommands()

    dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000 })))

    expect(calls).toEqual(['create_payment'])
  })

  it('devuelve los errores de Rust sin tocar el espejo', async () => {
    commit({ ...getState(), rates: [] })
    installDevIpc()
    const before = getState().payments

    const missingRate = errorOf(await createPayment(input({ currency: 'VES', amountCents: 73000 })))
    const missingAppointment = errorOf(await createPayment(input({ appointmentId: MISSING_ID })))
    const invalidAmount = errorOf(await createPayment(input({ amountCents: 0 })))

    expect(missingRate).toMatchObject({ code: 'rateMissing', field: 'rateBsPerUsdE4' })
    expect(missingAppointment).toMatchObject({ code: 'notFound', field: 'appointmentId' })
    expect(invalidAmount).toMatchObject({ code: 'validation', field: 'amountCents' })
    expect(getState().payments).toBe(before)
  })

  it('el usuario de solo lectura recibe forbidden desde Rust', async () => {
    signInAs('lectura')

    expect(errorOf(await createPayment(input())).code).toBe('forbidden')
    expect(getState().payments).toEqual([])
  })

  it('sin sesión recibe unauthenticated', async () => {
    commit({ ...getState(), sessionUserId: null })

    expect(errorOf(await createPayment(input())).code).toBe('unauthenticated')
  })

  it('un fallo del canal es internal y no toca el espejo', async () => {
    stubRustCatalog({ failing: ['create_payment'] })

    expect(errorOf(await createPayment(input())).code).toBe('internal')
    expect(getState().payments).toEqual([])
  })

  it('no muta la entrada congelada ni el arreglo previo del espejo', async () => {
    const before = getState().payments

    dataOf(await createPayment(Object.freeze(input())))

    expect(before).toEqual([])
    expect(getState().payments).not.toBe(before)
  })
})

describe('listPayments', () => {
  it('lee de Rust solo los pagos de la cita, anulados incluidos, sin tocar el espejo', async () => {
    const first = dataOf(await createPayment(input()))
    dataOf(await createPayment(input({ appointmentId: OTHER_APPOINTMENT_ID })))
    const voided = dataOf(await voidPayment(first.id, 'error'))
    commit({ ...getState(), payments: [] })

    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([voided])
    expect(getState().payments).toEqual([])
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

  it('guarda cuándo, quién y el motivo recortado y reemplaza la fila del espejo', async () => {
    const voided = dataOf(await voidPayment(paymentId, '  Monto digitado por error  '))

    expect(voided).toMatchObject({ id: paymentId, voidedAt: NOW, voidedBy: RECEPTION_ID, voidReason: 'Monto digitado por error' })
    expect(getState().payments).toEqual([voided])
  })

  it.each(['', '   ', '\t\n'])('Rust rechaza el motivo %j en reason y el espejo sigue activo', async (reason) => {
    expect(errorOf(await voidPayment(paymentId, reason))).toMatchObject({ code: 'validation', field: 'reason' })
    expect(getState().payments[0]?.voidedAt).toBeNull()
  })

  it('la doble anulación es alreadyVoided con el id y conserva la primera', async () => {
    const first = dataOf(await voidPayment(paymentId, 'primero'))

    const error = errorOf(await voidPayment(paymentId, 'segundo'))

    expect(error).toMatchObject({ code: 'alreadyVoided', entityIds: [paymentId] })
    expect(getState().payments).toEqual([first])
  })

  it('un pago inexistente es notFound', async () => {
    expect(errorOf(await voidPayment(MISSING_ID, 'motivo')).code).toBe('notFound')
  })

  it('no toca los demás pagos del espejo', async () => {
    const other = dataOf(await createPayment(input({ amountCents: 500 })))

    dataOf(await voidPayment(paymentId, 'error'))

    expect(getState().payments).toHaveLength(2)
    expect(getState().payments.find((row) => row.id === other.id)).toEqual(other)
  })

  it('reemplaza el objeto sin mutar el original', async () => {
    const created = getState().payments[0] as Payment
    const snapshot: Payment = { ...created }

    dataOf(await voidPayment(created.id, 'error'))

    expect(created).toEqual(snapshot)
    expect(getState().payments[0]).not.toBe(created)
  })

  it('el usuario de solo lectura recibe forbidden', async () => {
    signInAs('lectura')

    expect(errorOf(await voidPayment(paymentId, 'motivo')).code).toBe('forbidden')
  })
})

describe('syncPaymentsMirror', () => {
  it('reemplaza el espejo con todos los pagos de Rust', async () => {
    const created = dataOf(await createPayment(input()))
    commit({ ...getState(), payments: [] })

    const synced = dataOf(await syncPaymentsMirror())

    expect(synced).toEqual([created])
    expect(getState().payments).toEqual([created])
  })

  it('descarta del espejo un pago que Rust no devuelve', async () => {
    commit({ ...getState(), payments: [STALE_PAYMENT] })

    dataOf(await syncPaymentsMirror())

    expect(getState().payments).toEqual([])
  })

  it('un fallo del canal es internal y deja el espejo intacto', async () => {
    const before = getState().payments
    stubRustCatalog({ failing: ['list_all_payments'] })

    expect(errorOf(await syncPaymentsMirror()).code).toBe('internal')
    expect(getState().payments).toBe(before)
  })

  it('una lectura obsoleta por una mutación se reintenta y devuelve ok con el pago nuevo', async () => {
    const gate = deferred<void>()
    delayFirstReplyOf('list_all_payments', gate.promise)

    const slow = syncPaymentsMirror()
    const created = dataOf(await createPayment(input()))
    gate.resolve()

    expect(dataOf(await slow)).toEqual([created])
    expect(getState().payments).toEqual([created])
  })

  it('si la lectura nunca se puede aplicar devuelve un error interno y no un ok parcial', async () => {
    const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
    const original = internals.invoke
    internals.invoke = async (cmd, args) => {
      if (cmd === 'list_all_payments') await createPayment(input())
      return original(cmd, args)
    }

    expect(errorOf(await syncPaymentsMirror()).code).toBe('internal')
  })

  it('sin sesión devuelve unauthenticated y no toca el espejo', async () => {
    commit({ ...getState(), sessionUserId: null })
    const before = getState().payments

    expect(errorOf(await syncPaymentsMirror()).code).toBe('unauthenticated')
    expect(getState().payments).toBe(before)
  })
})
