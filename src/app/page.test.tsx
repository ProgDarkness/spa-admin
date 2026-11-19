import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import Home from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('Home', () => {
  it('redirige a /login sin sesión', async () => {
    renderWithProviders(<Home />)

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'))
    expect(routerMock.replace).toHaveBeenCalledTimes(1)
  })

  it('redirige a /citas con sesión', async () => {
    renderWithProviders(<Home />, { as: 'lectura' })

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/citas'))
    expect(routerMock.replace).toHaveBeenCalledTimes(1)
  })

  it('no redirige mientras la sesión carga', () => {
    renderWithProviders(<Home />, { as: 'lectura' })

    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('anuncia la carga de forma accesible', () => {
    renderWithProviders(<Home />)

    expect(screen.getByRole('status')).toHaveTextContent('Cargando')
  })
})
