'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { currentSession, login, logout, unlock as unlockCommand } from '@/features/auth/api'
import { LockScreen } from '@/features/auth/components/lock-screen'
import { useActivityTracker } from '@/features/auth/hooks/use-activity-tracker'
import type { AppError, PermissionKey, Result, SessionUser, SessionView } from './model'
import { appErrorOf } from './result'
import { ROUTES } from './routes'

export type SessionStatus = 'loading' | 'signedIn' | 'locked' | 'signedOut'

export const SESSION_POLL_INTERVAL_MS = 15_000

export type SessionContextValue = {
  status: SessionStatus
  user: SessionUser | null
  signIn(username: string, password: string): Promise<Result<SessionUser>>
  signOut(): Promise<Result<null>>
  unlock(password: string): Promise<Result<SessionUser>>
  refresh(): Promise<void>
}

type SessionSnapshot = { status: SessionStatus; user: SessionUser | null }

const LOADING_SNAPSHOT: SessionSnapshot = { status: 'loading', user: null }
const SIGNED_OUT_SNAPSHOT: SessionSnapshot = { status: 'signedOut', user: null }
const LOCKED_SNAPSHOT: SessionSnapshot = { status: 'locked', user: null }

function signedInSnapshot(user: SessionUser): SessionSnapshot {
  return { status: 'signedIn', user }
}

function unreachableStatus(status: never): SessionSnapshot {
  void status
  return SIGNED_OUT_SNAPSHOT
}

function snapshotOfView(view: SessionView | null): SessionSnapshot {
  if (view === null) return SIGNED_OUT_SNAPSHOT
  switch (view.status) {
    case 'locked':
      return LOCKED_SNAPSHOT
    case 'active':
      return view.user ? signedInSnapshot(view.user) : SIGNED_OUT_SNAPSHOT
    default:
      return unreachableStatus(view.status)
  }
}

function snapshotOfResult(result: Result<SessionView | null>): SessionSnapshot | null {
  if (result.status === 'ok') return snapshotOfView(result.data)
  return result.error.code === 'sessionLocked' ? LOCKED_SNAPSHOT : null
}

function isSameSnapshot(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return (
    a.status === b.status &&
    a.user?.id === b.user?.id &&
    a.user?.roleName === b.user?.roleName &&
    a.user?.permissions.join() === b.user?.permissions.join()
  )
}

const REFRESH_TRIGGER_CODES: ReadonlySet<string> = new Set(['sessionLocked', 'unauthenticated'])

function isSessionInvalidatedError(error: unknown): boolean {
  const code = appErrorOf(error)?.code
  return code !== undefined && REFRESH_TRIGGER_CODES.has(code)
}

function isSessionNoLongerLocked(error: AppError): boolean {
  return error.code === 'unauthenticated' || (error.code === 'validation' && error.field === 'password')
}

type CacheEvent ={ type: string; action?: { type: string; error?: unknown } }

type InFlightRefresh = { generation: number; promise: Promise<void> }

type SnapshotWriter = {
  replaceSnapshot(next: SessionSnapshot): void
  applyResult(result: Result<SessionView | null>): void
}

const SessionContext = createContext<SessionContextValue | null>(null)

function useDeduplicatedRefresh(generationRef: { current: number }, applyResult: SnapshotWriter['applyResult']) {
  const inFlightRef = useRef<InFlightRefresh | null>(null)

  return useCallback((): Promise<void> => {
    const generation = generationRef.current
    const existing = inFlightRef.current
    if (existing && existing.generation === generation) return existing.promise
    const promise = currentSession()
      .then((result) => {
        if (generation === generationRef.current) applyResult(result)
      })
      .finally(() => {
        if (inFlightRef.current?.promise === promise) inFlightRef.current = null
      })
    inFlightRef.current = { generation, promise }
    return promise
  }, [generationRef, applyResult])
}

function useSessionSnapshot() {
  const queryClient = useQueryClient()
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(LOADING_SNAPSHOT)
  const statusRef = useRef<SessionStatus>('loading')
  const generationRef = useRef(0)

  const replaceSnapshot = useCallback(
    (next: SessionSnapshot) => {
      generationRef.current += 1
      if (next.status !== 'signedIn') queryClient.clear()
      statusRef.current = next.status
      setSnapshot(next)
    },
    [queryClient],
  )

  const applyResult = useCallback(
    (result: Result<SessionView | null>) => {
      const next = snapshotOfResult(result)
      if (!next) return
      if (next.status !== 'signedIn' && statusRef.current === 'signedIn') queryClient.clear()
      statusRef.current = next.status
      setSnapshot((previous) => (isSameSnapshot(previous, next) ? previous : next))
    },
    [queryClient],
  )

  const applyActivityResult = useCallback(
    (result: Result<SessionView | null>) => {
      if (snapshotOfResult(result)?.status !== 'signedIn') applyResult(result)
    },
    [applyResult],
  )

  const loadInitial = useCallback(async (): Promise<void> => {
    const generation = generationRef.current
    const result = await currentSession()
    if (generation !== generationRef.current) return
    const next = snapshotOfResult(result) ?? SIGNED_OUT_SNAPSHOT
    statusRef.current = next.status
    setSnapshot(next)
  }, [])

  const refresh = useDeduplicatedRefresh(generationRef, applyResult)

  return { snapshot, replaceSnapshot, applyActivityResult, loadInitial, refresh }
}

function useSessionPolling(status: SessionStatus, refresh: () => Promise<void>): void {
  useEffect(() => {
    if (status !== 'signedIn') return
    const timer = setInterval(() => void refresh(), SESSION_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [status, refresh])
}

function useInvalidationSubscription(refresh: () => Promise<void>): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const refreshOnInvalidation = (event: CacheEvent) => {
      if (event.type === 'updated' && event.action?.type === 'error' && isSessionInvalidatedError(event.action.error)) {
        void refresh()
      }
    }
    const stopQueries = queryClient.getQueryCache().subscribe(refreshOnInvalidation)
    const stopMutations = queryClient.getMutationCache().subscribe(refreshOnInvalidation)
    return () => {
      stopQueries()
      stopMutations()
    }
  }, [queryClient, refresh])
}

function useSessionActions(replaceSnapshot: SnapshotWriter['replaceSnapshot'], refresh: () => Promise<void>) {
  const signIn = useCallback(
    async (username: string, password: string) => {
      const result = await login(username, password)
      if (result.status === 'ok') replaceSnapshot(signedInSnapshot(result.data))
      return result
    },
    [replaceSnapshot],
  )

  const signOut = useCallback(async () => {
    const result = await logout()
    if (result.status === 'error') return result
    replaceSnapshot(SIGNED_OUT_SNAPSHOT)
    return result
  }, [replaceSnapshot])

  const unlock = useCallback(
    async (password: string) => {
      const result = await unlockCommand(password)
      if (result.status === 'ok') replaceSnapshot(signedInSnapshot(result.data))
      else if (isSessionNoLongerLocked(result.error)) void refresh()
      return result
    },
    [replaceSnapshot, refresh],
  )

  return { signIn, signOut, unlock }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { snapshot, replaceSnapshot, applyActivityResult, loadInitial, refresh } = useSessionSnapshot()
  const { signIn, signOut, unlock } = useSessionActions(replaceSnapshot, refresh)

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useSessionPolling(snapshot.status, refresh)
  useInvalidationSubscription(refresh)
  useActivityTracker(snapshot.status === 'signedIn', applyActivityResult)

  const value = useMemo(
    () => ({ ...snapshot, signIn, signOut, unlock, refresh }),
    [snapshot, signIn, signOut, unlock, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession requiere SessionProvider')
  return value
}

export function useCanAny(permissions: readonly PermissionKey[]): boolean {
  const { user } = useSession()
  return permissions.some((permission) => user?.permissions.includes(permission) ?? false)
}

export function useCan(permission: PermissionKey): boolean {
  return useCanAny([permission])
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedOut') router.replace(ROUTES.login)
  }, [status, router])

  if (status === 'loading') return <p role="status">Cargando…</p>
  if (status === 'signedOut') return null
  if (status === 'locked') return <LockScreen />
  return <>{children}</>
}
