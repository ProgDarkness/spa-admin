import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ClientHistory, ClientHistoryEntry, Payment } from '@/lib/model'
import { formatCents } from '@/lib/money'
import { appointmentTemplate } from '@/test/appointment-fixtures'
import { HistorySummary } from './history-summary'

const normalized = (text: string) => text.replace(/\s+/g, ' ')

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 1,
    appointmentId: 100,
    methodId: 1,
    currency: 'VES',
    amountCents: 73000,
    rateBsPerUsdE4: 365000,
    usdEquivalentCents: 2000,
    paidAt: '2026-11-12T09:00',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

function entry(overrides: Partial<ClientHistoryEntry>): ClientHistoryEntry {
  return { ...appointmentTemplate(), serviceName: 'Facial', resourceName: 'Cabina 1', payments: [], ...overrides }
}

function historyWith(overrides: Partial<ClientHistory>): ClientHistory {
  return {
    client: { id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '0414', deletedAt: null },
    entries: [],
    totalMinutes: 0,
    paidByCurrency: { USD: 0, VES: 0 },
    collectedOnNonCompletedByCurrency: { USD: 0, VES: 0 },
    pendingByCurrency: { USD: 0, VES: 0 },
    vesUsdEquivalentOfCompleted: 0,
    ...overrides,
  }
}

function summary() {
  return within(screen.getByRole('region', { name: 'Resumen' }))
}

function textOf(label: string): string {
  return normalized(summary().getByText(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`)).textContent ?? '')
}

describe('HistorySummary', () => {
  it('la región de totales anuncia sus cambios con aria-live polite', () => {
    render(<HistorySummary history={historyWith({})} />)

    expect(screen.getByRole('region', { name: 'Resumen' })).toHaveAttribute('aria-live', 'polite')
  })

  it('sin datos muestra ceros y 0 min', () => {
    render(<HistorySummary history={historyWith({})} />)

    expect(summary().getByText('Tiempo total en servicios completados: 0 min')).toBeInTheDocument()
    expect(textOf('Pagado en USD')).toBe(normalized(`Pagado en USD: ${formatCents(0, 'USD')}`))
    expect(textOf('Pagado en VES')).toBe(normalized(`Pagado en VES: ${formatCents(0, 'VES')}`))
    expect(textOf('Equivalente en USD')).toBe(normalized(`Equivalente en USD de pagos en VES: ${formatCents(0, 'USD')}`))
  })

  it('formatea minutos en horas y minutos', () => {
    render(<HistorySummary history={historyWith({ totalMinutes: 135 })} />)

    expect(summary().getByText('Tiempo total en servicios completados: 2 h 15 min')).toBeInTheDocument()
  })

  it('formatea horas exactas sin minutos', () => {
    render(<HistorySummary history={historyWith({ totalMinutes: 120 })} />)

    expect(summary().getByText('Tiempo total en servicios completados: 2 h')).toBeInTheDocument()
  })

  it('muestra los totales pagados por moneda sin mezclarlos', () => {
    render(<HistorySummary history={historyWith({ paidByCurrency: { USD: 5500, VES: 73000 } })} />)

    expect(textOf('Pagado en USD')).toBe(normalized(`Pagado en USD: ${formatCents(5500, 'USD')}`))
    expect(textOf('Pagado en VES')).toBe(normalized(`Pagado en VES: ${formatCents(73000, 'VES')}`))
  })

  it('muestra lo cobrado en citas no completadas por moneda', () => {
    render(<HistorySummary history={historyWith({ collectedOnNonCompletedByCurrency: { USD: 1500, VES: 4000 } })} />)

    expect(textOf('Cobrado en citas no completadas en USD')).toBe(
      normalized(`Cobrado en citas no completadas en USD: ${formatCents(1500, 'USD')}`),
    )
    expect(textOf('Cobrado en citas no completadas en VES')).toBe(
      normalized(`Cobrado en citas no completadas en VES: ${formatCents(4000, 'VES')}`),
    )
  })

  it('muestra el equivalente USD de pagos en VES que entrega Rust sin recalcularlo', () => {
    const entries = [entry({ id: 1, status: 'completed', payments: [payment({ id: 1, usdEquivalentCents: 1 })] })]
    render(<HistorySummary history={historyWith({ entries, vesUsdEquivalentOfCompleted: 2000 })} />)

    expect(textOf('Equivalente en USD')).toBe(normalized(`Equivalente en USD de pagos en VES: ${formatCents(2000, 'USD')}`))
  })

  it('muestra los cobros pendientes de citas programadas o en curso por moneda', () => {
    render(<HistorySummary history={historyWith({ pendingByCurrency: { USD: 1500, VES: 73000 } })} />)

    expect(textOf('Cobros pendientes (citas programadas o en curso) en USD')).toBe(
      normalized(`Cobros pendientes (citas programadas o en curso) en USD: ${formatCents(1500, 'USD')}`),
    )
    expect(textOf('Cobros pendientes (citas programadas o en curso) en VES')).toBe(
      normalized(`Cobros pendientes (citas programadas o en curso) en VES: ${formatCents(73000, 'VES')}`),
    )
  })

  it('los cobros pendientes no se mezclan con lo cobrado en citas no completadas', () => {
    render(
      <HistorySummary
        history={historyWith({ pendingByCurrency: { USD: 100, VES: 0 }, collectedOnNonCompletedByCurrency: { USD: 900, VES: 0 } })}
      />,
    )

    expect(textOf('Cobros pendientes (citas programadas o en curso) en USD')).toContain(normalized(formatCents(100, 'USD')))
    expect(textOf('Cobrado en citas no completadas en USD')).toContain(normalized(formatCents(900, 'USD')))
  })
})
