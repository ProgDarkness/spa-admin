import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AppError, PaymentMethod } from '@/lib/model'
import { deferred } from '@/test/deferred'
import { DeactivateDialog } from './deactivate-dialog'

const ZELLE: PaymentMethod = { id: 3, name: 'Zelle', active: true }

function appError(overrides: Partial<AppError> = {}): AppError {
  return { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null, ...overrides }
}

function renderDialog(onConfirm: () => Promise<AppError | null>) {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<DeactivateDialog paymentMethod={ZELLE} onConfirm={onConfirm} onClose={onClose} />)
  return { onClose, user }
}

describe('DeactivateDialog de métodos de pago', () => {
  it('pide confirmación nombrando el método', () => {
    renderDialog(vi.fn().mockResolvedValue(null))

    expect(screen.getByRole('dialog', { name: 'Desactivar Zelle' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cierra tras confirmar con éxito', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null)
    const { onClose, user } = renderDialog(onConfirm)

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('con fallo permanece abierto y muestra la alerta', async () => {
    const { onClose, user } = renderDialog(vi.fn().mockResolvedValue(appError()))

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancelar cierra sin confirmar', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null)
    const { onClose, user } = renderDialog(onConfirm)

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('deshabilita Desactivar y Cancelar mientras confirma', async () => {
    const pending = deferred<AppError | null>()
    const { user } = renderDialog(() => pending.promise)

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    pending.resolve(null)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desactivar' })).toBeEnabled())
  })
})
