import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from '@/lib/bindings'
import type { SessionUser } from '@/lib/model'
import { createSeed } from '@/lib/mock/seed'
import { createAuthIpcBackend, DEV_PASSWORD, type AuthBackendOptions } from './auth-backend'
import { canonicalRecoveryCode, formatRecoveryCode } from './recovery-codes'

const MINUTE_MS = 60_000
const IDLE_LOCK_MS = 10 * MINUTE_MS
const GOOD_PASSWORD = 'clave-larga-1'

let nowMs: number
let sessionUserId: number | null
let directoryUsers: SessionUser[]

function install(options: AuthBackendOptions = {}, seeded = true): void {
  const seedUsers = seeded ? createSeed('2026-11-12').users : []
  mockIPC(
    createAuthIpcBackend(
      () => [...seedUsers, ...directoryUsers],
      {
        read: () => sessionUserId,
        write: (id) => {
          sessionUserId = id
        },
      },
      {
        now: () => nowMs,
        directory: {
          add: (user) => {
            directoryUsers = [...directoryUsers, user]
          },
        },
        ...options,
      },
    ),
  )
}

beforeEach(() => {
  nowMs = Date.UTC(2026, 10, 12, 13, 0, 0)
  sessionUserId = null
  directoryUsers = []
  install()
})

afterEach(() => clearMocks())

describe('bloqueo por inactividad', () => {
  it('current_session no extiende la inactividad', async () => {
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
    nowMs += IDLE_LOCK_MS - MINUTE_MS
    await commands.currentSession()
    nowMs += MINUTE_MS

    expect(await commands.currentSession()).toEqual({ status: 'ok', data: { status: 'locked', user: null } })
  })

  it('record_activity extiende la inactividad', async () => {
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
    nowMs += IDLE_LOCK_MS - MINUTE_MS
    await commands.recordActivity()
    nowMs += IDLE_LOCK_MS - MINUTE_MS

    const result = await commands.currentSession()

    expect(result.status === 'ok' && result.data?.status).toBe('active')
  })

  it('record_activity sobre una sesión vencida devuelve locked sin extenderla', async () => {
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
    nowMs += IDLE_LOCK_MS

    expect(await commands.recordActivity()).toEqual({ status: 'ok', data: { status: 'locked', user: null } })
    expect(await commands.currentSession()).toEqual({ status: 'ok', data: { status: 'locked', user: null } })
  })

  it('record_activity sin sesión devuelve null', async () => {
    expect(await commands.recordActivity()).toEqual({ status: 'ok', data: null })
  })
})

describe('unlock', () => {
  async function lockSession(): Promise<void> {
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
    nowMs += IDLE_LOCK_MS
    await commands.currentSession()
  }

  it('con la contraseña correcta restaura la sesión activa', async () => {
    await lockSession()

    const result = await commands.unlock({ password: DEV_PASSWORD })

    expect(result).toMatchObject({ status: 'ok', data: { username: 'recepcion' } })
    const view = await commands.currentSession()
    expect(view.status === 'ok' && view.data?.status).toBe('active')
  })

  it('con contraseña incorrecta devuelve invalidCredentials y sigue bloqueada', async () => {
    await lockSession()

    const result = await commands.unlock({ password: 'incorrecta' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
    const view = await commands.currentSession()
    expect(view.status === 'ok' && view.data?.status).toBe('locked')
  })

  it('sin sesión devuelve unauthenticated', async () => {
    expect(await commands.unlock({ password: DEV_PASSWORD })).toMatchObject({
      status: 'error',
      error: { code: 'unauthenticated' },
    })
  })

  it('con la sesión activa devuelve validation del campo password', async () => {
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })

    expect(await commands.unlock({ password: DEV_PASSWORD })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'password' },
    })
  })

  it('logout desde bloqueada cierra la sesión', async () => {
    await lockSession()

    await commands.logout()

    expect(await commands.currentSession()).toEqual({ status: 'ok', data: null })
  })
})

describe('setup_status', () => {
  it('needsOwner es true sin usuarios y false con usuarios', async () => {
    install({}, false)
    expect(await commands.setupStatus()).toEqual({ status: 'ok', data: { needsOwner: true, clockRollback: null } })

    install({}, true)
    expect(await commands.setupStatus()).toMatchObject({ status: 'ok', data: { needsOwner: false } })
  })

  it('expone el retroceso de reloj configurado', async () => {
    const clockRollback = { lastRecordedAt: '2026-11-12T10:00:00', detectedAt: '2026-11-10T08:00:00' }
    install({ clockRollback })

    expect(await commands.setupStatus()).toMatchObject({ status: 'ok', data: { clockRollback } })
  })
})

describe('setup_owner', () => {
  beforeEach(() => install({}, false))

  it('crea la propietaria, inicia sesión y devuelve el código formateado', async () => {
    const result = await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })

    expect(result).toMatchObject({
      status: 'ok',
      data: { user: { username: 'dueña', roleName: 'Propietaria' }, recoveryCode: formatRecoveryCode(0) },
    })
    expect(directoryUsers.map((user) => user.username)).toEqual(['dueña'])
    expect(sessionUserId).toBe(directoryUsers[0]?.id)
    expect(await commands.setupStatus()).toMatchObject({ data: { needsOwner: false } })
  })

  it('no devuelve la contraseña ni el hash', async () => {
    const result = await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })

    expect(JSON.stringify(result)).not.toContain(GOOD_PASSWORD)
    expect(JSON.stringify(directoryUsers)).not.toContain(GOOD_PASSWORD)
  })

  it('rechaza con forbidden si ya hay usuarios', async () => {
    install({}, true)

    expect(await commands.setupOwner({ username: 'otra', password: GOOD_PASSWORD })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
    expect(directoryUsers).toEqual([])
  })

  it('rechaza contraseñas de menos de 10 code points con validation password', async () => {
    expect(await commands.setupOwner({ username: 'dueña', password: '😀'.repeat(9) })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'password' },
    })
    expect(await commands.setupOwner({ username: 'dueña', password: '😀'.repeat(10) })).toMatchObject({ status: 'ok' })
  })

  it('rechaza un usuario vacío con validation username', async () => {
    expect(await commands.setupOwner({ username: '   ', password: GOOD_PASSWORD })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'username' },
    })
  })

  it('permite iniciar sesión luego con la contraseña elegida', async () => {
    await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })
    await commands.logout()

    expect(await commands.login({ username: 'dueña', password: GOOD_PASSWORD })).toMatchObject({ status: 'ok' })
  })
})

describe('recover_password', () => {
  const NEW_PASSWORD = 'nueva-clave-larga'

  beforeEach(async () => {
    install({}, false)
    await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })
    await commands.logout()
  })

  it('con el código correcto cambia la contraseña, rota el código y no inicia sesión', async () => {
    const result = await commands.recoverPassword({
      username: 'dueña',
      recoveryCode: canonicalRecoveryCode(0),
      newPassword: NEW_PASSWORD,
    })

    expect(result).toEqual({ status: 'ok', data: { recoveryCode: formatRecoveryCode(1) } })
    expect(await commands.currentSession()).toEqual({ status: 'ok', data: null })
    expect(await commands.login({ username: 'dueña', password: GOOD_PASSWORD })).toMatchObject({ status: 'error' })
    expect(await commands.login({ username: 'dueña', password: NEW_PASSWORD })).toMatchObject({ status: 'ok' })
  })

  it('acepta el código con guiones y minúsculas', async () => {
    const result = await commands.recoverPassword({
      username: 'dueña',
      recoveryCode: formatRecoveryCode(0).toLowerCase(),
      newPassword: NEW_PASSWORD,
    })

    expect(result).toMatchObject({ status: 'ok' })
  })

  it('el código usado deja de servir', async () => {
    const request = { username: 'dueña', recoveryCode: canonicalRecoveryCode(0), newPassword: NEW_PASSWORD }
    await commands.recoverPassword(request)

    expect(await commands.recoverPassword(request)).toMatchObject({
      status: 'error',
      error: { code: 'invalidCredentials' },
    })
  })

  it('un código erróneo o un usuario desconocido devuelven invalidCredentials', async () => {
    const wrongCode = await commands.recoverPassword({
      username: 'dueña',
      recoveryCode: canonicalRecoveryCode(9),
      newPassword: NEW_PASSWORD,
    })
    const unknownUser = await commands.recoverPassword({
      username: 'nadie',
      recoveryCode: canonicalRecoveryCode(0),
      newPassword: NEW_PASSWORD,
    })

    expect(wrongCode).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
    expect(unknownUser).toEqual(wrongCode)
  })

  it('valida la contraseña nueva antes que el código', async () => {
    expect(
      await commands.recoverPassword({ username: 'dueña', recoveryCode: 'x', newPassword: 'corta' }),
    ).toMatchObject({ status: 'error', error: { code: 'validation', field: 'password' } })
  })

  it('usuarios con código inicial configurado pueden recuperarse', async () => {
    install({ recoverableUsernames: ['recepcion'] }, true)

    const result = await commands.recoverPassword({
      username: 'recepcion',
      recoveryCode: canonicalRecoveryCode(0),
      newPassword: NEW_PASSWORD,
    })

    expect(result).toMatchObject({ status: 'ok' })
  })
})
