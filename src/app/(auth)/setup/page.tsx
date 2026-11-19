'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { setupStatus } from '@/features/auth/api'
import { AuthCard } from '@/features/auth/components/auth-card'
import { SetupOwnerForm } from '@/features/auth/components/setup-owner-form'
import { ROUTES } from '@/lib/routes'

export default function SetupPage() {
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
    <AuthCard title="Primer arranque">
      <p className="text-center text-sm text-muted-foreground">
        Crea la cuenta de la propietaria. Es la única cuenta que puede recuperarse con un código.
      </p>
      <SetupOwnerForm onComplete={() => router.replace(ROUTES.appointments)} />
    </AuthCard>
  )
}
