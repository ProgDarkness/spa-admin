import { mockIPC } from '@tauri-apps/api/mocks'
import { currentUser } from '@/lib/mock/authorize'
import { commit, getState } from '@/lib/mock/store'
import { createAuthIpcBackend } from './auth-backend'
import { createDevBackends } from './dev-backends'

export const DEV_BROWSER_IPC_SENTINEL = 'spa-dev-browser-ipc/6f2c9a1e'

function isRunningInTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export function installDevBrowserIpc(): boolean {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined' || isRunningInTauri()) return false
  const authBackend = createAuthIpcBackend(
    () => getState().users,
    {
      read: () => getState().sessionUserId,
      write: (id) => commit({ ...getState(), sessionUserId: id }),
    },
    { directory: { add: (user) => commit({ ...getState(), users: [...getState().users, user] }) } },
  )
  mockIPC(
    createDevBackends({
      auth: authBackend,
      session: () => currentUser(getState()),
      seed: getState(),
    }),
  )
  Reflect.set(window, DEV_BROWSER_IPC_SENTINEL, true)
  return true
}
