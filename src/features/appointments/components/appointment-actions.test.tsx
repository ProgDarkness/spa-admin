import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Appointment, AppointmentStatus } from '@/lib/model'
import {
  DAY,
  appointmentById,
  appointmentTemplate,
  resetWithEmptyAgenda,
  seedAppointments,
} from '@/test/appointment-fixtures'
import { renderWithProviders } from '@/test/render'
import type { SeedUsername } from '@/lib/mock/seed'
import { AppointmentActions } from './appointment-actions'

const CLIENT = 'María González'
const PAST_START = '2026-11-12T08:00'
const PAST_END = '2026-11-12T09:00'

beforeEach(resetWithEmptyAgenda)

function renderActions(appointment: Appointment, options: { as?: SeedUsername; canWrite?: boolean } = {}) {
  seedAppointments(appointment)
  const onCancel = vi.fn()
  const rendered = renderWithProviders(
    <AppointmentActions appointment={appointment} clientName={CLIENT} canWrite={options.canWrite ?? true} onCancel={onCancel} />,
    { as: options.as ?? 'recepcion' },
  )
  return { ...rendered, onCancel }
}

const buttonNames = () => screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label'))

describe('AppointmentActions', () => {
  it('scheduled ya iniciada ofrece Iniciar, Completar, No asistió y Cancelar', async () => {
    renderActions(appointmentTemplate({ startsAt: PAST_START, endsAt: PAST_END }))

    expect(await screen.findByRole('button', { name: `Iniciar cita de ${CLIENT}` })).toBeInTheDocument()
    expect(buttonNames()).toEqual([
      `Iniciar cita de ${CLIENT}`,
      `Completar cita de ${CLIENT}`,
      `Marcar no asistió cita de ${CLIENT}`,
      `Cancelar cita de ${CLIENT}`,
    ])
  })

  it('scheduled futura no ofrece Completar', () => {
    renderActions(appointmentTemplate())

    expect(screen.queryByRole('button', { name: /Completar/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Iniciar/ })).toBeInTheDocument()
  })

  it('Iniciar mueve la cita a inProgress en el store', async () => {
    const { user } = renderActions(appointmentTemplate({ id: 5 }))

    await user.click(screen.getByRole('button', { name: `Iniciar cita de ${CLIENT}` }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('inProgress'))
  })

  it('Completar desde scheduled iniciada cierra la cita', async () => {
    const { user } = renderActions(appointmentTemplate({ id: 5, startsAt: PAST_START, endsAt: PAST_END }))

    await user.click(screen.getByRole('button', { name: `Completar cita de ${CLIENT}` }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('completed'))
  })

  it('No asistió marca noShow', async () => {
    const { user } = renderActions(appointmentTemplate({ id: 5 }))

    await user.click(screen.getByRole('button', { name: `Marcar no asistió cita de ${CLIENT}` }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('noShow'))
  })

  it('Cancelar delega en onCancel sin tocar el store', async () => {
    const appointment = appointmentTemplate({ id: 5 })
    const { user, onCancel } = renderActions(appointment)

    await user.click(screen.getByRole('button', { name: `Cancelar cita de ${CLIENT}` }))

    expect(onCancel).toHaveBeenCalledWith(appointment)
    expect((await appointmentById(5)).status).toBe('scheduled')
  })

  it('inProgress ofrece Completar y Cancelar', () => {
    renderActions(appointmentTemplate({ status: 'inProgress' }))

    expect(buttonNames()).toEqual([`Completar cita de ${CLIENT}`, `Cancelar cita de ${CLIENT}`])
  })

  it.each<AppointmentStatus>(['completed', 'cancelled', 'noShow'])('%s no ofrece acciones a recepción', (status) => {
    renderActions(appointmentTemplate({ status }))

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each<AppointmentStatus>(['completed', 'cancelled', 'noShow'])('%s ofrece solo Reabrir a la propietaria', async (status) => {
    renderActions(appointmentTemplate({ status }), { as: 'propietaria' })

    expect(await screen.findByRole('button', { name: `Reabrir cita de ${CLIENT}` })).toBeInTheDocument()
    expect(buttonNames()).toEqual([`Reabrir cita de ${CLIENT}`])
  })

  it('recepción no ve Reabrir', () => {
    renderActions(appointmentTemplate({ status: 'cancelled' }), { as: 'recepcion' })

    expect(screen.queryByRole('button', { name: /Reabrir/ })).not.toBeInTheDocument()
  })

  it('lectura no ve ningún botón', () => {
    renderActions(appointmentTemplate(), { as: 'lectura', canWrite: false })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('Reabrir devuelve la cita a scheduled', async () => {
    const { user } = renderActions(appointmentTemplate({ id: 5, status: 'cancelled' }), { as: 'propietaria' })

    await user.click(await screen.findByRole('button', { name: `Reabrir cita de ${CLIENT}` }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('scheduled'))
  })

  it('Reabrir con la franja ocupada muestra el error y las citas en conflicto en un alert', async () => {
    const reopening = appointmentTemplate({ id: 5, status: 'cancelled', startsAt: `${DAY}T12:00`, endsAt: `${DAY}T13:00` })
    const occupant = appointmentTemplate({ id: 6, startsAt: `${DAY}T12:00`, endsAt: `${DAY}T13:00` })
    seedAppointments(reopening, occupant)
    const { user } = renderWithProviders(
      <AppointmentActions appointment={reopening} clientName={CLIENT} canWrite onCancel={vi.fn()} />,
      { as: 'propietaria' },
    )

    await user.click(await screen.findByRole('button', { name: `Reabrir cita de ${CLIENT}` }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('El recurso ya tiene una cita en ese horario')
    expect(alert).toHaveTextContent('#6')
    expect((await appointmentById(5)).status).toBe('cancelled')
  })
})
