import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { renderWithProviders } from '@/test/render'
import { ExportBackupPanel } from './export-backup-panel'

const PASSPHRASE = 'frase de prueba larga'
const LOST_PASSPHRASE_WARNING = 'Si pierdes la frase, el respaldo no se puede recuperar'

type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

function renderPanel() {
  return renderWithProviders(<ExportBackupPanel />, { as: 'propietaria' })
}

async function fill(user: ReturnType<typeof renderPanel>['user'], passphrase = PASSPHRASE, confirmation = PASSPHRASE) {
  await user.type(screen.getByLabelText('Frase del respaldo'), passphrase)
  await user.type(screen.getByLabelText('Confirmar frase'), confirmation)
}

function exportButton() {
  return screen.getByRole('button', { name: 'Exportar respaldo' })
}

describe('ExportBackupPanel', () => {
  it('muestra campos etiquetados y el aviso de frase perdida', () => {
    renderPanel()

    expect(screen.getByRole('heading', { level: 2, name: 'Exportar respaldo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Frase del respaldo')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Confirmar frase')).toHaveAttribute('type', 'password')
    expect(screen.getByText(LOST_PASSPHRASE_WARNING, { exact: false })).toBeInTheDocument()
  })

  it('exporta y muestra el nombre del archivo y la hora', async () => {
    const { user } = renderPanel()
    await fill(user)

    await user.click(exportButton())

    const status = await screen.findByText(/spa-respaldo-2026-11-12-0900\.spabak/)
    expect(status).toHaveTextContent('12/11/2026 09:00')
    expect(status.closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getState().sessionUserId).not.toBeNull()
  })

  it('limpia la frase tras exportar', async () => {
    const { user } = renderPanel()
    await fill(user)

    await user.click(exportButton())

    await screen.findByText(/spa-respaldo/)
    expect(screen.getByLabelText('Frase del respaldo')).toHaveValue('')
    expect(screen.getByLabelText('Confirmar frase')).toHaveValue('')
  })

  it('cancelar el diálogo no muestra error ni éxito y conserva la frase', async () => {
    setNextPickedBackup(null)
    const { user } = renderPanel()
    await fill(user)

    await user.click(exportButton())

    await waitFor(() => expect(exportButton()).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/spa-respaldo/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('Frase del respaldo')).toHaveValue(PASSPHRASE)
  })

  it('rechaza una frase corta sin llamar al backend', async () => {
    const { user } = renderPanel()
    await fill(user, 'corta', 'corta')

    await user.click(exportButton())

    expect(await screen.findByText('La frase debe tener al menos 12 caracteres')).toBeInTheDocument()
    expect(getState().sessionUserId).not.toBeNull()
    expect(screen.queryByText(/spa-respaldo/)).not.toBeInTheDocument()
  })

  it('rechaza una frase demasiado larga', async () => {
    const { user } = renderPanel()
    const tooLong = 'a'.repeat(1025)
    await user.click(screen.getByLabelText('Frase del respaldo'))
    await user.paste(tooLong)
    await user.click(screen.getByLabelText('Confirmar frase'))
    await user.paste(tooLong)

    await user.click(exportButton())

    expect(await screen.findByText('La frase es demasiado larga')).toBeInTheDocument()
  })

  it('rechaza una confirmación distinta', async () => {
    const { user } = renderPanel()
    await fill(user, PASSPHRASE, `${PASSPHRASE}x`)

    await user.click(exportButton())

    expect(await screen.findByText('Las frases no coinciden')).toBeInTheDocument()
    expect(screen.queryByText(/spa-respaldo/)).not.toBeInTheDocument()
  })

  it('deshabilita el botón mientras exporta y lo habilita al terminar', async () => {
    const { user } = renderPanel()
    await fill(user)
    const pending = deferred<void>()
    const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
    const originalInvoke = internals.invoke
    internals.invoke = async (cmd, args) => {
      if (cmd === 'export_backup') await pending.promise
      return originalInvoke(cmd, args)
    }

    await user.click(exportButton())

    expect(await screen.findByRole('button', { name: 'Exportando…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Exportando')
    pending.resolve()
    await screen.findByText(/spa-respaldo/)
    expect(exportButton()).toBeEnabled()
  })

  it('muestra el error del backend con rol alert y retira el éxito previo', async () => {
    const { user } = renderPanel()
    await fill(user)
    await user.click(exportButton())
    await screen.findByText(/spa-respaldo/)
    commit({ ...getState(), sessionUserId: null })
    await fill(user)

    await user.click(exportButton())

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/spa-respaldo/)).not.toBeInTheDocument()
  })

  it('limpia la frase y la confirmación también cuando el backend falla', async () => {
    const { user } = renderPanel()
    await fill(user)
    commit({ ...getState(), sessionUserId: null })

    await user.click(exportButton())

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Frase del respaldo')).toHaveValue('')
    expect(screen.getByLabelText('Confirmar frase')).toHaveValue('')
  })

  it('un error del backend recibe el foco para que se anuncie', async () => {
    const { user } = renderPanel()
    await fill(user)
    commit({ ...getState(), sessionUserId: null })

    await user.click(exportButton())

    expect(await screen.findByRole('alert')).toHaveFocus()
  })

  it('al fallar la validación después de un error del backend queda un solo alert', async () => {
    const { user } = renderPanel()
    await fill(user)
    commit({ ...getState(), sessionUserId: null })
    await user.click(exportButton())
    await screen.findByText(/^Error:/)

    await fill(user, 'corta', 'corta')
    await user.click(exportButton())

    await screen.findByText('La frase debe tener al menos 12 caracteres')
    expect(screen.queryByText(/^Error:/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('el envío directo del formulario con una frase corta no llama al backend', async () => {
    renderPanel()
    const input = screen.getByLabelText('Frase del respaldo')
    if (!(input instanceof HTMLInputElement) || !input.form) throw new Error('formulario inexistente')
    fireEvent.change(input, { target: { value: 'corta' } })

    fireEvent.submit(input.form)

    await screen.findByText('La frase debe tener al menos 12 caracteres')
    expect(screen.queryByText(/spa-respaldo/)).not.toBeInTheDocument()
    expect(getState().sessionUserId).not.toBeNull()
  })
})
