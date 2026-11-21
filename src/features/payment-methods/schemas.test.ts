import { describe, expect, it } from 'vitest'
import { paymentMethodInputSchema } from './schemas'

describe('paymentMethodInputSchema', () => {
  it('acepta un nombre válido y lo normaliza', () => {
    expect(paymentMethodInputSchema.parse({ name: '  Café   pago  ' })).toEqual({ name: 'Café pago' })
  })

  it.each(['', '   '])('rechaza el nombre vacío %j con mensaje en español sobre name', (name) => {
    const result = paymentMethodInputSchema.safeParse({ name })

    expect(!result.success && result.error.issues[0]?.message).toBe('Ingresa el nombre del método de pago')
    expect(!result.success && result.error.issues[0]?.path).toEqual(['name'])
  })

  it('rechaza más de 80 code points y caracteres no permitidos', () => {
    expect(paymentMethodInputSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false)
    expect(paymentMethodInputSchema.safeParse({ name: 'Sa​la' }).success).toBe(false)
  })

  it('rechaza campos faltantes y tipos inválidos', () => {
    expect(paymentMethodInputSchema.safeParse({}).success).toBe(false)
    expect(paymentMethodInputSchema.safeParse({ name: 5 }).success).toBe(false)
    expect(paymentMethodInputSchema.safeParse(null).success).toBe(false)
  })
})
