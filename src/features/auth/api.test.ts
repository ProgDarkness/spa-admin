import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorize } from '@/lib/mock/authorize'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Id, SessionUser } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createAuthIpcBackend, DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { signInAs } from '@/test/session'
import { currentSession, login, logout, recordActivity, recoverPassword, setupOwner, setupStatus, unlock } from './api'

const EXTERNAL_USER: SessionUser = { id: 99, username: 'externo', roleName: 'Recepción', permissions: [] }

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

    expect(result.status === 'ok' && result.data?.status).toBe('active')
    expect(result.status === 'ok' && result.data?.user?.username).toBe('lectura')
    expect(getState().sessionUserId).toBe(3)
  })

  it('locked_view_unlinks_the_mock_session_without_closing_rust', async () => {
    signInAs('lectura')
    useBackend(() => ({ status: 'locked', user: null }))

    const result = await currentSession()

    expect(result).toEqual({ status: 'ok', data: { status: 'locked', user: null } })
    expect(getState().sessionUserId).toBeNull()
    expect(commands).toEqual(['current_session'])
  })

  it('un mock desvinculado por bloqueo no autoriza datos y se vuelve a apuntar al desbloquear', async () => {
    signInAs('lectura')
    useBackend(() => ({ status: 'locked', user: null }))
    await currentSession()
    expect(authorize(getState(), 'clients.read')).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })

    useBackend((cmd) => (cmd === 'unlock' ? { id: 3, username: 'lectura', roleName: 'Solo lectura', permissions: [] } : null))
    await unlock(DEV_PASSWORD)

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

  it('currentSession da de alta en el mock al usuario de Rust ausente y apunta la sesión a él', async () => {
    useBackend(() => ({ status: 'active', user: EXTERNAL_USER }))

    const result = await currentSession()

    expect(result.status).toBe('ok')
    const stored = getState().users.find((user) => user.username === 'externo')
    expect(stored).toEqual(EXTERNAL_USER)
    expect(getState().sessionUserId).toBe(99)
    expect(commands).toEqual(['current_session'])
  })

  it('login con usuario de Rust ausente del mock funciona sin cerrar la sesión de Rust', async () => {
    useBackend(() => EXTERNAL_USER)

    const result = await login('externo', DEV_PASSWORD)

    expect(result).toMatchObject({ status: 'ok', data: { username: 'externo' } })
    expect(getState().sessionUserId).toBe(99)
    expect(commands).toEqual(['login'])
  })

  it('alinea rol y permisos de un usuario existente del mock con los de Rust y conserva su id', async () => {
    useBackend(() => ({ id: 77, username: 'lectura', roleName: 'Otro', permissions: ['users.manage'] }))

    await login('lectura', DEV_PASSWORD)

    expect(getState().users.find((user) => user.username === 'lectura')).toEqual({
      id: 3,
      username: 'lectura',
      roleName: 'Otro',
      permissions: ['users.manage'],
    })
    expect(getState().sessionUserId).toBe(3)
  })

  it('mock_never_grants_more_than_rust_for_a_downgraded_known_user', async () => {
    useBackend(() => ({ id: 1, username: 'propietaria', roleName: 'Solo lectura', permissions: ['clients.read'] }))

    await login('propietaria', DEV_PASSWORD)

    expect(authorize(getState(), 'catalog.write')).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(authorize(getState(), 'metrics.read')).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(authorize(getState(), 'clients.read')).toMatchObject({ status: 'ok' })
  })

  it('currentSession también degrada al usuario conocido del mock', async () => {
    useBackend(() => ({
      status: 'active',
      user: { id: 1, username: 'propietaria', roleName: 'Solo lectura', permissions: ['clients.read'] },
    }))

    await currentSession()

    expect(authorize(getState(), 'catalog.write')).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('un fallo al sincronizar el mock no convierte un login exitoso en internal y deja el mock sin sesión', async () => {
    signInAs('lectura')
    const poisonedUsers = new Proxy([], {
      get() {
        throw new Error('mock corrupto')
      },
    })
    commit({ ...getState(), users: poisonedUsers })
    useBackend(() => EXTERNAL_USER)

    const result = await login('externo', DEV_PASSWORD)

    expect(result).toMatchObject({ status: 'ok', data: { username: 'externo' } })
    expect(getState().sessionUserId).toBeNull()
  })

  it('reasigna el id si el de Rust ya lo usa otro usuario del mock', async () => {
    useBackend(() => ({ ...EXTERNAL_USER, id: 1 }))

    await login('externo', DEV_PASSWORD)

    const stored = getState().users.find((user) => user.username === 'externo')
    expect(stored?.id).not.toBe(1)
    expect(getState().users.find((user) => user.id === 1)?.username).toBe('propietaria')
    expect(getState().sessionUserId).toBe(stored?.id)
  })

  it('concede al usuario dado de alta solo los permisos que Rust devolvió', async () => {
    useBackend(() => ({ ...EXTERNAL_USER, permissions: ['clients.read'] }))

    await login('externo', DEV_PASSWORD)

    expect(getState().users.find((user) => user.username === 'externo')?.permissions).toEqual(['clients.read'])
  })

  it('no duplica al usuario en llamadas repetidas', async () => {
    useBackend(() => ({ status: 'active', user: EXTERNAL_USER }))

    await currentSession()
    await currentSession()

    expect(getState().users.filter((user) => user.username === 'externo')).toHaveLength(1)
  })
})

describe('recordActivity', () => {
  it('delega en record_activity y devuelve la vista activa', async () => {
    rustSessionId = 3

    const result = await recordActivity()

    expect(commands).toEqual(['record_activity'])
    expect(result.status === 'ok' && result.data?.status).toBe('active')
  })

  it('devuelve null sin sesión y limpia la sesión mock', async () => {
    signInAs('lectura')

    expect(await recordActivity()).toEqual({ status: 'ok', data: null })
    expect(getState().sessionUserId).toBeNull()
  })

  it('devuelve internal si el IPC falla', async () => {
    useBackend(() => Promise.reject(new Error('IPC caído')))

    expect(await recordActivity()).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('unlock', () => {
  it('delega en unlock con la clave credentials y conserva la sesión mock', async () => {
    const calls: unknown[] = []
    signInAs('lectura')
    useBackend((cmd, args) => {
      calls.push(args)
      return cmd === 'unlock' ? { id: 3, username: 'lectura', roleName: 'Solo lectura', permissions: [] } : null
    })

    const result = await unlock(DEV_PASSWORD)

    expect(calls).toEqual([{ credentials: { password: DEV_PASSWORD } }])
    expect(result).toMatchObject({ status: 'ok', data: { username: 'lectura' } })
    expect(getState().sessionUserId).toBe(3)
  })

  it('propaga invalidCredentials del backend', async () => {
    useBackend(() => {
      throw { code: 'invalidCredentials', message: 'Usuario o contraseña incorrectos', field: null, entityIds: null }
    })

    expect(await unlock('mala')).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
  })

  it('unlock con usuario de Rust ausente del mock lo da de alta y no cierra la sesión', async () => {
    useBackend((cmd) => (cmd === 'unlock' ? EXTERNAL_USER : null))

    expect(await unlock(DEV_PASSWORD)).toMatchObject({ status: 'ok', data: { username: 'externo' } })
    expect(getState().sessionUserId).toBe(99)
    expect(commands).toEqual(['unlock'])
  })
})

describe('setupStatus', () => {
  it('delega en setup_status', async () => {
    expect(await setupStatus()).toEqual({ status: 'ok', data: { needsOwner: false, clockRollback: null } })
    expect(commands).toEqual(['setup_status'])
  })

  it('devuelve internal si el IPC falla', async () => {
    useBackend(() => Promise.reject(new Error('caído')))

    expect(await setupStatus()).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('setupOwner', () => {
  it('delega en setup_owner con la clave input', async () => {
    const calls: unknown[] = []
    useBackend((_cmd, args) => {
      calls.push(args)
      return { user: { id: 1, username: 'dueña', roleName: 'Propietaria', permissions: [] }, recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE' }
    })

    const result = await setupOwner({ username: 'dueña', password: 'clave-larga-1' })

    expect(calls).toEqual([{ input: { username: 'dueña', password: 'clave-larga-1' } }])
    expect(result).toMatchObject({ status: 'ok', data: { recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE' } })
  })

  it('propaga forbidden y devuelve internal ante fallo de IPC', async () => {
    useBackend(() => {
      throw { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null }
    })
    expect(await setupOwner({ username: 'x', password: 'clave-larga-1' })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })

    useBackend(() => Promise.reject(new Error('caído')))
    expect(await setupOwner({ username: 'x', password: 'clave-larga-1' })).toMatchObject({
      status: 'error',
      error: { code: 'internal' },
    })
  })
})

describe('recoverPassword', () => {
  it('delega en recover_password con la clave input y devuelve el código nuevo', async () => {
    const calls: unknown[] = []
    useBackend((_cmd, args) => {
      calls.push(args)
      return { recoveryCode: 'NEW1-NEW2-NEW3-NEW4-NEW5' }
    })
    const request = { username: 'dueña', recoveryCode: 'ABCDEFGHIJKLMNOPQRST', newPassword: 'clave-larga-2' }

    const result = await recoverPassword(request)

    expect(calls).toEqual([{ input: request }])
    expect(result).toEqual({ status: 'ok', data: { recoveryCode: 'NEW1-NEW2-NEW3-NEW4-NEW5' } })
  })

  it('no toca la sesión mock', async () => {
    signInAs('lectura')
    useBackend(() => ({ recoveryCode: 'X' }))

    await recoverPassword({ username: 'u', recoveryCode: 'c', newPassword: 'clave-larga-2' })

    expect(getState().sessionUserId).toBe(3)
  })

  it('devuelve internal si el IPC falla', async () => {
    useBackend(() => Promise.reject(new Error('caído')))

    expect(await recoverPassword({ username: 'u', recoveryCode: 'c', newPassword: 'p' })).toMatchObject({
      status: 'error',
      error: { code: 'internal' },
    })
  })
})
