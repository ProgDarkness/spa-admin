import { listPaymentMethods } from '@/features/payment-methods/api'
import { listRates } from '@/features/rates/api'
import { todayLocal, nowLocal } from '@/lib/datetime'
import { authorize } from '@/lib/mock/authorize'
import { appendRow, commit, findById, getState, nextId, replaceById, type StoreState } from '@/lib/mock/store'
import type { Id, Payment, PaymentInput, RateE4, Result } from '@/lib/model'
import { usdEquivalentCents } from '@/lib/money'
import { err, ok, validationError } from '@/lib/result'
import { paymentInputSchema, voidFormSchema } from './schemas'

const PAYMENTS_READ = 'payments.read'
const PAYMENTS_WRITE = 'payments.write'

function dayRateOf(state: StoreState): RateE4 | null {
  const today = todayLocal()
  return state.rates.find((rate) => rate.date === today)?.rateBsPerUsdE4 ?? null
}

function conversionOf(input: PaymentInput, state: StoreState): Result<{ rate: RateE4 | null; usd: number }> {
  if (input.currency === 'USD') return ok({ rate: null, usd: input.amountCents })
  const rate = input.rateBsPerUsdE4 ?? dayRateOf(state)
  if (rate === null) {
    return err('rateMissing', 'Falta la tasa de hoy; registra la tasa o indícala manualmente', {
      field: 'rateBsPerUsdE4',
    })
  }
  return ok({ rate, usd: usdEquivalentCents(input.amountCents, rate) })
}

const INCLUDE_INACTIVE = { includeInactive: true }

function needsDayRate(input: PaymentInput): boolean {
  return input.currency === 'VES' && input.rateBsPerUsdE4 === null
}

async function refreshFromRust(input: PaymentInput): Promise<Result<never> | null> {
  const methods = await listPaymentMethods(INCLUDE_INACTIVE)
  if (methods.status === 'error') return methods
  if (!needsDayRate(input)) return null
  const rates = await listRates()
  return rates.status === 'error' ? rates : null
}

export async function listPayments(appointmentId: Id): Promise<Result<Payment[]>> {
  const state = getState()
  const access = authorize(state, PAYMENTS_READ)
  if (access.status === 'error') return access
  return ok(state.payments.filter((payment) => payment.appointmentId === appointmentId))
}

export async function createPayment(input: PaymentInput): Promise<Result<Payment>> {
  const access = authorize(getState(), PAYMENTS_WRITE)
  if (access.status === 'error') return access
  const parsed = paymentInputSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error.issues)
  const valid = parsed.data
  const refreshFailure = await refreshFromRust(valid)
  if (refreshFailure) return refreshFailure
  const state = getState()
  if (!findById(state.appointments, valid.appointmentId)) {
    return err('notFound', 'La cita no existe', { field: 'appointmentId' })
  }
  const method = findById(state.paymentMethods, valid.methodId)
  if (!method) return err('notFound', 'El método de pago no existe', { field: 'methodId' })
  if (!method.active) return err('validation', 'El método de pago está inactivo', { field: 'methodId' })
  const conversion = conversionOf(valid, state)
  if (conversion.status === 'error') return conversion
  const created: Payment = {
    id: nextId(state.payments),
    appointmentId: valid.appointmentId,
    methodId: valid.methodId,
    currency: valid.currency,
    amountCents: valid.amountCents,
    rateBsPerUsdE4: conversion.data.rate,
    usdEquivalentCents: conversion.data.usd,
    paidAt: nowLocal(),
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  }
  commit({ ...state, payments: appendRow(state.payments, created) })
  return ok(created)
}

export async function voidPayment(id: Id, reason: string): Promise<Result<Payment>> {
  const state = getState()
  const access = authorize(state, PAYMENTS_WRITE)
  if (access.status === 'error') return access
  const parsed = voidFormSchema.safeParse({ reason })
  if (!parsed.success) return validationError(parsed.error.issues)
  const existing = findById(state.payments, id)
  if (!existing) return err('notFound', 'El pago no existe')
  if (existing.voidedAt !== null) return err('alreadyVoided', 'El pago ya fue anulado', { entityIds: [id] })
  const voided: Payment = {
    ...existing,
    voidedAt: nowLocal(),
    voidedBy: access.data.id,
    voidReason: parsed.data.reason,
  }
  commit({ ...state, payments: replaceById(state.payments, voided) })
  return ok(voided)
}
