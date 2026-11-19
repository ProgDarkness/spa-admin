import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import type { ClientInput, ClientListFilter } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import {
  useClients,
  useCreateClient,
  useReactivateClient,
  useSoftDeleteClient,
  useUpdateClient,
} from './hooks'

const ACTIVE_FILTER: ClientListFilter = { query: null, includeDeleted: false }
const NEW_CLIENT: ClientInput = { firstName: 'Valentina', lastName: 'Ríos', nationalId: 'V-30111222', phone: '0414-5550000' }

let queryClient: QueryClient

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  signInAs('recepcion')
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useClients', () => {
  it('entrega los clientes bajo la clave [clients, filtro]', async () => {
    const { result } = renderHook(() => useClients(ACTIVE_FILTER), { wrapper })

    await waitFor(() => expect(result.current.data).toHaveLength(8))
    expect(queryClient.getQueryData(['clients', ACTIVE_FILTER])).toHaveLength(8)
  })
})

describe('mutaciones', () => {
  it('crear invalida clients y clientHistory', async () => {
    const list = renderHook(() => useClients(ACTIVE_FILTER), { wrapper })
    await waitFor(() => expect(list.result.current.data).toHaveLength(8))
    queryClient.setQueryData(['clientHistory', 1], 'previo')
    const mutation = renderHook(() => useCreateClient(), { wrapper })

    await act(async () => {
      await mutation.result.current.mutateAsync(NEW_CLIENT)
    })

    await waitFor(() => expect(list.result.current.data).toHaveLength(9))
    expect(queryClient.getQueryState(['clientHistory', 1])?.isInvalidated).toBe(true)
  })

  it('actualizar invalida y refleja el cambio', async () => {
    const list = renderHook(() => useClients(ACTIVE_FILTER), { wrapper })
    await waitFor(() => expect(list.result.current.data?.find((client) => client.id === 1)?.firstName).toBe('María'))
    const mutation = renderHook(() => useUpdateClient(), { wrapper })

    await act(async () => {
      await mutation.result.current.mutateAsync({ id: 1, input: { ...NEW_CLIENT, nationalId: 'V-12345678' } })
    })

    await waitFor(() => expect(list.result.current.data?.find((client) => client.id === 1)?.firstName).toBe('Valentina'))
  })

  it('eliminar y reactivar invalidan la lista', async () => {
    const list = renderHook(() => useClients(ACTIVE_FILTER), { wrapper })
    await waitFor(() => expect(list.result.current.data).toHaveLength(8))
    const remove = renderHook(() => useSoftDeleteClient(), { wrapper })
    const restore = renderHook(() => useReactivateClient(), { wrapper })

    await act(async () => {
      await remove.result.current.mutateAsync(1)
    })
    await waitFor(() => expect(list.result.current.data).toHaveLength(7))
    await act(async () => {
      await restore.result.current.mutateAsync(1)
    })
    await waitFor(() => expect(list.result.current.data).toHaveLength(8))
  })

  it('propaga el error de dominio de una mutación', async () => {
    signInAs('lectura')
    const mutation = renderHook(() => useCreateClient(), { wrapper })

    await act(async () => {
      await expect(mutation.result.current.mutateAsync(NEW_CLIENT)).rejects.toMatchObject({
        appError: { code: 'forbidden' },
      })
    })
  })
})
