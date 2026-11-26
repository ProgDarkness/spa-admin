import { commands, type BackupExported, type BackupStatus, type RestoreResult } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import type { Result } from '@/lib/model'

export function exportBackup(passphrase: string): Promise<Result<BackupExported | null>> {
  return settle(() => commands.exportBackup(passphrase))
}

export function restoreBackup(passphrase: string): Promise<Result<RestoreResult | null>> {
  return settle(() => commands.restoreBackup(passphrase))
}

export function getBackupStatus(): Promise<Result<BackupStatus>> {
  return settle(() => commands.getBackupStatus())
}
