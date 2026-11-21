import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { ROUTES } from '@/lib/routes'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import { MissingRateBanner } from './missing-rate-banner'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
})

function removeTodayRate() {
  commit({ ...getState(), rates: getState().rates.filter((rate) => rate.date !== '2026-11-12') })
  installDevIpc()
}

describe('MissingRateBanner', () => {
  it('avisa con role alert y enlaza a las tasas cuando falta la de hoy', async () => {
    removeTodayRate()
    renderWithProviders(<MissingRateBanner />, { as: 'recepcion' })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Falta la tasa de cambio de hoy')
    expect(screen.getByRole('link', { name: 'Registrar tasa' })).toHaveAttribute('href', ROUTES.rates)
  })

  it('expone el aviso con data-tone warning', async () => {
    removeTodayRate()
    renderWithProviders(<MissingRateBanner />, { as: 'recepcion' })

    expect(await screen.findByRole('alert')).toHaveAttribute('data-tone', 'warning')
  })

  it('se oculta cuando existe la tasa de hoy', async () => {
    const { queryClient } = renderWithProviders(<MissingRateBanner />, { as: 'recepcion' })

    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('success'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('también avisa a quien solo tiene payments.read', async () => {
    removeTodayRate()
    renderWithProviders(<MissingRateBanner />, { as: 'lectura' })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('no avisa a quien no tiene permiso de lectura de tasas', async () => {
    removeTodayRate()
    commit({
      ...getState(),
      users: getState().users.map((user) => ({
        ...user,
        permissions: ['clients.read'],
      })),
    })
    const { queryClient } = renderWithProviders(<MissingRateBanner />, {
      as: 'lectura',
    })

    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no avisa sin sesión', async () => {
    removeTodayRate()
    const { queryClient } = renderWithProviders(<MissingRateBanner />)

    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
