import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Appointment, Client, Resource, Service } from '@/lib/model'
import { renderWithProviders } from '@/test/render'
import { buildAppointmentLabels } from '../labels'
import { ResourceColumn } from './resource-column'

const DAY = '2026-11-13'
const activeResource: Resource = { id: 1, name: 'Cabina 1', kind: 'cabin', active: true }
const inactiveResource: Resource = { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false }
const clients: Client[] = [{ id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null }]
const services: Service[] = [{ id: 1, name: 'Limpieza facial', priceCents: 3500, currency: 'USD', durationMin: 60, active: true }]
const labels = buildAppointmentLabels(clients, services, [activeResource, inactiveResource])

function appointmentAt(resourceId: number, time: string, endTime: string): Appointment {
  return {
    id: 1,
    clientId: 1,
    serviceId: 1,
    resourceId,
    startsAt: `${DAY}T${time}`,
    endsAt: `${DAY}T${endTime}`,
    status: 'scheduled',
    priceCentsSnapshot: 3500,
    durationMinSnapshot: 60,
    notes: null,
  }
}

function renderColumn(resource: Resource, appointments: Appointment[], canWrite = true) {
  const onCreateAt = vi.fn()
  renderWithProviders(
    <ResourceColumn
      date={DAY}
      resource={resource}
      appointments={appointments}
      labels={labels}
      canWrite={canWrite}
      onCreateAt={onCreateAt}
      onCancel={vi.fn()}
      onMove={vi.fn()}
    />,
  )
  return { onCreateAt, user: userEvent.setup() }
}

describe('ResourceColumn', () => {
  it('cada franja muestra su hora en un elemento data-slot=hour', () => {
    renderColumn(activeResource, [])

    const slot = screen.getByRole('listitem', { name: 'Franja 10:30' })
    expect(slot.querySelector('[data-slot="hour"]')).toHaveTextContent('10:30')
    expect(document.querySelectorAll('[data-slot="hour"]')).toHaveLength(32)
  })

  it('notifica recurso y hora al crear en un hueco libre', async () => {
    const { onCreateAt, user } = renderColumn(activeResource, [])

    await user.click(screen.getByRole('button', { name: 'Crear cita en Cabina 1 a las 23:30' }))

    expect(onCreateAt).toHaveBeenCalledWith(1, `${DAY}T23:30`)
  })

  it('no ofrece crear en un recurso inactivo aunque tenga permiso de escritura', () => {
    renderColumn(inactiveResource, [appointmentAt(3, '10:00', '11:00')])

    expect(screen.queryByRole('button', { name: /Crear cita/ })).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toBeInTheDocument()
  })

  it('coloca una cita fuera de horario solo en la fila Fuera de horario', () => {
    renderColumn(activeResource, [appointmentAt(1, '07:00', '07:30')])

    const row = screen.getByRole('listitem', { name: 'Fuera de horario' })
    expect(within(row).getByRole('article')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('la columna tiene alto de 32 franjas fijas sin importar las citas', () => {
    renderColumn(activeResource, [appointmentAt(1, '16:00', '17:00')])

    expect(document.querySelector('[data-slot="slot-track"]')).toHaveAttribute('data-slot-count', '32')
    screen.getAllByRole('listitem', { name: /^Franja / }).forEach((slot) => {
      expect(slot).toHaveClass('h-(--slot-height)')
    })
  })

  it('expone la cita como appointment-box con top y alto segun su duracion', () => {
    renderColumn(activeResource, [appointmentAt(1, '16:00', '17:00')])

    const box = document.querySelector<HTMLElement>('[data-slot="appointment-box"]')
    expect(box).not.toBeNull()
    expect(box?.style.top).toBe('calc(var(--slot-height) * 16)')
    expect(box?.style.height).toBe('calc(var(--slot-height) * 2)')
    expect(within(box as HTMLElement).getByRole('article')).toBeInTheDocument()
  })

  it('dos cabinas con citas distintas comparten la misma cantidad de franjas', () => {
    renderColumn(activeResource, [appointmentAt(1, '16:30', '17:00')])
    expect(screen.getAllByRole('listitem', { name: /^Franja / })).toHaveLength(32)
  })

  it('el boton crear solo se revela con hover o foco', () => {
    renderColumn(activeResource, [])

    const button = screen.getByRole('button', { name: 'Crear cita en Cabina 1 a las 10:30' })
    expect(button).toHaveAttribute('data-reveal', 'hover')
    expect(button.className).toContain('[@media(hover:hover)]:opacity-0')
    expect(button.className).toContain('group-hover:opacity-100')
    expect(button.className).toContain('focus-visible:opacity-100')
    expect(screen.getByRole('listitem', { name: 'Franja 10:30' })).toHaveClass('group')
  })
})
