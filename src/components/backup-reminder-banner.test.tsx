import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportBackupPanel } from '@/features/backup/components/export-backup-panel'
import { login } from '@/features/auth/api'
import { exportBackup } from '@/features/backup/api'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { renderWithProviders } from '@/test/render'
import { signInAs } from '@/test/session'
import { BackupReminderBanner } from './backup-reminder-banner'

const PASSPHRASE = 'frase de prueba larga'
const NEVER_EXPORTED_TEXT = 'Aún no has exportado ningún respaldo'
const OVERDUE_TEXT = 'Hace más de 7 días que no exportas un respaldo'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

async function exportOn(at: string): Promise<void> {
  vi.setSystemTime(new Date(at))
  signInAs('propietaria')
  await exportBackup(PASSPHRASE)
}

async function signInAgainAt(at: string): Promise<void> {
  vi.setSystemTime(new Date(at))
  await login('propietaria', DEV_PASSWORD)
}

describe('BackupReminderBanner', () => {
  it('avisa que nunca se exportó un respaldo y enlaza a Respaldo', async () => {
    renderWithProviders(<BackupReminderBanner />, { as: 'propietaria' })

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(NEVER_EXPORTED_TEXT)
    expect(screen.getByRole('link', { name: 'Exportar un respaldo' })).toHaveAttribute('href', '/ajustes/respaldo')
  })

  it('avisa con 7 días cuando el último respaldo está vencido', async () => {
    await exportOn('2026-11-01T09:00')
    await signInAgainAt('2026-11-12T09:00')
    renderWithProviders(<BackupReminderBanner />)

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(OVERDUE_TEXT)
    expect(banner).not.toHaveTextContent(NEVER_EXPORTED_TEXT)
  })

  it('no se muestra con un respaldo reciente', async () => {
    await exportOn('2026-11-10T09:00')
    await signInAgainAt('2026-11-12T09:00')
    const { queryClient } = renderWithProviders(<BackupReminderBanner />)

    await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('success'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('no consulta el estado ni se muestra sin backup.manage', async () => {
    const commands = recordCommands()
    const { container, queryClient } = renderWithProviders(<BackupReminderBanner />, { as: 'recepcion' })

    await waitFor(() => expect(commands).toContain('current_session'))
    expect(container).toBeEmptyDOMElement()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
    expect(commands).not.toContain('get_backup_status')
  })

  it('no se muestra si la consulta del estado falla', async () => {
    failCommand('get_backup_status')
    const { container, queryClient } = renderWithProviders(<BackupReminderBanner />, { as: 'propietaria' })

    await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('error'))
    expect(container).toBeEmptyDOMElement()
  })

  it('desaparece tras exportar un respaldo', async () => {
    const { user } = renderWithProviders(
      <>
        <BackupReminderBanner />
        <ExportBackupPanel />
      </>,
      { as: 'propietaria' },
    )
    await screen.findByText(NEVER_EXPORTED_TEXT)
    await user.type(screen.getByLabelText('Frase del respaldo'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirmar frase'), PASSPHRASE)

    await user.click(screen.getByRole('button', { name: 'Exportar respaldo' }))

    await waitFor(() => expect(screen.queryByText(NEVER_EXPORTED_TEXT)).not.toBeInTheDocument())
    expect(screen.getByText(/spa-respaldo/)).toBeInTheDocument()
  })
})

type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

function internals(): { invoke: InvokeHook } {
  return Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
}

function recordCommands(): string[] {
  const hooks = internals()
  const original = hooks.invoke
  const commands: string[] = []
  hooks.invoke = (cmd, args) => {
    commands.push(cmd)
    return original(cmd, args)
  }
  return commands
}

function failCommand(failing: string): void {
  const hooks = internals()
  const original = hooks.invoke
  hooks.invoke = (cmd, args) => (cmd === failing ? Promise.reject(new Error('IPC roto')) : original(cmd, args))
}
