import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Id, ResourceInput, ResourceListFilter } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import {
  createResource,
  listFutureAppointmentsOfResource,
  listResources,
  setResourceActive,
  updateResource,
} from './api'

export function useResources(filter: ResourceListFilter) {
  return useQuery({
    queryKey: [QUERY_KEYS.resources, filter],
    queryFn: async () => unwrap(await listResources(filter)),
  })
}

export function useFutureAppointmentsOfResource(resourceId: Id | null) {
  return useQuery({
    queryKey: [QUERY_KEYS.appointments, 'futureOfResource', resourceId],
    queryFn: async () => unwrap(await listFutureAppointmentsOfResource(resourceId as Id)),
    enabled: resourceId !== null,
  })
}

function useInvalidateResourceCaches() {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.resources] }),
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.appointments] }),
    ])
  }
}

export function useCreateResource() {
  const invalidate = useInvalidateResourceCaches()
  return useMutation({
    mutationFn: async (input: ResourceInput) => unwrap(await createResource(input)),
    onSuccess: invalidate,
  })
}

export function useUpdateResource() {
  const invalidate = useInvalidateResourceCaches()
  return useMutation({
    mutationFn: async (variables: { id: Id; input: ResourceInput }) =>
      unwrap(await updateResource(variables.id, variables.input)),
    onSuccess: invalidate,
  })
}

export function useSetResourceActive() {
  const invalidate = useInvalidateResourceCaches()
  return useMutation({
    mutationFn: async (variables: { id: Id; active: boolean }) =>
      unwrap(await setResourceActive(variables.id, variables.active)),
    onSuccess: invalidate,
  })
}
