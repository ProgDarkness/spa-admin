import { authorize } from '@/lib/mock/authorize'
import { getState } from '@/lib/mock/store'
import type { MonthlyMetrics, Result } from '@/lib/model'
import { ok, validationError } from '@/lib/result'
import { computeMonthlyMetrics } from './compute'
import { monthInputSchema } from './schemas'

const METRICS_READ = 'metrics.read'

export async function getMonthlyMetrics(month: string): Promise<Result<MonthlyMetrics>> {
  const state = getState()
  const access = authorize(state, METRICS_READ)
  if (access.status === 'error') return access
  const parsed = monthInputSchema.safeParse({ month })
  if (!parsed.success) return validationError(parsed.error.issues)
  return ok(computeMonthlyMetrics(parsed.data.month, state.appointments, state.payments))
}
