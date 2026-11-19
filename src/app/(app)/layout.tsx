'use client'

import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { RequireSession } from '@/lib/session'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <AppShell>{children}</AppShell>
    </RequireSession>
  )
}
