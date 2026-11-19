import { describe, expect, it } from 'vitest'
import { MAX_RATE_E4 } from '@/lib/money'
import { rateFormFieldsSchema, rateFormSchema, rateInputSchema } from './schemas'

describe('rateFormFieldsSchema', () => {
  it('conserva el texto y rechaza más de 4 decimales', () => {
    expect(rateFormFieldsSchema.safeParse({ date: '2026-11-12', rateText: '36,50' })).toMatchObject({
      success: true,
      data: { rateText: '36,50' },
    })
    expect(rateFormFieldsSchema.safeParse({ date: '2026-11-12', rateText: '36.12345' }).success).toBe(false)
  })
})

describe('rateFormSchema', () => {
  it('convierte el texto 36,50 en 365000', () => {
    const result = rateFormSchema.safeParse({ date: '2026-11-12', rateText: '36,50' })

    expect(result).toMatchObject({ success: true, data: { date: '2026-11-12', rateBsPerUsdE4: 365000 } })
  })

  it('acepta punto decimal y hasta cuatro decimales', () => {
    const result = rateFormSchema.safeParse({ date: '2026-11-12', rateText: '36.1234' })

    expect(result).toMatchObject({ success: true, data: { rateBsPerUsdE4: 361234 } })
  })

  it.each(['36.12345', '-1', '0', '0,0000', 'abc', '', ' ', 'NaN', '1e3'])('rechaza la tasa %j', (rateText) => {
    const result = rateFormSchema.safeParse({ date: '2026-11-12', rateText })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['rateText'])
  })

  it('rechaza una tasa que excede el máximo', () => {
    const result = rateFormSchema.safeParse({ date: '2026-11-12', rateText: '99999999999' })

    expect(result.success).toBe(false)
  })

  it.each(['', '12/11/2026', '2026-11-1', '2026-11-12T09:00'])('rechaza la fecha %j', (date) => {
    const result = rateFormSchema.safeParse({ date, rateText: '36,50' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['date'])
  })
})

describe('fechas inexistentes', () => {
  it.each(['2026-02-31', '2026-13-45'])('rateInputSchema rechaza %s con mensaje en español', (date) => {
    const result = rateInputSchema.safeParse({ date, rateBsPerUsdE4: 365000 })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Ingresa una fecha válida')
  })

  it.each(['2026-02-31', '2026-13-45'])('rateFormFieldsSchema rechaza %s en el campo date', (date) => {
    const result = rateFormFieldsSchema.safeParse({ date, rateText: '36,50' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['date'])
  })

  it.each(['2026-02-31', '2026-13-45'])('rateFormSchema rechaza %s en el campo date', (date) => {
    const result = rateFormSchema.safeParse({ date, rateText: '36,50' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['date'])
  })
})

describe('rateInputSchema', () => {
  it('acepta una tasa entera dentro del rango', () => {
    expect(rateInputSchema.safeParse({ date: '2026-11-12', rateBsPerUsdE4: 1 }).success).toBe(true)
    expect(rateInputSchema.safeParse({ date: '2026-11-12', rateBsPerUsdE4: MAX_RATE_E4 }).success).toBe(true)
  })

  it.each([0, -5, 1.5, Number.NaN, MAX_RATE_E4 + 1, Infinity])('rechaza la tasa %s', (rateBsPerUsdE4) => {
    expect(rateInputSchema.safeParse({ date: '2026-11-12', rateBsPerUsdE4 }).success).toBe(false)
  })

  it('rechaza una fecha con formato inválido', () => {
    expect(rateInputSchema.safeParse({ date: '12-11-2026', rateBsPerUsdE4: 365000 }).success).toBe(false)
  })
})
