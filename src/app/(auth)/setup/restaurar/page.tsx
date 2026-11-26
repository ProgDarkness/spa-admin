'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { setupStatus } from '@/features/auth/api'
import { AuthCard } from '@/features/auth/components/auth-card'
import { RestoreBackupPanel } from '@/features/backup/components/restore-backup-panel'
import { RESTORED_LOGIN_HREF, ROUTES } from '@/lib/routes'

export default function RestoreFirstRunPage() {
  const router = useRouter()

  useEffect(() => {
    let isCurrent = true
    setupStatus().then((result) => {
      if (isCurrent && result.status === 'ok' && !result.data.needsOwner) router.replace(ROUTES.login)
    })
    return () => {
      isCurrent = false
    }
  }, [router])

  return (
    <AuthCard title="Restaurar desde un respaldo">
      <RestoreBackupPanel onRestored={() => router.replace(RESTORED_LOGIN_HREF)} />
      <Link href={ROUTES.setup} className="text-sm text-primary underline-offset-4 hover:underline">
        Volver al primer arranque
      </Link>
    </AuthCard>
  )
}
