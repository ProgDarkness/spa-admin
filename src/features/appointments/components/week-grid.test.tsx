import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Appointment, Client, Resource, Service } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { buildAppointmentLabels } from '../labels'
import { WeekGrid } from './week-grid'

const resources: Resource[] = [
  { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
  { id: 2, name: 'Cabina 2', kind: 'cabin', active: true },
  { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
]
const clients: Client[] = [
  { id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null },
  { id: 2, firstName: 'José', lastName: 'Rodríguez', nationalId: 'V-2', phone: '2', deletedAt: null },
]
const services: Service[] = [{ id: 1, name: 'Limpieza facial', priceCents: 3500, currency: 'USD', durationMin: 60, active: true }]
const labels = buildAppointmentLabels(clients, services, resources)

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 1,
    clientId: 1,
    serviceId: 1,
    resourceId: 1,
    startsAt: '2026-11-10T10:00',
    endsAt: '2026-11-10T11:00',
    status: 'scheduled',
    priceCentsSnapshot: 3500,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

function renderGrid(appointments: Appointment[], options: { selectedResourceId?: number | null; canWrite?: boolean } = {}) {
  const onResourceChange = vi.fn()
  const onCancel = vi.fn()
  const onMove = vi.fn()
  const user = userEvent.setup()
  renderWithProviders(
    <WeekGrid
      date="2026-11-12"
      resources={resources}
      selectedResourceId={options.selectedResourceId ?? null}
      appointments={appointments}
      labels={labels}
      canWrite={options.canWrite ?? true}
      onResourceChange={onResourceChange}
      onCancel={onCancel}
      onMove={onMove}
    />,
  )
  return { onResourceChange, onCancel, onMove, user }
}

describe('WeekGrid', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dibuja la línea de ahora solo en la sección de hoy', () => {
    freezeDate('2026-11-10T10:15')
    renderGrid([])

    const days = screen.getAllByRole('region')
    days.forEach((day, index) => {
      const line = day.querySelector('[data-now-line]')
      if (index === 1) expect(line).not.toBeNull()
      else expect(line).toBeNull()
    })
    expect(document.querySelectorAll('[data-now-line]')).toHaveLength(1)
  })

  it('no dibuja la línea de ahora si hoy está fuera de la semana mostrada', () => {
    freezeDate('2026-12-01T10:15')
    renderGrid([])

    expect(document.querySelector('[data-now-line]')).toBeNull()
  })

  it('muestra siete días de lunes 9 a domingo 15', () => {
    renderGrid([])

    const days = screen.getAllByRole('region')
    expect(days).toHaveLength(7)
    expect(days[0]).toHaveAccessibleName(/lunes.*9/i)
    expect(days[6]).toHaveAccessibleName(/domingo.*15/i)
  })

  it('agrupa cada cita en su día ordenada por hora', () => {
    renderGrid([
      appointment({ id: 1, startsAt: '2026-11-10T15:00', endsAt: '2026-11-10T16:00' }),
      appointment({ id: 2, clientId: 2, startsAt: '2026-11-10T09:00', endsAt: '2026-11-10T10:00' }),
      appointment({ id: 3, startsAt: '2026-11-15T09:00', endsAt: '2026-11-15T10:00' }),
    ])

    const [monday, tuesday, , , , , sunday] = screen.getAllByRole('region')
    const tuesdayCards = within(tuesday as HTMLElement).getAllByRole('article')
    expect(tuesdayCards[0]).toHaveAccessibleName('Cita de José Rodríguez a las 09:00')
    expect(tuesdayCards[1]).toHaveAccessibleName('Cita de María González a las 15:00')
    expect(within(monday as HTMLElement).queryByRole('article')).not.toBeInTheDocument()
    expect(within(sunday as HTMLElement).getAllByRole('article')).toHaveLength(1)
  })

  it('agrupa las citas anteriores a las 08:00 en Fuera de horario dentro de su día', () => {
    renderGrid([
      appointment({ id: 1, startsAt: '2026-11-10T06:15', endsAt: '2026-11-10T07:00' }),
      appointment({ id: 2, clientId: 2, startsAt: '2026-11-10T23:00', endsAt: '2026-11-10T23:30' }),
    ])

    const [, tuesday] = screen.getAllByRole('region')
    const outside = within(within(tuesday as HTMLElement).getByRole('group', { name: 'Fuera de horario' }))
    expect(outside.getAllByRole('article')).toHaveLength(1)
    expect(outside.getByRole('article')).toHaveAccessibleName('Cita de María González a las 06:15')
    expect(within(tuesday as HTMLElement).getAllByRole('article')).toHaveLength(2)
  })

  it('no muestra Fuera de horario cuando todas las citas están en horario', () => {
    renderGrid([appointment({})])

    expect(screen.queryByRole('group', { name: 'Fuera de horario' })).not.toBeInTheDocument()
  })

  it('el título de cada día es un encabezado de nivel 2', () => {
    renderGrid([])

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(7)
  })

  it('indica el recurso de cada cita y los días vacíos', () => {
    renderGrid([appointment({ resourceId: 2 })])

    const [monday, tuesday] = screen.getAllByRole('region')
    expect(within(tuesday as HTMLElement).getByText('Cabina 2')).toBeInTheDocument()
    expect(within(monday as HTMLElement).getByText('Sin citas')).toBeInTheDocument()
  })

  it('el selector de recurso ofrece todos los recursos activos y notifica el cambio', async () => {
    const { onResourceChange, user } = renderGrid([])

    const select = screen.getByLabelText('Recurso')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos los recursos',
      'Cabina 1',
      'Cabina 2',
    ])
    await user.selectOptions(select, 'Cabina 2')
    await user.selectOptions(select, 'Todos los recursos')

    expect(onResourceChange).toHaveBeenNthCalledWith(1, 2)
    expect(onResourceChange).toHaveBeenNthCalledWith(2, null)
  })

  it('refleja el recurso seleccionado', () => {
    renderGrid([], { selectedResourceId: 2 })

    expect(screen.getByLabelText('Recurso')).toHaveValue('2')
  })

  it('conserva como opción un recurso inactivo seleccionado', () => {
    renderGrid([], { selectedResourceId: 3 })

    expect(screen.getByRole('option', { name: 'Manicure (Rosa)' })).toBeInTheDocument()
  })

  it('reenvía Cancelar y Mover y los oculta sin permiso', async () => {
    const row = appointment({})
    const { onCancel, user } = renderGrid([row])

    await user.click(screen.getByRole('button', { name: 'Cancelar cita de María González' }))

    expect(onCancel).toHaveBeenCalledWith(row)
  })

  it('sin permiso de escritura no hay botones de cita', () => {
    renderGrid([appointment({})], { canWrite: false })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
