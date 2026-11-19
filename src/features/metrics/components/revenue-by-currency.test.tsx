import type { Currency } from '@/lib/model'
import { formatCents } from '@/lib/money'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RevenueByCurrency } from './revenue-by-currency'

describe('RevenueByCurrency', () => {
  it('muestra el ingreso por moneda formateado', () => {
    render(
      <RevenueByCurrency
        revenue={{ USD: 8000, VES: 73000 }}
        collectedOnNonCompleted={{ USD: 1500, VES: 0 }}
      />,
    )

    const revenue = screen.getByRole('region', { name: 'Ingreso del mes' })
    expect(within(revenue).getByText(amountMatcher(8000, 'USD'))).toBeInTheDocument()
    expect(within(revenue).getByText(amountMatcher(73000, 'VES'))).toBeInTheDocument()
  })

  it('muestra aparte el bloque de cobros en citas no completadas', () => {
    render(
      <RevenueByCurrency
        revenue={{ USD: 8000, VES: 73000 }}
        collectedOnNonCompleted={{ USD: 1500, VES: 4000 }}
      />,
    )

    const block = screen.getByRole('region', { name: 'Cobros en citas no completadas' })
    expect(within(block).getByText(amountMatcher(1500, 'USD'))).toBeInTheDocument()
    expect(within(block).getByText(amountMatcher(4000, 'VES'))).toBeInTheDocument()
    expect(within(block).getByText(/no cuentan como ingreso/i)).toBeInTheDocument()
  })

  it('renderiza los títulos de tarjeta en font-serif', () => {
    render(<RevenueByCurrency revenue={{ USD: 0, VES: 0 }} collectedOnNonCompleted={{ USD: 0, VES: 0 }} />)

    for (const heading of screen.getAllByRole('heading')) expect(heading.closest('.font-serif')).not.toBeNull()
  })
})

function amountMatcher(cents: number, currency: Currency): (content: string, element: Element | null) => boolean {
  const expected = formatCents(cents, currency).replace(/\s/g, ' ')
  return (_content, element) =>
    element?.getAttribute('data-slot') === 'figure' && (element.textContent ?? '').replace(/\s/g, ' ') === expected
}
