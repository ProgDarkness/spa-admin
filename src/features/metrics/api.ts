import { syncAppointmentsMirror } from '@/features/appointments/api'
import { syncPaymentsMirror } from '@/features/payments/api'
import { authorize } from '@/lib/mock/authorize'
import { getState } from '@/lib/mock/store'
import type { MonthlyMetrics, Result } from '@/lib/model'
import { ok, validationError } from '@/lib/result'
import { computeMonthlyMetrics } from './compute'
import { monthInputSchema } from './schemas'

const METRICS_READ = 'metrics.read'

export async function getMonthlyMetrics(month: string): Promise<Result<MonthlyMetrics>> {
  const access = authorize(getState(), METRICS_READ)
  if (access.status === 'error') return access
  const parsed = monthInputSchema.safeParse({ month })
  if (!parsed.success) return validationError(parsed.error.issues)
  const synced = await syncAppointmentsMirror()
  if (synced.status === 'error') return synced
  const syncedPayments = await syncPaymentsMirror()
  if (syncedPayments.status === 'error') return syncedPayments
  const state = getState()
  return ok(computeMonthlyMetrics(parsed.data.month, state.appointments, state.payments))
}
