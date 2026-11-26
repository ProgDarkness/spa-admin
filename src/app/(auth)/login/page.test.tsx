import { screen, waitFor, within } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { routerMock, setSearchParams } from '@/test/navigation'
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

  it('login_redirects_to_setup_when_needs_owner', async () => {
    commit({ ...getState(), users: [], sessionUserId: null })

    renderWithProviders(<LoginPage />)

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/setup'))
  })

  it('no redirige a setup cuando ya existen usuarios', async () => {
    renderWithProviders(<LoginPage />)
    await screen.findByLabelText('Usuario')
    await waitFor(() => expect(getState().users.length).toBeGreaterThan(0))

    expect(routerMock.replace).not.toHaveBeenCalledWith('/setup')
  })

  it('login_shows_clock_rollback_banner', async () => {
    mockIPC((cmd) => {
      if (cmd === 'setup_status') {
        return {
          needsOwner: false,
          clockRollback: { lastRecordedAt: '2026-11-12 10:00:00', detectedAt: '2026-11-10 08:00:00' },
        }
      }
      return null
    })

    renderWithProviders(<LoginPage />)

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('12/11/2026 10:00')
    expect(banner).toHaveTextContent('10/11/2026 08:00')
    expect(banner).not.toHaveTextContent('2026-11-12')
    expect(screen.getByLabelText('Usuario')).toBeEnabled()
  })

  it('no muestra banner sin retroceso de reloj', async () => {
    renderWithProviders(<LoginPage />)
    await screen.findByLabelText('Usuario')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('ofrece el enlace Recuperar acceso hacia /recover', async () => {
    renderWithProviders(<LoginPage />)

    expect(await screen.findByRole('link', { name: 'Recuperar acceso' })).toHaveAttribute('href', '/recover')
  })

  it('un fallo de setup_status no bloquea el formulario ni redirige', async () => {
    mockIPC((cmd) => {
      if (cmd === 'setup_status') throw new Error('IPC caído')
      return null
    })

    renderWithProviders(<LoginPage />)

    expect(await screen.findByLabelText('Usuario')).toBeEnabled()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('login_surfaces_setup_status_failure_and_allows_retry', async () => {
    let isSetupStatusFailing = true
    mockIPC((cmd) => {
      if (cmd !== 'setup_status') return null
      if (isSetupStatusFailing) throw new Error('IPC caído')
      return { needsOwner: false, clockRollback: { lastRecordedAt: '2026-11-12T10:00:00', detectedAt: '2026-11-10T08:00:00' } }
    })
    const { user } = renderWithProviders(<LoginPage />)

    expect(await screen.findByText('No se pudo comprobar el estado del equipo')).toBeInTheDocument()
    isSetupStatusFailing = false
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText(/La fecha del equipo retrocedió/)).toBeInTheDocument()
    expect(screen.queryByText('No se pudo comprobar el estado del equipo')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })

  it('el reintento puede redirigir a setup si ahora no hay usuarios', async () => {
    let isSetupStatusFailing = true
    mockIPC((cmd) => {
      if (cmd !== 'setup_status') return null
      if (isSetupStatusFailing) throw new Error('IPC caído')
      return { needsOwner: true, clockRollback: null }
    })
    const { user } = renderWithProviders(<LoginPage />)
    await screen.findByRole('button', { name: 'Reintentar' })
    isSetupStatusFailing = false

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/setup'))
  })

  it('muestra el aviso de restauración cuando llega con restored=1', async () => {
    setSearchParams({ restored: '1' })
    renderWithProviders(<LoginPage />)

    expect(screen.getByRole('status')).toHaveTextContent('Respaldo restaurado. Inicia sesión con una cuenta del respaldo.')
    await screen.findByLabelText('Usuario')
  })

  it('mantiene la región de estado montada y vacía y le añade el aviso al llegar restored=1', async () => {
    const { rerender } = renderWithProviders(<LoginPage />)
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()

    setSearchParams({ restored: '1' })
    rerender(<LoginPage />)

    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent('Respaldo restaurado. Inicia sesión con una cuenta del respaldo.')
    await screen.findByLabelText('Usuario')
  })

  it('no muestra el aviso de restauración sin el parámetro', async () => {
    renderWithProviders(<LoginPage />)
    await screen.findByLabelText('Usuario')

    expect(screen.queryByText(/Respaldo restaurado/)).not.toBeInTheDocument()
  })

  it('no muestra el aviso de restauración con restored distinto de 1', async () => {
    setSearchParams({ restored: '0' })
    renderWithProviders(<LoginPage />)
    await screen.findByLabelText('Usuario')

    expect(screen.queryByText(/Respaldo restaurado/)).not.toBeInTheDocument()
  })

  it('el aviso de fallo no aparece cuando setup_status responde', async () => {
    renderWithProviders(<LoginPage />)
    await screen.findByLabelText('Usuario')

    await waitFor(() => expect(screen.queryByText('No se pudo comprobar el estado del equipo')).not.toBeInTheDocument())
  })
})
