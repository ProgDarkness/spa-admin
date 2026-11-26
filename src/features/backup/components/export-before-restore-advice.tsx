'use client'

import { formatAuditTimestamp } from '@/features/auth/format-audit-timestamp'
import type { BackupStatus } from '@/lib/bindings'
import { useBackupStatus } from '../hooks'

function lastBackupTextOf(status: BackupStatus): string {
  return status.lastBackupAt === null
    ? 'Aún no has exportado ningún respaldo'
    : `Último respaldo: ${formatAuditTimestamp(status.lastBackupAt)}`
}

export function ExportBeforeRestoreAdvice() {
  const { data } = useBackupStatus()

  return (
    <div className="grid gap-1 text-sm">
      <p>Te recomendamos exportar un respaldo antes de restaurar.</p>
      {data ? <p>{lastBackupTextOf(data)}</p> : null}
      <a href="#exportar" className="font-medium underline">
        Ir a Exportar respaldo
      </a>
    </div>
  )
}
