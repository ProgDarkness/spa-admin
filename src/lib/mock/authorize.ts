import { err, ok } from '@/lib/result'
import type { PermissionKey, Result, SessionUser } from '@/lib/model'
import type { StoreState } from './store'

export type PermissionRequirement = PermissionKey | { anyOf: readonly PermissionKey[] }

export function currentUser(state: StoreState): SessionUser | null {
  const user = state.users.find((candidate) => candidate.id === state.sessionUserId)
  if (!user) return null
  return { id: user.id, username: user.username, roleName: user.roleName, permissions: [...user.permissions] }
}

function isSatisfiedBy(user: SessionUser, requirement: PermissionRequirement): boolean {
  if (typeof requirement === 'string') return user.permissions.includes(requirement)
  return requirement.anyOf.some((permission) => user.permissions.includes(permission))
}

export function authorize(state: StoreState, requirement: PermissionRequirement): Result<SessionUser> {
  const user = currentUser(state)
  if (!user) return err('unauthenticated', 'Debes iniciar sesión')
  if (!isSatisfiedBy(user, requirement)) return err('forbidden', 'No tienes permiso para esta acción')
  return ok(user)
}
