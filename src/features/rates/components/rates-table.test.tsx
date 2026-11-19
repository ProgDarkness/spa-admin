import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ExchangeRate } from '@/lib/model'
import { RatesTable } from './rates-table'

const RATES: readonly ExchangeRate[] = [
  { date: '2026-11-12', rateBsPerUsdE4: 365000 },
  { date: '2026-11-11', rateBsPerUsdE4: 364500 },
]

describe('RatesTable', () => {
  it('muestra una fila por tasa con la tasa formateada', () => {
    render(<RatesTable rates={RATES} />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('2026-11-12')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('36,50')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('36,45')).toBeInTheDocument()
  })

  it('rotula las columnas y la tabla', () => {
    render(<RatesTable rates={RATES} />)

    expect(screen.getByRole('table', { name: 'Tasas de cambio' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Fecha' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Bs por USD' })).toBeInTheDocument()
  })

  it('informa cuando no hay tasas registradas', () => {
    render(<RatesTable rates={[]} />)

    expect(screen.getByText('Aún no hay tasas registradas.').closest('[data-slot="empty-state"]')).not.toBeNull()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
