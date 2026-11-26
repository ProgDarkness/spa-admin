'use client'

import { ExportBackupPanel } from '@/features/backup/components/export-backup-panel'
import { ExportBeforeRestoreAdvice } from '@/features/backup/components/export-before-restore-advice'
import { RestoreBackupPanel } from '@/features/backup/components/restore-backup-panel'
import { useCan } from '@/lib/session'

const PANEL_CLASS = 'max-w-xl rounded-lg border border-border bg-card p-6'

export default function BackupPage() {
  const canManageBackups = useCan('backup.manage')

  return (
    <div className="grid gap-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Respaldo</h1>
      {canManageBackups ? (
        <>
          <div className={PANEL_CLASS}>
            <ExportBackupPanel />
          </div>
          <div className={PANEL_CLASS}>
            <RestoreBackupPanel advice={<ExportBeforeRestoreAdvice />} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No tienes permiso para gestionar respaldos.</p>
      )}
    </div>
  )
}
