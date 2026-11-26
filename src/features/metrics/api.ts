import { commands, type MonthlyMetrics } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import type { Result, YearMonth } from '@/lib/model'

export function getMonthlyMetrics(month: YearMonth): Promise<Result<MonthlyMetrics>> {
  return settle(() => commands.getMonthlyMetrics(month))
}
