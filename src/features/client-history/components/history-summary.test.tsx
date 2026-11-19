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
    ...overrides,
  }
}

function summary() {
  return within(screen.getByRole('region', { name: 'Resumen' }))
}

function textOf(label: string): string {
  return normalized(summary().getByText(new RegExp(`^${label}`)).textContent ?? '')
}

describe('HistorySummary', () => {
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

  it('calcula el equivalente USD solo con pagos vigentes de citas completadas', () => {
    const entries = [
      entry({
        id: 1,
        status: 'completed',
        payments: [payment({ id: 1, usdEquivalentCents: 2000 }), payment({ id: 2, usdEquivalentCents: 900, voidedAt: '2026-11-12T10:00' })],
      }),
      entry({ id: 2, status: 'cancelled', payments: [payment({ id: 3, usdEquivalentCents: 700 })] }),
    ]
    render(<HistorySummary history={historyWith({ entries })} />)

    expect(textOf('Equivalente en USD')).toBe(normalized(`Equivalente en USD de pagos en VES: ${formatCents(2000, 'USD')}`))
  })
})
