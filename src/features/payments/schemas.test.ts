import { describe, expect, it } from 'vitest'
import { MAX_AMOUNT_CENTS, MAX_RATE_E4 } from '@/lib/money'
import { paymentFormSchema, paymentInputSchema, voidFormSchema, voidReasonSchema } from './schemas'

const VALID_INPUT = { appointmentId: 1, methodId: 1, currency: 'USD', amountCents: 2500, rateBsPerUsdE4: null }

describe('paymentInputSchema', () => {
  it('acepta un pago USD sin tasa', () => {
    expect(paymentInputSchema.safeParse(VALID_INPUT).success).toBe(true)
  })

  it('acepta un pago VES con tasa entera positiva', () => {
    expect(paymentInputSchema.safeParse({ ...VALID_INPUT, currency: 'VES', rateBsPerUsdE4: 365000 }).success).toBe(true)
  })

  it.each([
    ['amountCents', 0],
    ['amountCents', -1],
    ['amountCents', 10.5],
    ['amountCents', MAX_AMOUNT_CENTS + 1],
    ['amountCents', Number.NaN],
    ['rateBsPerUsdE4', 0],
    ['rateBsPerUsdE4', 1.5],
    ['rateBsPerUsdE4', MAX_RATE_E4 + 1],
    ['methodId', 0],
    ['appointmentId', 1.2],
    ['currency', 'EUR'],
  ])('rechaza %s = %s indicando el campo', (field, value) => {
    const result = paymentInputSchema.safeParse({ ...VALID_INPUT, [field]: value })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path.join('.')).toBe(field)
  })

  it('acepta los límites máximos', () => {
    const result = paymentInputSchema.safeParse({
      ...VALID_INPUT,
      currency: 'VES',
      amountCents: MAX_AMOUNT_CENTS,
      rateBsPerUsdE4: MAX_RATE_E4,
    })

    expect(result.success).toBe(true)
  })
})

describe('paymentFormSchema', () => {
  const FORM = { methodId: '2', currency: 'VES', amount: '10', rate: '36,5' }

  it('convierte texto de monto y tasa a céntimos y E4', () => {
    const result = paymentFormSchema.safeParse({ ...FORM, amount: '1250,50' })

    expect(result.success && result.data).toEqual({
      methodId: 2,
      currency: 'VES',
      amountCents: 125050,
      rateBsPerUsdE4: 365000,
    })
  })

  it('usa tasa null cuando la moneda es USD aunque haya texto de tasa', () => {
    const result = paymentFormSchema.safeParse({ methodId: '1', currency: 'USD', amount: '25', rate: '36,5' })

    expect(result.success && result.data).toEqual({ methodId: 1, currency: 'USD', amountCents: 2500, rateBsPerUsdE4: null })
  })

  it('usa tasa null en VES cuando el texto de tasa está vacío', () => {
    const result = paymentFormSchema.safeParse({ ...FORM, rate: '  ' })

    expect(result.success && result.data.rateBsPerUsdE4).toBeNull()
  })

  it.each([
    ['amount', 'abc'],
    ['amount', '0'],
    ['amount', ''],
    ['amount', '1,234'],
    ['methodId', ''],
    ['rate', '0'],
    ['rate', '1,23456'],
  ])('rechaza %s = "%s" con el campo', (field, value) => {
    const result = paymentFormSchema.safeParse({ ...FORM, [field]: value })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path.join('.')).toBe(field)
  })
})

describe('motivo de anulación', () => {
  it('recorta espacios', () => {
    expect(voidFormSchema.parse({ reason: '  error de monto  ' })).toEqual({ reason: 'error de monto' })
  })

  it.each(['', '   ', '\n\t'])('rechaza el motivo vacío %j', (reason) => {
    const result = voidFormSchema.safeParse({ reason })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path.join('.')).toBe('reason')
  })

  it('rechaza motivos de más de 200 caracteres', () => {
    expect(voidReasonSchema.safeParse('x'.repeat(201)).success).toBe(false)
    expect(voidReasonSchema.safeParse('x'.repeat(200)).success).toBe(true)
  })
})
