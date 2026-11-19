import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { useMonthlyMetrics } from './hooks'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, wrapper: Wrapper }
}

describe('useMonthlyMetrics', () => {
  it('consulta con la clave metrics y el mes', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()

    const { result } = renderHook(() => useMonthlyMetrics('2026-11'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.recurringClients).toBe(2)
    expect(queryClient.getQueryData(['metrics', '2026-11'])).toMatchObject({ recurringClients: 2 })
  })

  it('expone el error de dominio sin permiso', async () => {
    signInAs('lectura')
    const { wrapper } = setup()

    const { result } = renderHook(() => useMonthlyMetrics('2026-11'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('No tienes permiso para esta acción')
  })

  it('se invalida con la raíz metrics al cambiar de mes', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()
    const { result, rerender } = renderHook(({ month }) => useMonthlyMetrics(month), {
      wrapper,
      initialProps: { month: '2026-11' },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ month: '2026-10' })

    await waitFor(() => expect(result.current.data?.month).toBe('2026-10'))
    expect(queryClient.getQueryCache().findAll({ queryKey: ['metrics'] })).toHaveLength(2)
  })
})
