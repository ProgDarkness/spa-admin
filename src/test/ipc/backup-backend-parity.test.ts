import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { Id } from '@/lib/model'
import { createAuthIpcBackend, IDLE_LOCK_MS } from './auth-backend'
import { setNextPickedBackup } from './backup-backend'
import { createDevBackends } from './dev-backends'

const PASSPHRASE = 'frase de prueba larga'
const SEED = createSeed('2026-11-12')
const ERROR_KEYS = ['code', 'entityIds', 'field', 'message']
const STATUS_KEYS = ['isDue', 'lastBackupAt']
const EXPORTED_KEYS = ['createdAt', 'fileName']
const RESTORED_KEYS = ['schemaVersion', 'sourceSchemaVersion']
const BINDINGS_ERROR_CODES: readonly AppErrorCode[] = [
  'invalidCredentials',
  'validation',
  'unauthenticated',
  'forbidden',
  'sessionLocked',
  'notFound',
  'nationalIdTaken',
  'clientDeletedReactivate',
  'overlap',
  'crossesMidnight',
  'invalidTransition',
  'resourceInactive',
  'resourceHasFutureAppointments',
  'rateMissing',
  'alreadyVoided',
  'backupUnreadable',
  'backupNotRecognized',
  'backupFromNewerApp',
  'internal',
]

let sessionUserId: Id | null
let clockMs: number
let users: typeof SEED.users
let invoked: { cmd: string; args: unknown }[]

function install(): void {
  const auth = createAuthIpcBackend(() => users, { read: () => sessionUserId, write: (id) => (sessionUserId = id) }, { now: () => clockMs })
  const backend = createDevBackends({
    auth,
    session: () => users.find((user) => user.id === sessionUserId) ?? null,
    seed: SEED,
    now: () => clockMs,
  })
  mockIPC((cmd, args) => {
    invoked.push({ cmd, args })
    return backend(cmd, args)
  })
}

beforeEach(() => {
  users = SEED.users
  sessionUserId = 1
  clockMs = Date.parse('2026-12-10T12:00:00.000Z')
  invoked = []
  setNextPickedBackup('valid')
  install()
})

afterEach(() => {
  clearMocks()
  setNextPickedBackup('valid')
})

async function errorOf(operation: () => Promise<{ status: string; error?: unknown }>): Promise<Record<string, unknown>> {
  const outcome = await operation()
  if (outcome.status !== 'error' || typeof outcome.error !== 'object' || outcome.error === null) {
    throw new Error('se esperaba un error')
  }
  return outcome.error as Record<string, unknown>
}

describe('paridad de forma con los bindings generados', () => {
  it('los comandos viajan con el nombre y la clave de argumento del contrato', async () => {
    await commands.exportBackup(PASSPHRASE)
    await commands.restoreBackup(PASSPHRASE)
    await commands.getBackupStatus()

    const backupCalls = invoked.filter((call) => call.cmd.includes('backup'))
    expect(backupCalls.map((call) => [call.cmd, Object.keys((call.args ?? {}) as object)])).toEqual([
      ['export_backup', ['passphrase']],
      ['restore_backup', ['passphrase']],
      ['get_backup_status', []],
    ])
  })

  it('los resultados tienen exactamente las claves del contrato', async () => {
    const exported = await commands.exportBackup(PASSPHRASE)
    const status = await commands.getBackupStatus()
    sessionUserId = 1
    const restored = await commands.restoreBackup(PASSPHRASE)

    if (exported.status !== 'ok' || exported.data === null) throw new Error('export')
    if (status.status !== 'ok') throw new Error('status')
    if (restored.status !== 'ok' || restored.data === null) throw new Error('restore')
    expect(Object.keys(exported.data).sort()).toEqual(EXPORTED_KEYS)
    expect(Object.keys(status.data).sort()).toEqual(STATUS_KEYS)
    expect(Object.keys(restored.data).sort()).toEqual(RESTORED_KEYS)
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const validation = await errorOf(() => commands.exportBackup('corta'))
    setNextPickedBackup('future')
    const newer = await errorOf(() => commands.restoreBackup(PASSPHRASE))
    sessionUserId = 2
    const forbidden = await errorOf(() => commands.getBackupStatus())
    sessionUserId = null
    const unauthenticated = await errorOf(() => commands.getBackupStatus())

    for (const error of [validation, newer, forbidden, unauthenticated]) {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
    }
    expect(validation).toMatchObject({ code: 'validation', field: 'passphrase', entityIds: null })
    expect(newer).toMatchObject({ code: 'backupFromNewerApp', field: null, entityIds: null })
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    sessionUserId = null

    const rejection = await invoke('export_backup', { passphrase: PASSPHRASE }).catch((caught: unknown) => caught)

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})

function rustMessageOf(constantName: string): string {
  const source = readFileSync(resolve(process.cwd(), 'src-tauri/src/errors.rs'), 'utf8')
  const match = new RegExp(`const ${constantName}: &str =\\s*"([^"]*)";`).exec(source)
  if (!match?.[1]) throw new Error(`constante Rust inexistente: ${constantName}`)
  return match[1]
}

describe('paridad de mensajes con src-tauri/src/errors.rs', () => {
  it.each([
    ['unreadable', 'BACKUP_UNREADABLE_MESSAGE'],
    ['notRecognized', 'BACKUP_NOT_RECOGNIZED_MESSAGE'],
    ['future', 'BACKUP_FROM_NEWER_APP_MESSAGE'],
    ['rollbackFailed', 'BACKUP_ROLLBACK_FAILED_MESSAGE'],
  ] as const)('el mensaje del fallo de restauración %s coincide con %s', async (pick, constant) => {
    setNextPickedBackup(pick === 'unreadable' ? 'corrupt' : pick)

    const error = await errorOf(() => commands.restoreBackup(PASSPHRASE))

    expect(error.message).toBe(rustMessageOf(constant))
  })

  it('el mensaje de exportación demasiado grande coincide con BACKUP_TOO_LARGE_MESSAGE', async () => {
    setNextPickedBackup('tooLarge')

    const error = await errorOf(() => commands.exportBackup(PASSPHRASE))

    expect(error).toMatchObject({ code: 'internal', message: rustMessageOf('BACKUP_TOO_LARGE_MESSAGE') })
  })
})

describe('integración con la autenticación simulada', () => {
  it('una sesión inactiva más de diez minutos queda bloqueada para respaldar', async () => {
    await invoke('current_session')
    clockMs += IDLE_LOCK_MS

    expect(await errorOf(() => commands.exportBackup(PASSPHRASE))).toMatchObject({ code: 'sessionLocked' })
    expect(await errorOf(() => commands.getBackupStatus())).toMatchObject({ code: 'sessionLocked' })
  })

  it('restaurar un respaldo válido cierra la sesión real', async () => {
    await commands.restoreBackup(PASSPHRASE)

    expect(sessionUserId).toBeNull()
    expect(await invoke('current_session')).toBeNull()
  })

  it('un respaldo con fallo deja la sesión real', async () => {
    setNextPickedBackup('corrupt')

    await commands.restoreBackup(PASSPHRASE)

    expect(sessionUserId).toBe(1)
  })

  it('sin usuarios (primer arranque) restaura sin sesión y con usuarios la exige', async () => {
    users = []
    sessionUserId = null

    expect((await commands.restoreBackup(PASSPHRASE)).status).toBe('ok')

    users = SEED.users
    expect(await errorOf(() => commands.restoreBackup(PASSPHRASE))).toMatchObject({ code: 'unauthenticated' })
  })

  it('exportar audita y el estado deja de estar vencido', async () => {
    const before = await commands.getBackupStatus()
    await commands.exportBackup(PASSPHRASE)
    const after = await commands.getBackupStatus()

    expect(before).toMatchObject({ data: { isDue: true } })
    expect(after).toMatchObject({ data: { isDue: false } })
  })

  it('Recepción no puede exportar ni restaurar ni ver el estado', async () => {
    sessionUserId = 2

    const codes = [
      (await errorOf(() => commands.exportBackup(PASSPHRASE))).code,
      (await errorOf(() => commands.restoreBackup(PASSPHRASE))).code,
      (await errorOf(() => commands.getBackupStatus())).code,
    ]

    expect(codes).toEqual(['forbidden', 'forbidden', 'forbidden'])
  })
})
