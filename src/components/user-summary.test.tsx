import { screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { renderWithProviders } from '@/test/render'
import { UserSummary } from './user-summary'

beforeEach(() => {
  resetStore()
})

describe('UserSummary', () => {
  it('muestra usuario y rol', async () => {
    renderWithProviders(<UserSummary />, { as: 'recepcion' })

    expect(await screen.findByText('recepcion')).toBeInTheDocument()
    expect(screen.getByText('Recepción')).toBeInTheDocument()
  })

  it('no renderiza nada sin sesión', () => {
    const { container } = renderWithProviders(<UserSummary />)

    expect(container).toBeEmptyDOMElement()
  })

  it('cierra la sesión con Cerrar sesión', async () => {
    const { user } = renderWithProviders(<UserSummary />, { as: 'propietaria' })

    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))

    await waitFor(() => expect(getState().sessionUserId).toBeNull())
  })

  it('muestra una alerta y mantiene la sesión si cerrar sesión falla', async () => {
    const { user } = renderWithProviders(<UserSummary />, { as: 'propietaria' })
    await screen.findByText('propietaria')
    mockIPC(() => {
      throw new Error('pánico')
    })

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación')
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeEnabled()
    expect(getState().sessionUserId).not.toBeNull()
  })
})
