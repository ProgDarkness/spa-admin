'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useBackupStatus } from '@/features/backup/hooks'
import { ROUTES } from '@/lib/routes'
import { useCan } from '@/lib/session'

const NEVER_EXPORTED_TEXT = 'Aún no has exportado ningún respaldo'
const OVERDUE_TEXT = 'Hace más de 7 días que no exportas un respaldo'
const TRAILING_SLASHES = /\/+$/

function isOnBackupScreen(pathname: string): boolean {
  return pathname.replace(TRAILING_SLASHES, '') === ROUTES.backup
}

function DueBackupNotice() {
  const { data } = useBackupStatus()
  if (!data?.isDue) return null

  return (
    <div
      data-tone="warning"
      className="flex items-center gap-3 border-b border-border bg-[var(--warning)] px-4 py-2 text-sm text-[var(--warning-foreground)]"
    >
      <p>{data.lastBackupAt === null ? NEVER_EXPORTED_TEXT : OVERDUE_TEXT}</p>
      <Link href={ROUTES.backup} className="font-medium underline">
        Exportar un respaldo
      </Link>
    </div>
  )
}

export function BackupReminderBanner() {
  const canManageBackups = useCan('backup.manage')
  const isRedundant = isOnBackupScreen(usePathname())
  if (!canManageBackups) return null

  return <div role="status">{isRedundant ? null : <DueBackupNotice />}</div>
}
