import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Id, ServiceInput, ServiceListFilter } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { createService, listServices, setServiceActive, updateService } from './api'

export function useServices(filter: ServiceListFilter) {
  return useQuery({
    queryKey: [QUERY_KEYS.services, filter],
    queryFn: async () => unwrap(await listServices(filter)),
  })
}

function useServiceMutation<Variables>(run: (variables: Variables) => ReturnType<typeof createService>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: Variables) => unwrap(await run(variables)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.services] }),
  })
}

export function useCreateService() {
  return useServiceMutation((input: ServiceInput) => createService(input))
}

export function useUpdateService() {
  return useServiceMutation(({ id, input }: { id: Id; input: ServiceInput }) => updateService(id, input))
}

export function useSetServiceActive() {
  return useServiceMutation(({ id, active }: { id: Id; active: boolean }) => setServiceActive(id, active))
}
