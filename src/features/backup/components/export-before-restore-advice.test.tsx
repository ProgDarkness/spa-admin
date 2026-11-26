import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { renderWithProviders } from '@/test/render'
import { exportBackup } from '../api'
import { ExportBeforeRestoreAdvice } from './export-before-restore-advice'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

describe('ExportBeforeRestoreAdvice', () => {
  it('recomienda exportar antes y enlaza al panel Exportar', async () => {
    renderWithProviders(<ExportBeforeRestoreAdvice />, { as: 'propietaria' })

    expect(screen.getByText(/Te recomendamos exportar un respaldo antes de restaurar/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a Exportar respaldo' })).toHaveAttribute('href', '#exportar')
  })

  it('indica que nunca se exportó un respaldo', async () => {
    renderWithProviders(<ExportBeforeRestoreAdvice />, { as: 'propietaria' })

    expect(await screen.findByText('Aún no has exportado ningún respaldo')).toBeInTheDocument()
  })

  it('muestra la fecha y hora del último respaldo', async () => {
    await exportBackupAs('propietaria')
    renderWithProviders(<ExportBeforeRestoreAdvice />, { as: 'propietaria' })

    expect(await screen.findByText('Último respaldo: 12/11/2026 09:00')).toBeInTheDocument()
  })

  it('sin permiso de consulta no muestra el último respaldo ni falla', async () => {
    renderWithProviders(<ExportBeforeRestoreAdvice />, { as: 'recepcion' })

    expect(screen.getByRole('link', { name: 'Ir a Exportar respaldo' })).toBeInTheDocument()
    expect(screen.queryByText(/Último respaldo|Aún no has exportado/)).not.toBeInTheDocument()
  })
})

async function exportBackupAs(username: 'propietaria'): Promise<void> {
  const { signInAs } = await import('@/test/session')
  signInAs(username)
  await exportBackup('frase de prueba larga')
}
