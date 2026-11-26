import type { AuditAction, BackupExported, BackupStatus, RestoreResult } from '@/lib/bindings'
import { backupPassphraseProblem } from '@/lib/backup-passphrase'
import { toLocalDateTime } from '@/lib/datetime'
import type { SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import {
  backupFromNewerAppError,
  backupNotRecognizedError,
  backupRollbackFailedError,
  backupTooLargeError,
  backupUnreadableError,
  forbiddenError,
  sessionLockedError,
  unauthenticatedError,
  validationError,
} from './ipc-errors'
import { isRecord } from './record-backend-support'
import type { SharedRows } from './shared-rows'

export type PickedBackup =
  | 'valid'
  | 'corrupt'
  | 'future'
  | 'wrongPassphrase'
  | 'notRecognized'
  | 'rollbackFailed'
  | 'tooLarge'

export type BackupAuditRow = {
  id: number
  action: AuditAction
  actorUserId: number | null
  occurredAt: string
  occurredAtUtc: string
  diff: Record<string, unknown> | null
}

export type BackupBackendOptions = {
  session: () => SessionUser | null
  isLocked: () => boolean
  needsOwner: () => boolean
  endSession: () => void
  audit: SharedRows<BackupAuditRow>
  now?: () => number
  onRestored?: () => void
}

const BACKUP_PERMISSION = 'backup.manage'
const PASSPHRASE_FIELD = 'passphrase'
const SUPPORTED_SCHEMA_VERSION = 12
const BACKUP_REMINDER_INTERVAL_SECONDS = 7 * 24 * 60 * 60
const MS_PER_SECOND = 1000
const LOCAL_SECONDS_LENGTH = 2
const FILE_NAME_PREFIX = 'spa-respaldo-'
const FILE_NAME_EXTENSION = '.spabak'
const BACKUP_ACTIONS: readonly AuditAction[] = ['backup_created', 'backup_restored']

const DEFAULT_PICK: PickedBackup = 'valid'
let nextPick: PickedBackup | null = DEFAULT_PICK

export function seededBackupAuditRow(occurredAtUtc: string): BackupAuditRow {
  return {
    id: 1,
    action: 'backup_created',
    actorUserId: null,
    occurredAt: localInstant(Date.parse(occurredAtUtc)),
    occurredAtUtc,
    diff: null,
  }
}

export function setNextPickedBackup(pick: PickedBackup | null): void {
  nextPick = pick
}

function takeNextPick(): PickedBackup | null {
  const pick = nextPick
  nextPick = DEFAULT_PICK
  return pick
}

function passphraseArgument(args: unknown): string {
  const value = isRecord(args) ? args.passphrase : undefined
  if (typeof value !== 'string') throw new Error('argumento inválido: passphrase')
  return value
}

function requireAcceptablePassphrase(passphrase: string): void {
  if (backupPassphraseProblem(passphrase) !== null) throw validationError(PASSPHRASE_FIELD)
}

function localInstant(ms: number): string {
  const date = new Date(ms)
  const seconds = String(date.getSeconds()).padStart(LOCAL_SECONDS_LENGTH, '0')
  return `${toLocalDateTime(date)}:${seconds}`
}

function defaultFileName(ms: number): string {
  return `${FILE_NAME_PREFIX}${toLocalDateTime(new Date(ms)).replace('T', '-').replace(':', '')}${FILE_NAME_EXTENSION}`
}

function wholeSeconds(ms: number): number {
  return Math.floor(ms / MS_PER_SECOND)
}

export function createBackupIpcBackend(next: IpcBackend, options: BackupBackendOptions): IpcBackend {
  const now = options.now ?? Date.now

  function requireActiveUser(): SessionUser {
    const user = options.session()
    if (!user) throw unauthenticatedError()
    if (options.isLocked()) throw sessionLockedError()
    return user
  }

  function authorize(): SessionUser {
    const user = requireActiveUser()
    if (!user.permissions.some((granted) => granted === BACKUP_PERMISSION)) throw forbiddenError()
    return user
  }

  function authorizeRestore(): SessionUser | null {
    return options.needsOwner() ? null : authorize()
  }

  function record(entry: Omit<BackupAuditRow, 'id' | 'occurredAt' | 'occurredAtUtc'>): BackupAuditRow {
    const rows = options.audit.read()
    const instantMs = now()
    const row: BackupAuditRow = {
      ...entry,
      id: rows.reduce((highest, existing) => Math.max(highest, existing.id), 0) + 1,
      occurredAt: localInstant(instantMs),
      occurredAtUtc: new Date(instantMs).toISOString(),
    }
    options.audit.write([...rows, row])
    return row
  }

  function exportBackup(args: unknown): BackupExported | null {
    const actor = authorize()
    requireAcceptablePassphrase(passphraseArgument(args))
    const pick = takeNextPick()
    if (pick === null) return null
    if (pick === 'tooLarge') throw backupTooLargeError()
    const fileName = defaultFileName(now())
    const row = record({
      actorUserId: actor.id,
      action: 'backup_created',
      diff: { schemaVersion: SUPPORTED_SCHEMA_VERSION, fileName },
    })
    return { fileName, createdAt: row.occurredAt }
  }

  function failureOf(pick: PickedBackup): ReturnType<typeof backupUnreadableError> | null {
    if (pick === 'corrupt' || pick === 'wrongPassphrase') return backupUnreadableError()
    if (pick === 'notRecognized') return backupNotRecognizedError()
    if (pick === 'future') return backupFromNewerAppError()
    if (pick === 'rollbackFailed') return backupRollbackFailedError()
    return null
  }

  function restoreBackup(args: unknown): RestoreResult | null {
    const actor = authorizeRestore()
    requireAcceptablePassphrase(passphraseArgument(args))
    const pick = takeNextPick()
    if (pick === null) return null
    const failure = failureOf(pick)
    if (failure) throw failure
    const result: RestoreResult = { sourceSchemaVersion: SUPPORTED_SCHEMA_VERSION, schemaVersion: SUPPORTED_SCHEMA_VERSION }
    record({
      actorUserId: null,
      action: 'backup_restored',
      diff: { restoredBy: actor?.username ?? null, ...result },
    })
    options.endSession()
    options.onRestored?.()
    return result
  }

  function getBackupStatus(): BackupStatus {
    authorize()
    const backups = options.audit.read().filter((row) => BACKUP_ACTIONS.includes(row.action))
    const latest = backups.reduce<BackupAuditRow | null>(
      (best, row) => (best === null || row.occurredAtUtc > best.occurredAtUtc ? row : best),
      null,
    )
    if (!latest) return { lastBackupAt: null, isDue: true }
    const elapsedSeconds = wholeSeconds(now()) - wholeSeconds(Date.parse(latest.occurredAtUtc))
    return { lastBackupAt: latest.occurredAt, isDue: elapsedSeconds >= BACKUP_REMINDER_INTERVAL_SECONDS }
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    export_backup: exportBackup,
    restore_backup: restoreBackup,
    get_backup_status: getBackupStatus,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
