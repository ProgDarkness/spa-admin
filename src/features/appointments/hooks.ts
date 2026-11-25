import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Appointment,
  AppointmentInput,
  AppointmentMove,
  AppointmentRange,
  AppointmentTransition,
  Id,
  Result,
} from '@/lib/model'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { createAppointment, listAppointments, moveAppointment, transitionAppointment } from './api'

const DEPENDENT_KEYS = [
  QUERY_KEYS.appointments,
  QUERY_KEYS.clientHistory,
  QUERY_KEYS.metrics,
  QUERY_KEYS.payments,
] as const

export function useAppointments(range: AppointmentRange) {
  return useQuery({
    queryKey: [QUERY_KEYS.appointments, range],
    queryFn: async () => unwrap(await listAppointments(range)),
  })
}

function useAppointmentMutation<Variables>(run: (variables: Variables) => Promise<Result<Appointment>>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: Variables) => unwrap(await run(variables)),
    onSuccess: async () => {
      await Promise.all(DEPENDENT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })))
    },
  })
}

export function useCreateAppointment() {
  return useAppointmentMutation((input: AppointmentInput) => createAppointment(input))
}

export function useMoveAppointment() {
  return useAppointmentMutation((variables: { id: Id; move: AppointmentMove }) =>
    moveAppointment(variables.id, variables.move),
  )
}

export function useTransitionAppointment() {
  return useAppointmentMutation((variables: { id: Id; transition: AppointmentTransition }) =>
    transitionAppointment(variables.id, variables.transition),
  )
}
