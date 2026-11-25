import type { Currency } from '@/lib/model'
import { formatCents } from '@/lib/money'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { renderWithProviders } from '@/test/render'
import MetricsPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function valueOf(label: string): string {
  const group = screen.getByText(label).closest('div')
  if (!group) throw new Error('grupo inexistente')
  return within(group).getByRole('definition').textContent ?? ''
}

describe('MetricsPage', () => {
  it('abre en el mes actual con las métricas del seed', async () => {
    renderWithProviders(<MetricsPage />, { as: 'propietaria' })

    expect(screen.getByRole('heading', { level: 1, name: 'Métricas' })).toBeInTheDocument()
    expect(await screen.findByText('Clientes nuevos')).toBeInTheDocument()
    expect(screen.getByLabelText('Mes')).toHaveValue('2026-11')
    expect(valueOf('Clientes nuevos')).toBe('1')
    expect(valueOf('Clientes recurrentes')).toBe('2')
    expect(valueOf('Completadas')).toBe('3')
    expect(valueOf('En curso')).toBe('1')
    const revenue = screen.getByRole('region', { name: 'Ingreso del mes' })
    expect(within(revenue).getByText(amountMatcher(8000, 'USD'))).toBeInTheDocument()
    const advance = screen.getByRole('region', { name: 'Cobrado por adelantado (citas pendientes)' })
    expect(within(advance).getByText(amountMatcher(0, 'USD'))).toBeInTheDocument()
  })

  it('recalcula al cambiar de mes con el botón anterior', async () => {
    const { user } = renderWithProviders(<MetricsPage />, { as: 'propietaria' })
    await screen.findByText('Clientes nuevos')

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }))

    expect(screen.getByLabelText('Mes')).toHaveValue('2026-10')
    expect(await screen.findByText('Clientes nuevos')).toBeInTheDocument()
    await screen.findByText(amountMatcher(20500, 'USD'))
    expect(valueOf('Clientes nuevos')).toBe('4')
    expect(valueOf('Completadas')).toBe('6')
    expect(valueOf('En curso')).toBe('0')
  })

  it('en el último mes soportado deshabilita siguiente y muestra métricas válidas', async () => {
    renderWithProviders(<MetricsPage />, { as: 'propietaria' })
    await screen.findByText('Clientes nuevos')

    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '9998-12' } })

    expect(await screen.findByLabelText('Mes')).toHaveValue('9998-12')
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled()
    await waitFor(() => expect(valueOf('Completadas')).toBe('0'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('en el primer mes soportado deshabilita anterior y muestra métricas válidas', async () => {
    renderWithProviders(<MetricsPage />, { as: 'propietaria' })
    await screen.findByText('Clientes nuevos')

    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '0001-01' } })

    expect(await screen.findByLabelText('Mes')).toHaveValue('0001-01')
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled()
    await waitFor(() => expect(valueOf('Completadas')).toBe('0'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['recepcion', 'lectura'] as const)('%s ve un mensaje claro sin metrics.read', async (username) => {
    renderWithProviders(<MetricsPage />, { as: username })

    expect(await screen.findByText('No tienes permiso para ver las métricas')).toBeInTheDocument()
    expect(screen.queryByText('Clientes nuevos')).not.toBeInTheDocument()
  })

  it('sin sesión muestra el mensaje de permiso', async () => {
    renderWithProviders(<MetricsPage />)

    expect(await screen.findByText('No tienes permiso para ver las métricas')).toBeInTheDocument()
  })

  it('muestra el error de dominio si la consulta falla tras perder el permiso', async () => {
    const { user } = renderWithProviders(<MetricsPage />, { as: 'propietaria' })
    await screen.findByText('Clientes nuevos')
    signInAs('lectura')

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
  })
})

function amountMatcher(cents: number, currency: Currency): (content: string, element: Element | null) => boolean {
  const expected = formatCents(cents, currency).replace(/\s/g, ' ')
  return (_content, element) =>
    element?.tagName === 'DD' && (element.textContent ?? '').replace(/\s/g, ' ') === expected
}
