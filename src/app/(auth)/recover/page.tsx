'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthCard } from '@/features/auth/components/auth-card'
import { RecoverForm } from '@/features/auth/components/recover-form'
import { ROUTES } from '@/lib/routes'

export default function RecoverPage() {
  const router = useRouter()

  return (
    <AuthCard title="Recuperar acceso">
      <RecoverForm onComplete={() => router.replace(ROUTES.login)} />
      <Link href={ROUTES.login} className="text-sm text-primary underline-offset-4 hover:underline">
        Volver a iniciar sesión
      </Link>
    </AuthCard>
  )
}
