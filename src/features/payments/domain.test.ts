import { describe, expect, it } from 'vitest'
import type { Payment } from '@/lib/model'
import { rateInputText, sumActivePayments, usdTotalOfActivePayments } from './domain'

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 1,
    appointmentId: 1,
    methodId: 1,
    currency: 'USD',
    amountCents: 1000,
    rateBsPerUsdE4: null,
    usdEquivalentCents: 1000,
    paidAt: '2026-11-12T09:00',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

const VOIDED = { voidedAt: '2026-11-12T10:00', voidedBy: 1, voidReason: 'error' }

describe('sumActivePayments', () => {
  it('devuelve ceros sin pagos', () => {
    expect(sumActivePayments([])).toEqual({ USD: 0, VES: 0 })
  })

  it('suma por moneda sin convertir', () => {
    const total = sumActivePayments([
      payment({ id: 1, amountCents: 2000 }),
      payment({ id: 2, amountCents: 500 }),
      payment({ id: 3, currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000, usdEquivalentCents: 2000 }),
    ])

    expect(total).toEqual({ USD: 2500, VES: 73000 })
  })

  it('excluye los pagos anulados', () => {
    const total = sumActivePayments([
      payment({ id: 1, amountCents: 2000 }),
      payment({ id: 2, amountCents: 999, ...VOIDED }),
    ])

    expect(total).toEqual({ USD: 2000, VES: 0 })
  })

  it('no muta la lista recibida', () => {
    const payments = Object.freeze([Object.freeze(payment({}))])

    expect(() => sumActivePayments(payments)).not.toThrow()
  })
})

describe('usdTotalOfActivePayments', () => {
  it('suma los equivalentes USD de los activos', () => {
    const total = usdTotalOfActivePayments([
      payment({ id: 1, amountCents: 2000, usdEquivalentCents: 2000 }),
      payment({ id: 2, currency: 'VES', amountCents: 73000, rateBsPerUsdE4: 365000, usdEquivalentCents: 2000 }),
      payment({ id: 3, usdEquivalentCents: 7777, ...VOIDED }),
    ])

    expect(total).toBe(4000)
  })

  it('devuelve cero sin pagos', () => {
    expect(usdTotalOfActivePayments([])).toBe(0)
  })
})

describe('rateInputText', () => {
  it.each([
    [365000, '36,50'],
    [361234, '36,1234'],
    [361230, '36,123'],
    [361200, '36,12'],
    [361000, '36,10'],
    [1, '0,0001'],
    [10000, '1,00'],
  ])('formatea %s como %s', (rate, expected) => {
    expect(rateInputText(rate)).toBe(expected)
  })
})
