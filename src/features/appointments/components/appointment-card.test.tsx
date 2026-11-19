import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SeedUsername } from '@/lib/mock/seed'
import type { Appointment, AppointmentStatus } from '@/lib/model'
import { buildAppointmentLabels } from '../labels'
import { AppointmentCard } from './appointment-card'

const labels = buildAppointmentLabels(
  [{ id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null }],
  [{ id: 1, name: 'Limpieza facial', priceCents: 1, currency: 'USD', durationMin: 60, active: true }],
  [],
)

function appointmentWith(status: AppointmentStatus): Appointment {
  return {
    id: 7,
    clientId: 1,
    serviceId: 1,
    resourceId: 1,
    startsAt: '2026-11-13T10:00',
    endsAt: '2026-11-13T11:00',
    status,
    priceCentsSnapshot: 3500,
    durationMinSnapshot: 60,
    notes: null,
  }
}

function renderCard(status: AppointmentStatus, canWrite: boolean, as?: SeedUsername) {
  const onCancel = vi.fn()
  const onMove = vi.fn()
  const user = userEvent.setup()
  renderWithProviders(<AppointmentCard appointment={appointmentWith(status)} labels={labels} canWrite={canWrite} onCancel={onCancel} onMove={onMove} />, as ? { as } : {})
  return { onCancel, onMove, user }
}

describe('AppointmentCard', () => {
  it('muestra horario, cliente, servicio y estado', () => {
    renderCard('scheduled', true)

    const card = screen.getByRole('article', { name: 'Cita de María González a las 10:00' })
    expect(card).toHaveTextContent('10:00 – 11:00')
    expect(card).toHaveTextContent('María González')
    expect(card).toHaveTextContent('Limpieza facial')
    expect(card).toHaveTextContent('Programada')
  })

  it.each<AppointmentStatus>(['scheduled', 'inProgress', 'completed', 'cancelled', 'noShow'])('expone data-status=%s en la tarjeta', (status) => {
    renderCard(status, false)

    expect(screen.getByRole('article')).toHaveAttribute('data-status', status)
  })

  it('con permiso de escritura ofrece Cancelar y Mover en una cita programada', async () => {
    const { onCancel, onMove, user } = renderCard('scheduled', true)

    await user.click(screen.getByRole('button', { name: 'Cancelar cita de María González' }))
    await user.click(screen.getByRole('button', { name: 'Mover cita de María González' }))

    expect(onCancel).toHaveBeenCalledWith(appointmentWith('scheduled'))
    expect(onMove).toHaveBeenCalledWith(appointmentWith('scheduled'))
  })

  it('una cita en curso se puede cancelar pero no mover', () => {
    renderCard('inProgress', true)

    expect(screen.getByRole('button', { name: /Cancelar cita/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mover cita/ })).not.toBeInTheDocument()
  })

  it.each<AppointmentStatus>(['completed', 'cancelled', 'noShow'])('una cita %s no ofrece acciones', (status) => {
    renderCard(status, true)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('sin permiso de escritura no ofrece acciones', () => {
    renderCard('scheduled', false)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each<AppointmentStatus>(['scheduled', 'inProgress', 'completed', 'cancelled', 'noShow'])(
    'con permiso de pagos una cita %s muestra el botón Pagos',
    async (status) => {
      renderCard(status, false, 'lectura')

      expect(await screen.findByRole('button', { name: 'Pagos' })).toBeInTheDocument()
    },
  )

  it('el botón Pagos abre el diálogo de pagos de la cita', async () => {
    const { user } = renderCard('completed', false, 'recepcion')

    await user.click(await screen.findByRole('button', { name: 'Pagos' }))

    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
  })

  it('sin permiso de pagos no muestra el botón Pagos', () => {
    renderCard('scheduled', false)

    expect(screen.queryByRole('button', { name: 'Pagos' })).not.toBeInTheDocument()
  })
})
