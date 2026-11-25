import { mockIPC } from '@tauri-apps/api/mocks'
import { currentUser } from '@/lib/mock/authorize'
import { todayLocal } from '@/lib/datetime'
import { createSeed, type SeedData } from '@/lib/mock/seed'
import { commit, getState } from '@/lib/mock/store'
import { createAuthIpcBackend } from './ipc/auth-backend'
import { createDevBackends } from './ipc/dev-backends'

export function installDevIpc(overrides: Partial<SeedData> = {}): void {
  const rows = createSeed(todayLocal())
  const authBackend = createAuthIpcBackend(() => getState().users, {
    read: () => getState().sessionUserId,
    write: (id) => commit({ ...getState(), sessionUserId: id }),
  })
  mockIPC(
    createDevBackends({
      auth: authBackend,
      session: () => currentUser(getState()),
      seed: { ...getState(), appointments: rows.appointments, payments: rows.payments, ...overrides },
    }),
  )
}
