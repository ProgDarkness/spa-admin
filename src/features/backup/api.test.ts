import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { dataOf, errorOf } from '@/test/appointment-fixtures'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { signInAs } from '@/test/session'
import { exportBackup, getBackupStatus, restoreBackup } from './api'

const PASSPHRASE = 'frase de prueba larga'

type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

function recordInvokedCommands(): { cmd: string; args: unknown }[] {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
  const original = internals.invoke
  const calls: { cmd: string; args: unknown }[] = []
  internals.invoke = (cmd, args) => {
    calls.push({ cmd, args })
    return original(cmd, args)
  }
  return calls
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

afterEach(() => {
  clearMocks()
  setNextPickedBackup('valid')
})

describe('exportBackup', () => {
  it('invoca export_backup con la frase y devuelve el archivo creado', async () => {
    signInAs('propietaria')
    const calls = recordInvokedCommands()

    const exported = dataOf(await exportBackup(PASSPHRASE))

    expect(calls).toEqual([{ cmd: 'export_backup', args: { passphrase: PASSPHRASE } }])
    expect(exported).toEqual({ fileName: 'spa-respaldo-2026-11-12-0900.spabak', createdAt: '2026-11-12T09:00:00' })
  })

  it('cancelar el diálogo devuelve ok con null', async () => {
    signInAs('propietaria')
    setNextPickedBackup(null)

    expect(await exportBackup(PASSPHRASE)).toEqual({ status: 'ok', data: null })
  })

  it('una frase corta es validation del campo passphrase', async () => {
    signInAs('propietaria')

    expect(errorOf(await exportBackup('corta'))).toMatchObject({ code: 'validation', field: 'passphrase' })
  })

  it('sin sesión es unauthenticated y Recepción forbidden', async () => {
    const anonymous = errorOf(await exportBackup(PASSPHRASE)).code
    signInAs('recepcion')
    const reception = errorOf(await exportBackup(PASSPHRASE)).code

    expect([anonymous, reception]).toEqual(['unauthenticated', 'forbidden'])
  })

  it('un fallo inesperado del IPC se convierte en internal sin lanzar', async () => {
    mockIPC(() => {
      throw new Error('IPC roto')
    })

    expect(errorOf(await exportBackup(PASSPHRASE)).code).toBe('internal')
  })
})

describe('restoreBackup', () => {
  it('invoca restore_backup, devuelve las versiones y cierra la sesión', async () => {
    signInAs('propietaria')
    const calls = recordInvokedCommands()

    const restored = dataOf(await restoreBackup(PASSPHRASE))

    expect(calls[0]).toEqual({ cmd: 'restore_backup', args: { passphrase: PASSPHRASE } })
    expect(restored).toEqual({ sourceSchemaVersion: 12, schemaVersion: 12 })
    expect(getState().sessionUserId).toBeNull()
  })

  it('cancelar el diálogo devuelve ok con null y conserva la sesión', async () => {
    signInAs('propietaria')
    setNextPickedBackup(null)

    expect(await restoreBackup(PASSPHRASE)).toEqual({ status: 'ok', data: null })
    expect(getState().sessionUserId).not.toBeNull()
  })

  it.each([
    ['corrupt', 'backupUnreadable'],
    ['wrongPassphrase', 'backupUnreadable'],
    ['notRecognized', 'backupNotRecognized'],
    ['future', 'backupFromNewerApp'],
  ] as const)('el respaldo %s responde %s y conserva la sesión', async (pick, code) => {
    signInAs('propietaria')
    setNextPickedBackup(pick)

    expect(errorOf(await restoreBackup(PASSPHRASE)).code).toBe(code)
    expect(getState().sessionUserId).not.toBeNull()
  })

  it('Recepción es forbidden', async () => {
    signInAs('recepcion')

    expect(errorOf(await restoreBackup(PASSPHRASE)).code).toBe('forbidden')
  })

  it('un fallo inesperado del IPC se convierte en internal sin lanzar', async () => {
    mockIPC(() => {
      throw new Error('IPC roto')
    })

    expect(errorOf(await restoreBackup(PASSPHRASE)).code).toBe('internal')
  })
})

describe('getBackupStatus', () => {
  it('invoca get_backup_status sin argumentos y avisa que vence cuando no hay respaldos', async () => {
    signInAs('propietaria')
    const calls = recordInvokedCommands()

    const status = dataOf(await getBackupStatus())

    expect(calls.map((call) => call.cmd)).toEqual(['get_backup_status'])
    expect(status).toEqual({ lastBackupAt: null, isDue: true })
  })

  it('tras exportar deja de estar vencido', async () => {
    signInAs('propietaria')
    await exportBackup(PASSPHRASE)

    expect(dataOf(await getBackupStatus())).toEqual({ lastBackupAt: '2026-11-12T09:00:00', isDue: false })
  })

  it('Recepción es forbidden', async () => {
    signInAs('recepcion')

    expect(errorOf(await getBackupStatus()).code).toBe('forbidden')
  })

  it('un fallo inesperado del IPC se convierte en internal sin lanzar', async () => {
    mockIPC(() => {
      throw new Error('IPC roto')
    })

    expect(errorOf(await getBackupStatus()).code).toBe('internal')
  })
})
