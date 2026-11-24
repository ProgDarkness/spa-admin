import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import type { AppError, Resource } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { renderWithProviders } from '@/test/render'
import { DeactivateDialog } from './deactivate-dialog'

const CABIN: Resource = { id: 1, name: 'Cabina 1', kind: 'cabin', active: true }

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function appError(overrides: Partial<AppError>): AppError {
  return { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null, ...overrides }
}

function renderDialog(result: AppError | null, pendingResult?: Promise<AppError | null>) {
  const onConfirm = vi.fn(() => pendingResult ?? Promise.resolve(result))
  const onClose = vi.fn()
  const rendered = renderWithProviders(<DeactivateDialog resource={CABIN} onConfirm={onConfirm} onClose={onClose} />, {
    as: 'propietaria',
  })
  return { onConfirm, onClose, ...rendered }
}

describe('DeactivateDialog', () => {
  it('pide confirmación nombrando el recurso', () => {
    renderDialog(null)

    expect(screen.getByRole('dialog', { name: 'Desactivar Cabina 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cierra tras confirmar con éxito', async () => {
    const { onConfirm, onClose, user } = renderDialog(null)

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('deshabilita Desactivar y Cancelar mientras confirma', async () => {
    const pending = deferred<AppError | null>()
    const { user } = renderDialog(null, pending.promise)

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    pending.resolve(null)
  })

  it('Cancelar cierra sin confirmar', async () => {
    const { onConfirm, onClose, user } = renderDialog(null)

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('con citas futuras muestra el mensaje y lista cada cita a reubicar', async () => {
    const { onClose, user } = renderDialog(
      appError({ code: 'resourceHasFutureAppointments', message: 'Tiene citas futuras', entityIds: [5] }),
    )

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tiene citas futuras')
    const item = await screen.findByRole('listitem')
    expect(within(item).getByText(/Cita #5/)).toBeInTheDocument()
    expect(within(item).getByText(/2026-11-13 16:00/)).toBeInTheDocument()
    expect(within(item).getByText(/Cabina 1/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lista solo las citas cuyos ids vienen en el error', async () => {
    const { user } = renderDialog(
      appError({ code: 'resourceHasFutureAppointments', message: 'Tiene citas futuras', entityIds: [999] }),
    )

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    await screen.findByRole('alert')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('un error distinto muestra solo el mensaje, sin lista, y no cierra', async () => {
    const { onClose, user } = renderDialog(appError({}))

    await user.click(screen.getByRole('button', { name: 'Desactivar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
