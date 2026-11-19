'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ROUTES } from '@/lib/routes'
import { useSession } from '@/lib/session'

export default function Home() {
  const router = useRouter()
  const { status } = useSession()

  useEffect(() => {
    if (status === 'signedIn' || status === 'locked') router.replace(ROUTES.appointments)
    if (status === 'signedOut') router.replace(ROUTES.login)
  }, [status, router])

  return <p role="status">Cargando…</p>
}
