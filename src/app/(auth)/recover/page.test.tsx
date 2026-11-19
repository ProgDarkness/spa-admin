import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import RecoverPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('RecoverPage', () => {
  it('muestra el heading, el formulario y el enlace de vuelta al login', async () => {
    renderWithProviders(<RecoverPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Recuperar acceso' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Código de recuperación')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute('href', '/login')
    expect(routerMock.replace).not.toHaveBeenCalled()
  })
})
