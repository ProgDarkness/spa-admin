import { syncAppointmentsMirror } from '@/features/appointments/api'
import { getClient } from '@/features/clients/api'
import { authorize } from '@/lib/mock/authorize'
import { getState, type StoreState } from '@/lib/mock/store'
import type { ClientHistory, Id, PermissionKey, Result } from '@/lib/model'
import { ok } from '@/lib/result'
import { buildClientHistory } from './compute'

const REQUIRED_PERMISSIONS: readonly PermissionKey[] = ['clients.read', 'appointments.read', 'payments.read']

function firstDenial(state: StoreState): Result<never> | null {
  for (const permission of REQUIRED_PERMISSIONS) {
    const access = authorize(state, permission)
    if (access.status === 'error') return access
  }
  return null
}

export async function getClientHistory(clientId: Id): Promise<Result<ClientHistory>> {
  const state = getState()
  const denied = firstDenial(state)
  if (denied) return denied
  const refreshed = await getClient(clientId)
  if (refreshed.status === 'error') return refreshed
  const deniedAfterRefresh = firstDenial(getState())
  if (deniedAfterRefresh) return deniedAfterRefresh
  const synced = await syncAppointmentsMirror()
  if (synced.status === 'error') return synced
  const latest = getState()
  return ok(
    buildClientHistory({
      client: refreshed.data,
      appointments: latest.appointments,
      payments: latest.payments,
      services: latest.services,
      resources: latest.resources,
    }),
  )
}
