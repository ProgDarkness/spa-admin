import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appointmentTemplate, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { renderWithProviders } from '@/test/render'
import { AppointmentActions } from './appointment-actions'

const CLIENT = 'María González'

beforeEach(() => {
  resetWithEmptyAgenda()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 10, 12, 9, 59, 40))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AppointmentActions al llegar la hora', () => {
  it('muestra Completar sin nuevo render externo cuando llega la hora de inicio', () => {
    const appointment = appointmentTemplate({ startsAt: '2026-11-12T10:00', endsAt: '2026-11-12T11:00' })
    seedAppointments(appointment)
    renderWithProviders(
      <AppointmentActions appointment={appointment} clientName={CLIENT} canWrite onCancel={vi.fn()} />,
      { as: 'recepcion' },
    )
    expect(screen.queryByRole('button', { name: `Completar cita de ${CLIENT}` })).not.toBeInTheDocument()

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 12, 10, 0, 10))
      vi.advanceTimersByTime(30_000)
    })

    expect(screen.getByRole('button', { name: `Completar cita de ${CLIENT}` })).toBeInTheDocument()
  })
})
