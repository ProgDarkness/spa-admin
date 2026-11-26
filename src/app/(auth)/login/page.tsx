'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect } from 'react'
import { AuthCard } from '@/features/auth/components/auth-card'
import { ClockRollbackBanner } from '@/features/auth/components/clock-rollback-banner'
import { LoginForm } from '@/features/auth/components/login-form'
import { useSetupStatus } from '@/features/auth/hooks/use-setup-status'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/routes'
import { useSession } from '@/lib/session'

const RESTORED_NOTICE = 'Respaldo restaurado. Inicia sesión con una cuenta del respaldo.'

function RestoredNotice() {
  const wasRestored = useSearchParams().get('restored') === '1'
  if (!wasRestored) return null

  return (
    <p role="status" className="w-full rounded-md border border-border bg-background p-3 text-sm font-medium">
      {RESTORED_NOTICE}
    </p>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const { status } = useSession()
  const goToSetup = useCallback(() => router.replace(ROUTES.setup), [router])
  const { clockRollback, hasFailed, retry } = useSetupStatus(goToSetup)

  useEffect(() => {
    if (status === 'signedIn') router.replace(ROUTES.appointments)
  }, [status, router])

  return (
    <AuthCard title="Iniciar sesión">
      <Suspense fallback={null}>
        <RestoredNotice />
      </Suspense>
      {clockRollback ? <ClockRollbackBanner {...clockRollback} /> : null}
      {hasFailed ? (
        <div role="alert" className="flex w-full items-center justify-between gap-2 text-sm text-destructive">
          <span>No se pudo comprobar el estado del equipo</span>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Reintentar
          </Button>
        </div>
      ) : null}
      <LoginForm />
      <Link href={ROUTES.recover} className="text-sm text-primary underline-offset-4 hover:underline">
        Recuperar acceso
      </Link>
    </AuthCard>
  )
}
