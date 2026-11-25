import { commands, type OwnerSetup, type OwnerSetupResult, type RecoveryRequest, type RecoveryResult, type SetupStatus } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { commit, getState, nextId, replaceById } from '@/lib/mock/store'
import type { Result, SessionUser, SessionView } from '@/lib/model'

function pointMockSessionTo(sessionUserId: number | null): void {
  const state = getState()
  if (state.sessionUserId !== sessionUserId) commit({ ...state, sessionUserId })
}

function registerInMock(user: SessionUser): number {
  const state = getState()
  const id = state.users.some((candidate) => candidate.id === user.id) ? nextId(state.users) : user.id
  const registered: SessionUser = { id, username: user.username, roleName: user.roleName, permissions: [...user.permissions] }
  commit({ ...state, users: [...state.users, registered], sessionUserId: id })
  return id
}

function hasSameGrants(known: SessionUser, rustUser: SessionUser): boolean {
  return known.roleName === rustUser.roleName && known.permissions.join() === rustUser.permissions.join()
}

function alignKnownUserWithRust(known: SessionUser, rustUser: SessionUser): void {
  if (!hasSameGrants(known, rustUser)) {
    const state = getState()
    const aligned: SessionUser = { ...known, roleName: rustUser.roleName, permissions: [...rustUser.permissions] }
    commit({ ...state, users: replaceById(state.users, aligned) })
  }
  pointMockSessionTo(known.id)
}

function syncMockSession(user: SessionUser | null): void {
  if (user === null) return pointMockSessionTo(null)
  const known = getState().users.find((candidate) => candidate.username === user.username)
  if (known) return alignKnownUserWithRust(known, user)
  registerInMock(user)
}

function syncMockSessionView(view: SessionView | null): void {
  if (view?.status === 'locked') return pointMockSessionTo(null)
  syncMockSession(view?.user ?? null)
}

function syncMockOrDisconnect<T>(onOk: (data: T) => void, data: T): void {
  try {
    onOk(data)
  } catch {
    pointMockSessionTo(null)
  }
}

function callAuthBackend<T>(operation: () => Promise<Result<T>>, onOk: (data: T) => void): Promise<Result<T>> {
  return callBackend(operation, (data) => syncMockOrDisconnect(onOk, data))
}

function ignoreData(): void {}

export function login(username: string, password: string): Promise<Result<SessionUser>> {
  return callAuthBackend(() => commands.login({ username, password }), syncMockSession)
}

export function logout(): Promise<Result<null>> {
  return callAuthBackend(() => commands.logout(), () => syncMockSession(null))
}

export function currentSession(): Promise<Result<SessionView | null>> {
  return callAuthBackend(() => commands.currentSession(), syncMockSessionView)
}

export function recordActivity(): Promise<Result<SessionView | null>> {
  return callAuthBackend(() => commands.recordActivity(), syncMockSessionView)
}

export function unlock(password: string): Promise<Result<SessionUser>> {
  return callAuthBackend(() => commands.unlock({ password }), syncMockSession)
}

export function setupStatus(): Promise<Result<SetupStatus>> {
  return callAuthBackend(() => commands.setupStatus(), ignoreData)
}

export function setupOwner(input: OwnerSetup): Promise<Result<OwnerSetupResult>> {
  return callAuthBackend(() => commands.setupOwner(input), ignoreData)
}

export function recoverPassword(input: RecoveryRequest): Promise<Result<RecoveryResult>> {
  return callAuthBackend(() => commands.recoverPassword(input), ignoreData)
}
