import { screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import { ShellBanners } from './shell-banners'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
})

it('muestra el aviso de tasa faltante cuando no hay tasa de hoy', async () => {
  commit({ ...getState(), rates: getState().rates.filter((rate) => rate.date !== '2026-11-12') })
  installDevIpc()
  renderWithProviders(<ShellBanners />, { as: 'recepcion' })

  expect(await screen.findByRole('alert')).toHaveTextContent('Falta la tasa de cambio de hoy')
})

it('muestra el recordatorio de respaldo a quien tiene backup.manage', async () => {
  renderWithProviders(<ShellBanners />, { as: 'propietaria' })

  expect(await screen.findByText('Aún no has exportado ningún respaldo')).toBeInTheDocument()
})

it('no muestra el recordatorio de respaldo a Recepción', async () => {
  const { queryClient } = renderWithProviders(<ShellBanners />, { as: 'recepcion' })

  await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('success'))
  expect(screen.queryByText(/respaldo/)).not.toBeInTheDocument()
})

it('no renderiza avisos cuando existe la tasa de hoy', async () => {
  const { container, queryClient } = renderWithProviders(<ShellBanners />, { as: 'recepcion' })

  await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('success'))
  expect(container).toBeEmptyDOMElement()
})
