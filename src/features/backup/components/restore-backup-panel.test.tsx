import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { RequireSession, useSession } from '@/lib/session'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { routerMock } from '@/test/navigation'
import { renderWithProviders, type RenderWithProvidersOptions } from '@/test/render'
import { RestoreBackupPanel } from './restore-backup-panel'

const PASSPHRASE = 'frase de prueba larga'
const CONSENT_LABEL = 'Entiendo que se reemplazarán todos los datos actuales'

type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

function renderPanel(options: RenderWithProvidersOptions = { as: 'propietaria' }) {
  const onRestored = vi.fn()
  const rendered = renderWithProviders(
    <RestoreBackupPanel onRestored={onRestored} advice={<p>consejo de prueba</p>} />,
    options,
  )
  return { ...rendered, onRestored }
}

function SessionStatusProbe() {
  return <p data-testid="session-status">{useSession().status}</p>
}

function restoreButton() {
  return screen.getByRole('button', { name: 'Restaurar respaldo' })
}

async function fill(user: ReturnType<typeof renderPanel>['user'], consent = true) {
  await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
  if (consent) await user.click(screen.getByLabelText(CONSENT_LABEL))
}

describe('RestoreBackupPanel', () => {
  it('advierte que se reemplazan todos los datos y la clave y que no se puede deshacer', () => {
    renderPanel()

    expect(screen.getByRole('heading', { level: 2, name: 'Restaurar respaldo' })).toBeInTheDocument()
    expect(screen.getByText(/reemplaza todos los datos y la clave actuales/)).toBeInTheDocument()
    expect(screen.getByText(/no se puede deshacer/)).toBeInTheDocument()
    expect(screen.getByText('consejo de prueba')).toBeInTheDocument()
  })

  it('mantiene deshabilitado el botón hasta marcar la casilla', async () => {
    const { user } = renderPanel()
    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)

    expect(screen.getByLabelText(CONSENT_LABEL)).not.toBeChecked()
    expect(restoreButton()).toBeDisabled()

    await user.click(screen.getByLabelText(CONSENT_LABEL))
    expect(restoreButton()).toBeEnabled()

    await user.click(screen.getByLabelText(CONSENT_LABEL))
    expect(restoreButton()).toBeDisabled()
  })

  it('no restaura con Enter si la casilla no está marcada', async () => {
    const { user, onRestored } = renderPanel()
    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), `${PASSPHRASE}{Enter}`)

    await waitFor(() => expect(restoreButton()).toBeDisabled())
    expect(getState().sessionUserId).not.toBeNull()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('restaura, termina la sesión y avisa solo en éxito', async () => {
    const { user, onRestored } = renderPanel()
    await fill(user)

    await user.click(restoreButton())

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    expect(getState().sessionUserId).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refresca la sesión tras restaurar para que quede cerrada en el cliente', async () => {
    const onRestored = vi.fn()
    const { user } = renderWithProviders(
      <>
        <RestoreBackupPanel onRestored={onRestored} />
        <SessionStatusProbe />
      </>,
      { as: 'propietaria' },
    )
    await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent('signedIn'))
    await fill(user)

    await user.click(restoreButton())

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent('signedOut'))
  })

  it('dentro de RequireSession va una sola vez al login con el aviso y nunca al login simple', async () => {
    const { user } = renderWithProviders(
      <RequireSession>
        <RestoreBackupPanel />
      </RequireSession>,
      { as: 'propietaria' },
    )
    await user.type(await screen.findByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
    await user.click(screen.getByLabelText(CONSENT_LABEL))

    await user.click(restoreButton())

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login?restored=1'))
    expect(routerMock.replace).not.toHaveBeenCalledWith('/login')
  })

  it('cancelar el diálogo no muestra error, no avisa y conserva la sesión', async () => {
    setNextPickedBackup(null)
    const { user, onRestored } = renderPanel()
    await fill(user)

    await user.click(restoreButton())

    await waitFor(() => expect(restoreButton()).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
    expect(getState().sessionUserId).not.toBeNull()
  })

  it.each([
    ['corrupt', 'La frase no coincide o el archivo está dañado'],
    ['wrongPassphrase', 'La frase no coincide o el archivo está dañado'],
    ['notRecognized', 'El archivo no es un respaldo reconocido'],
    ['future', 'El respaldo fue creado con una versión más nueva de la aplicación'],
  ] as const)('el respaldo %s muestra el mensaje del backend y conserva la sesión', async (pick, message) => {
    setNextPickedBackup(pick)
    const { user, onRestored } = renderPanel()
    await fill(user)

    await user.click(restoreButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onRestored).not.toHaveBeenCalled()
    expect(getState().sessionUserId).not.toBeNull()
  })

  it('rechaza una frase corta sin llamar al backend', async () => {
    const { user, onRestored } = renderPanel()
    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), 'corta')
    await user.click(screen.getByLabelText(CONSENT_LABEL))

    await user.click(restoreButton())

    expect(await screen.findByText('La frase debe tener al menos 12 caracteres')).toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
    expect(getState().sessionUserId).not.toBeNull()
  })

  it('rechaza una frase demasiado larga', async () => {
    const { user } = renderPanel()
    await user.click(screen.getByLabelText('Frase del respaldo a restaurar'))
    await user.paste('a'.repeat(1025))
    await user.click(screen.getByLabelText(CONSENT_LABEL))

    await user.click(restoreButton())

    expect(await screen.findByText('La frase es demasiado larga')).toBeInTheDocument()
  })

  it('deshabilita el botón mientras restaura', async () => {
    const { user, onRestored } = renderPanel()
    await fill(user)
    const pending = deferred<void>()
    const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
    const originalInvoke = internals.invoke
    internals.invoke = async (cmd, args) => {
      if (cmd === 'restore_backup') await pending.promise
      return originalInvoke(cmd, args)
    }

    await user.click(restoreButton())

    expect(await screen.findByRole('button', { name: 'Restaurando…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Restaurando')
    pending.resolve()
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
  })

  it('sin sesión funciona en primer arranque y sin ranura de consejo', async () => {
    commit({ ...getState(), users: [], sessionUserId: null })
    installDevIpc()
    const onRestored = vi.fn()
    const { user } = renderWithProviders(<RestoreBackupPanel onRestored={onRestored} />)
    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), PASSPHRASE)
    await user.click(screen.getByLabelText(CONSENT_LABEL))

    await user.click(restoreButton())

    expect(screen.queryByText('consejo de prueba')).not.toBeInTheDocument()
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
  })

  it('el envío directo del formulario sin la casilla marcada no restaura ni llama al backend', async () => {
    const commandsSeen: string[] = []
    const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
    const originalInvoke = internals.invoke
    internals.invoke = async (cmd, args) => {
      commandsSeen.push(cmd)
      return originalInvoke(cmd, args)
    }
    const { onRestored } = renderPanel()
    const input = screen.getByLabelText('Frase del respaldo a restaurar')
    if (!(input instanceof HTMLInputElement) || !input.form) throw new Error('formulario inexistente')
    fireEvent.change(input, { target: { value: PASSPHRASE } })

    await act(async () => {
      fireEvent.submit(input.form as HTMLFormElement)
      await new Promise((settle) => setTimeout(settle, 0))
    })

    expect(commandsSeen).not.toContain('restore_backup')
    expect(onRestored).not.toHaveBeenCalled()
    expect(getState().sessionUserId).not.toBeNull()
  })

  it('limpia la frase y desmarca la casilla tras restaurar con éxito', async () => {
    const { user } = renderPanel()
    await fill(user)

    await user.click(restoreButton())

    await waitFor(() => expect(getState().sessionUserId).toBeNull())
    expect(screen.getByLabelText('Frase del respaldo a restaurar')).toHaveValue('')
    expect(screen.getByLabelText(CONSENT_LABEL)).not.toBeChecked()
  })

  it('limpia la frase y desmarca la casilla cuando el respaldo falla, y deja el foco en el error', async () => {
    setNextPickedBackup('corrupt')
    const { user } = renderPanel()
    await fill(user)

    await user.click(restoreButton())

    expect(await screen.findByRole('alert')).toHaveFocus()
    expect(screen.getByLabelText('Frase del respaldo a restaurar')).toHaveValue('')
    expect(screen.getByLabelText(CONSENT_LABEL)).not.toBeChecked()
  })

  it('cancelar el diálogo conserva la frase y la casilla', async () => {
    setNextPickedBackup(null)
    const { user } = renderPanel()
    await fill(user)

    await user.click(restoreButton())

    await waitFor(() => expect(restoreButton()).toBeEnabled())
    expect(screen.getByLabelText('Frase del respaldo a restaurar')).toHaveValue(PASSPHRASE)
    expect(screen.getByLabelText(CONSENT_LABEL)).toBeChecked()
  })

  it('la sesión sigue activa en el cliente tras un fallo del respaldo y tras cancelar', async () => {
    setNextPickedBackup('corrupt')
    const { user } = renderWithProviders(
      <>
        <RestoreBackupPanel />
        <SessionStatusProbe />
      </>,
      { as: 'propietaria' },
    )
    await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent('signedIn'))
    await fill(user)
    await user.click(restoreButton())
    await screen.findByRole('alert')

    setNextPickedBackup(null)
    await fill(user, true)
    await user.click(restoreButton())
    await waitFor(() => expect(restoreButton()).toBeEnabled())

    expect(screen.getByTestId('session-status')).toHaveTextContent('signedIn')
  })

  it('al fallar la validación después de un error del backend queda un solo alert', async () => {
    setNextPickedBackup('corrupt')
    const { user } = renderPanel()
    await fill(user)
    await user.click(restoreButton())
    await screen.findByText(/^Error:/)

    await user.type(screen.getByLabelText('Frase del respaldo a restaurar'), 'corta')
    await user.click(screen.getByLabelText(CONSENT_LABEL))
    await user.click(restoreButton())

    await screen.findByText('La frase debe tener al menos 12 caracteres')
    expect(screen.queryByText(/^Error:/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
