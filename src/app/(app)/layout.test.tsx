import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import AppLayout from './layout'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('AppLayout', () => {
  it('sin sesión redirige a /login y oculta el contenido', async () => {
    renderWithProviders(
      <AppLayout>
        <p>página privada</p>
      </AppLayout>,
    )

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'))
    expect(screen.queryByText('página privada')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
  })

  it('con sesión muestra el shell y el contenido', async () => {
    renderWithProviders(
      <AppLayout>
        <p>página privada</p>
      </AppLayout>,
      { as: 'propietaria' },
    )

    const navigation = await screen.findByRole('navigation', { name: 'Principal' })
    expect(within(navigation).getByRole('link', { name: 'Métricas' })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByText('página privada')).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('expone un único landmark main con el contenido', async () => {
    renderWithProviders(
      <AppLayout>
        <p>página privada</p>
      </AppLayout>,
      { as: 'propietaria' },
    )

    const main = await screen.findByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toContainElement(screen.getByText('página privada'))
  })
})
