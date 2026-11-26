import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppError } from '@/lib/bindings'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createBackupIpcBackend, setNextPickedBackup, type BackupAuditRow } from './backup-backend'
import { createSharedRows, type SharedRows } from './shared-rows'

const PASSPHRASE = 'frase de prueba larga'
const NOW = Date.parse('2026-12-10T12:00:00.000Z')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const SUPPORTED_SCHEMA_VERSION = 12
const OWNER: SessionUser = { id: 1, username: 'propietaria', roleName: 'Propietaria', permissions: ['backup.manage'] }
const RECEPTION: SessionUser = { id: 2, username: 'recepcion', roleName: 'Recepción', permissions: ['clients.read'] }

let session: SessionUser | null
let locked: boolean
let ownerPending: boolean
let sessionsEnded: number
let restoredNotifications: number
let audit: SharedRows<BackupAuditRow>
let nowMs: number

function installBackend(): void {
  mockIPC(
    createBackupIpcBackend(
      (command) => {
        throw new Error(`IPC no simulado: ${command}`)
      },
      {
        session: () => session,
        isLocked: () => locked,
        needsOwner: () => ownerPending,
        endSession: () => {
          sessionsEnded += 1
          session = null
        },
        audit,
        now: () => nowMs,
        onRestored: () => {
          restoredNotifications += 1
        },
      },
    ),
  )
}

beforeEach(() => {
  session = OWNER
  locked = false
  ownerPending = false
  sessionsEnded = 0
  restoredNotifications = 0
  nowMs = NOW
  audit = createSharedRows<BackupAuditRow>()
  setNextPickedBackup('valid')
  installBackend()
})

afterEach(() => {
  clearMocks()
  setNextPickedBackup('valid')
})

function row(action: BackupAuditRow['action'], utc: string, local: string, id = 1): BackupAuditRow {
  return { id, action, actorUserId: 1, occurredAt: local, occurredAtUtc: utc, diff: null }
}

function errorOf(outcome: { status: string; error?: AppError }): AppError {
  if (outcome.status !== 'error' || !outcome.error) throw new Error('se esperaba un error')
  return outcome.error
}

function userWithout(permission: PermissionKey): SessionUser {
  return { ...OWNER, permissions: OWNER.permissions.filter((granted) => granted !== permission) }
}

async function dialogWasNotOpened(): Promise<boolean> {
  setNextPickedBackup('notRecognized')
  const outcome = await commands.restoreBackup(PASSPHRASE)
  return outcome.status === 'error' && outcome.error.code === 'backupNotRecognized'
}

describe('exportar: autorización', () => {
  it('sin sesión es unauthenticated y no abre el diálogo', async () => {
    session = null
    setNextPickedBackup('notRecognized')

    expect(errorOf(await commands.exportBackup(PASSPHRASE)).code).toBe('unauthenticated')
    session = OWNER
    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('backupNotRecognized')
  })

  it('con el primer arranque pendiente y sin sesión sigue siendo unauthenticated', async () => {
    session = null
    ownerPending = true

    expect(errorOf(await commands.exportBackup(PASSPHRASE)).code).toBe('unauthenticated')
  })

  it('Recepción es forbidden', async () => {
    session = RECEPTION

    expect(errorOf(await commands.exportBackup(PASSPHRASE)).code).toBe('forbidden')
    expect(audit.read()).toEqual([])
  })

  it('un permiso retirado es forbidden', async () => {
    session = userWithout('backup.manage')

    expect(errorOf(await commands.exportBackup(PASSPHRASE)).code).toBe('forbidden')
  })

  it('una sesión bloqueada es sessionLocked', async () => {
    locked = true

    expect(errorOf(await commands.exportBackup(PASSPHRASE)).code).toBe('sessionLocked')
  })

  it('el bloqueo se decide antes que el permiso', async () => {
    session = RECEPTION
    locked = true

    expect(errorOf(await commands.exportBackup(PASSPHRASE)).code).toBe('sessionLocked')
  })

  it('el permiso se decide antes de validar la frase', async () => {
    session = RECEPTION

    expect(errorOf(await commands.exportBackup('corta')).code).toBe('forbidden')
  })
})

describe('exportar: flujo', () => {
  it('una frase corta se rechaza como validation del campo passphrase antes del diálogo', async () => {
    setNextPickedBackup('notRecognized')

    const failure = errorOf(await commands.exportBackup('corta'))

    expect(failure).toMatchObject({ code: 'validation', field: 'passphrase' })
    expect(await dialogWasNotOpened()).toBe(true)
  })

  it('cancelar el diálogo devuelve null y no audita', async () => {
    setNextPickedBackup(null)

    expect(await commands.exportBackup(PASSPHRASE)).toEqual({ status: 'ok', data: null })
    expect(audit.read()).toEqual([])
  })

  it('exportar devuelve el nombre sugerido con la fecha local y la hora de creación', async () => {
    const outcome = await commands.exportBackup(PASSPHRASE)

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok' || outcome.data === null) throw new Error('se esperaba un respaldo')
    expect(outcome.data.fileName).toBe('spa-respaldo-2026-12-10-0800.spabak')
    expect(outcome.data.createdAt).toBe('2026-12-10T08:00:00')
  })

  it('audita backup_created con el actor y un diff sin frase ni ruta', async () => {
    await commands.exportBackup(PASSPHRASE)

    expect(audit.read()).toEqual([
      {
        id: 1,
        action: 'backup_created',
        actorUserId: OWNER.id,
        occurredAt: '2026-12-10T08:00:00',
        occurredAtUtc: '2026-12-10T12:00:00.000Z',
        diff: { schemaVersion: SUPPORTED_SCHEMA_VERSION, fileName: 'spa-respaldo-2026-12-10-0800.spabak' },
      },
    ])
    expect(JSON.stringify(audit.read())).not.toContain(PASSPHRASE)
  })

  it('cada exportación recibe un id nuevo', async () => {
    await commands.exportBackup(PASSPHRASE)
    await commands.exportBackup(PASSPHRASE)

    expect(audit.read().map((entry) => entry.id)).toEqual([1, 2])
  })

  it('el cierre de sesión no ocurre al exportar', async () => {
    await commands.exportBackup(PASSPHRASE)

    expect(sessionsEnded).toBe(0)
  })
})

function withOwnerSession<T>(call: (passphrase: string) => Promise<T>): (passphrase: string) => Promise<T> {
  return (passphrase) => {
    session = OWNER
    return call(passphrase)
  }
}

describe('frase: límites idénticos a Rust', () => {
  const ENTRY_POINTS = [
    ['exportar', () => withOwnerSession(commands.exportBackup)],
    ['restaurar', () => withOwnerSession(commands.restoreBackup)],
  ] as const

  describe.each(ENTRY_POINTS)('%s', (_name, pick) => {
    it('rechaza 11 code points y acepta 12', async () => {
      const call = pick()

      expect(errorOf(await call('a'.repeat(11)))).toMatchObject({ code: 'validation', field: 'passphrase' })
      expect((await call('a'.repeat(12))).status).toBe('ok')
    })

    it('cuenta los code points después de componer a NFC', async () => {
      const call = pick()
      const decomposed = `${'a'.repeat(10)}é`

      expect(decomposed.length).toBe(12)
      expect(errorOf(await call(decomposed))).toMatchObject({ code: 'validation', field: 'passphrase' })
      expect((await call(`${decomposed}a`)).status).toBe('ok')
    })

    it('un emoji cuenta como un code point', async () => {
      const call = pick()

      expect(errorOf(await call('😀'.repeat(11)))).toMatchObject({ code: 'validation' })
      expect((await call('😀'.repeat(12))).status).toBe('ok')
    })

    it('acepta 1024 bytes y rechaza 1025', async () => {
      const call = pick()

      expect((await call('a'.repeat(1024))).status).toBe('ok')
      expect(errorOf(await call('a'.repeat(1025)))).toMatchObject({ code: 'validation', field: 'passphrase' })
    })

    it('el máximo cuenta bytes y no code points', async () => {
      const call = pick()

      expect((await call('ñ'.repeat(512))).status).toBe('ok')
      expect(errorOf(await call('ñ'.repeat(513)))).toMatchObject({ code: 'validation' })
      expect((await call('😀'.repeat(256))).status).toBe('ok')
      expect(errorOf(await call('😀'.repeat(257)))).toMatchObject({ code: 'validation' })
    })

    it('el máximo se mide después de componer', async () => {
      const call = pick()
      const composable = 'é'.repeat(512)

      expect(composable.length).toBe(1024)
      expect((await call(composable)).status).toBe('ok')
    })
  })

  it('una frase que no es texto es un argumento inválido', async () => {
    const outcome = await commands.exportBackup(42 as unknown as string).catch((caught: unknown) => caught)

    expect(outcome).toBeInstanceOf(Error)
  })
})

describe('restaurar: autorización', () => {
  it('con un propietario existente y sin sesión es unauthenticated y no abre el diálogo', async () => {
    session = null
    setNextPickedBackup('notRecognized')

    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('unauthenticated')
    session = OWNER
    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('backupNotRecognized')
  })

  it('Recepción es forbidden y no restaura', async () => {
    session = RECEPTION

    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('forbidden')
    expect(audit.read()).toEqual([])
    expect(sessionsEnded).toBe(0)
  })

  it('una sesión bloqueada es sessionLocked', async () => {
    locked = true

    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('sessionLocked')
  })

  it('una frase corta se rechaza antes del diálogo', async () => {
    setNextPickedBackup('notRecognized')

    expect(errorOf(await commands.restoreBackup('corta'))).toMatchObject({ code: 'validation', field: 'passphrase' })
    expect(await dialogWasNotOpened()).toBe(true)
  })

  it('en el primer arranque restaura sin sesión', async () => {
    session = null
    ownerPending = true

    const outcome = await commands.restoreBackup(PASSPHRASE)

    expect(outcome).toEqual({
      status: 'ok',
      data: { sourceSchemaVersion: SUPPORTED_SCHEMA_VERSION, schemaVersion: SUPPORTED_SCHEMA_VERSION },
    })
    expect(audit.read()[0]).toMatchObject({ action: 'backup_restored', actorUserId: null })
    expect(audit.read()[0]?.diff).toMatchObject({ restoredBy: null })
  })

  it('en el primer arranque el permiso de la sesión no se exige', async () => {
    session = RECEPTION
    ownerPending = true

    expect((await commands.restoreBackup(PASSPHRASE)).status).toBe('ok')
  })

  it('con un propietario existente la restauración sigue exigiendo permiso aunque haya sesión', async () => {
    session = userWithout('backup.manage')
    ownerPending = false

    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('forbidden')
  })
})

describe('restaurar: flujo', () => {
  it('cancelar el diálogo devuelve null y no toca sesión ni auditoría', async () => {
    setNextPickedBackup(null)

    expect(await commands.restoreBackup(PASSPHRASE)).toEqual({ status: 'ok', data: null })
    expect(sessionsEnded).toBe(0)
    expect(session).toBe(OWNER)
    expect(audit.read()).toEqual([])
  })

  it('un respaldo válido termina la sesión y audita backup_restored sin actor', async () => {
    const outcome = await commands.restoreBackup(PASSPHRASE)

    expect(outcome).toEqual({
      status: 'ok',
      data: { sourceSchemaVersion: SUPPORTED_SCHEMA_VERSION, schemaVersion: SUPPORTED_SCHEMA_VERSION },
    })
    expect(sessionsEnded).toBe(1)
    expect(session).toBeNull()
    expect(audit.read()).toEqual([
      {
        id: 1,
        action: 'backup_restored',
        actorUserId: null,
        occurredAt: '2026-12-10T08:00:00',
        occurredAtUtc: '2026-12-10T12:00:00.000Z',
        diff: {
          restoredBy: OWNER.username,
          sourceSchemaVersion: SUPPORTED_SCHEMA_VERSION,
          schemaVersion: SUPPORTED_SCHEMA_VERSION,
        },
      },
    ])
  })

  it('el diálogo se consume: la siguiente restauración vuelve al respaldo válido', async () => {
    setNextPickedBackup('corrupt')

    expect(errorOf(await commands.restoreBackup(PASSPHRASE)).code).toBe('backupUnreadable')
    expect((await commands.restoreBackup(PASSPHRASE)).status).toBe('ok')
  })

  it.each([
    ['corrupt', 'backupUnreadable', 'La frase no coincide o el archivo está dañado'],
    ['wrongPassphrase', 'backupUnreadable', 'La frase no coincide o el archivo está dañado'],
    ['notRecognized', 'backupNotRecognized', 'El archivo no es un respaldo reconocido'],
    ['future', 'backupFromNewerApp', 'El respaldo fue creado con una versión más nueva de la aplicación'],
  ] as const)('el respaldo %s falla con %s y el mensaje exacto sin cambiar nada', async (pick, code, message) => {
    setNextPickedBackup(pick)

    const failure = errorOf(await commands.restoreBackup(PASSPHRASE))

    expect(failure).toEqual({ code, message, field: null, entityIds: null })
    expect(sessionsEnded).toBe(0)
    expect(session).toBe(OWNER)
    expect(audit.read()).toEqual([])
  })
})

describe('restaurar: fallos internos con los mensajes de Rust', () => {
  const ROLLBACK_FAILED_MESSAGE =
    'La restauración quedó a medias; reinicia la aplicación para completarla o recuperar el estado anterior'

  it('rollbackFailed responde internal con el mensaje exacto y no cierra la sesión ni audita', async () => {
    setNextPickedBackup('rollbackFailed')

    const failure = errorOf(await commands.restoreBackup(PASSPHRASE))

    expect(failure).toEqual({ code: 'internal', message: ROLLBACK_FAILED_MESSAGE, field: null, entityIds: null })
    expect(sessionsEnded).toBe(0)
    expect(session).toBe(OWNER)
    expect(audit.read()).toEqual([])
    expect(restoredNotifications).toBe(0)
  })

  it('rollbackFailed se consume como cualquier otro diálogo', async () => {
    setNextPickedBackup('rollbackFailed')
    await commands.restoreBackup(PASSPHRASE)

    expect((await commands.restoreBackup(PASSPHRASE)).status).toBe('ok')
  })

  it('tooLarge no aplica al restaurar: el tamaño máximo del archivo es notRecognized en Rust y aquí el diálogo se ignora', async () => {
    setNextPickedBackup('tooLarge')

    expect((await commands.restoreBackup(PASSPHRASE)).status).toBe('ok')
  })

  it('tras restaurar el estado cuenta la restauración como último respaldo aunque el audit previo trajera otro', async () => {
    audit.write([row('backup_created', '2026-12-09T12:00:00.000Z', '2026-12-09T08:00:00')])

    await commands.restoreBackup(PASSPHRASE)
    session = OWNER

    expect(await commands.getBackupStatus()).toEqual({
      status: 'ok',
      data: { lastBackupAt: '2026-12-10T08:00:00', isDue: false },
    })
  })
})

describe('exportar: fallos internos con los mensajes de Rust', () => {
  it('tooLarge responde internal con el mensaje exacto y no audita', async () => {
    setNextPickedBackup('tooLarge')

    const failure = errorOf(await commands.exportBackup(PASSPHRASE))

    expect(failure).toEqual({
      code: 'internal',
      message: 'La base de datos supera el tamaño máximo admitido para un respaldo',
      field: null,
      entityIds: null,
    })
    expect(audit.read()).toEqual([])
  })

  it('rollbackFailed no aplica al exportar y el diálogo se ignora', async () => {
    setNextPickedBackup('rollbackFailed')

    expect((await commands.exportBackup(PASSPHRASE)).status).toBe('ok')
    expect(audit.read()).toHaveLength(1)
  })
})

describe('restaurar: aviso onRestored', () => {
  it('se invoca una sola vez tras un respaldo válido', async () => {
    await commands.restoreBackup(PASSPHRASE)

    expect(restoredNotifications).toBe(1)
  })

  it.each(['corrupt', 'wrongPassphrase', 'notRecognized', 'future'] as const)(
    'no se invoca con el respaldo %s',
    async (pick) => {
      setNextPickedBackup(pick)

      await commands.restoreBackup(PASSPHRASE)

      expect(restoredNotifications).toBe(0)
    },
  )

  it('no se invoca al cancelar el diálogo ni al exportar', async () => {
    setNextPickedBackup(null)
    await commands.restoreBackup(PASSPHRASE)
    await commands.exportBackup(PASSPHRASE)

    expect(restoredNotifications).toBe(0)
  })

  it('se invoca después de terminar la sesión y de auditar', async () => {
    const observed: { sessionEnded: boolean; audited: number }[] = []
    mockIPC(
      createBackupIpcBackend(
        () => null,
        {
          session: () => session,
          isLocked: () => false,
          needsOwner: () => false,
          endSession: () => {
            session = null
          },
          audit,
          now: () => nowMs,
          onRestored: () => observed.push({ sessionEnded: session === null, audited: audit.read().length }),
        },
      ),
    )

    await commands.restoreBackup(PASSPHRASE)

    expect(observed).toEqual([{ sessionEnded: true, audited: 1 }])
  })

  it('sin el callback la restauración sigue funcionando', async () => {
    mockIPC(
      createBackupIpcBackend(
        () => null,
        { session: () => session, isLocked: () => false, needsOwner: () => false, endSession: () => undefined, audit },
      ),
    )

    expect((await commands.restoreBackup(PASSPHRASE)).status).toBe('ok')
  })
})

describe('estado del respaldo', () => {
  it('sin respaldos el recordatorio vence y no hay última fecha', async () => {
    expect(await commands.getBackupStatus()).toEqual({ status: 'ok', data: { lastBackupAt: null, isDue: true } })
  })

  it('a 6 días 23 horas 59 minutos 59 segundos no vence', async () => {
    audit.write([row('backup_created', '2026-12-03T12:00:01.000Z', '2026-12-03T08:00:01')])

    expect(await commands.getBackupStatus()).toEqual({
      status: 'ok',
      data: { lastBackupAt: '2026-12-03T08:00:01', isDue: false },
    })
  })

  it('a 7 días exactos vence', async () => {
    audit.write([row('backup_created', '2026-12-03T12:00:00.000Z', '2026-12-03T08:00:00')])

    expect(await commands.getBackupStatus()).toEqual({
      status: 'ok',
      data: { lastBackupAt: '2026-12-03T08:00:00', isDue: true },
    })
  })

  it('la frontera se mide en segundos enteros como en Rust', async () => {
    audit.write([row('backup_created', '2026-12-03T12:00:00.600Z', '2026-12-03T08:00:00')])
    nowMs = Date.parse('2026-12-10T12:00:00.100Z')

    expect(await commands.getBackupStatus()).toMatchObject({ data: { isDue: true } })
    expect(nowMs - Date.parse('2026-12-03T12:00:00.600Z')).toBeLessThan(SEVEN_DAYS_MS)
  })

  it('una restauración cuenta como respaldo', async () => {
    audit.write([row('backup_restored', '2026-12-09T12:00:00.000Z', '2026-12-09T08:00:00')])

    expect(await commands.getBackupStatus()).toEqual({
      status: 'ok',
      data: { lastBackupAt: '2026-12-09T08:00:00', isDue: false },
    })
  })

  it('se informa el más reciente entre creaciones y restauraciones', async () => {
    audit.write([
      row('backup_created', '2026-12-01T12:00:00.000Z', '2026-12-01T08:00:00', 1),
      row('backup_restored', '2026-12-08T12:00:00.000Z', '2026-12-08T08:00:00', 2),
      row('backup_created', '2026-12-05T12:00:00.000Z', '2026-12-05T08:00:00', 3),
    ])

    expect(await commands.getBackupStatus()).toMatchObject({ data: { lastBackupAt: '2026-12-08T08:00:00', isDue: false } })
  })

  it('otras acciones de auditoría no cuentan como respaldo', async () => {
    audit.write([row('logout', '2026-12-09T12:00:00.000Z', '2026-12-09T08:00:00')])

    expect(await commands.getBackupStatus()).toEqual({ status: 'ok', data: { lastBackupAt: null, isDue: true } })
  })

  it('exige sesión y permiso y respeta el bloqueo', async () => {
    session = null
    const anonymous = errorOf(await commands.getBackupStatus())
    session = RECEPTION
    const reception = errorOf(await commands.getBackupStatus())
    session = OWNER
    locked = true
    const lockedOut = errorOf(await commands.getBackupStatus())

    expect([anonymous.code, reception.code, lockedOut.code]).toEqual(['unauthenticated', 'forbidden', 'sessionLocked'])
  })

  it('el primer arranque no abre el estado sin sesión', async () => {
    session = null
    ownerPending = true

    expect(errorOf(await commands.getBackupStatus()).code).toBe('unauthenticated')
  })

  it('tras exportar el recordatorio deja de estar vencido', async () => {
    const before = await commands.getBackupStatus()
    await commands.exportBackup(PASSPHRASE)
    const after = await commands.getBackupStatus()

    expect(before).toMatchObject({ data: { isDue: true } })
    expect(after).toEqual({ status: 'ok', data: { lastBackupAt: '2026-12-10T08:00:00', isDue: false } })
  })
})

describe('comandos ajenos', () => {
  it('delega en el siguiente backend', async () => {
    const delegated: string[] = []
    mockIPC(
      createBackupIpcBackend(
        (command) => {
          delegated.push(command)
          return 'delegado'
        },
        { session: () => session, isLocked: () => locked, needsOwner: () => ownerPending, endSession: () => {}, audit },
      ),
    )

    const { invoke } = await import('@tauri-apps/api/core')

    expect(await invoke('otro_comando')).toBe('delegado')
    expect(delegated).toEqual(['otro_comando'])
  })
})
