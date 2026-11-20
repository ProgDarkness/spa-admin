import type { ClockRollback, OwnerSetupResult, RecoveryResult, SetupStatus } from '@/lib/bindings'
import { PERMISSION_KEYS, type Id, type LoginCredentials, type SessionUser, type SessionView } from '@/lib/model'
import {
  forbiddenError,
  invalidCredentialsError,
  unauthenticatedError,
  validationError,
} from './ipc-errors'
import { canonicalRecoveryCode, formatRecoveryCode, normalizeRecoveryCode } from './recovery-codes'

export const DEV_PASSWORD = 'demo1234'
export const IDLE_LOCK_MS = 10 * 60_000

export type CredentialedUser = SessionUser & { password?: string }

export type SessionPort = { read(): Id | null; write(id: Id | null): void }

export type UserDirectoryPort = { add(user: SessionUser): void }

export type AuthBackendOptions = {
  now?: () => number
  directory?: UserDirectoryPort
  clockRollback?: ClockRollback | null
  recoverableUsernames?: readonly string[]
}

export type IpcBackend = (cmd: string, args: unknown) => unknown

const MAX_USERNAME_BYTES = 64
const MAX_PASSWORD_BYTES = 1024
const MIN_NEW_PASSWORD_CHARS = 10
const OWNER_ROLE_NAME = 'Propietaria'

const utf8Encoder = new TextEncoder()

function isWithinBytes(value: string, maxBytes: number): boolean {
  const byteLength = utf8Encoder.encode(value).length
  return byteLength > 0 && byteLength <= maxBytes
}

const DISALLOWED_USERNAME_CHARACTER = new RegExp(
  [
    '\\p{Cc}',
    '[\\u00AD\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u180E\\u200B-\\u200F\\u202A-\\u202E]',
    '[\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB\\u{110BD}\\u{110CD}\\u{13430}-\\u{1343F}]',
    '[\\u{1BCA0}-\\u{1BCA3}\\u{1D173}-\\u{1D17A}\\u{E0001}\\u{E0020}-\\u{E007F}]',
    '[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]',
  ].join('|'),
  'u',
)

function normalizedUsername(raw: string): string | null {
  const username = raw.trim().normalize('NFC')
  if (!isWithinBytes(username, MAX_USERNAME_BYTES)) return null
  return DISALLOWED_USERNAME_CHARACTER.test(username) ? null : username
}

function foldedAsciiCase(username: string): string {
  return username.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function isSameUsername(stored: string, typed: string): boolean {
  return foldedAsciiCase(stored) === foldedAsciiCase(typed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function fieldsOf(args: unknown, key: string): Record<string, unknown> {
  const payload = isRecord(args) ? args[key] : null
  if (!isRecord(payload)) throw invalidCredentialsError()
  return payload
}

function parseCredentials(args: unknown): LoginCredentials {
  const { username, password } = fieldsOf(args, 'credentials')
  if (typeof username !== 'string' || typeof password !== 'string') throw invalidCredentialsError()
  if (!isWithinBytes(password, MAX_PASSWORD_BYTES)) throw invalidCredentialsError()
  const normalized = normalizedUsername(username)
  if (normalized === null) throw invalidCredentialsError()
  return { username: normalized, password }
}

function textField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key]
  if (typeof value !== 'string') throw validationError(key)
  return value
}

function requireNewPassword(password: string): void {
  const isLongEnough = [...password].length >= MIN_NEW_PASSWORD_CHARS
  const isShortEnough = utf8Encoder.encode(password).length <= MAX_PASSWORD_BYTES
  if (!isLongEnough || !isShortEnough) throw validationError('password')
}

function requireRecoveryCodeWithinLimit(code: string): void {
  if (!isWithinBytes(code, MAX_PASSWORD_BYTES)) throw invalidCredentialsError()
}

function toSessionUser(user: SessionUser): SessionUser {
  return { id: user.id, username: user.username, roleName: user.roleName, permissions: [...user.permissions] }
}

function nextUserId(users: readonly SessionUser[]): Id {
  return users.reduce((highest, user) => Math.max(highest, user.id), 0) + 1
}

export function createAuthIpcBackend(
  knownUsers: () => readonly CredentialedUser[],
  session: SessionPort,
  options: AuthBackendOptions = {},
): IpcBackend {
  const now = options.now ?? Date.now
  let lastActivityMs: number | null = null
  let isLocked = false
  let lockedUserId: Id | null = null
  let createdUsers: readonly CredentialedUser[] = []
  let passwords: ReadonlyMap<Id, string> = new Map()
  let recoveryRotations: ReadonlyMap<Id, number> = new Map()
  const directory: UserDirectoryPort = options.directory ?? {
    add: (user) => {
      createdUsers = [...createdUsers, user]
    },
  }

  function allUsers(): readonly CredentialedUser[] {
    return [...knownUsers(), ...createdUsers]
  }

  function rotationOf(user: CredentialedUser): number | undefined {
    const rotation = recoveryRotations.get(user.id)
    if (rotation !== undefined) return rotation
    return options.recoverableUsernames?.includes(user.username) ? 0 : undefined
  }

  function passwordOf(user: CredentialedUser): string {
    return passwords.get(user.id) ?? user.password ?? DEV_PASSWORD
  }

  function activeSessionId(): Id | null {
    return session.read() ?? lockedUserId
  }

  function markActive(): void {
    lastActivityMs = now()
    isLocked = false
    lockedUserId = null
  }

  function clearSessionState(): void {
    lastActivityMs = null
    isLocked = false
    lockedUserId = null
  }

  function observe(): void {
    const id = activeSessionId()
    if (id === null) return clearSessionState()
    const currentMs = now()
    lastActivityMs ??= currentMs
    if (currentMs - lastActivityMs >= IDLE_LOCK_MS) {
      isLocked = true
      lockedUserId = id
    }
  }

  function sessionUser(): CredentialedUser | undefined {
    const id = activeSessionId()
    return allUsers().find((user) => user.id === id)
  }

  function viewOf(user: CredentialedUser | undefined): SessionView | null {
    if (!user) return null
    return isLocked ? { status: 'locked', user: null } : { status: 'active', user: toSessionUser(user) }
  }

  function login(args: unknown): SessionUser {
    const { username, password } = parseCredentials(args)
    const match = allUsers().find((user) => isSameUsername(user.username, username) && passwordOf(user) === password)
    if (!match) throw invalidCredentialsError()
    session.write(match.id)
    markActive()
    return toSessionUser(match)
  }

  function logout(): null {
    session.write(null)
    clearSessionState()
    return null
  }

  function currentSession(): SessionView | null {
    observe()
    return viewOf(sessionUser())
  }

  function recordActivity(): SessionView | null {
    observe()
    if (!isLocked && activeSessionId() !== null) lastActivityMs = now()
    return viewOf(sessionUser())
  }

  function unlock(args: unknown): SessionUser {
    const password = textField(fieldsOf(args, 'credentials'), 'password')
    observe()
    const user = sessionUser()
    if (!user) throw unauthenticatedError()
    if (!isLocked) throw validationError('password')
    if (passwordOf(user) !== password) throw invalidCredentialsError()
    session.write(user.id)
    markActive()
    return toSessionUser(user)
  }

  function setupStatus(): SetupStatus {
    return { needsOwner: allUsers().length === 0, clockRollback: options.clockRollback ?? null }
  }

  function setupOwner(args: unknown): OwnerSetupResult {
    const fields = fieldsOf(args, 'input')
    const username = normalizedUsername(textField(fields, 'username'))
    if (username === null) throw validationError('username')
    const password = textField(fields, 'password')
    requireNewPassword(password)
    if (allUsers().length > 0) throw forbiddenError()
    const owner: SessionUser = {
      id: nextUserId(allUsers()),
      username,
      roleName: OWNER_ROLE_NAME,
      permissions: [...PERMISSION_KEYS],
    }
    directory.add(owner)
    passwords = new Map(passwords).set(owner.id, password)
    recoveryRotations = new Map(recoveryRotations).set(owner.id, 0)
    session.write(owner.id)
    markActive()
    return { user: toSessionUser(owner), recoveryCode: formatRecoveryCode(0) }
  }

  function recoverPassword(args: unknown): RecoveryResult {
    const fields = fieldsOf(args, 'input')
    const newPassword = textField(fields, 'newPassword')
    requireNewPassword(newPassword)
    const rawCode = textField(fields, 'recoveryCode')
    requireRecoveryCodeWithinLimit(rawCode)
    const username = normalizedUsername(textField(fields, 'username'))
    if (username === null) throw invalidCredentialsError()
    const typedCode = normalizeRecoveryCode(rawCode)
    const target = allUsers().find((user) => isSameUsername(user.username, username))
    const rotation = target ? rotationOf(target) : undefined
    if (!target || rotation === undefined || typedCode !== canonicalRecoveryCode(rotation)) {
      throw invalidCredentialsError()
    }
    passwords = new Map(passwords).set(target.id, newPassword)
    recoveryRotations = new Map(recoveryRotations).set(target.id, rotation + 1)
    if (session.read() === target.id) logout()
    return { recoveryCode: formatRecoveryCode(rotation + 1) }
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    login,
    logout,
    current_session: currentSession,
    record_activity: recordActivity,
    unlock,
    setup_status: setupStatus,
    setup_owner: setupOwner,
    recover_password: recoverPassword,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    if (!handler) throw new Error(`IPC no simulado: ${cmd}`)
    return handler(args)
  }
}
