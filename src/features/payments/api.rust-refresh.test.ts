import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { PaymentInput, PaymentMethod } from '@/lib/model'
import { usdEquivalentCents } from '@/lib/money'
import { appointmentTemplate, dataOf, errorOf, NOW, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { signInAs } from '@/test/session'
import { createPayment } from './api'

const APPOINTMENT_ID = 100
const SEED_METHOD_ID = 1
const RUST_ONLY_METHOD_ID = 700
const TODAY = NOW.slice(0, 10)
const RUST_RATE_E4 = 412_500
const AMOUNT_CENTS = 73_000

function input(overrides: Partial<PaymentInput> = {}): PaymentInput {
  return {
    appointmentId: APPOINTMENT_ID,
    methodId: SEED_METHOD_ID,
    currency: 'USD',
    amountCents: 2_000,
    rateBsPerUsdE4: null,
    ...overrides,
  }
}

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return { id: SEED_METHOD_ID, name: 'Método de Rust', active: true, ...overrides }
}

beforeEach(() => {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID }))
  commit({ ...getState(), payments: [] })
  signInAs('recepcion')
})

describe('createPayment refresca el espejo desde Rust antes de validar', () => {
  it('registra un pago USD con el store sin métodos usando el método de Rust', async () => {
    commit({ ...getState(), paymentMethods: [] })
    stubRustCatalog({ paymentMethods: [method({ id: RUST_ONLY_METHOD_ID })] })

    const created = dataOf(await createPayment(input({ methodId: RUST_ONLY_METHOD_ID })))

    expect(created.methodId).toBe(RUST_ONLY_METHOD_ID)
  })

  it('rechaza un método del seed que Rust no devuelve', async () => {
    stubRustCatalog({ paymentMethods: [] })

    expect(errorOf(await createPayment(input())).code).toBe('notFound')
  })

  it('rechaza un método que Rust marca inactivo aunque el seed lo tenga activo', async () => {
    stubRustCatalog({ paymentMethods: [method({ active: false })] })

    expect(errorOf(await createPayment(input())).code).toBe('validation')
  })

  it('toma la tasa del día de Rust sin haber listado antes, con el store sin tasas', async () => {
    commit({ ...getState(), rates: [] })
    stubRustCatalog({ paymentMethods: [method()], rates: [{ date: TODAY, rateBsPerUsdE4: RUST_RATE_E4 }] })

    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: AMOUNT_CENTS })))

    expect(created.rateBsPerUsdE4).toBe(RUST_RATE_E4)
    expect(created.usdEquivalentCents).toBe(usdEquivalentCents(AMOUNT_CENTS, RUST_RATE_E4))
  })

  it('prefiere la tasa de Rust sobre la del seed para la misma fecha', async () => {
    stubRustCatalog({ paymentMethods: [method()], rates: [{ date: TODAY, rateBsPerUsdE4: RUST_RATE_E4 }] })

    const created = dataOf(await createPayment(input({ currency: 'VES', amountCents: AMOUNT_CENTS })))

    expect(created.rateBsPerUsdE4).toBe(RUST_RATE_E4)
  })

  it('devuelve rateMissing si Rust no tiene la tasa de hoy aunque el seed sí', async () => {
    stubRustCatalog({ paymentMethods: [method()], rates: [] })

    expect(errorOf(await createPayment(input({ currency: 'VES', amountCents: AMOUNT_CENTS }))).code).toBe('rateMissing')
  })

  it('no consulta tasas cuando el pago es USD o trae tasa manual', async () => {
    const calls = stubRustCatalog({ paymentMethods: [method()] })

    await createPayment(input())
    await createPayment(input({ currency: 'VES', amountCents: AMOUNT_CENTS, rateBsPerUsdE4: 365_000 }))

    expect(calls).not.toContain('list_rates')
  })

  it('no consulta a Rust si la entrada no pasa el esquema', async () => {
    const calls = stubRustCatalog({})

    await createPayment(input({ amountCents: -1 }))

    expect(calls).toEqual([])
  })

  it('un fallo de list_rates no impide un pago USD', async () => {
    stubRustCatalog({ paymentMethods: [method()], failing: ['list_rates'] })

    const created = dataOf(await createPayment(input()))

    expect(created.currency).toBe('USD')
    expect(getState().payments).toContain(created)
  })

  it('un fallo de list_rates no impide un pago VES con tasa explícita', async () => {
    stubRustCatalog({ paymentMethods: [method()], failing: ['list_rates'] })

    const created = dataOf(
      await createPayment(input({ currency: 'VES', amountCents: AMOUNT_CENTS, rateBsPerUsdE4: 365_000 })),
    )

    expect(created.rateBsPerUsdE4).toBe(365_000)
    expect(getState().payments).toContain(created)
  })

  it.each(['USD', 'VES'] as const)('un fallo de list_payment_methods propaga el error aunque el pago sea %s con tasa explícita', async (currency) => {
    stubRustCatalog({ paymentMethods: [method()], failing: ['list_payment_methods'] })
    const before = getState().payments

    const error = errorOf(await createPayment(input({ currency, rateBsPerUsdE4: currency === 'VES' ? 365_000 : null })))

    expect(error.code).toBe('internal')
    expect(getState().payments).toBe(before)
  })

  it.each(['list_payment_methods', 'list_rates'])('devuelve el error y no registra el pago si falla %s', async (failing) => {
    stubRustCatalog({ paymentMethods: [method()], rates: [{ date: TODAY, rateBsPerUsdE4: RUST_RATE_E4 }], failing: [failing] })
    const before = getState().payments

    expect(errorOf(await createPayment(input({ currency: 'VES', amountCents: AMOUNT_CENTS }))).code).toBe('internal')
    expect(getState().payments).toBe(before)
  })
})

describe('createPayment sincroniza las citas desde Rust antes de validar', () => {
  it('registra el pago de una cita que solo existe en Rust y la refleja en el espejo', async () => {
    commit({ ...getState(), appointments: [] })
    stubRustCatalog({ paymentMethods: [method()], appointments: [appointmentTemplate({ id: APPOINTMENT_ID })] })

    const created = dataOf(await createPayment(input()))

    expect(created.appointmentId).toBe(APPOINTMENT_ID)
    expect(getState().appointments.map((appointment) => appointment.id)).toEqual([APPOINTMENT_ID])
  })

  it('rechaza con notFound sobre appointmentId una cita que el espejo tiene pero Rust no devuelve', async () => {
    stubRustCatalog({ paymentMethods: [method()], appointments: [] })

    const error = errorOf(await createPayment(input()))

    expect(error).toMatchObject({ code: 'notFound', field: 'appointmentId' })
  })

  it('un fallo de list_all_appointments propaga el error y no registra el pago', async () => {
    stubRustCatalog({ paymentMethods: [method()], failing: ['list_all_appointments'] })
    const before = getState().payments

    const error = errorOf(await createPayment(input()))

    expect(error.code).toBe('internal')
    expect(getState().payments).toBe(before)
  })

  it('consulta list_all_appointments exactamente una vez', async () => {
    const calls = stubRustCatalog({ paymentMethods: [method()] })

    await createPayment(input())

    expect(calls.filter((cmd) => cmd === 'list_all_appointments')).toHaveLength(1)
  })
})

describe('createPayment con citas fuera de cualquier ventana de fechas', () => {
  it('paga una cita de hace 8 meses que solo existe en Rust', async () => {
    seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T11:00' }))
    commit({ ...getState(), appointments: [] })

    const created = dataOf(await createPayment(input()))

    expect(created.appointmentId).toBe(APPOINTMENT_ID)
  })
})
