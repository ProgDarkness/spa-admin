import { mockIPC } from '@tauri-apps/api/mocks'
import { todayLocal } from '@/lib/datetime'
import { currentUser } from '@/lib/mock/authorize'
import { createSeed, stateOf } from '@/lib/mock/seed'
import { commit, EMPTY_STATE, getState } from '@/lib/mock/store'
import { createAuthIpcBackend, type IpcBackend } from './auth-backend'
import { createDevBackends } from './dev-backends'

export const DEV_BROWSER_IPC_SENTINEL = 'spa-dev-browser-ipc/6f2c9a1e'
export const DEV_BROWSER_BACKEND_CACHE = 'spa-dev-browser-ipc-backend/6f2c9a1e'

function isRunningInTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

function buildBackend(): IpcBackend {
  const seed = createSeed(todayLocal())
  if (getState() === EMPTY_STATE) commit(stateOf(seed))
  const authBackend = createAuthIpcBackend(
    () => getState().users,
    {
      read: () => getState().sessionUserId,
      write: (id) => commit({ ...getState(), sessionUserId: id }),
    },
    { directory: { add: (user) => commit({ ...getState(), users: [...getState().users, user] }) } },
  )
  return createDevBackends({
    auth: authBackend,
    session: () => currentUser(getState()),
    seed: { ...getState(), appointments: seed.appointments, payments: seed.payments },
  })
}

export function installDevBrowserIpc(): boolean {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined' || isRunningInTauri()) return false
  const backend: IpcBackend = Reflect.get(window, DEV_BROWSER_BACKEND_CACHE) ?? buildBackend()
  Reflect.set(window, DEV_BROWSER_BACKEND_CACHE, backend)
  mockIPC(backend)
  Reflect.set(window, DEV_BROWSER_IPC_SENTINEL, true)
  return true
}
