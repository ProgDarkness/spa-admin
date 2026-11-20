import { mockIPC } from '@tauri-apps/api/mocks'
import { currentUser } from '@/lib/mock/authorize'
import type { SeedUsername } from '@/lib/mock/seed'
import { commit, getState } from '@/lib/mock/store'
import type { SessionUser } from '@/lib/model'

export function dropMockSessionKeepingRustActive(): void {
  const rustUser = currentUser(getState())
  commit({ ...getState(), sessionUserId: null })
  const isSessionRead = (cmd: string) => cmd === 'current_session' || cmd === 'record_activity'
  mockIPC((cmd) => (isSessionRead(cmd) ? { status: 'active', user: rustUser } : null))
}

export function signInAs(username: SeedUsername): SessionUser {
  const target = getState().users.find((user) => user.username === username)
  if (!target) throw new Error(`Usuario seed inexistente: ${username}`)
  commit({ ...getState(), sessionUserId: target.id })
  const user = currentUser(getState())
  if (!user) throw new Error('No se pudo iniciar la sesión de prueba')
  return user
}
