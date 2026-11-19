import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MonthlyMetrics } from '@/lib/model'
import { MetricsCards } from './metrics-cards'

const metrics: MonthlyMetrics = {
  month: '2026-11',
  newClients: 1,
  recurringClients: 2,
  appointments: { scheduled: 3, inProgress: 7, completed: 4, cancelled: 5, noShow: 6 },
  revenueByCurrency: { USD: 0, VES: 0 },
  collectedOnNonCompletedByCurrency: { USD: 0, VES: 0 },
}

function valueOf(label: string): string {
  const term = screen.getByText(label)
  const group = term.closest('div')
  if (!group) throw new Error('grupo inexistente')
  const figure = group.querySelector('[data-slot="figure"]')
  if (!figure) throw new Error('cifra inexistente')
  return figure.textContent ?? ''
}

describe('MetricsCards', () => {
  it('muestra clientes nuevos y recurrentes', () => {
    render(<MetricsCards metrics={metrics} />)

    expect(valueOf('Clientes nuevos')).toBe('1')
    expect(valueOf('Clientes recurrentes')).toBe('2')
  })

  it('muestra las citas por estado', () => {
    render(<MetricsCards metrics={metrics} />)

    expect(valueOf('Programadas')).toBe('3')
    expect(valueOf('En curso')).toBe('7')
    expect(valueOf('Completadas')).toBe('4')
    expect(valueOf('Canceladas')).toBe('5')
    expect(valueOf('No asistió')).toBe('6')
  })

  it('renderiza los títulos de tarjeta en font-serif', () => {
    render(<MetricsCards metrics={metrics} />)

    for (const heading of screen.getAllByRole('heading')) expect(heading.closest('.font-serif')).not.toBeNull()
  })
})
