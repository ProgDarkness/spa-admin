import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { appErrorOf } from '@/lib/result'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import {
  useCreateService,
  useServices,
  useSetServiceActive,
  useUpdateService,
} from './hooks'

const validInput = { name: 'Depilación', priceCents: 2_500, durationMin: 30 }

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

describe('useServices', () => {
  it('carga el listado bajo la clave [services, filtro]', async () => {
    signInAs('lectura')
    const { queryClient, wrapper } = setup()
    const filter = { includeInactive: true }

    const { result } = renderHook(() => useServices(filter), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(8)
    expect(queryClient.getQueryData(['services', filter])).toEqual(result.current.data)
  })

  it('separa en caché los filtros distintos', async () => {
    signInAs('lectura')
    const { wrapper } = setup()

    const active = renderHook(() => useServices({ includeInactive: false }), { wrapper })
    await waitFor(() => expect(active.result.current.isSuccess).toBe(true))

    expect(active.result.current.data).toHaveLength(7)
  })

  it('propaga el AppError de la api como error de la query', async () => {
    const { wrapper } = setup()

    const { result } = renderHook(() => useServices({ includeInactive: true }), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('unauthenticated')
  })
})

describe('mutaciones de servicios', () => {
  it('useCreateService crea y reinvalida services', async () => {
    signInAs('propietaria')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCreateService(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(validInput)
    })

    expect(getState().services).toHaveLength(9)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['services'] })
  })

  it('useUpdateService actualiza por id y reinvalida services', async () => {
    signInAs('propietaria')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useUpdateService(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 1, input: validInput })
    })

    expect(getState().services[0]?.name).toBe('Depilación')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['services'] })
  })

  it('useSetServiceActive cambia el estado y reinvalida services', async () => {
    signInAs('propietaria')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useSetServiceActive(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 1, active: false })
    })

    expect(getState().services[0]?.active).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['services'] })
  })

  it('una mutación rechazada expone el AppError y no invalida', async () => {
    signInAs('lectura')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCreateService(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(validInput).catch(() => undefined)
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('forbidden')
    expect(invalidate).not.toHaveBeenCalled()
  })
})
