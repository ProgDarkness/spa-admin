import { commands } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import type { Id, Payment, PaymentInput, Result } from '@/lib/model'

export function listPayments(appointmentId: Id): Promise<Result<Payment[]>> {
  return settle(() => commands.listPayments(appointmentId))
}

export function createPayment(input: PaymentInput): Promise<Result<Payment>> {
  return settle(() => commands.createPayment(input))
}

export function voidPayment(id: Id, reason: string): Promise<Result<Payment>> {
  return settle(() => commands.voidPayment({ id, reason }))
}
