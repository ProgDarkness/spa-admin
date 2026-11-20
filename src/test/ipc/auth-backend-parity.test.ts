import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { Id, SessionUser } from '@/lib/model'
import { createAuthIpcBackend, DEV_PASSWORD, IDLE_LOCK_MS } from './auth-backend'
import { canonicalRecoveryCode } from './recovery-codes'

const GOOD_PASSWORD = 'clave-larga-1'
const NEW_PASSWORD = 'nueva-clave-larga'
const MAX_BYTES = 1024
const INVALID_CREDENTIALS = { status: 'error', error: { code: 'invalidCredentials' } }
const VALIDATION_PASSWORD = { status: 'error', error: { code: 'validation', field: 'password' } }
const VALIDATION_USERNAME = { status: 'error', error: { code: 'validation', field: 'username' } }

let nowMs: number
let sessionUserId: Id | null
let directoryUsers: SessionUser[]

function install(seeded: boolean): void {
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
      },
    ),
  )
}

beforeEach(() => {
  nowMs = Date.UTC(2026, 10, 12, 13, 0, 0)
  sessionUserId = null
  directoryUsers = []
  install(false)
})

afterEach(() => clearMocks())

describe('paridad con las reglas de contraseña nueva de Rust (password.rs)', () => {
  it('setup_owner_rejects_new_password_above_1024_bytes', async () => {
    expect(await commands.setupOwner({ username: 'dueña', password: 'a'.repeat(MAX_BYTES + 1) })).toMatchObject(
      VALIDATION_PASSWORD,
    )
    expect(directoryUsers).toEqual([])
  })

  it('setup_owner_accepts_new_password_of_exactly_1024_bytes', async () => {
    expect(await commands.setupOwner({ username: 'dueña', password: 'a'.repeat(MAX_BYTES) })).toMatchObject({
      status: 'ok',
    })
  })

  it('el límite de 1024 bytes cuenta bytes UTF-8 y no code points', async () => {
    const withinCodePoints = '😀'.repeat(MAX_BYTES / 4 + 1)

    expect(await commands.setupOwner({ username: 'dueña', password: withinCodePoints })).toMatchObject(
      VALIDATION_PASSWORD,
    )
  })

  it('recover_rejects_new_password_above_1024_bytes_before_checking_the_code', async () => {
    await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })
    await commands.logout()

    expect(
      await commands.recoverPassword({
        username: 'dueña',
        recoveryCode: canonicalRecoveryCode(0),
        newPassword: 'a'.repeat(MAX_BYTES + 1),
      }),
    ).toMatchObject(VALIDATION_PASSWORD)
  })
})

describe('paridad con el parseo del código de recuperación de Rust (recover.rs, recovery.rs)', () => {
  beforeEach(async () => {
    await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })
    await commands.logout()
  })

  it('recover_rejects_recovery_code_above_1024_bytes_even_if_padding_is_ignorable', async () => {
    const padded = `${canonicalRecoveryCode(0)}${' '.repeat(MAX_BYTES)}`

    expect(
      await commands.recoverPassword({ username: 'dueña', recoveryCode: padded, newPassword: NEW_PASSWORD }),
    ).toMatchObject(INVALID_CREDENTIALS)
  })

  it('recover_accepts_recovery_code_of_exactly_1024_bytes_with_ignorable_padding', async () => {
    const code = canonicalRecoveryCode(0)
    const padded = `${code}${' '.repeat(MAX_BYTES - code.length)}`

    expect(
      await commands.recoverPassword({ username: 'dueña', recoveryCode: padded, newPassword: NEW_PASSWORD }),
    ).toMatchObject({ status: 'ok' })
  })

  it('recover_rejects_an_empty_recovery_code', async () => {
    expect(
      await commands.recoverPassword({ username: 'dueña', recoveryCode: '', newPassword: NEW_PASSWORD }),
    ).toMatchObject(INVALID_CREDENTIALS)
  })

  it('solo ignora espacios y guiones al interpretar el código, no otros blancos', async () => {
    const withTab = `${canonicalRecoveryCode(0).slice(0, 10)}\t${canonicalRecoveryCode(0).slice(10)}`

    expect(
      await commands.recoverPassword({ username: 'dueña', recoveryCode: withTab, newPassword: NEW_PASSWORD }),
    ).toMatchObject(INVALID_CREDENTIALS)
  })
})

describe('paridad con la normalización de usuario de Rust (normalized_username)', () => {
  const COMPOSED = 'dueña'
  const DECOMPOSED = 'dueña'

  it('setup_owner_stores_username_trimmed_and_nfc_normalized', async () => {
    await commands.setupOwner({ username: `  ${DECOMPOSED}  `, password: GOOD_PASSWORD })

    expect(directoryUsers.map((user) => user.username)).toEqual([COMPOSED])
  })

  it('setup_owner_applies_the_64_byte_limit_after_normalization', async () => {
    const longDecomposed = 'ñ'.repeat(32).normalize('NFD')

    expect(await commands.setupOwner({ username: longDecomposed, password: GOOD_PASSWORD })).toMatchObject({
      status: 'ok',
    })
    expect(directoryUsers[0]?.username).toBe('ñ'.repeat(32))
  })

  it('setup_owner_rejects_a_username_above_64_bytes_after_normalization', async () => {
    expect(await commands.setupOwner({ username: 'ñ'.repeat(33), password: GOOD_PASSWORD })).toMatchObject(
      VALIDATION_USERNAME,
    )
  })

  it('login_normalizes_the_typed_username_like_rust', async () => {
    await commands.setupOwner({ username: COMPOSED, password: GOOD_PASSWORD })
    await commands.logout()

    expect(await commands.login({ username: ` ${DECOMPOSED} `, password: GOOD_PASSWORD })).toMatchObject({
      status: 'ok',
      data: { username: COMPOSED },
    })
  })

  it('login_matches_usernames_ignoring_ascii_case_like_rust_nocase', async () => {
    install(true)

    expect(await commands.login({ username: 'PROPIETARIA', password: DEV_PASSWORD })).toMatchObject({
      status: 'ok',
      data: { username: 'propietaria' },
    })
  })

  it.each([
    ['control Cc', 'due\u0007ña'],
    ['formato Cf (ancho cero)', 'due​ña'],
    ['formato Cf (soft hyphen)', 'due­ña'],
    ['formato Cf (BOM)', 'due﻿ña'],
    ['separador Zs (nbsp)', 'due ña'],
    ['separador Zl', 'due ña'],
    ['separador Zp', 'due ña'],
    ['separador ideográfico', 'due　ña'],
  ])('normalized_username_rejects_%s_like_rust', async (_label, username) => {
    expect(await commands.setupOwner({ username, password: GOOD_PASSWORD })).toMatchObject(VALIDATION_USERNAME)
    expect(directoryUsers).toEqual([])
  })

  it('un espacio ASCII interior sigue permitido como en Rust', async () => {
    expect(await commands.setupOwner({ username: 'ana maría', password: GOOD_PASSWORD })).toMatchObject({
      status: 'ok',
    })
  })

  it('login_rejects_usernames_with_control_or_format_characters', async () => {
    install(true)

    expect(await commands.login({ username: 'propietaria​', password: DEV_PASSWORD })).toMatchObject(
      INVALID_CREDENTIALS,
    )
    expect(await commands.login({ username: 'propie\u0000taria', password: DEV_PASSWORD })).toMatchObject(
      INVALID_CREDENTIALS,
    )
  })

  it('recover_rejects_usernames_with_control_or_format_characters', async () => {
    await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })
    await commands.logout()

    expect(
      await commands.recoverPassword({
        username: 'dueña​',
        recoveryCode: canonicalRecoveryCode(0),
        newPassword: NEW_PASSWORD,
      }),
    ).toMatchObject(INVALID_CREDENTIALS)
  })

  it('el lookup de login sigue siendo NOCASE solo ASCII como repository.rs', async () => {
    await commands.setupOwner({ username: 'Ñandú', password: GOOD_PASSWORD })
    await commands.logout()

    expect(await commands.login({ username: 'ñandú', password: GOOD_PASSWORD })).toMatchObject(INVALID_CREDENTIALS)
    expect(await commands.login({ username: 'Ñandú', password: GOOD_PASSWORD })).toMatchObject({ status: 'ok' })
  })

  it('login rechaza un usuario que solo contiene blancos', async () => {
    install(true)

    expect(await commands.login({ username: '   ', password: DEV_PASSWORD })).toMatchObject(INVALID_CREDENTIALS)
  })

  it('recover_normalizes_the_typed_username_like_rust', async () => {
    await commands.setupOwner({ username: COMPOSED, password: GOOD_PASSWORD })
    await commands.logout()

    expect(
      await commands.recoverPassword({
        username: ` ${DECOMPOSED} `,
        recoveryCode: canonicalRecoveryCode(0),
        newPassword: NEW_PASSWORD,
      }),
    ).toMatchObject({ status: 'ok' })
  })
})

describe('paridad con el orden de validación de setup_owner (owner_setup.rs)', () => {
  it('valida usuario y contraseña antes de comprobar si el setup sigue abierto', async () => {
    install(true)

    expect(await commands.setupOwner({ username: '   ', password: GOOD_PASSWORD })).toMatchObject(
      VALIDATION_USERNAME,
    )
    expect(await commands.setupOwner({ username: 'otra', password: 'corta' })).toMatchObject(VALIDATION_PASSWORD)
    expect(await commands.setupOwner({ username: 'otra', password: GOOD_PASSWORD })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })
})

describe('shim_does_not_simulate_lockout', () => {
  it('shim_does_not_simulate_lockout: intentos fallidos repetidos nunca bloquean la cuenta como Rust', async () => {
    install(true)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await commands.login({ username: 'propietaria', password: 'incorrecta' })
    }

    expect(await commands.login({ username: 'propietaria', password: DEV_PASSWORD })).toMatchObject({
      status: 'ok',
    })
  })

  it('shim_does_not_simulate_recovery_throttle: recuperar con código erróneo no se limita como Rust', async () => {
    await commands.setupOwner({ username: 'dueña', password: GOOD_PASSWORD })
    await commands.logout()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await commands.recoverPassword({
        username: 'dueña',
        recoveryCode: canonicalRecoveryCode(9),
        newPassword: NEW_PASSWORD,
      })
    }

    expect(
      await commands.recoverPassword({
        username: 'dueña',
        recoveryCode: canonicalRecoveryCode(0),
        newPassword: NEW_PASSWORD,
      }),
    ).toMatchObject({ status: 'ok' })
  })
})

describe('el bloqueo sobrevive a que el front desvincule la sesión del mock', () => {
  it('shim_stays_locked_after_the_port_session_is_cleared_and_unlock_restores_it', async () => {
    install(true)
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
    nowMs += IDLE_LOCK_MS
    expect(await commands.currentSession()).toEqual({ status: 'ok', data: { status: 'locked', user: null } })
    sessionUserId = null

    expect(await commands.currentSession()).toEqual({ status: 'ok', data: { status: 'locked', user: null } })
    expect(await commands.unlock({ password: DEV_PASSWORD })).toMatchObject({
      status: 'ok',
      data: { username: 'recepcion' },
    })
    expect(sessionUserId).toBe(2)
  })

  it('logout desde bloqueada con el puerto ya desvinculado cierra la sesión del shim', async () => {
    install(true)
    await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
    nowMs += IDLE_LOCK_MS
    await commands.currentSession()
    sessionUserId = null

    await commands.logout()

    expect(await commands.currentSession()).toEqual({ status: 'ok', data: null })
  })
})
