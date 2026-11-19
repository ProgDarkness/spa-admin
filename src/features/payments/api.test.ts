import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { Payment, PaymentInput } from '@/lib/model'
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
import { upsertRate } from '@/features/rates/api'
import { createPayment, listPayments, voidPayment } from './api'

const APPOINTMENT_ID = 100
const CASH_METHOD = 1
const MOBILE_METHOD = 2
const TODAY = NOW.slice(0, 10)
const DAY_RATE = 365000
const OWNER_ID = 1
const RECEPTION_ID = 2

function input(overrides: Partial<PaymentInput> = {}): PaymentInput {
  return {
    appointmentId: APPOINTMENT_ID,
    methodId: CASH_METHOD,
    currency: 'USD',
    amountCents: 2000,
    rateBsPerUsdE4: null,
    ...overrides,
  }
}

function withoutTodayRate(): void {
  commit({ ...getState(), rates: getState().rates.filter((rate) => rate.date !== TODAY) })
}

beforeEach(() => {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID }))
  commit({ ...getState(), payments: [] })
  signInAs('recepcion')
})

describe('createPayment en USD', () => {
  it('guarda rate null y equivalente igual al monto', async () => {
    const created = dataOf(await createPayment(input({ amountCents: 3500 })))

    expect(created).toMatchObject({
      id: 1,
      appointmentId: APPOINTMENT_ID,
      methodId: CASH_METHOD,
      currency: 'USD',
      amountCents: 3500,
      rateBsPerUsdE4: null,
      usdEquivalentCents: 3500,
      paidAt: NOW,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    })
    expect(getState().payments).toEqual([created])
  })

  it('ignora una tasa enviada y guarda null', async () => {
    const created = dataOf(await createPayment(input({ rateBsPerUsdE4: 400000 })))

    expect(created.rateBsPerUsdE4).toBeNull()
  })

  it('permite pagos mixtos USD y VES en la misma cita con ids secuenciales', async () => {
    const usd = dataOf(await createPayment(input()))
    const ves = dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000, methodId: MOBILE_METHOD })))

    expect([usd.id, ves.id]).toEqual([1, 2])
    expect(dataOf(await listPayments(APPOINTMENT_ID))).toHaveLength(2)
  })
})

describe('createPayment en VES', () => {
  it('sin tasa del día ni tasa manual devuelve rateMissing y no guarda', async () => {
    withoutTodayRate()

    const result = await createPayment(input({ currency: 'VES', amountCents: 73000 }))

    expect(errorOf(result).code).toBe('rateMissing')
    expect(getState().payments).toEqual([])
  })

  it('usa la tasa manual indicada y la guarda', async () => {
    withoutTodayRate()

    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000 })))

    expect(created.rateBsPerUsdE4).toBe(365000)
    expect(created.usdEquivalentCents).toBe(2000)
  })

  it('prefiere la tasa manual sobre la del día', async () => {
    dataOf(await upsertRate(TODAY, 400000))

    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000 })))

    expect(created.rateBsPerUsdE4).toBe(365000)
    expect(created.usdEquivalentCents).toBe(2000)
  })

  it('sin tasa manual usa la tasa del día', async () => {
    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 182500 })))

    expect(created.rateBsPerUsdE4).toBe(DAY_RATE)
    expect(created.usdEquivalentCents).toBe(5000)
  })

  it.each([
    ['sube en el .5 exacto', 1, 20000, 1],
    ['sube 1.5 a 2', 3, 20000, 2],
    ['baja por debajo de .5', 4, 30000, 1],
    ['sube justo en .5 con 3 divisores', 3, 60000, 1],
  ])('redondea half-up: %s', async (_name, amountCents, rate, expected) => {
    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents, rateBsPerUsdE4: rate })))

    expect(created.usdEquivalentCents).toBe(expected)
  })

  it('calcula el equivalente de un monto grande sin perder precisión', async () => {
    const created = dataOf(
      await createPayment(input({ currency: 'VES', amountCents: 100_000_000_000, rateBsPerUsdE4: 365000 })),
    )

    expect(created.usdEquivalentCents).toBe(2_739_726_027)
  })

  it('conserva su tasa cuando luego se corrige la tasa del día', async () => {
    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: 182500 })))

    dataOf(await upsertRate(TODAY, 500000))

    const [stored] = dataOf(await listPayments(APPOINTMENT_ID))
    expect(stored).toEqual(created)
    expect(stored?.rateBsPerUsdE4).toBe(DAY_RATE)
    expect(stored?.usdEquivalentCents).toBe(5000)
  })
})

describe('createPayment reglas de cita y método', () => {
  it.each(['scheduled', 'inProgress', 'completed', 'cancelled', 'noShow'] as const)(
    'permite pagar una cita %s',
    async (status) => {
      seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID, status }))

      expect((await createPayment(input())).status).toBe('ok')
    },
  )

  it('devuelve notFound con field appointmentId si la cita no existe', async () => {
    const error = errorOf(await createPayment(input({ appointmentId: MISSING_ID })))

    expect(error).toMatchObject({ code: 'notFound', field: 'appointmentId' })
  })

  it('devuelve notFound con field methodId si el método no existe', async () => {
    const error = errorOf(await createPayment(input({ methodId: MISSING_ID })))

    expect(error).toMatchObject({ code: 'notFound', field: 'methodId' })
  })

  it('rechaza un método inactivo con validation en methodId', async () => {
    commit({
      ...getState(),
      paymentMethods: getState().paymentMethods.map((method) =>
        method.id === CASH_METHOD ? { ...method, active: false } : method,
      ),
    })

    const result = await createPayment(input())

    expect(errorOf(result)).toMatchObject({ code: 'validation', field: 'methodId' })
    expect(getState().payments).toEqual([])
  })

  it('valida el esquema antes de buscar entidades', async () => {
    const error = errorOf(await createPayment(input({ appointmentId: MISSING_ID, amountCents: 0 })))

    expect(error).toMatchObject({ code: 'validation', field: 'amountCents' })
  })

  it('verifica la existencia de la cita antes que el estado del método', async () => {
    const error = errorOf(await createPayment(input({ appointmentId: MISSING_ID, methodId: MISSING_ID })))

    expect(error.field).toBe('appointmentId')
  })
})

describe('permisos', () => {
  it('exige sesión en las tres operaciones', async () => {
    commit({ ...getState(), sessionUserId: null })

    expect(errorOf(await listPayments(APPOINTMENT_ID)).code).toBe('unauthenticated')
    expect(errorOf(await createPayment(input())).code).toBe('unauthenticated')
    expect(errorOf(await voidPayment(1, 'x')).code).toBe('unauthenticated')
  })

  it('el usuario de lectura puede listar pero no crear ni anular', async () => {
    const created = dataOf(await createPayment(input()))
    signInAs('lectura')

    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([created])
    expect(errorOf(await createPayment(input())).code).toBe('forbidden')
    expect(errorOf(await voidPayment(created.id, 'motivo')).code).toBe('forbidden')
    expect(getState().payments).toEqual([created])
  })

  it('autoriza antes de validar', async () => {
    signInAs('lectura')

    expect(errorOf(await createPayment(input({ amountCents: 0 }))).code).toBe('forbidden')
  })
})

describe('listPayments', () => {
  it('devuelve solo los pagos de la cita incluidos los anulados', async () => {
    seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID }), appointmentTemplate({ id: 101, startsAt: '2026-11-13T14:00', endsAt: '2026-11-13T15:00' }))
    const first = dataOf(await createPayment(input()))
    dataOf(await createPayment(input({ appointmentId: 101 })))
    const voided = dataOf(await voidPayment(first.id, 'error'))

    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([voided])
  })

  it('devuelve lista vacía para una cita sin pagos o inexistente', async () => {
    expect(dataOf(await listPayments(APPOINTMENT_ID))).toEqual([])
    expect(dataOf(await listPayments(MISSING_ID))).toEqual([])
  })
})

describe('voidPayment', () => {
  let paymentId: number

  beforeEach(async () => {
    paymentId = dataOf(await createPayment(input())).id
  })

  it('guarda voidedAt, voidedBy del usuario en sesión y el motivo recortado', async () => {
    signInAs('propietaria')

    const voided = dataOf(await voidPayment(paymentId, '  Monto digitado por error  '))

    expect(voided).toMatchObject({
      id: paymentId,
      voidedAt: NOW,
      voidedBy: OWNER_ID,
      voidReason: 'Monto digitado por error',
      amountCents: 2000,
    })
    expect(getState().payments).toEqual([voided])
  })

  it('registra como voidedBy a quien anula, no a quien cobró', async () => {
    const voided = dataOf(await voidPayment(paymentId, 'error'))

    expect(voided.voidedBy).toBe(RECEPTION_ID)
  })

  it.each(['', '   ', '\t\n'])('exige motivo no vacío (%j)', async (reason) => {
    const error = errorOf(await voidPayment(paymentId, reason))

    expect(error).toMatchObject({ code: 'validation', field: 'reason' })
    expect(getState().payments[0]?.voidedAt).toBeNull()
  })

  it('la doble anulación devuelve alreadyVoided y conserva la primera', async () => {
    const first = dataOf(await voidPayment(paymentId, 'primero'))

    const error = errorOf(await voidPayment(paymentId, 'segundo'))

    expect(error.code).toBe('alreadyVoided')
    expect(getState().payments).toEqual([first])
  })

  it('devuelve notFound si el pago no existe', async () => {
    expect(errorOf(await voidPayment(MISSING_ID, 'motivo')).code).toBe('notFound')
  })

  it('valida el motivo antes de buscar el pago', async () => {
    expect(errorOf(await voidPayment(MISSING_ID, ' ')).code).toBe('validation')
  })

  it('no elimina el pago ni toca los demás', async () => {
    const other = dataOf(await createPayment(input({ amountCents: 500 })))

    dataOf(await voidPayment(paymentId, 'error'))

    expect(getState().payments).toHaveLength(2)
    expect(getState().payments.find((row) => row.id === other.id)).toEqual(other)
  })
})

describe('inmutabilidad', () => {
  it('createPayment no muta el arreglo ni la entrada previa', async () => {
    const before = getState().payments
    const frozen = Object.freeze(input())

    dataOf(await createPayment(frozen))

    expect(before).toEqual([])
    expect(getState().payments).not.toBe(before)
  })

  it('voidPayment reemplaza el objeto sin mutar el original', async () => {
    const created = dataOf(await createPayment(input()))
    const snapshot: Payment = { ...created }
    const previousList = getState().payments

    dataOf(await voidPayment(created.id, 'error'))

    expect(created).toEqual(snapshot)
    expect(previousList[0]).toBe(created)
    expect(getState().payments).not.toBe(previousList)
  })

  it('un resultado de lectura no altera el store al modificarlo', async () => {
    dataOf(await createPayment(input()))
    const listed = dataOf(await listPayments(APPOINTMENT_ID))

    listed.pop()

    expect(getState().payments).toHaveLength(1)
  })
})
