'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/session'

export function UserSummary() {
  const { user, signOut } = useSession()
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut(): Promise<void> {
    const result = await signOut()
    setSignOutError(result.status === 'error' ? result.error.message : null)
  }

  if (!user) return null

  return (
    <div className="flex items-center justify-between gap-3 md:flex-col md:items-stretch">
      <div className="text-sm leading-tight">
        <p className="font-medium">{user.username}</p>
        <p className="text-primary-foreground/70">{user.roleName}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={() => void handleSignOut()}
      >
        Cerrar sesión
      </Button>
      {signOutError && <p role="alert" className="text-xs">{signOutError}</p>}
    </div>
  )
}
