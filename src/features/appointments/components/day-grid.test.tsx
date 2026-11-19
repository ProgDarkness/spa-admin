import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Appointment, Client, Resource, Service } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { buildAppointmentLabels } from '../labels'
import { DayGrid } from './day-grid'

const DAY = '2026-11-13'

const resources: Resource[] = [
  { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
  { id: 2, name: 'Cabina 2', kind: 'cabin', active: true },
  { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
]
const clients: Client[] = [{ id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null }]
const services: Service[] = [{ id: 1, name: 'Limpieza facial', priceCents: 3500, currency: 'USD', durationMin: 60, active: true }]
const labels = buildAppointmentLabels(clients, services, resources)

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 1,
    clientId: 1,
    serviceId: 1,
    resourceId: 1,
    startsAt: `${DAY}T10:00`,
    endsAt: `${DAY}T11:00`,
    status: 'scheduled',
    priceCentsSnapshot: 3500,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

function renderGrid(appointments: Appointment[], canWrite = true) {
  const onCreateAt = vi.fn()
  const onCancel = vi.fn()
  const onMove = vi.fn()
  const user = userEvent.setup()
  renderWithProviders(
    <DayGrid
      date={DAY}
      resources={resources}
      appointments={appointments}
      labels={labels}
      canWrite={canWrite}
      onCreateAt={onCreateAt}
      onCancel={onCancel}
      onMove={onMove}
    />,
  )
  return { onCreateAt, onCancel, onMove, user }
}

describe('DayGrid', () => {
  it('permite scroll horizontal con snap y columnas con ancho mínimo', () => {
    renderGrid([appointment()])

    const column = screen.getByRole('region', { name: 'Recurso Cabina 1' })
    const container = column.parentElement
    expect(container).toHaveClass('overflow-x-auto', 'snap-x', 'snap-mandatory')
    expect(column).toHaveClass('snap-start', 'min-w-[80%]', 'md:min-w-56')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('dibuja la línea de ahora solo en la franja actual de hoy', () => {
    freezeDate(`${DAY}T10:15`)
    renderGrid([])

    const lines = document.querySelectorAll('[data-now-line]')
    expect(lines.length).toBeGreaterThan(0)
    lines.forEach((line) => expect(line).toHaveAttribute('role', 'presentation'))
    const column = within(screen.getByRole('region', { name: 'Recurso Cabina 1' }))
    expect(column.getByRole('listitem', { name: 'Franja 10:00' }).querySelector('[data-now-line]')).not.toBeNull()
    expect(column.getByRole('listitem', { name: 'Franja 10:30' }).querySelector('[data-now-line]')).toBeNull()
    expect(column.getByRole('listitem', { name: 'Franja 09:30' }).querySelector('[data-now-line]')).toBeNull()
  })

  it('no dibuja la línea de ahora cuando el día mostrado no es hoy', () => {
    freezeDate('2026-11-14T10:15')
    renderGrid([])

    expect(document.querySelector('[data-now-line]')).toBeNull()
  })

  it('muestra una columna por recurso activo y omite el inactivo sin citas', () => {
    renderGrid([])

    expect(screen.getByRole('region', { name: 'Recurso Cabina 1' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recurso Cabina 2' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recurso Manicure (Rosa)' })).not.toBeInTheDocument()
  })

  it('muestra el recurso inactivo si tiene citas ese día', () => {
    renderGrid([appointment({ resourceId: 3 })])

    expect(screen.getByRole('region', { name: 'Recurso Manicure (Rosa)' })).toBeInTheDocument()
  })

  it('cada columna tiene 32 franjas de 08:00 a 23:30', () => {
    renderGrid([])

    const slots = within(screen.getByRole('region', { name: 'Recurso Cabina 1' })).getAllByRole('listitem')
    expect(slots).toHaveLength(32)
    expect(slots[0]).toHaveAccessibleName('Franja 08:00')
    expect(slots[31]).toHaveAccessibleName('Franja 23:30')
  })

  it('una cita de las 23:00 se muestra en su propia franja', () => {
    renderGrid([appointment({ startsAt: `${DAY}T23:00`, endsAt: `${DAY}T23:30` })])

    const box = screen.getByRole('region', { name: 'Recurso Cabina 1' }).querySelector<HTMLElement>('[data-slot="appointment-box"]')
    expect(box?.style.top).toBe('calc(var(--slot-height) * 30)')
    expect(within(box as HTMLElement).getByRole('article')).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: 'Fuera de horario' })).not.toBeInTheDocument()
  })

  it('agrupa las citas anteriores a las 08:00 en la fila Fuera de horario sin ofrecer crear', () => {
    renderGrid([appointment({ startsAt: `${DAY}T06:15`, endsAt: `${DAY}T07:00` })])

    const column = within(screen.getByRole('region', { name: 'Recurso Cabina 1' }))
    const row = column.getByRole('listitem', { name: 'Fuera de horario' })
    expect(within(row).getByRole('article')).toHaveTextContent('María González')
    expect(within(column.getByRole('listitem', { name: 'Franja 08:00' })).queryByRole('article')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Crear cita/ })).not.toBeInTheDocument()
  })

  it('no muestra la fila Fuera de horario en columnas sin citas fuera de horario', () => {
    renderGrid([appointment({ startsAt: `${DAY}T06:15`, endsAt: `${DAY}T07:00` })])

    expect(within(screen.getByRole('region', { name: 'Recurso Cabina 2' })).queryByRole('listitem', { name: 'Fuera de horario' })).not.toBeInTheDocument()
  })

  it('un recurso inactivo con citas ese día no ofrece crear', () => {
    renderGrid([appointment({ resourceId: 3 })])

    const column = within(screen.getByRole('region', { name: 'Recurso Manicure (Rosa)' }))
    expect(column.queryByRole('button', { name: /Crear cita/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear cita en Cabina 1 a las 08:00' })).toBeInTheDocument()
  })

  it('el título de cada columna es un encabezado de nivel 2', () => {
    renderGrid([])

    expect(screen.getByRole('heading', { level: 2, name: 'Cabina 1' })).toBeInTheDocument()
  })

  it('posiciona la cita en su recurso y su franja con cliente, servicio y estado', () => {
    renderGrid([appointment({ resourceId: 2, startsAt: `${DAY}T10:30`, endsAt: `${DAY}T11:30` })])

    const box = screen.getByRole('region', { name: 'Recurso Cabina 2' }).querySelector<HTMLElement>('[data-slot="appointment-box"]')
    expect(box?.style.top).toBe('calc(var(--slot-height) * 5)')
    const card = within(box as HTMLElement).getByRole('article')
    expect(card).toHaveTextContent('María González')
    expect(card).toHaveTextContent('Limpieza facial')
    expect(card).toHaveTextContent('Programada')
    expect(within(screen.getByRole('region', { name: 'Recurso Cabina 1' })).queryByRole('article')).not.toBeInTheDocument()
  })

  it('ignora citas de otros días', () => {
    renderGrid([appointment({ startsAt: '2026-11-14T10:00', endsAt: '2026-11-14T11:00' })])

    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('un hueco vacío es clicable y notifica recurso y hora', async () => {
    const { onCreateAt, user } = renderGrid([])

    await user.click(screen.getByRole('button', { name: 'Crear cita en Cabina 2 a las 08:30' }))

    expect(onCreateAt).toHaveBeenCalledWith(2, `${DAY}T08:30`)
  })

  it('las franjas cubiertas por una cita no ofrecen crear', () => {
    renderGrid([appointment()])

    expect(screen.queryByRole('button', { name: 'Crear cita en Cabina 1 a las 10:00' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear cita en Cabina 1 a las 10:30' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear cita en Cabina 1 a las 11:00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear cita en Cabina 2 a las 10:00' })).toBeInTheDocument()
  })

  it('una cita cancelada libera la franja para crear', () => {
    renderGrid([appointment({ status: 'cancelled' })])

    expect(screen.getByRole('button', { name: 'Crear cita en Cabina 1 a las 10:30' })).toBeInTheDocument()
  })

  it('sin permiso de escritura no hay huecos clicables ni acciones', () => {
    renderGrid([appointment()], false)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reenvía Cancelar y Mover de la tarjeta', async () => {
    const row = appointment()
    const { onCancel, onMove, user } = renderGrid([row])

    await user.click(screen.getByRole('button', { name: 'Cancelar cita de María González' }))
    await user.click(screen.getByRole('button', { name: 'Mover cita de María González' }))

    expect(onCancel).toHaveBeenCalledWith(row)
    expect(onMove).toHaveBeenCalledWith(row)
  })

  it('muestra un mensaje cuando no hay recursos', () => {
    renderWithProviders(
      <DayGrid date={DAY} resources={[]} appointments={[]} labels={labels} canWrite onCreateAt={vi.fn()} onCancel={vi.fn()} onMove={vi.fn()} />,
    )

    expect(screen.getByText('No hay recursos activos para mostrar')).toBeInTheDocument()
  })

  it('todas las cabinas tienen la misma cantidad de franjas aunque solo una tenga citas', () => {
    renderGrid([appointment({ resourceId: 1, startsAt: `${DAY}T16:30`, endsAt: `${DAY}T17:30` })])

    const tracks = Array.from(document.querySelectorAll('[data-slot="slot-track"]'))
    expect(tracks).toHaveLength(2)
    tracks.forEach((track) => expect(track.querySelectorAll('[data-slot="hour"]')).toHaveLength(32))
    expect(document.querySelectorAll('[data-slot="appointment-box"]')).toHaveLength(1)
  })
})
