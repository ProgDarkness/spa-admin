import { currentUser } from '@/lib/mock/authorize'
import type { SeedUsername } from '@/lib/mock/seed'
import { commit, getState } from '@/lib/mock/store'
import type { SessionUser } from '@/lib/model'

export function signInAs(username: SeedUsername): SessionUser {
  const target = getState().users.find((user) => user.username === username)
  if (!target) throw new Error(`Usuario seed inexistente: ${username}`)
  commit({ ...getState(), sessionUserId: target.id })
  const user = currentUser(getState())
  if (!user) throw new Error('No se pudo iniciar la sesión de prueba')
  return user
}
