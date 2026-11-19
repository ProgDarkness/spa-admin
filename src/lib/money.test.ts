import { describe, expect, it } from 'vitest'
import {
  MAX_AMOUNT_CENTS,
  MAX_RATE_E4,
  RATE_SCALE,
  addAmount,
  emptyAmounts,
  formatCents,
  formatRateE4,
  parseCents,
  parseRateE4,
  usdEquivalentCents,
} from './money'

describe('constantes', () => {
  it('expone la escala y los topes del diseño', () => {
    expect(RATE_SCALE).toBe(10_000)
    expect(MAX_AMOUNT_CENTS).toBe(100_000_000_000)
    expect(MAX_RATE_E4).toBe(100_000_000_000)
  })
})

describe('usdEquivalentCents', () => {
  it('convierte 1000,00 Bs a tasa 36,50 redondeando half-up', () => {
    expect(usdEquivalentCents(100_000, 365_000)).toBe(2_740)
  })

  it('el caso exacto .5 sube', () => {
    expect(usdEquivalentCents(1, 20_000)).toBe(1)
    expect(usdEquivalentCents(3, 20_000)).toBe(2)
  })

  it('justo por debajo de .5 baja', () => {
    expect(usdEquivalentCents(1, 20_001)).toBe(0)
    expect(usdEquivalentCents(1, 30_000)).toBe(0)
  })

  it('resultado exacto no se altera', () => {
    expect(usdEquivalentCents(146_000, 365_000)).toBe(4_000)
  })

  it('no pierde precisión con el monto máximo permitido', () => {
    const expected = Number((2n * BigInt(MAX_AMOUNT_CENTS) * 10_000n + 365_000n) / 730_000n)
    expect(usdEquivalentCents(MAX_AMOUNT_CENTS, 365_000)).toBe(expected)
  })

  it('monto cero da cero', () => {
    expect(usdEquivalentCents(0, 365_000)).toBe(0)
  })

  it('rechaza entradas que no son enteros seguros', () => {
    expect(() => usdEquivalentCents(1.5, 365_000)).toThrow(RangeError)
    expect(() => usdEquivalentCents(Number.MAX_SAFE_INTEGER + 1, 365_000)).toThrow(RangeError)
    expect(() => usdEquivalentCents(Number.NaN, 365_000)).toThrow(RangeError)
    expect(() => usdEquivalentCents(100, 0)).toThrow(RangeError)
    expect(() => usdEquivalentCents(100, -5)).toThrow(RangeError)
    expect(() => usdEquivalentCents(-100, 365_000)).toThrow(RangeError)
  })

  it('rechaza un resultado que excede el rango seguro', () => {
    expect(() => usdEquivalentCents(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError)
  })
})

describe('parseRateE4', () => {
  it.each([
    ['36,5', 365_000],
    ['36.5', 365_000],
    ['36', 360_000],
    ['36,1234', 361_234],
    ['0,0001', 1],
    [' 36,50 ', 365_000],
  ])('%s => %s', (text, expected) => {
    expect(parseRateE4(text)).toBe(expected)
  })

  it.each(['36.12345', '-1', '0', '0,0000', '', '  ', 'abc', '36,', ',5', '1e3', '36,5,1', '36 5'])('%j => null', (text) => {
    expect(parseRateE4(text)).toBeNull()
  })

  it('rechaza valores sobre el tope', () => {
    expect(parseRateE4('10000001')).toBeNull()
    expect(parseRateE4('10000000')).toBe(MAX_RATE_E4)
  })
})

describe('formatRateE4', () => {
  it('muestra al menos dos decimales con coma', () => {
    expect(formatRateE4(365_000)).toBe('36,50')
    expect(formatRateE4(360_000)).toBe('36,00')
  })

  it('conserva hasta cuatro decimales', () => {
    expect(formatRateE4(123_456)).toBe('12,3456')
  })

  it('es inverso de parseRateE4', () => {
    expect(parseRateE4(formatRateE4(361_234))).toBe(361_234)
  })
})

describe('parseCents', () => {
  it.each([
    ['25,5', 2_550],
    ['25.50', 2_550],
    ['25', 2_500],
    ['0', 0],
    ['0,01', 1],
    [' 10,05 ', 1_005],
  ])('%s => %s', (text, expected) => {
    expect(parseCents(text)).toBe(expected)
  })

  it.each(['25.555', '-1', '', 'abc', '25,', ',5', '1e2', '1,2,3'])('%j => null', (text) => {
    expect(parseCents(text)).toBeNull()
  })

  it('rechaza montos sobre el tope', () => {
    expect(parseCents('1000000000,01')).toBeNull()
    expect(parseCents('1000000000')).toBe(MAX_AMOUNT_CENTS)
  })
})

describe('formatCents', () => {
  it('formatea USD con coma decimal es-VE', () => {
    expect(formatCents(2_550, 'USD')).toMatch(/25,50/)
    expect(formatCents(2_550, 'USD')).toMatch(/USD|\$/)
  })

  it('formatea VES con coma decimal es-VE', () => {
    expect(formatCents(2_550, 'VES')).toMatch(/25,50/)
    expect(formatCents(2_550, 'VES')).toMatch(/Bs|VES/)
  })

  it('formatea cero', () => {
    expect(formatCents(0, 'USD')).toMatch(/0,00/)
  })
})

describe('emptyAmounts / addAmount', () => {
  it('emptyAmounts devuelve ceros por moneda y una instancia nueva cada vez', () => {
    expect(emptyAmounts()).toEqual({ USD: 0, VES: 0 })
    expect(emptyAmounts()).not.toBe(emptyAmounts())
  })

  it('addAmount devuelve una copia y no muta el original', () => {
    const original = emptyAmounts()
    const next = addAmount(original, 'USD', 500)
    expect(next).toEqual({ USD: 500, VES: 0 })
    expect(original).toEqual({ USD: 0, VES: 0 })
    expect(next).not.toBe(original)
  })

  it('acumula por moneda sin mezclar', () => {
    const totals = addAmount(addAmount(addAmount(emptyAmounts(), 'USD', 100), 'VES', 7), 'USD', 50)
    expect(totals).toEqual({ USD: 150, VES: 7 })
  })
})
