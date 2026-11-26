import { act, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportBackupPanel } from '@/features/backup/components/export-backup-panel'
import { login } from '@/features/auth/api'
import { exportBackup } from '@/features/backup/api'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { setPathname } from '@/test/navigation'
import { deferred } from '@/test/deferred'
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

    expect(await screen.findByText(NEVER_EXPORTED_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(NEVER_EXPORTED_TEXT)
    expect(screen.getByRole('link', { name: 'Exportar un respaldo' })).toHaveAttribute('href', '/ajustes/respaldo')
  })

  it('avisa con 7 días cuando el último respaldo está vencido', async () => {
    await exportOn('2026-11-01T09:00')
    await signInAgainAt('2026-11-12T09:00')
    renderWithProviders(<BackupReminderBanner />)

    expect(await screen.findByText(OVERDUE_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent(NEVER_EXPORTED_TEXT)
  })

  it('no se muestra con un respaldo reciente', async () => {
    await exportOn('2026-11-10T09:00')
    await signInAgainAt('2026-11-12T09:00')
    const { queryClient } = renderWithProviders(<BackupReminderBanner />)

    await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('success'))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('monta la región de estado vacía antes de saber si hay aviso y le añade el texto después', async () => {
    renderWithProviders(<BackupReminderBanner />, { as: 'propietaria' })
    const region = await screen.findByRole('status')
    expect(region).toBeEmptyDOMElement()

    await screen.findByText(NEVER_EXPORTED_TEXT)

    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent(NEVER_EXPORTED_TEXT)
  })

  it.each(['/ajustes/respaldo', '/ajustes/respaldo/'])('no muestra el aviso dentro de %s porque ya está en la pantalla', async (pathname) => {
    setPathname(pathname)
    const { queryClient } = renderWithProviders(<BackupReminderBanner />, { as: 'propietaria' })

    expect(await screen.findByRole('status')).toBeEmptyDOMElement()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
    expect(screen.queryByRole('link', { name: 'Exportar un respaldo' })).not.toBeInTheDocument()
  })

  it('sí lo muestra en otras pantallas de ajustes', async () => {
    setPathname('/ajustes/tasas')
    renderWithProviders(<BackupReminderBanner />, { as: 'propietaria' })

    expect(await screen.findByText(NEVER_EXPORTED_TEXT)).toBeInTheDocument()
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
    const { queryClient } = renderWithProviders(<BackupReminderBanner />, { as: 'propietaria' })

    await waitFor(() => expect(queryClient.getQueryCache().findAll()[0]?.state.status).toBe('error'))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
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

function LockableShell() {
  const [isLocked, setIsLocked] = useState(false)
  return (
    <>
      <button onClick={() => setIsLocked((previous) => !previous)}>alternar bloqueo</button>
      {isLocked ? <p>pantalla bloqueada</p> : (
        <>
          <BackupReminderBanner />
          <ExportBackupPanel />
        </>
      )}
    </>
  )
}

describe('exportación en vuelo durante un bloqueo de sesión', () => {
  it('al volver a la pantalla el aviso refleja el respaldo que terminó mientras estaba bloqueada', async () => {
    const pending = deferred<void>()
    const hooks = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
    const original = hooks.invoke
    hooks.invoke = async (cmd, args) => {
      if (cmd === 'export_backup') await pending.promise
      return original(cmd, args)
    }
    const { user, queryClient } = renderWithProviders(<LockableShell />, { as: 'propietaria' })
    await screen.findByText(NEVER_EXPORTED_TEXT)
    await user.type(screen.getByLabelText('Frase del respaldo'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirmar frase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Exportar respaldo' }))

    await user.click(screen.getByRole('button', { name: 'alternar bloqueo' }))
    act(() => queryClient.clear())
    await user.click(screen.getByRole('button', { name: 'alternar bloqueo' }))
    await screen.findByText(NEVER_EXPORTED_TEXT)
    await act(async () => {
      pending.resolve()
    })

    await waitFor(() => expect(screen.queryByText(NEVER_EXPORTED_TEXT)).not.toBeInTheDocument())
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
