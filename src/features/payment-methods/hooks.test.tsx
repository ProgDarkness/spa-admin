import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { appErrorOf } from '@/lib/result'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import {
  useCreatePaymentMethod,
  usePaymentMethods,
  useSetPaymentMethodActive,
  useUpdatePaymentMethod,
} from './hooks'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, invalidate, wrapper: Wrapper }
}

describe('usePaymentMethods', () => {
  it('carga todos los métodos, inactivos incluidos, bajo la clave [paymentMethods]', async () => {
    signInAs('lectura')
    const { queryClient, wrapper } = setup()

    const { result } = renderHook(() => usePaymentMethods(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(5)
    expect(queryClient.getQueryData(['paymentMethods'])).toEqual(result.current.data)
  })

  it('propaga el AppError de la api como error de la query', async () => {
    const { wrapper } = setup()

    const { result } = renderHook(() => usePaymentMethods(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('unauthenticated')
  })
})

describe('mutaciones de métodos de pago', () => {
  it('useCreatePaymentMethod crea y reinvalida paymentMethods', async () => {
    signInAs('propietaria')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCreatePaymentMethod(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'Cripto' })
    })

    expect(getState().paymentMethods).toHaveLength(6)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['paymentMethods'] })
  })

  it('useUpdatePaymentMethod renombra por id y reinvalida paymentMethods', async () => {
    signInAs('propietaria')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useUpdatePaymentMethod(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 1, input: { name: 'Efectivo USD' } })
    })

    expect(getState().paymentMethods.find((method) => method.id === 1)?.name).toBe('Efectivo USD')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['paymentMethods'] })
  })

  it('useSetPaymentMethodActive desactiva y reinvalida paymentMethods', async () => {
    signInAs('propietaria')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useSetPaymentMethodActive(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 1, active: false })
    })

    expect(getState().paymentMethods.find((method) => method.id === 1)?.active).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['paymentMethods'] })
  })

  it('un rechazo llega como error y no invalida', async () => {
    signInAs('lectura')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCreatePaymentMethod(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'Cripto' }).catch(() => undefined)
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('forbidden')
    expect(invalidate).not.toHaveBeenCalled()
  })
})
