import { mockIPC } from '@tauri-apps/api/mocks'
import { currentUser } from '@/lib/mock/authorize'
import { commit, getState, type StoreState } from '@/lib/mock/store'
import { createAuthIpcBackend } from './ipc/auth-backend'
import { createDevBackends } from './ipc/dev-backends'

export function installDevIpc(seed: StoreState = getState()): void {
  const authBackend = createAuthIpcBackend(() => getState().users, {
    read: () => getState().sessionUserId,
    write: (id) => commit({ ...getState(), sessionUserId: id }),
  })
  mockIPC(
    createDevBackends({
      auth: authBackend,
      session: () => currentUser(getState()),
      seed,
    }),
  )
}
