'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { SessionProvider } from '@/lib/session'

function useDevBrowserIpcReady(): boolean {
  const [isReady, setIsReady] = useState(process.env.NODE_ENV !== 'development')

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    let isCurrent = true
    void import('@/test/ipc/dev-browser-ipc')
      .then(({ installDevBrowserIpc }) => installDevBrowserIpc())
      .catch((error: unknown) => {
        console.error('No se pudo instalar el IPC de desarrollo', error)
      })
      .then(() => {
        if (isCurrent) setIsReady(true)
      })
    return () => {
      isCurrent = false
    }
  }, [])

  return isReady
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const isIpcReady = useDevBrowserIpcReady()

  if (!isIpcReady) return null

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  )
}
