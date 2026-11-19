import { useQuery } from '@tanstack/react-query'
import type { YearMonth } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { getMonthlyMetrics } from './api'

export function useMonthlyMetrics(month: YearMonth) {
  return useQuery({
    queryKey: [QUERY_KEYS.metrics, month],
    queryFn: async () => unwrap(await getMonthlyMetrics(month)),
  })
}
