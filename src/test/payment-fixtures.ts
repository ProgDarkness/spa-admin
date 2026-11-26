import { listPayments } from '@/features/payments/api'
import type { Id, Payment } from '@/lib/model'
import { dataOf } from './appointment-fixtures'

export async function paymentsOfAppointment(appointmentId: Id): Promise<Payment[]> {
  return dataOf(await listPayments(appointmentId))
}
