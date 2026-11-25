import { describe, expect, it } from 'vitest'
import vectors from './usd-equivalent-vectors.json'
import { MAX_AMOUNT_CENTS, usdEquivalentCents } from './money'

describe('usdEquivalentCents contra los vectores compartidos con Rust', () => {
  it.each(vectors)('$amountCents a tasa $rateE4 da $expected', ({ amountCents, rateE4, expected }) => {
    expect(usdEquivalentCents(amountCents, rateE4)).toBe(expected)
  })

  it('el equivalente máximo con el tope de monto y la tasa mínima cabe en un entero seguro', () => {
    const largest = usdEquivalentCents(MAX_AMOUNT_CENTS, 1)

    expect(Number.isSafeInteger(largest)).toBe(true)
    expect(largest).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    expect(vectors.some((vector) => vector.amountCents === MAX_AMOUNT_CENTS && vector.rateE4 === 1)).toBe(true)
  })

  it('todos los equivalentes de los vectores son enteros seguros', () => {
    expect(vectors.every((vector) => Number.isSafeInteger(vector.expected))).toBe(true)
  })
})
