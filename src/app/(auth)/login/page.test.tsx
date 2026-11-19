import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import LoginPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('LoginPage', () => {
  it('muestra el heading accesible Iniciar sesión y el formulario', async () => {
    renderWithProviders(<LoginPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Usuario')).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('muestra el BrandLogo y el heading dentro de una región con nombre', async () => {
    renderWithProviders(<LoginPage />)

    const region = screen.getByRole('region')
    expect(within(region).getByRole('img', { name: 'Spa' })).toBeInTheDocument()
    expect(within(region).getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Usuario')).toBeInTheDocument()
  })

  it('redirige a /citas si ya hay sesión', async () => {
    renderWithProviders(<LoginPage />, { as: 'recepcion' })

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/citas'))
  })

  it('redirige a /citas tras un login válido', async () => {
    const { user } = renderWithProviders(<LoginPage />)
    await user.type(await screen.findByLabelText('Usuario'), 'propietaria')
    await user.type(screen.getByLabelText('Contraseña'), DEV_PASSWORD)

    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/citas'))
  })
})
