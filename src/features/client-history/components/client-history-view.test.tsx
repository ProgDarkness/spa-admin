import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { formatCents } from '@/lib/money'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { ClientHistoryView } from './client-history-view'

const MARIA_ID = 1
const JOSE_ID = 2
const ANA_ID = 3
const DELETED_CARLOS_ID = 9
const MISSING_ID = 9999

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function line(label: string, cents: number, currency: 'USD' | 'VES'): string {
  return `${label}: ${formatCents(cents, currency)}`.replace(/\u00a0/g, ' ')
}

async function summaryOf() {
  return within(await screen.findByRole('region', { name: 'Resumen' }))
}

describe('ClientHistoryView', () => {
  it('muestra el nombre y los datos del cliente', async () => {
    renderWithProviders(<ClientHistoryView clientId={MARIA_ID} />, { as: 'recepcion' })

    expect(await screen.findByRole('heading', { level: 1, name: 'María González' })).toBeInTheDocument()
    expect(screen.getByText('V-12345678')).toBeInTheDocument()
    expect(screen.getByText('0414-1234567')).toBeInTheDocument()
    expect(screen.queryByText('Eliminado')).not.toBeInTheDocument()
  })

  it('marca como Eliminado a un cliente borrado y conserva su historial', async () => {
    renderWithProviders(<ClientHistoryView clientId={DELETED_CARLOS_ID} />, { as: 'recepcion' })

    expect(await screen.findByText('Eliminado')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('resume minutos, pagado por moneda y equivalente USD de pagos en bolívares', async () => {
    renderWithProviders(<ClientHistoryView clientId={MARIA_ID} />, { as: 'recepcion' })

    const summary = await summaryOf()
    expect(summary.getByText('Tiempo total en servicios completados: 2 h')).toBeInTheDocument()
    expect(summary.getByText(line('Pagado en USD', 5500, 'USD'))).toBeInTheDocument()
    expect(summary.getByText(line('Pagado en VES', 73000, 'VES'))).toBeInTheDocument()
    expect(summary.getByText(line('Equivalente en USD de pagos en VES', 2000, 'USD'))).toBeInTheDocument()
  })

  it('resume los cobros en citas no completadas por moneda', async () => {
    renderWithProviders(<ClientHistoryView clientId={ANA_ID} />, { as: 'recepcion' })

    const summary = await summaryOf()
    expect(summary.getByText(line('Cobrado en citas no completadas en USD', 1500, 'USD'))).toBeInTheDocument()
    expect(summary.getByText(line('Cobrado en citas no completadas en VES', 0, 'VES'))).toBeInTheDocument()
    expect(summary.getByText('Tiempo total en servicios completados: 0 min')).toBeInTheDocument()
  })

  it('lista las citas de más reciente a más antigua con servicio, recurso y estado en español', async () => {
    renderWithProviders(<ClientHistoryView clientId={MARIA_ID} />, { as: 'recepcion' })

    const items = within(await screen.findByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Programada')
    expect(items[0]).toHaveTextContent('Cabina 2')
    expect(items[1]).toHaveTextContent('Completada')
    expect(items[1]).toHaveTextContent('Masaje relajante (ejemplo)')
    expect(items[2]).toHaveTextContent('Limpieza facial (ejemplo)')
    expect(items[2]).toHaveTextContent('Cabina 1')
  })

  it('mantiene visible el servicio y recurso inactivos de una cita completada', async () => {
    renderWithProviders(<ClientHistoryView clientId={JOSE_ID} />, { as: 'recepcion' })

    const list = await screen.findByRole('list', { name: 'Historial de citas' })
    expect(within(list).getByText(/Peeling químico \(ejemplo\)/)).toBeInTheDocument()
    expect(within(list).getByText(/Manicure \(Rosa\)/)).toBeInTheDocument()
  })

  it('muestra los pagos de cada cita y marca los anulados', async () => {
    renderWithProviders(<ClientHistoryView clientId={JOSE_ID} />, { as: 'recepcion' })

    const list = await screen.findByRole('list', { name: 'Historial de citas' })
    expect(within(list).getByText('Anulado')).toBeInTheDocument()
  })

  it('el botón Pagos de una cita abre el diálogo de pagos', async () => {
    const { user } = renderWithProviders(<ClientHistoryView clientId={MARIA_ID} />, { as: 'recepcion' })

    const items = within(await screen.findByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')
    await user.click(within(items[1]!).getByRole('button', { name: 'Pagos' }))

    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
  })

  it('un cliente inexistente muestra el estado vacío con enlace a clientes', async () => {
    renderWithProviders(<ClientHistoryView clientId={MISSING_ID} />, { as: 'recepcion' })

    expect(await screen.findByText('Cliente no encontrado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a clientes' })).toHaveAttribute('href', '/clientes')
  })

  it('sin permiso de pagos oculta montos y explica el motivo', async () => {
    const withoutPayments = getState().users.map((user) =>
      user.username === 'recepcion'
        ? { ...user, permissions: user.permissions.filter((permission) => permission !== 'payments.read') }
        : user,
    )
    commit({ ...getState(), users: withoutPayments })
    renderWithProviders(<ClientHistoryView clientId={MARIA_ID} />, { as: 'recepcion' })

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para ver pagos ni el historial de este cliente')
    expect(screen.queryByRole('region', { name: 'Resumen' })).not.toBeInTheDocument()
    expect(screen.queryByText(/USD \d|Bs\.S/)).not.toBeInTheDocument()
  })
})
