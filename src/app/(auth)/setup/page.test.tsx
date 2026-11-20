import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { formatRecoveryCode } from '@/test/ipc/recovery-codes'
import SetupPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('SetupPage', () => {
  it('muestra el heading y el formulario cuando falta la propietaria', async () => {
    commit({ ...getState(), users: [], sessionUserId: null })

    renderWithProviders(<SetupPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Primer arranque' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Usuario')).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('redirige al login si el primer arranque ya se completó', async () => {
    renderWithProviders(<SetupPage />)

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'))
  })

  it('tras guardar el código y continuar lleva a la agenda', async () => {
    commit({ ...getState(), users: [], sessionUserId: null })
    const { user } = renderWithProviders(<SetupPage />)
    await user.type(await screen.findByLabelText('Usuario'), 'dueña')
    await user.type(screen.getByLabelText('Contraseña'), 'clave-larga-1')
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'clave-larga-1')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    await screen.findByText(formatRecoveryCode(0))
    expect(routerMock.replace).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', { name: 'Guardé mi código de recuperación' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(routerMock.replace).toHaveBeenCalledWith('/citas')
  })
})
