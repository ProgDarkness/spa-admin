import { commands } from '@/lib/bindings'
import { callBackend, settle } from '@/lib/ipc'
import { createMirrorSync } from '@/lib/mirror-sync'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Id, Payment, PaymentInput, Result } from '@/lib/model'

const mirrorSync = createMirrorSync()

function replacePayments(payments: readonly Payment[]): void {
  commit({ ...getState(), payments })
}

function mirrorPayment(payment: Payment): void {
  const state = getState()
  commit({ ...state, payments: upsertById(state.payments, payment) })
}

function callPaymentBackend(operation: () => Promise<Result<Payment>>): Promise<Result<Payment>> {
  return callBackend(operation, mirrorSync.reflectMutation(mirrorPayment))
}

export function listPayments(appointmentId: Id): Promise<Result<Payment[]>> {
  return settle(() => commands.listPayments(appointmentId))
}

export function syncPaymentsMirror(): Promise<Result<Payment[]>> {
  return mirrorSync.listUntilApplied(() => commands.listAllPayments(), replacePayments)
}

export function createPayment(input: PaymentInput): Promise<Result<Payment>> {
  return callPaymentBackend(() => commands.createPayment(input))
}

export function voidPayment(id: Id, reason: string): Promise<Result<Payment>> {
  return callPaymentBackend(() => commands.voidPayment({ id, reason }))
}
