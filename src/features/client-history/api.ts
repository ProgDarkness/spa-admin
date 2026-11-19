import { authorize } from '@/lib/mock/authorize'
import { findById, getState } from '@/lib/mock/store'
import type { ClientHistory, Id, PermissionKey, Result } from '@/lib/model'
import { err, ok } from '@/lib/result'
import { buildClientHistory } from './compute'

const REQUIRED_PERMISSIONS: readonly PermissionKey[] = ['clients.read', 'appointments.read', 'payments.read']
const CLIENT_NOT_FOUND_MESSAGE = 'El cliente no existe'

export async function getClientHistory(clientId: Id): Promise<Result<ClientHistory>> {
  const state = getState()
  for (const permission of REQUIRED_PERMISSIONS) {
    const access = authorize(state, permission)
    if (access.status === 'error') return access
  }
  const client = findById(state.clients, clientId)
  if (!client) return err('notFound', CLIENT_NOT_FOUND_MESSAGE)
  return ok(
    buildClientHistory({
      client,
      appointments: state.appointments,
      payments: state.payments,
      services: state.services,
      resources: state.resources,
    }),
  )
}
