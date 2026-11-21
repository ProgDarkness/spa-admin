import { commands, type PaymentMethodSummary } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Id, PaymentMethod, PaymentMethodInput, PaymentMethodListFilter, Result } from '@/lib/model'
import { mapOk } from '@/lib/result'

function toPaymentMethod(summary: PaymentMethodSummary): PaymentMethod {
  return { id: summary.id, name: summary.name, active: summary.active }
}

function mirrorPaymentMethods(paymentMethods: readonly PaymentMethod[]): void {
  const state = getState()
  commit({ ...state, paymentMethods: paymentMethods.reduce(upsertById, state.paymentMethods) })
}

function mirrorPaymentMethod(paymentMethod: PaymentMethod): void {
  mirrorPaymentMethods([paymentMethod])
}

function callPaymentMethodBackend(
  operation: () => Promise<Result<PaymentMethodSummary>>,
): Promise<Result<PaymentMethod>> {
  return callBackend(async () => mapOk(await operation(), toPaymentMethod), mirrorPaymentMethod)
}

export function listPaymentMethods(filter: PaymentMethodListFilter): Promise<Result<PaymentMethod[]>> {
  return callBackend(
    async () => mapOk(await commands.listPaymentMethods(filter), (rows) => rows.map(toPaymentMethod)),
    mirrorPaymentMethods,
  )
}

export function createPaymentMethod(input: PaymentMethodInput): Promise<Result<PaymentMethod>> {
  return callPaymentMethodBackend(() => commands.createPaymentMethod(input))
}

export function updatePaymentMethod(id: Id, input: PaymentMethodInput): Promise<Result<PaymentMethod>> {
  return callPaymentMethodBackend(() => commands.updatePaymentMethod({ id, ...input }))
}

export function setPaymentMethodActive(id: Id, active: boolean): Promise<Result<PaymentMethod>> {
  return callPaymentMethodBackend(() => commands.setPaymentMethodActive({ id, active }))
}
