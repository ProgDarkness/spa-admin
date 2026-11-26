import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import RestoreFirstRunPage from './page'

const PASSPHRASE = 'frase de prueba larga'
const CONSENT_LABEL = 'Entiendo que se reemplazarán todos los datos actuales'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  commit({ ...getState(), users: [], sessionUserId: null })
  installDevIpc()
  setNextPickedBackup('valid')
})

describe('RestoreFirstRunPage', () => {
  it('muestra el heading y el panel de restauración sin consejo de exportar', async () => {
    renderWithProviders(<RestoreFirstRunPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Restaurar desde un respaldo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Restaurar respaldo' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ir a Exportar respaldo' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al primer arranque' })).toHaveAttribute('href', '/setup')
    await waitFor(() => expect(routerMock.replace).not.toHaveBeenCalled())
  })

  it('al terminar va al login con el aviso', async () => {
    const { user } = renderWithProviders(<RestoreFirstRunPage />)
    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
    await user.click(screen.getByLabelText(CONSENT_LABEL))

    await user.click(screen.getByRole('button', { name: 'Restaurar respaldo' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login?restored=1'))
  })

  it('un respaldo ilegible muestra el error y no redirige', async () => {
    setNextPickedBackup('corrupt')
    const { user } = renderWithProviders(<RestoreFirstRunPage />)
    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
    await user.click(screen.getByLabelText(CONSENT_LABEL))

    await user.click(screen.getByRole('button', { name: 'Restaurar respaldo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('La frase no coincide o el archivo está dañado')
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('redirige al login si el primer arranque ya se completó', async () => {
    resetStore()
    installDevIpc()

    renderWithProviders(<RestoreFirstRunPage />)

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'))
  })
})
