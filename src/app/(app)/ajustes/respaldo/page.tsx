'use client'

import { useRouter } from 'next/navigation'
import { ExportBackupPanel } from '@/features/backup/components/export-backup-panel'
import { ExportBeforeRestoreAdvice } from '@/features/backup/components/export-before-restore-advice'
import { RestoreBackupPanel } from '@/features/backup/components/restore-backup-panel'
import { RESTORED_LOGIN_HREF } from '@/lib/routes'
import { useCan } from '@/lib/session'

const PANEL_CLASS = 'max-w-xl rounded-lg border border-border bg-card p-6'

export default function BackupPage() {
  const router = useRouter()
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
            <RestoreBackupPanel advice={<ExportBeforeRestoreAdvice />} onRestored={() => router.replace(RESTORED_LOGIN_HREF)} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No tienes permiso para gestionar respaldos.</p>
      )}
    </div>
  )
}
