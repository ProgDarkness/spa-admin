import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { todayLocal } from '@/lib/datetime'
import type { ExchangeRate } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { getRate, listRates, upsertRate } from './api'

export function useRates() {
  return useQuery({
    queryKey: [QUERY_KEYS.rates],
    queryFn: async () => unwrap(await listRates()),
  })
}

export function useTodayRate() {
  const today = todayLocal()
  return useQuery({
    queryKey: [QUERY_KEYS.rates, 'day', today],
    queryFn: async () => unwrap(await getRate(today)),
  })
}

export function useUpsertRate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, rateBsPerUsdE4 }: ExchangeRate) => unwrap(await upsertRate(date, rateBsPerUsdE4)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.rates] }),
  })
}
