import { commands } from '@/lib/bindings'
import { commit, getState } from '@/lib/mock/store'
import type { Result, SessionUser } from '@/lib/model'
import { err } from '@/lib/result'

const INTERNAL_MESSAGE = 'No se pudo completar la operación'

function syncMockSession(user: SessionUser | null): boolean {
  const state = getState()
  const knownUser = user ? state.users.find((candidate) => candidate.username === user.username) : undefined
  const sessionUserId = knownUser?.id ?? null
  if (state.sessionUserId !== sessionUserId) commit({ ...state, sessionUserId })
  return user === null || knownUser !== undefined
}

async function closeRustSession(): Promise<void> {
  try {
    await commands.logout()
  } catch {
    return
  }
}

async function callBackend<T>(operation: () => Promise<Result<T>>, onOk: (data: T) => boolean): Promise<Result<T>> {
  try {
    const result = await operation()
    if (result.status === 'ok' && !onOk(result.data)) {
      await closeRustSession()
      return err('internal', INTERNAL_MESSAGE)
    }
    return result
  } catch {
    return err('internal', INTERNAL_MESSAGE)
  }
}

export function login(username: string, password: string): Promise<Result<SessionUser>> {
  return callBackend(() => commands.login({ username, password }), syncMockSession)
}

export function logout(): Promise<Result<null>> {
  return callBackend(() => commands.logout(), () => syncMockSession(null))
}

export function currentSession(): Promise<Result<SessionUser | null>> {
  return callBackend(() => commands.currentSession(), syncMockSession)
}
