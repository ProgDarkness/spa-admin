import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecoveryCodePanel } from './recovery-code-panel'

const CODE = 'ABCD-EFGH-IJKL-MNOP-QRST'

function renderPanel(onContinue = vi.fn()) {
  render(<RecoveryCodePanel heading="Tu código de recuperación" code={CODE} onContinue={onContinue} />)
  return { user: userEvent.setup(), onContinue }
}

describe('RecoveryCodePanel', () => {
  it('muestra el código formateado y el aviso de que no volverá a mostrarse', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Tu código de recuperación' })).toHaveFocus()
    expect(screen.getByText(CODE)).toBeInTheDocument()
    expect(screen.getByText(/no volverá a mostrarse/i)).toBeInTheDocument()
  })

  it('setup_requires_confirm_saved_checkbox_before_continue', async () => {
    const { user, onContinue } = renderPanel()
    const continueButton = screen.getByRole('button', { name: 'Continuar' })

    expect(continueButton).toBeDisabled()
    await user.click(continueButton)
    expect(onContinue).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', { name: 'Guardé mi código de recuperación' }))
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('al desmarcar la casilla vuelve a deshabilitar Continuar', async () => {
    const { user } = renderPanel()
    const checkbox = screen.getByRole('checkbox', { name: 'Guardé mi código de recuperación' })

    await user.click(checkbox)
    await user.click(checkbox)

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })

  it('el código se puede seleccionar de una vez', () => {
    renderPanel()

    expect(screen.getByText(CODE)).toHaveClass('select-all')
  })

  it('recovery_panel_never_touches_the_clipboard_and_offers_no_copy_button', async () => {
    const { user } = renderPanel()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const write = vi.spyOn(navigator.clipboard, 'write')

    await user.click(screen.getByText(CODE))
    await user.click(screen.getByRole('checkbox', { name: 'Guardé mi código de recuperación' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.queryByRole('button', { name: /copiar/i })).not.toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(await navigator.clipboard.readText()).toBe('')
  })

  it('indica guardar el código en papel o en un gestor seguro', () => {
    renderPanel()

    expect(screen.getByText(/en papel o en un gestor de contraseñas seguro/i)).toBeInTheDocument()
  })

  it('no copia el código a almacenamiento del navegador', async () => {
    const { user } = renderPanel()
    await user.click(screen.getByRole('checkbox', { name: 'Guardé mi código de recuperación' }))

    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})
