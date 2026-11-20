import { mockIPC } from '@tauri-apps/api/mocks'
import { commit, getState } from '@/lib/mock/store'
import { createAuthIpcBackend } from './auth-backend'

function isRunningInTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export function installDevBrowserIpc(): boolean {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined' || isRunningInTauri()) return false
  mockIPC(
    createAuthIpcBackend(
      () => getState().users,
      {
        read: () => getState().sessionUserId,
        write: (id) => commit({ ...getState(), sessionUserId: id }),
      },
      { directory: { add: (user) => commit({ ...getState(), users: [...getState().users, user] }) } },
    ),
  )
  return true
}
