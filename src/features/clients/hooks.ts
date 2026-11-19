import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Client, ClientInput, ClientListFilter, Id, Result } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { createClient, listClients, reactivateClient, softDeleteClient, updateClient } from './api'

export function useClients(filter: ClientListFilter) {
  return useQuery({
    queryKey: [QUERY_KEYS.clients, filter],
    queryFn: async () => unwrap(await listClients(filter)),
  })
}

function useClientMutation<Args>(run: (args: Args) => Promise<Result<Client>>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: Args) => unwrap(await run(args)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.clients] }),
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.clientHistory] }),
      ])
    },
  })
}

export function useCreateClient() {
  return useClientMutation((input: ClientInput) => createClient(input))
}

export function useUpdateClient() {
  return useClientMutation((args: { id: Id; input: ClientInput }) => updateClient(args.id, args.input))
}

export function useSoftDeleteClient() {
  return useClientMutation((id: Id) => softDeleteClient(id))
}

export function useReactivateClient() {
  return useClientMutation((id: Id) => reactivateClient(id))
}
