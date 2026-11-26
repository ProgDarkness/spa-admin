import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { routerMock } from '@/test/navigation'
import { RequireSession } from '@/lib/session'
import { renderWithProviders } from '@/test/render'
import BackupPage from './page'

const PASSPHRASE = 'frase de prueba larga'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

describe('BackupPage', () => {
  it('muestra el heading y los paneles Exportar y Restaurar', async () => {
    renderWithProviders(<BackupPage />, { as: 'propietaria' })

    expect(await screen.findByRole('heading', { level: 2, name: 'Exportar respaldo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Respaldo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Restaurar respaldo' })).toBeInTheDocument()
    expect(document.getElementById('exportar')).toContainElement(screen.getByRole('heading', { name: 'Exportar respaldo' }))
  })

  it('en Restaurar recomienda exportar antes y muestra el último respaldo', async () => {
    renderWithProviders(<BackupPage />, { as: 'propietaria' })

    const restore = (await screen.findByRole('heading', { name: 'Restaurar respaldo' })).closest('section') as HTMLElement
    expect(within(restore).getByRole('link', { name: 'Ir a Exportar respaldo' })).toHaveAttribute('href', '#exportar')
    expect(await within(restore).findByText('Aún no has exportado ningún respaldo')).toBeInTheDocument()
  })

  it('exportar actualiza el último respaldo mostrado en Restaurar', async () => {
    const { user } = renderWithProviders(<BackupPage />, { as: 'propietaria' })
    await user.type(await screen.findByLabelText('Frase del respaldo'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirmar frase'), PASSPHRASE)

    await user.click(screen.getByRole('button', { name: 'Exportar respaldo' }))

    expect(await screen.findByText('Último respaldo: 12/11/2026 09:00')).toBeInTheDocument()
  })

  it('tras restaurar con éxito va al login con el aviso y nunca al login simple', async () => {
    const { user } = renderWithProviders(
      <RequireSession>
        <BackupPage />
      </RequireSession>,
      { as: 'propietaria' },
    )
    await user.type(await screen.findByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
    await user.click(screen.getByLabelText('Entiendo que se reemplazarán todos los datos actuales'))

    await user.click(screen.getByRole('button', { name: 'Restaurar respaldo' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login?restored=1'))
    expect(routerMock.replace).not.toHaveBeenCalledWith('/login')
  })

  it('si la restauración falla no redirige y muestra el error', async () => {
    setNextPickedBackup('corrupt')
    const { user } = renderWithProviders(<BackupPage />, { as: 'propietaria' })
    await user.type(await screen.findByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
    await user.click(screen.getByLabelText('Entiendo que se reemplazarán todos los datos actuales'))

    await user.click(screen.getByRole('button', { name: 'Restaurar respaldo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('La frase no coincide o el archivo está dañado')
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('sin backup.manage muestra el aviso de permiso y no los paneles', async () => {
    renderWithProviders(<BackupPage />, { as: 'recepcion' })
    await act(async () => {})

    expect(screen.getByText('No tienes permiso para gestionar respaldos.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Exportar respaldo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Restaurar respaldo' })).not.toBeInTheDocument()
  })
})
