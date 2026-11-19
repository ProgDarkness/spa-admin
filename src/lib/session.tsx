'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { currentSession, login, logout } from '@/features/auth/api'
import type { PermissionKey, Result, SessionUser } from './model'
import { ROUTES } from './routes'

type SessionStatus = 'loading' | 'signedIn' | 'signedOut'

export type SessionContextValue = {
  status: SessionStatus
  user: SessionUser | null
  signIn(username: string, password: string): Promise<Result<SessionUser>>
  signOut(): Promise<Result<null>>
}

type SessionSnapshot = { status: SessionStatus; user: SessionUser | null }

const LOADING_SNAPSHOT: SessionSnapshot = { status: 'loading', user: null }
const SIGNED_OUT_SNAPSHOT: SessionSnapshot = { status: 'signedOut', user: null }

function signedInSnapshot(user: SessionUser): SessionSnapshot {
  return { status: 'signedIn', user }
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(LOADING_SNAPSHOT)

  useEffect(() => {
    let isCurrent = true
    currentSession().then((result) => {
      if (!isCurrent) return
      const user = result.status === 'ok' ? result.data : null
      setSnapshot(user ? signedInSnapshot(user) : SIGNED_OUT_SNAPSHOT)
    })
    return () => {
      isCurrent = false
    }
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await login(username, password)
    if (result.status === 'ok') setSnapshot(signedInSnapshot(result.data))
    return result
  }, [])

  const signOut = useCallback(async () => {
    const result = await logout()
    if (result.status === 'error') return result
    queryClient.clear()
    setSnapshot(SIGNED_OUT_SNAPSHOT)
    return result
  }, [queryClient])

  const value = useMemo(() => ({ ...snapshot, signIn, signOut }), [snapshot, signIn, signOut])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession requiere SessionProvider')
  return value
}

export function useCan(permission: PermissionKey): boolean {
  const { user } = useSession()
  return user?.permissions.includes(permission) ?? false
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedOut') router.replace(ROUTES.login)
  }, [status, router])

  if (status === 'loading') return <p role="status">Cargando…</p>
  if (status === 'signedOut') return null
  return <>{children}</>
}
