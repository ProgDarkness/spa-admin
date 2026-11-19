'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { LoginForm } from '@/features/auth/components/login-form'
import { ROUTES } from '@/lib/routes'
import { useSession } from '@/lib/session'

export default function LoginPage() {
  const router = useRouter()
  const { status } = useSession()

  useEffect(() => {
    if (status === 'signedIn') router.replace(ROUTES.appointments)
  }, [status, router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section
        aria-labelledby="login-heading"
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 text-card-foreground"
      >
        <BrandLogo size={56} />
        <h1 id="login-heading" className="font-serif text-2xl font-semibold">
          Iniciar sesión
        </h1>
        <LoginForm />
      </section>
    </main>
  )
}
