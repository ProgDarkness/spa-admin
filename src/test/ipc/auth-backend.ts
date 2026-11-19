import type { AppError } from '@/lib/bindings'
import type { Id, LoginCredentials, SessionUser } from '@/lib/model'

export const DEV_PASSWORD = 'demo1234'

export type CredentialedUser = SessionUser & { password?: string }

export type SessionPort = { read(): Id | null; write(id: Id | null): void }

export type IpcBackend = (cmd: string, args: unknown) => unknown

const MAX_USERNAME_BYTES = 64
const MAX_PASSWORD_BYTES = 1024

const INVALID_CREDENTIALS: AppError = {
  code: 'invalidCredentials',
  message: 'Usuario o contraseña incorrectos',
  field: null,
  entityIds: null,
}

function invalidCredentials(): AppError {
  return { ...INVALID_CREDENTIALS }
}

const utf8Encoder = new TextEncoder()

function isWithinBytes(value: string, maxBytes: number): boolean {
  const byteLength = utf8Encoder.encode(value).length
  return byteLength > 0 && byteLength <= maxBytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCredentials(args: unknown): LoginCredentials {
  const credentials = isRecord(args) ? args.credentials : null
  if (!isRecord(credentials)) throw invalidCredentials()
  const { username, password } = credentials
  if (typeof username !== 'string' || typeof password !== 'string') throw invalidCredentials()
  if (!isWithinBytes(username, MAX_USERNAME_BYTES)) throw invalidCredentials()
  if (!isWithinBytes(password, MAX_PASSWORD_BYTES)) throw invalidCredentials()
  return { username, password }
}

function toSessionUser(user: CredentialedUser): SessionUser {
  return { id: user.id, username: user.username, roleName: user.roleName, permissions: [...user.permissions] }
}

export function createAuthIpcBackend(users: () => readonly CredentialedUser[], session: SessionPort): IpcBackend {
  function login(args: unknown): SessionUser {
    const { username, password } = parseCredentials(args)
    const match = users().find((user) => user.username === username && (user.password ?? DEV_PASSWORD) === password)
    if (!match) throw invalidCredentials()
    session.write(match.id)
    return toSessionUser(match)
  }

  function currentSession(): SessionUser | null {
    const id = session.read()
    const match = users().find((user) => user.id === id)
    return match ? toSessionUser(match) : null
  }

  function logout(): null {
    session.write(null)
    return null
  }

  return (cmd, args) => {
    switch (cmd) {
      case 'login':
        return login(args)
      case 'logout':
        return logout()
      case 'current_session':
        return currentSession()
      default:
        throw new Error(`IPC no simulado: ${cmd}`)
    }
  }
}
