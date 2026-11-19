import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { useSession } from '@/lib/session'
import { freezeDate } from './clock'
import { renderWithProviders } from './render'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function UserLabel() {
  const { user } = useSession()
  return <p>{user?.username ?? 'sin-sesion'}</p>
}

describe('renderWithProviders', () => {
  it('inicia la sesión indicada en as antes de montar', async () => {
    renderWithProviders(<UserLabel />, { as: 'recepcion' })

    expect(getState().sessionUserId).toBe(2)
    expect(await screen.findByText('recepcion')).toBeInTheDocument()
  })

  it('no inicia sesión sin as', async () => {
    renderWithProviders(<UserLabel />)

    expect(getState().sessionUserId).toBeNull()
    expect(await screen.findByText('sin-sesion')).toBeInTheDocument()
  })

  it('crea un QueryClient nuevo por render sin reintentos', () => {
    const first = renderWithProviders(<p>a</p>)
    const second = renderWithProviders(<p>b</p>)

    expect(first.queryClient).not.toBe(second.queryClient)
    expect(first.queryClient.getDefaultOptions().queries?.retry).toBe(false)
  })

  it('expone un userEvent listo para interactuar', () => {
    const { user } = renderWithProviders(<p>a</p>)

    expect(typeof user.click).toBe('function')
  })
})
