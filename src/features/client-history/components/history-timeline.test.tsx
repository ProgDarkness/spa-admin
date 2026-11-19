import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { ClientHistoryEntry, Payment } from '@/lib/model'
import { formatCents } from '@/lib/money'
import { appointmentTemplate, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { renderWithProviders } from '@/test/render'
import { HistoryTimeline } from './history-timeline'

const normalized = (text: string | null) => (text ?? '').replace(/\s+/g, ' ')

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 1,
    appointmentId: 100,
    methodId: 1,
    currency: 'USD',
    amountCents: 2000,
    rateBsPerUsdE4: null,
    usdEquivalentCents: 2000,
    paidAt: '2026-11-12T09:00',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

function entry(overrides: Partial<ClientHistoryEntry>): ClientHistoryEntry {
  return { ...appointmentTemplate(), serviceName: 'Limpieza facial', resourceName: 'Cabina 1', payments: [], ...overrides }
}

beforeEach(() => {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: 100 }), appointmentTemplate({ id: 101 }))
  commit({ ...getState(), payments: [] })
})

describe('HistoryTimeline', () => {
  it('sin citas muestra el mensaje vacío y ninguna lista', () => {
    renderWithProviders(<HistoryTimeline entries={[]} />, { as: 'recepcion' })

    expect(screen.getByText('Este cliente aún no tiene citas.').closest('[data-slot="empty-state"]')).not.toBeNull()
    expect(screen.queryByRole('list', { name: 'Historial de citas' })).not.toBeInTheDocument()
  })

  it('conserva el orden recibido (más reciente primero) y muestra fecha, servicio, recurso y estado', async () => {
    const entries = [
      entry({ id: 100, startsAt: '2026-11-13T10:00', status: 'scheduled', serviceName: 'Masaje', resourceName: 'Cabina 2' }),
      entry({ id: 101, startsAt: '2026-11-01T08:30', status: 'completed' }),
    ]
    renderWithProviders(<HistoryTimeline entries={entries} />, { as: 'recepcion' })

    const items = within(await screen.findByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('2026-11-13 10:00')
    expect(items[0]).toHaveTextContent('Masaje · Cabina 2')
    expect(items[0]).toHaveTextContent('Programada')
    expect(items[1]).toHaveTextContent('2026-11-01 08:30')
    expect(items[1]).toHaveTextContent('Limpieza facial · Cabina 1')
    expect(items[1]).toHaveTextContent('Completada')
  })

  it('una cita sin pagos no muestra el grupo de pagos registrados', async () => {
    renderWithProviders(<HistoryTimeline entries={[entry({ id: 100 })]} />, { as: 'recepcion' })

    await screen.findByRole('list', { name: 'Historial de citas' })
    expect(screen.queryByRole('group', { name: 'Pagos registrados' })).not.toBeInTheDocument()
  })

  it('muestra pagos vigentes sin tachar y pagos anulados tachados con la marca Anulado', async () => {
    const active = payment({ id: 1, amountCents: 2000 })
    const voided = payment({ id: 2, amountCents: 999, voidedAt: '2026-11-12T09:30', voidedBy: 1, voidReason: 'Error' })
    renderWithProviders(<HistoryTimeline entries={[entry({ id: 100, payments: [active, voided] })]} />, { as: 'recepcion' })

    const group = await screen.findByRole('group', { name: 'Pagos registrados' })
    const entries = Array.from(group.querySelectorAll<HTMLElement>('[data-voided]'))
    expect(entries).toHaveLength(2)
    const [first, second] = entries as [HTMLElement, HTMLElement]
    expect(first).toHaveAttribute('data-voided', 'false')
    expect(second).toHaveAttribute('data-voided', 'true')
    expect(within(first).queryByRole('deletion')).not.toBeInTheDocument()
    expect(normalized(first.textContent ?? '')).toBe(normalized(formatCents(2000, 'USD')))
    expect(normalized(within(second).getByRole('deletion').textContent ?? '')).toBe(normalized(formatCents(999, 'USD')))
    expect(within(group).getAllByText('Anulado')).toHaveLength(1)
    expect(within(second).getByText('Anulado')).toBeInTheDocument()
  })

  it('el botón Pagos de cada cita abre el diálogo de pagos', async () => {
    const { user } = renderWithProviders(<HistoryTimeline entries={[entry({ id: 100 }), entry({ id: 101 })]} />, { as: 'recepcion' })

    const items = within(await screen.findByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')
    await user.click(within(items[1]!).getByRole('button', { name: 'Pagos' }))

    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
  })
})
