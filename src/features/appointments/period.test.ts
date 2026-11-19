import { describe, expect, it } from 'vitest'
import { formatDayLabel, formatPeriodLabel, periodRangeOf, shiftDate } from './period'

describe('periodRangeOf', () => {
  it('en vista día el rango es la misma fecha', () => {
    expect(periodRangeOf('day', '2026-11-12')).toEqual({ from: '2026-11-12', to: '2026-11-12' })
  })

  it('en vista semana va de lunes a domingo', () => {
    expect(periodRangeOf('week', '2026-11-12')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
  })

  it('un lunes abre su propia semana y un domingo la cierra', () => {
    expect(periodRangeOf('week', '2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(periodRangeOf('week', '2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
  })

  it('cruza el fin de año', () => {
    expect(periodRangeOf('week', '2026-12-31')).toEqual({ from: '2026-12-28', to: '2027-01-03' })
  })
})

describe('shiftDate', () => {
  it('mueve un día en vista día', () => {
    expect(shiftDate('day', '2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDate('day', '2026-11-01', -1)).toBe('2026-10-31')
  })

  it('mueve siete días en vista semana', () => {
    expect(shiftDate('week', '2026-11-12', 1)).toBe('2026-11-19')
    expect(shiftDate('week', '2026-11-12', -1)).toBe('2026-11-05')
  })
})

describe('etiquetas', () => {
  it('formatDayLabel describe el día en español', () => {
    expect(formatDayLabel('2026-11-12')).toMatch(/jueves/i)
    expect(formatDayLabel('2026-11-12')).toMatch(/12/)
  })

  it('formatPeriodLabel en vista día es la etiqueta del día', () => {
    expect(formatPeriodLabel('day', '2026-11-12')).toBe(formatDayLabel('2026-11-12'))
  })

  it('formatPeriodLabel en vista semana menciona ambos extremos', () => {
    const label = formatPeriodLabel('week', '2026-11-12')

    expect(label).toMatch(/9/)
    expect(label).toMatch(/15/)
  })
})
