import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayLocal } from '@/lib/datetime'
import { createSeed } from '@/lib/mock/seed'
import { getState, resetStore } from '@/lib/mock/store'
import type { AppError, Appointment } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { buildAppointmentLabels } from '../labels'
import { MoveDialog } from './move-dialog'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function scheduledAppointment(): Appointment {
  const found = createSeed(todayLocal()).appointments.find((row) => row.id === 5)
  if (!found) throw new Error('Cita seed 5 inexistente')
  return found
}

function renderDialog(result: AppError | null = null) {
  const onSubmit = vi.fn().mockResolvedValue(result)
  const onClose = vi.fn()
  const state = getState()
  const labels = buildAppointmentLabels(state.clients, state.services, state.resources)
  const rendered = renderWithProviders(
    <MoveDialog appointment={scheduledAppointment()} labels={labels} onSubmit={onSubmit} onClose={onClose} />,
    { as: 'recepcion' },
  )
  return { onSubmit, onClose, ...rendered }
}

describe('MoveDialog', () => {
  it('titula el diálogo con el cliente y precarga recurso y hora actuales', async () => {
    renderDialog()

    expect(await screen.findByRole('dialog', { name: 'Mover cita de Luis Martínez' })).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Cabina 2' })
    await waitFor(() => expect(screen.getByLabelText('Recurso')).toHaveValue('1'))
    expect(screen.getByLabelText('Fecha y hora')).toHaveValue('2026-11-13T16:00')
  })

  it('no ofrece recursos inactivos', async () => {
    renderDialog()
    await screen.findByRole('option', { name: 'Cabina 2' })

    const names = within(screen.getByLabelText('Recurso')).getAllByRole('option').map((option) => option.textContent)
    expect(names).not.toContain('Manicure (Rosa)')
  })

  it('envía el movimiento y cierra al tener éxito', async () => {
    const { onSubmit, onClose, user } = renderDialog()
    await screen.findByRole('option', { name: 'Cabina 2' })

    await user.selectOptions(screen.getByLabelText('Recurso'), 'Cabina 2')
    fireEvent.change(screen.getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T11:30' } })
    await user.click(screen.getByRole('button', { name: 'Mover' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ resourceId: 2, startsAt: '2026-11-13T11:30' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('valida la hora y no envía', async () => {
    const { onSubmit, user } = renderDialog()
    await screen.findByRole('option', { name: 'Cabina 2' })

    fireEvent.change(screen.getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T11:31' } })
    await user.click(screen.getByRole('button', { name: 'Mover' }))

    expect(await screen.findByText('La hora debe estar en bloques de 5 minutos')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('muestra el solape sin cerrar el diálogo', async () => {
    const { onClose, user } = renderDialog({
      code: 'overlap',
      message: 'El recurso ya tiene una cita en ese horario',
      field: 'startsAt',
      entityIds: [12],
    })
    await screen.findByRole('option', { name: 'Cabina 2' })

    await user.click(screen.getByRole('button', { name: 'Mover' }))

    expect(await screen.findByText('El recurso ya tiene una cita en ese horario')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Citas en conflicto: #12')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancelar cierra sin enviar', async () => {
    const { onSubmit, onClose, user } = renderDialog()

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('tiene descripción accesible y no emite avisos de Radix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderDialog()

    expect(await screen.findByRole('dialog', { name: 'Mover cita de Luis Martínez' })).toHaveAccessibleDescription(
      'Elige el nuevo recurso y la nueva hora.',
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
