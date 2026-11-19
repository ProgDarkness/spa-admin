import { useQuery } from '@tanstack/react-query'
import type { Id } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { getClientHistory } from './api'

export function useClientHistory(clientId: Id) {
  return useQuery({
    queryKey: [QUERY_KEYS.clientHistory, clientId],
    queryFn: async () => unwrap(await getClientHistory(clientId)),
  })
}
