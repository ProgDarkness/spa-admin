import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Id, Payment, PaymentInput, Result } from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { createPayment, listPayments, voidPayment } from './api'

const DEPENDENT_KEYS = [QUERY_KEYS.payments, QUERY_KEYS.clientHistory, QUERY_KEYS.metrics] as const

export function usePayments(appointmentId: Id) {
  return useQuery({
    queryKey: [QUERY_KEYS.payments, appointmentId],
    queryFn: async () => unwrap(await listPayments(appointmentId)),
  })
}

function usePaymentMutation<Variables>(run: (variables: Variables) => Promise<Result<Payment>>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: Variables) => unwrap(await run(variables)),
    onSuccess: async () => {
      await Promise.all(DEPENDENT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })))
    },
  })
}

export function useCreatePayment() {
  return usePaymentMutation((input: PaymentInput) => createPayment(input))
}

export function useVoidPayment() {
  return usePaymentMutation(({ id, reason }: { id: Id; reason: string }) => voidPayment(id, reason))
}
