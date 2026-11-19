'use client'

import Link from 'next/link'
import { ROUTES } from '@/lib/routes'
import { useTodayRate } from '../hooks'

export function MissingRateBanner() {
  const { data } = useTodayRate()
  if (data !== null) return null

  return (
    <div
      role="alert"
      data-tone="warning"
      className="flex items-center gap-3 border-b border-border bg-[var(--warning)] px-4 py-2 text-sm text-[var(--warning-foreground)]"
    >
      <p>Falta la tasa de cambio de hoy; los pagos en bolívares no se podrán registrar sin ella.</p>
      <Link href={ROUTES.rates} className="font-medium underline">
        Registrar tasa
      </Link>
    </div>
  )
}
