import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Id } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createAuthIpcBackend, DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { signInAs } from '@/test/session'
import { currentSession, login, logout } from './api'

let rustSessionId: Id | null
let backend: ReturnType<typeof createAuthIpcBackend>
let commands: string[]

function useBackend(handler: (cmd: string, args: unknown) => unknown): void {
  mockIPC((cmd, args) => {
    commands.push(cmd)
    return handler(cmd, args)
  })
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  rustSessionId = null
  commands = []
  backend = createAuthIpcBackend(() => getState().users, {
    read: () => rustSessionId,
    write: (id) => {
      rustSessionId = id
    },
  })
  useBackend(backend)
})

afterEach(() => clearMocks())

describe('login', () => {
  it('delega en el comando login y sincroniza la sesión mock', async () => {
    const result = await login('recepcion', DEV_PASSWORD)

    expect(commands).toEqual(['login'])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.data.username).toBe('recepcion')
    expect(result.data.roleName).toBe('Recepción')
    expect(result.data.permissions).toContain('clients.write')
    expect(result.data.permissions).not.toContain('metrics.read')
    expect(rustSessionId).toBe(2)
    expect(getState().sessionUserId).toBe(2)
  })

  it('no expone la contraseña en la sesión devuelta', async () => {
    const result = await login('propietaria', DEV_PASSWORD)

    expect(result.status === 'ok' && 'password' in result.data).toBe(false)
  })

  it('rechaza una clave errónea con invalidCredentials y no abre sesión', async () => {
    const result = await login('propietaria', 'incorrecta')

    expect(result).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
    expect(rustSessionId).toBeNull()
    expect(getState().sessionUserId).toBeNull()
  })

  it('usa el mismo error para usuario inexistente y clave errónea', async () => {
    const wrongPassword = await login('propietaria', 'incorrecta')
    const unknownUser = await login('fantasma', DEV_PASSWORD)

    expect(unknownUser).toEqual(wrongPassword)
  })

  it('rechaza credenciales vacías', async () => {
    const result = await login('', '')

    expect(result).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
  })

  it('un login fallido no toca el store', async () => {
    signInAs('lectura')
    const before = getState()

    await login('propietaria', 'incorrecta')

    expect(getState()).toBe(before)
  })

  it('reemplaza la sesión previa sin mutar el estado anterior', async () => {
    signInAs('lectura')
    const before = getState()

    await login('propietaria', DEV_PASSWORD)

    expect(before.sessionUserId).toBe(3)
    expect(getState().sessionUserId).toBe(1)
  })

  it('devuelve internal si el IPC rechaza con un Error', async () => {
    useBackend(() => {
      throw new Error('IPC caído')
    })
    const before = getState()

    const result = await login('propietaria', DEV_PASSWORD)

    expect(result).toEqual({
      status: 'error',
      error: { code: 'internal', message: 'No se pudo completar la operación', field: null, entityIds: null },
    })
    expect(getState()).toBe(before)
  })
})

describe('logout', () => {
  it('limpia la sesión en Rust y en el mock', async () => {
    await login('propietaria', DEV_PASSWORD)

    const result = await logout()

    expect(result).toEqual({ status: 'ok', data: null })
    expect(rustSessionId).toBeNull()
    expect(getState().sessionUserId).toBeNull()
  })

  it('es idempotente sin sesión', async () => {
    expect(await logout()).toEqual({ status: 'ok', data: null })
  })

  it('devuelve internal si el IPC falla y conserva la sesión mock', async () => {
    signInAs('lectura')
    useBackend(() => {
      throw new Error('pánico')
    })

    const result = await logout()

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().sessionUserId).toBe(3)
  })
})

describe('currentSession', () => {
  it('devuelve null sin sesión', async () => {
    expect(await currentSession()).toEqual({ status: 'ok', data: null })
  })

  it('devuelve el usuario cuando Rust tiene sesión y sincroniza el mock', async () => {
    rustSessionId = 3

    const result = await currentSession()

    expect(result.status === 'ok' && result.data?.username).toBe('lectura')
    expect(getState().sessionUserId).toBe(3)
  })

  it('limpia la sesión mock cuando Rust no tiene sesión', async () => {
    signInAs('lectura')

    expect(await currentSession()).toEqual({ status: 'ok', data: null })
    expect(getState().sessionUserId).toBeNull()
  })

  it('no vuelve a confirmar el estado cuando la sesión ya coincide', async () => {
    rustSessionId = 3
    commit({ ...getState(), sessionUserId: 3 })
    const before = getState()

    await currentSession()

    expect(getState()).toBe(before)
  })

  it('devuelve internal si el IPC falla', async () => {
    useBackend(() => Promise.reject(new Error('IPC caído')))

    expect(await currentSession()).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })

  it('devuelve internal y deja el mock sin sesión cuando Rust devuelve un usuario ausente del mock', async () => {
    useBackend(() => ({ id: 99, username: 'externo', roleName: 'X', permissions: [] }))
    signInAs('lectura')

    const result = await currentSession()

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().sessionUserId).toBeNull()
  })

  it('login con usuario de Rust ausente del mock devuelve internal', async () => {
    useBackend(() => ({ id: 99, username: 'externo', roleName: 'X', permissions: [] }))

    const result = await login('externo', DEV_PASSWORD)

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().sessionUserId).toBeNull()
  })

  it('cierra la sesión de Rust cuando el usuario devuelto no existe en el mock', async () => {
    const externalUser = { id: 99, username: 'externo', roleName: 'X', permissions: [] }
    useBackend((cmd) => (cmd === 'login' ? externalUser : null))

    const result = await login('externo', DEV_PASSWORD)

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(commands).toEqual(['login', 'logout'])
  })

  it('cierra la sesión de Rust en currentSession cuando el usuario no existe en el mock', async () => {
    const externalUser = { id: 99, username: 'externo', roleName: 'X', permissions: [] }
    useBackend((cmd) => (cmd === 'current_session' ? externalUser : null))

    const result = await currentSession()

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(commands).toEqual(['current_session', 'logout'])
  })

  it('devuelve internal aunque el logout de compensación falle', async () => {
    const externalUser = { id: 99, username: 'externo', roleName: 'X', permissions: [] }
    useBackend((cmd) => {
      if (cmd === 'logout') throw new Error('IPC caído')
      return externalUser
    })

    const result = await login('externo', DEV_PASSWORD)

    expect(result).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})
