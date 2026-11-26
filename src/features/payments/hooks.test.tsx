import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { appErrorOf } from '@/lib/result'
import { installDevIpc } from '@/test/dev-ipc'
import { appointmentTemplate, resetWithEmptyAgenda } from '@/test/appointment-fixtures'
import { signInAs } from '@/test/session'
import { useCreatePayment, usePayments, useVoidPayment } from './hooks'

const APPOINTMENT_ID = 100

beforeEach(() => {
  resetWithEmptyAgenda()
  installDevIpc({ appointments: [appointmentTemplate({ id: APPOINTMENT_ID })], payments: [] })
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, wrapper: Wrapper }
}

describe('usePayments', () => {
  it('lista los pagos con la clave payments y el id de la cita', async () => {
    signInAs('recepcion')
    const { queryClient, wrapper } = setup()

    const { result } = renderHook(() => usePayments(APPOINTMENT_ID), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
    expect(queryClient.getQueryCache().findAll({ queryKey: ['payments', APPOINTMENT_ID] })).toHaveLength(1)
  })

  it('expone el error de dominio sin sesión', async () => {
    const { wrapper } = setup()

    const { result } = renderHook(() => usePayments(APPOINTMENT_ID), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('unauthenticated')
  })
})

describe('mutaciones', () => {
  it('crear y anular invalidan payments, clientHistory y metrics', async () => {
    signInAs('recepcion')
    const { queryClient, wrapper } = setup()
    const keys = [['payments', APPOINTMENT_ID], ['clientHistory', 1], ['metrics', '2026-11']]
    keys.forEach((queryKey) => queryClient.setQueryData(queryKey, []))
    const create = renderHook(() => useCreatePayment(), { wrapper })
    const voidHook = renderHook(() => useVoidPayment(), { wrapper })

    let created = 0
    await act(async () => {
      created = (
        await create.result.current.mutateAsync({
          appointmentId: APPOINTMENT_ID,
          methodId: 1,
          currency: 'USD',
          amountCents: 1000,
          rateBsPerUsdE4: null,
        })
      ).id
    })
    expect(keys.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated)).toEqual([true, true, true])

    keys.forEach((queryKey) => queryClient.setQueryData(queryKey, []))
    await act(async () => {
      await voidHook.result.current.mutateAsync({ id: created, reason: 'error' })
    })
    expect(keys.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated)).toEqual([true, true, true])
  })

  it('propaga el error de dominio al mutar', async () => {
    signInAs('lectura')
    const { wrapper } = setup()
    const { result } = renderHook(() => useVoidPayment(), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 1, reason: 'x' })).rejects.toMatchObject({ appError: { code: 'forbidden' } })
    })
  })
})
