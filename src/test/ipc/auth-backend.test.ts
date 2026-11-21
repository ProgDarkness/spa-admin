import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'
import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { Id } from '@/lib/model'
import { createAuthIpcBackend, DEV_PASSWORD, type CredentialedUser, type SessionPort } from './auth-backend'

const INVALID_CREDENTIALS = {
  code: 'invalidCredentials',
  message: 'Usuario o contraseña incorrectos',
  field: null,
  entityIds: null,
}

const users: readonly CredentialedUser[] = createSeed('2026-11-12').users

let sessionUserId: Id | null
let writes: (Id | null)[]
let handler: ReturnType<typeof createAuthIpcBackend>

beforeEach(() => {
  sessionUserId = null
  writes = []
  const port: SessionPort = {
    read: () => sessionUserId,
    write: (id) => {
      writes.push(id)
      sessionUserId = id
    },
  }
  handler = vi.fn(createAuthIpcBackend(() => users, port))
  mockIPC(handler)
})

afterEach(() => clearMocks())

describe('login', () => {
  it('invoca el comando login con la clave credentials', async () => {
    await commands.login({ username: 'propietaria', password: DEV_PASSWORD })

    expect(handler).toHaveBeenCalledWith('login', { credentials: { username: 'propietaria', password: DEV_PASSWORD } })
  })

  it('devuelve el usuario de sesión con sus permisos y escribe la sesión', async () => {
    const result = await commands.login({ username: 'recepcion', password: DEV_PASSWORD })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.data).toMatchObject({ id: 2, username: 'recepcion', roleName: 'Recepción' })
    expect(result.data.permissions).toContain('clients.write')
    expect(sessionUserId).toBe(2)
  })

  it('nunca devuelve la contraseña', async () => {
    const result = await commands.login({ username: 'propietaria', password: DEV_PASSWORD })

    expect(result.status === 'ok' && 'password' in result.data).toBe(false)
    expect(JSON.stringify(result)).not.toContain(DEV_PASSWORD)
  })

  it('rechaza una clave errónea sin abrir sesión', async () => {
    const result = await commands.login({ username: 'propietaria', password: 'incorrecta' })

    expect(result).toEqual({ status: 'error', error: INVALID_CREDENTIALS })
    expect(writes).toEqual([])
  })

  it('devuelve el mismo error para usuario desconocido y clave errónea', async () => {
    const wrongPassword = await commands.login({ username: 'propietaria', password: 'incorrecta' })
    const unknownUser = await commands.login({ username: 'fantasma', password: DEV_PASSWORD })

    expect(unknownUser).toEqual(wrongPassword)
  })

  it.each([
    ['usuario vacío', { username: '', password: DEV_PASSWORD }],
    ['clave vacía', { username: 'propietaria', password: '' }],
    ['usuario de 65 caracteres', { username: 'a'.repeat(65), password: DEV_PASSWORD }],
    ['clave de 1025 caracteres', { username: 'propietaria', password: 'a'.repeat(1025) }],
  ])('rechaza credenciales inválidas: %s', async (_name, credentials) => {
    const result = await commands.login(credentials)

    expect(result).toEqual({ status: 'error', error: INVALID_CREDENTIALS })
    expect(writes).toEqual([])
  })

  describe('longitud en bytes UTF-8', () => {
    function registerUser(username: string, password: string): void {
      const registered: CredentialedUser = { id: 1, roleName: 'Propietaria', permissions: [], username, password }
      mockIPC(createAuthIpcBackend(() => [registered], { read: () => null, write: (id) => writes.push(id) }))
    }

    it.each([
      ['usuario de 33 caracteres de 2 bytes', 'é'.repeat(33), 'clave'],
      ['clave de 257 caracteres de 4 bytes', 'propietaria', '😀'.repeat(257)],
    ])('rechaza %s aunque exista el usuario', async (_name, username, password) => {
      registerUser(username, password)

      const result = await commands.login({ username, password })

      expect(result).toEqual({ status: 'error', error: INVALID_CREDENTIALS })
      expect(writes).toEqual([])
    })

    it('acepta credenciales cuyo tamaño en bytes UTF-8 es exactamente el límite', async () => {
      const username = 'é'.repeat(32)
      const password = '😀'.repeat(256)
      registerUser(username, password)

      const result = await commands.login({ username, password })

      expect(result.status).toBe('ok')
      expect(writes).toHaveLength(1)
    })
  })

  describe('espacios en los bordes del usuario', () => {
    function registerAna(): void {
      const registered: CredentialedUser = { id: 1, roleName: 'Propietaria', permissions: [], username: 'ana', password: 'clave' }
      mockIPC(createAuthIpcBackend(() => [registered], { read: () => null, write: (id) => writes.push(id) }))
    }

    it('rechaza un usuario con U+FEFF al inicio porque no es White_Space', async () => {
      registerAna()

      const result = await commands.login({ username: '\uFEFFana', password: 'clave' })

      expect(result).toEqual({ status: 'error', error: INVALID_CREDENTIALS })
      expect(writes).toEqual([])
    })

    it('recorta U+0085 en ambos bordes del usuario porque es White_Space', async () => {
      registerAna()

      const result = await commands.login({ username: '\u0085ana\u0085', password: 'clave' })

      expect(result.status).toBe('ok')
      expect(result.status === 'ok' && result.data.username).toBe('ana')
    })
  })

  it.each([
    ['sin args', undefined],
    ['sin credentials', {}],
    ['credentials nulas', { credentials: null }],
    ['campos de tipo erróneo', { credentials: { username: 1, password: true } }],
  ])('rechaza argumentos mal formados: %s', async (_name, args) => {
    await expect(invoke('login', args)).rejects.toEqual(INVALID_CREDENTIALS)
    expect(writes).toEqual([])
  })

  it('acepta los límites exactos de longitud sin error de validación', async () => {
    const result = await commands.login({ username: 'a'.repeat(64), password: 'a'.repeat(1024) })

    expect(result).toEqual({ status: 'error', error: INVALID_CREDENTIALS })
  })

  it('consulta los usuarios en cada llamada', async () => {
    const lookup = vi.fn(() => users)
    mockIPC(createAuthIpcBackend(lookup, { read: () => null, write: () => {} }))

    await commands.login({ username: 'propietaria', password: DEV_PASSWORD })
    await commands.login({ username: 'propietaria', password: DEV_PASSWORD })

    expect(lookup).toHaveBeenCalledTimes(2)
  })
})

describe('logout', () => {
  it('limpia la sesión y devuelve null', async () => {
    sessionUserId = 1

    const result = await commands.logout()

    expect(result).toEqual({ status: 'ok', data: null })
    expect(sessionUserId).toBeNull()
  })

  it('es idempotente sin sesión', async () => {
    await commands.logout()
    const result = await commands.logout()

    expect(result).toEqual({ status: 'ok', data: null })
  })
})

describe('current_session', () => {
  it('devuelve null sin sesión', async () => {
    expect(await commands.currentSession()).toEqual({ status: 'ok', data: null })
  })

  it('devuelve el usuario con sesión, sin contraseña', async () => {
    sessionUserId = 3

    const result = await commands.currentSession()

    expect(result.status === 'ok' && result.data?.status).toBe('active')
    expect(result.status === 'ok' && result.data?.user?.username).toBe('lectura')
    expect(result.status === 'ok' && result.data?.user && 'password' in result.data.user).toBe(false)
  })

  it('devuelve null si el usuario de la sesión ya no existe', async () => {
    sessionUserId = 999

    expect(await commands.currentSession()).toEqual({ status: 'ok', data: null })
  })
})

describe('comando desconocido', () => {
  it('falla ruidosamente con un Error', async () => {
    await expect(invoke('otro_comando')).rejects.toThrow('IPC no simulado: otro_comando')
  })
})
