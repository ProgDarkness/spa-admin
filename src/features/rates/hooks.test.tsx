import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { useRates, useTodayRate, useUpsertRate } from './hooks'

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

describe('useRates', () => {
  it('lista las tasas con la clave rates', async () => {
    signInAs('recepcion')
    const { queryClient, wrapper } = setup()

    const { result } = renderHook(() => useRates(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0]).toEqual({ date: '2026-11-12', rateBsPerUsdE4: 365000 })
    expect(queryClient.getQueryCache().findAll({ queryKey: ['rates'] })).toHaveLength(1)
  })

  it('expone el error de dominio sin sesión', async () => {
    const { wrapper } = setup()

    const { result } = renderHook(() => useRates(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('Debes iniciar sesión')
  })
})

describe('useTodayRate', () => {
  it('devuelve la tasa de hoy cuando existe', async () => {
    signInAs('lectura')
    const { wrapper } = setup()

    const { result } = renderHook(() => useTodayRate(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ date: '2026-11-12', rateBsPerUsdE4: 365000 })
  })

  it('devuelve null cuando falta la tasa de hoy', async () => {
    signInAs('lectura')
    freezeDate('2026-12-01T09:00')
    const { wrapper } = setup()

    const { result } = renderHook(() => useTodayRate(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })
})

describe('useUpsertRate', () => {
  it('guarda la tasa e invalida la clave rates', async () => {
    signInAs('recepcion')
    const { wrapper } = setup()
    const { result } = renderHook(() => ({ rates: useRates(), upsert: useUpsertRate() }), { wrapper })
    await waitFor(() => expect(result.current.rates.isSuccess).toBe(true))

    await act(async () => {
      await result.current.upsert.mutateAsync({ date: '2026-12-01', rateBsPerUsdE4: 380000 })
    })

    await waitFor(() =>
      expect(result.current.rates.data?.[0]).toEqual({ date: '2026-12-01', rateBsPerUsdE4: 380000 }),
    )
    expect(getState().rates).toHaveLength(8)
  })

  it('rechaza con el error de dominio cuando falta el permiso', async () => {
    signInAs('lectura')
    const { wrapper } = setup()
    const upsert = renderHook(() => useUpsertRate(), { wrapper })

    await expect(upsert.result.current.mutateAsync({ date: '2026-12-01', rateBsPerUsdE4: 380000 })).rejects.toThrow(
      'No tienes permiso para esta acción',
    )
  })
})
