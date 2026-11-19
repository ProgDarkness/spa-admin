import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Appointment, Client, Resource, Service } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { buildAppointmentLabels } from '../labels'
import { WeekDaySection } from './week-day-section'

const DAY = '2026-11-10'
const resources: Resource[] = [{ id: 1, name: 'Cabina 1', kind: 'cabin', active: true }]
const clients: Client[] = [{ id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null }]
const services: Service[] = [{ id: 1, name: 'Limpieza facial', priceCents: 3500, currency: 'USD', durationMin: 60, active: true }]
const labels = buildAppointmentLabels(clients, services, resources)

function appointment(id: number, time: string): Appointment {
  return {
    id,
    clientId: 1,
    serviceId: 1,
    resourceId: 1,
    startsAt: `${DAY}T${time}`,
    endsAt: `${DAY}T${time}`,
    status: 'scheduled',
    priceCentsSnapshot: 3500,
    durationMinSnapshot: 60,
    notes: null,
  }
}

function renderSection(appointments: Appointment[]) {
  const onCancel = vi.fn()
  renderWithProviders(
    <WeekDaySection day={DAY} appointments={appointments} labels={labels} canWrite onCancel={onCancel} onMove={vi.fn()} />,
  )
  return { onCancel, user: userEvent.setup() }
}

describe('WeekDaySection', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dibuja la línea de ahora cuando la sección es hoy', () => {
    freezeDate(`${DAY}T10:15`)
    renderSection([])

    const line = document.querySelector('[data-now-line]')
    expect(line).not.toBeNull()
    expect(line).toHaveAttribute('role', 'presentation')
  })

  it('no dibuja la línea de ahora cuando la sección no es hoy', () => {
    freezeDate('2026-11-11T10:15')
    renderSection([])

    expect(document.querySelector('[data-now-line]')).toBeNull()
  })

  it('muestra el día como encabezado de nivel 2 y Sin citas cuando está vacío', () => {
    renderSection([])

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/martes/i)
    expect(screen.getByText('Sin citas')).toBeInTheDocument()
  })

  it('ordena las citas por hora y separa las de fuera de horario', () => {
    renderSection([appointment(1, '15:00'), appointment(2, '06:15'), appointment(3, '09:00')])

    const names = screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))
    expect(names).toEqual([
      'Cita de María González a las 09:00',
      'Cita de María González a las 15:00',
      'Cita de María González a las 06:15',
    ])
    const group = within(screen.getByRole('group', { name: 'Fuera de horario' }))
    expect(group.getAllByRole('article')).toHaveLength(1)
  })

  it('reenvía Cancelar', async () => {
    const { onCancel, user } = renderSection([appointment(1, '10:00')])

    await user.click(screen.getByRole('button', { name: 'Cancelar cita de María González' }))

    expect(onCancel).toHaveBeenCalledWith(appointment(1, '10:00'))
  })
})
