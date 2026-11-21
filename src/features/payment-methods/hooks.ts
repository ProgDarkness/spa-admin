import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Id, PaymentMethodInput, PaymentMethodListFilter } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { createPaymentMethod, listPaymentMethods, setPaymentMethodActive, updatePaymentMethod } from './api'

const INCLUDE_INACTIVE: PaymentMethodListFilter = { includeInactive: true }

export function usePaymentMethods() {
  return useQuery({
    queryKey: [QUERY_KEYS.paymentMethods],
    queryFn: async () => unwrap(await listPaymentMethods(INCLUDE_INACTIVE)),
  })
}

function usePaymentMethodMutation<Variables>(run: (variables: Variables) => ReturnType<typeof createPaymentMethod>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: Variables) => unwrap(await run(variables)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.paymentMethods] }),
  })
}

export function useCreatePaymentMethod() {
  return usePaymentMethodMutation((input: PaymentMethodInput) => createPaymentMethod(input))
}

export function useUpdatePaymentMethod() {
  return usePaymentMethodMutation(({ id, input }: { id: Id; input: PaymentMethodInput }) =>
    updatePaymentMethod(id, input),
  )
}

export function useSetPaymentMethodActive() {
  return usePaymentMethodMutation(({ id, active }: { id: Id; active: boolean }) => setPaymentMethodActive(id, active))
}
