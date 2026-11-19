import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { appErrorOf } from '@/lib/result'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { useClientHistory } from './hooks'

let queryClient: QueryClient

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  signInAs('recepcion')
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useClientHistory', () => {
  it('entrega el historial bajo la clave [clientHistory, id]', async () => {
    const { result } = renderHook(() => useClientHistory(1), { wrapper })

    await waitFor(() => expect(result.current.data?.client.id).toBe(1))
    expect(queryClient.getQueryData(['clientHistory', 1])).toBe(result.current.data)
  })

  it('expone el AppError notFound como error de la consulta', async () => {
    const { result } = renderHook(() => useClientHistory(9999), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('notFound')
  })
})
