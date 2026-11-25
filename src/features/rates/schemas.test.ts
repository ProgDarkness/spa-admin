import { describe, expect, it } from 'vitest'
import { rateFormFieldsSchema, rateFormSchema } from './schemas'

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

const INVALID_DATE_MESSAGE = 'Ingresa una fecha válida'

describe('fechas inexistentes', () => {
  it.each(['2026-02-31', '2026-13-45'])('rateFormFieldsSchema rechaza %s en el campo date con mensaje en español', (date) => {
    const result = rateFormFieldsSchema.safeParse({ date, rateText: '36,50' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['date'])
    expect(result.error?.issues[0]?.message).toBe(INVALID_DATE_MESSAGE)
  })

  it.each(['2026-02-31', '2026-13-45'])('rateFormSchema rechaza %s en el campo date con mensaje en español', (date) => {
    const result = rateFormSchema.safeParse({ date, rateText: '36,50' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['date'])
    expect(result.error?.issues[0]?.message).toBe(INVALID_DATE_MESSAGE)
  })
})

describe('años soportados de la tasa', () => {
  it.each(['0000-01-01', '0001-01-01', '1999-12-31', '2100-01-01', '9999-12-31'])(
    'rechaza %s en los dos esquemas con mensaje en español',
    (date) => {
      const fields = rateFormFieldsSchema.safeParse({ date, rateText: '36,50' })
      const form = rateFormSchema.safeParse({ date, rateText: '36,50' })

      expect(fields.error?.issues[0]?.path).toEqual(['date'])
      expect(fields.error?.issues[0]?.message).toBe(INVALID_DATE_MESSAGE)
      expect(form.error?.issues[0]?.path).toEqual(['date'])
      expect(form.error?.issues[0]?.message).toBe(INVALID_DATE_MESSAGE)
    },
  )

  it.each(['2000-01-01', '2099-12-31'])('acepta %s en los dos esquemas', (date) => {
    expect(rateFormFieldsSchema.safeParse({ date, rateText: '36,50' }).success).toBe(true)
    expect(rateFormSchema.safeParse({ date, rateText: '36,50' }).success).toBe(true)
  })
})
